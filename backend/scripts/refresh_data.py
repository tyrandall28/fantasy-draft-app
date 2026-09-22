"""One command to refresh every dataset, in the right order, and prove it worked.

    python -m scripts.refresh_data                # the normal weekly refresh
    python -m scripts.refresh_data --first-time   # empty database
    python -m scripts.refresh_data --rankings     # draft lists only (fast)
    python -m scripts.refresh_data --stats        # NFL stats only
    python -m scripts.refresh_data --stats --current-season
                                                  # what the daily cron runs
    python -m scripts.refresh_data --full-refresh # re-download, don't trust cache
    python -m scripts.refresh_data --dry-run      # show the plan, change nothing

Why this exists instead of a list of commands in a README: the stats steps feed
each other (weekly game logs -> season totals -> derived metrics), so running
them out of order, or stopping halfway, leaves the database looking populated
while the analytics pages read stale numbers. This runs them in order, refuses
to start if the schema is behind, takes a before/after row census, and finishes
by running the health check so you never have to wonder whether it took.

Nothing here is destructive unless you pass --full-refresh, and even that only
re-downloads the seasons you name.
"""
import argparse
import asyncio
import sys
import time
from datetime import datetime

from sqlalchemy import func, select, text

from app.database import async_session
from app.models.player import (
    BaseRanking,
    Player,
    PlayerBio,
    PlayerDerivedStats,
    PlayerSeason,
    PlayerWeeklyStat,
)
from app.nfl_season import current_nfl_season, default_stat_seasons

# Row census taken before and after, so the summary can show what moved.
CENSUS = {
    "players": Player,
    "player_bio": PlayerBio,
    "player_weekly_stats": PlayerWeeklyStat,
    "player_seasons": PlayerSeason,
    "player_derived_stats": PlayerDerivedStats,
    "base_rankings": BaseRanking,
}

# Exit codes. A scheduler can only see this number, so it's the whole
# vocabulary this script has for saying what went wrong.
EXIT_OK = 0
EXIT_INGEST_FAILED = 1       # a download or write failed — retrying may help
EXIT_USAGE = 2               # bad arguments — retrying will never help
EXIT_HEALTH_WARNING = 3      # data written, but the health check objects to it

STEP_NAMES = {
    1: "external IDs (links our players to nflverse)",
    2: "bio + combine measurables",
    3: "weekly game logs  <- the slow one, downloads from nflverse",
    4: "season totals      <- aggregates step 3",
    5: "snap counts        <- merges into steps 3 and 4",
    6: "derived metrics    <- powers Analytics and Ask AI",
}


def banner(text_: str) -> None:
    print(f"\n{'=' * 72}\n {text_}\n{'=' * 72}")


def step(text_: str) -> None:
    print(f"\n--- {text_} " + "-" * max(0, 67 - len(text_)))


async def census() -> dict[str, int]:
    async with async_session() as db:
        out = {}
        for name, model in CENSUS.items():
            out[name] = (
                await db.execute(select(func.count()).select_from(model))
            ).scalar() or 0
        return out


async def preflight() -> bool:
    """Refuse to run against a database whose schema is behind the migrations.

    Ingesting into a stale schema is how you get a confusing half-populated
    database, so this is a hard stop rather than a warning.
    """
    step("Pre-flight")
    try:
        async with async_session() as db:
            server = (await db.execute(text("SELECT version()"))).scalar()
            print(f"  Postgres:  {server.split(',')[0].replace('PostgreSQL ', 'v')}")

            from alembic.config import Config
            from alembic.script import ScriptDirectory

            applied = (
                await db.execute(text("SELECT version_num FROM alembic_version"))
            ).scalar()
            head = ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()
            if applied != head:
                print(f"  STOP: schema is at {applied}, migrations are at {head}.")
                print("  Run this first:  python -m alembic upgrade head")
                return False
            print(f"  Schema:    up to date ({applied})")
    except Exception as exc:
        print(f"  STOP: cannot reach the database -- {type(exc).__name__}: {exc}")
        print("  Is Postgres running? Check APP_DATABASE_URL, then try again.")
        return False
    print("  Ready.")
    return True


async def refresh_rankings(year: int, dry_run: bool) -> bool:
    """Draft lists from ESPN + Sleeper. Fast (seconds) and safe to run often."""
    step(f"Draft rankings for the {year} season")
    from rankings_ingester.main import run_ingestion

    results = await run_ingestion(sources=None, year=year, dry_run=dry_run)
    failed = [k for k, v in results.items() if v.get("status") != "ok"]
    if failed:
        print(f"  Sources that did not load: {', '.join(failed)}")
        print("  Rankings come from live public APIs -- a failure here is usually")
        print("  a network blip or an off-season endpoint. Safe to retry.")
        return False
    return True


async def refresh_stats(seasons: list[int], steps: list[int], dry_run: bool, full: bool) -> bool:
    """NFL stats from nflverse, in dependency order."""
    step(f"NFL stats for seasons {', '.join(map(str, seasons))}")
    for s in steps:
        print(f"  step {s}: {STEP_NAMES[s]}")
    print()

    from rankings_ingester import ingest_stats as ing

    try:
        if 1 in steps:
            await ing.step1_external_ids(dry_run=dry_run)
        if 2 in steps:
            await ing.step2_bio_and_combine(dry_run=dry_run)

        inserted_weeks: set[tuple[int, int]] = set()
        if 3 in steps:
            inserted_weeks = await ing.step3_weekly_stats(
                seasons, dry_run=dry_run, full_refresh=full
            )

        # Only re-aggregate seasons that actually changed, unless we're forcing
        # a full refresh or step 3 was skipped (then we can't know, so do all).
        if full or not inserted_weeks or 3 not in steps:
            dirty = seasons
        else:
            dirty = sorted({s for s, _ in inserted_weeks})
            print(f"\n  New weeks landed in: {dirty or 'nothing new'}")

        if dirty:
            if 4 in steps:
                await ing.step4_aggregate_seasons(dirty, dry_run=dry_run)
            if 5 in steps:
                await ing.step5_snap_counts(dirty, dry_run=dry_run)
            if 6 in steps:
                await ing.step6_compute_derived_stats(dirty, dry_run=dry_run)
        else:
            print("  Already up to date -- no seasons needed re-aggregating.")
    except Exception as exc:
        print(f"\n  Stats ingest failed: {type(exc).__name__}: {exc}")
        print("  Nothing partial was committed for the failing step. Fix the cause")
        print("  and re-run; the pipeline is incremental, so it picks up where it left off.")
        return False
    return True


def show_delta(before: dict[str, int], after: dict[str, int]) -> None:
    step("What changed")
    width = max(len(k) for k in before)
    print(f"  {'table'.ljust(width)}   {'before':>10}  {'after':>10}   change")
    for name in before:
        b, a = before[name], after[name]
        d = a - b
        arrow = "same" if d == 0 else (f"+{d:,}" if d > 0 else f"{d:,}")
        print(f"  {name.ljust(width)}   {b:>10,}  {a:>10,}   {arrow}")


async def run(args: argparse.Namespace) -> int:
    started = time.time()
    year = args.year or current_nfl_season()
    # --current-season is a named shorthand rather than a hardcoded year, so
    # the scheduled job's configuration never goes stale. Explicit --seasons
    # still wins; asking for both is a contradiction, caught in main().
    if args.current_season:
        seasons = [current_nfl_season()]
    else:
        seasons = args.seasons or default_stat_seasons()

    do_rankings = args.rankings or not args.stats
    do_stats = args.stats or not args.rankings
    steps = args.steps or [1, 2, 3, 4, 5, 6]
    if args.first_time:
        do_rankings = do_stats = True
        steps = [1, 2, 3, 4, 5, 6]

    banner(f"Data refresh -- {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"  Rankings season:  {year}" if do_rankings else "  Rankings:         skipped")
    print(f"  Stats seasons:    {', '.join(map(str, seasons))}" if do_stats else "  Stats:            skipped")
    print(f"  Mode:             {'FULL RE-DOWNLOAD' if args.full_refresh else 'incremental'}"
          f"{'  [DRY RUN -- nothing will be written]' if args.dry_run else ''}")

    if args.dry_run:
        print("\n  Plan only. Re-run without --dry-run to execute.")
        if do_rankings:
            print(f"\n  Rankings: fetch ESPN + Sleeper draft lists for {year},")
            print("            then replace base_rankings for those sources.")
        if do_stats:
            print("\n  Stats (each step feeds the next, so order matters):")
            for s in steps:
                print(f"            step {s}: {STEP_NAMES[s]}")
        print("\n  Note: a dry run of stats steps 4-6 reports counts from data already")
        print("  in the database, not from this run. Only steps 1-3 truly dry-run.")
        return EXIT_OK

    if not await preflight():
        return EXIT_INGEST_FAILED

    before = await census()
    ok = True
    if do_rankings:
        ok = await refresh_rankings(year, dry_run=False) and ok
    if do_stats:
        ok = await refresh_stats(seasons, steps, dry_run=False, full=args.full_refresh) and ok
    after = await census()

    show_delta(before, after)

    # The point of the whole exercise: end with an independent verdict rather
    # than "the script finished, probably fine".
    step("Verifying")
    print("  Running the health check...\n")
    from scripts.doctor import run as doctor_run

    doctor_exit = await doctor_run()

    mins = (time.time() - started) / 60
    banner(
        f"Refresh {'completed' if ok else 'completed WITH ERRORS'} in {mins:.1f} min -- "
        f"health check {'passed' if doctor_exit == 0 else 'reported problems'}"
    )
    if not ok:
        print(" One or more ingest stages reported an error. Scroll up for the cause.")
    if doctor_exit != 0:
        print(" The health check found failures. Its suggested fixes are listed above.")
    if ok and doctor_exit == 0:
        print(" Data is loaded and internally consistent. Start the app:")
        print("   backend:   uvicorn app.main:app --reload --port 8000")
        print("   frontend:  npm run dev      (in ../frontend)")

    # Distinct codes because the two failures want opposite responses from a
    # scheduler. A failed download is worth retrying; a health-check complaint
    # is not — the data is already written and re-downloading it will produce
    # the same complaint, so the right response is to look at it.
    # Both are non-zero, so anything checking for plain success is unaffected.
    if not ok:
        return EXIT_INGEST_FAILED
    if doctor_exit != 0:
        return EXIT_HEALTH_WARNING
    return EXIT_OK


def main() -> None:
    p = argparse.ArgumentParser(
        description="Refresh all app data in dependency order, then verify it.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--first-time", action="store_true",
                   help="Populate an empty database (everything, from scratch)")
    p.add_argument("--rankings", action="store_true", help="Draft ranking lists only")
    p.add_argument("--stats", action="store_true", help="NFL player stats only")
    p.add_argument("--year", type=int, default=None,
                   help=f"Season for draft rankings (default: {current_nfl_season()})")
    p.add_argument("--seasons", nargs="+", type=int, default=None,
                   help=f"Seasons for stats (default: {' '.join(map(str, default_stat_seasons()))})")
    p.add_argument("--current-season", action="store_true",
                   help="Stats for the in-progress season only (derived from "
                        "today's date). What the daily scheduled refresh uses: "
                        "completed seasons never change, so re-downloading four "
                        "of them every night is waste.")
    p.add_argument("--steps", nargs="+", type=int, choices=[1, 2, 3, 4, 5, 6], default=None,
                   help="Run only these stats steps (default: all)")
    p.add_argument("--full-refresh", action="store_true",
                   help="Delete and re-download the named seasons instead of adding new weeks")
    p.add_argument("--dry-run", action="store_true", help="Print the plan and exit")
    args = p.parse_args()

    if args.rankings and args.stats:
        print("--rankings and --stats are opposites; omit both to do everything.")
        raise SystemExit(EXIT_USAGE)

    if args.current_season and args.seasons:
        print("--current-season and --seasons both name which seasons to load; pass one.")
        raise SystemExit(EXIT_USAGE)

    raise SystemExit(asyncio.run(run(args)))


if __name__ == "__main__":
    main()
