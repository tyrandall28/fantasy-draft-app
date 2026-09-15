"""Health check for the app and its data. Run this before and after any refresh.

    python -m scripts.doctor

It answers, in order:
  1. Can the app talk to the database, and is the schema up to date?
  2. What data is actually in there -- how much, which seasons, how old?
  3. Is that data internally consistent? (the part that catches a half-finished
     ingest, which is the failure mode that looks like success)

Exit code is 0 when nothing FAILed, 1 otherwise, so CI can run it too.
Read-only: it never writes to the database.
"""
import argparse
import asyncio
import sys
from datetime import datetime, timezone

from sqlalchemy import func, select, text

from app.config import settings
from app.database import async_session
from app.models.player import (
    BaseRanking,
    Player,
    PlayerBio,
    PlayerDerivedStats,
    PlayerSeason,
    PlayerWeeklyStat,
)
from app.nfl_season import (
    approx_current_week,
    current_nfl_season,
    latest_completed_season,
)
from rankings_ingester.ingest_stats import FANTASY_POSITIONS

OK, WARN, FAIL, INFO = "OK", "WARN", "FAIL", "INFO"
_MARK = {OK: "[ OK ]", WARN: "[WARN]", FAIL: "[FAIL]", INFO: "[INFO]"}

# A rankings list older than this is probably not what you want to draft from.
RANKINGS_STALE_DAYS = 14
# Weekly data more than this many weeks behind the calendar looks like a missed refresh.
WEEKLY_LAG_WEEKS = 2


class Report:
    """Collects check results and the suggested fixes for anything not OK."""

    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []
        self.fixes: list[str] = []

    def add(self, status: str, label: str, detail: str = "", fix: str = "") -> None:
        self.rows.append((status, label, detail))
        print(f"  {_MARK[status]} {label}" + (f"  {detail}" if detail else ""))
        if fix and status in (WARN, FAIL):
            self.fixes.append(fix)

    def section(self, title: str) -> None:
        print(f"\n{title}\n{'-' * len(title)}")

    @property
    def failed(self) -> int:
        return sum(1 for s, _, _ in self.rows if s == FAIL)

    @property
    def warned(self) -> int:
        return sum(1 for s, _, _ in self.rows if s == WARN)


def _redact(url: str) -> str:
    """postgresql+asyncpg://user:pw@host/db -> postgresql+asyncpg://user:***@host/db"""
    if "://" not in url or "@" not in url:
        return url
    scheme, rest = url.split("://", 1)
    creds, host = rest.rsplit("@", 1)
    user = creds.split(":", 1)[0]
    return f"{scheme}://{user}:***@{host}"


def _fmt_seasons(seasons: list[int]) -> str:
    """[2022,2023,2024,2026] -> '2022-2024, 2026'"""
    if not seasons:
        return "none"
    seasons = sorted(seasons)
    runs: list[list[int]] = [[seasons[0]]]
    for s in seasons[1:]:
        if s == runs[-1][-1] + 1:
            runs[-1].append(s)
        else:
            runs.append([s])
    return ", ".join(str(r[0]) if len(r) == 1 else f"{r[0]}-{r[-1]}" for r in runs)


def _age(ts: datetime | None) -> tuple[float | None, str]:
    if ts is None:
        return None, "unknown"
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    days = (datetime.now(timezone.utc) - ts).total_seconds() / 86400
    if days < 1:
        return days, "today"
    if days < 2:
        return days, "yesterday"
    return days, f"{int(days)} days ago"


# ── 1. Environment ────────────────────────────────────────────────────────────


async def check_environment(db, rep: Report) -> None:
    rep.section("1. Environment")
    rep.add(INFO, "Python", sys.version.split()[0])
    rep.add(INFO, "Database", _redact(settings.database_url))

    server = (await db.execute(text("SELECT version()"))).scalar()
    rep.add(OK, "Postgres reachable", server.split(",")[0].replace("PostgreSQL ", "v"))

    # Schema version. A database behind head is the single most common cause of
    # "the app boots but every stats page 500s".
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    applied = (await db.execute(text("SELECT version_num FROM alembic_version"))).scalar()
    head = ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()
    if applied == head:
        rep.add(OK, "Schema up to date", f"revision {applied}")
    else:
        rep.add(
            FAIL,
            "Schema out of date",
            f"database at {applied}, migrations at {head}",
            fix="python -m alembic upgrade head",
        )

    if settings.secret_key == "dev-secret-change-in-production":
        rep.add(
            WARN,
            "APP_SECRET_KEY is the built-in default",
            "fine locally, never in production",
            fix="Set APP_SECRET_KEY to a random value before deploying.",
        )
    else:
        rep.add(OK, "APP_SECRET_KEY", "set from environment")

    if settings.anthropic_api_key:
        rep.add(OK, "AI assistant", f"enabled, model={settings.assistant_model}")
    else:
        rep.add(INFO, "AI assistant", "disabled (APP_ANTHROPIC_API_KEY not set)")


# ── 2. What data is present ───────────────────────────────────────────────────


async def check_datasets(db, rep: Report) -> dict:
    rep.section("2. Datasets")
    facts: dict = {}

    async def count(model) -> int:
        return (await db.execute(select(func.count()).select_from(model))).scalar() or 0

    async def seasons_of(model) -> list[int]:
        rows = (await db.execute(select(model.season).distinct())).scalars().all()
        return sorted(r for r in rows if r is not None)

    # -- players + identity resolution
    players = await count(Player)
    with_gsis = (
        await db.execute(select(func.count()).select_from(Player).where(Player.gsis_id.isnot(None)))
    ).scalar() or 0
    facts["players"] = players
    if players == 0:
        rep.add(
            FAIL, "players", "empty",
            fix="python -m scripts.refresh_data --first-time",
        )
    else:
        pct = 100 * with_gsis / players
        status = OK if pct >= 80 else WARN
        rep.add(
            status, "players",
            f"{players:,} rows, {with_gsis:,} ({pct:.0f}%) linked to nflverse via gsis_id",
            fix="python -m rankings_ingester.ingest_stats --steps 1",
        )

    # -- bio
    bio = await count(PlayerBio)
    rep.add(
        OK if bio else WARN, "player_bio", f"{bio:,} rows (height/weight/college/combine)",
        fix="python -m rankings_ingester.ingest_stats --steps 2",
    )

    # -- weekly game logs
    weekly = await count(PlayerWeeklyStat)
    weekly_seasons = await seasons_of(PlayerWeeklyStat)
    facts["weekly_seasons"] = weekly_seasons
    if weekly == 0:
        rep.add(
            FAIL, "player_weekly_stats", "empty -- this is the source for everything else",
            fix="python -m rankings_ingester.ingest_stats --steps 3",
        )
    else:
        rep.add(OK, "player_weekly_stats", f"{weekly:,} game logs, seasons {_fmt_seasons(weekly_seasons)}")
        # Per-season week coverage, so a partial season is visible.
        rows = (
            await db.execute(
                select(
                    PlayerWeeklyStat.season,
                    func.min(PlayerWeeklyStat.week),
                    func.max(PlayerWeeklyStat.week),
                    func.count(func.distinct(PlayerWeeklyStat.week)),
                ).group_by(PlayerWeeklyStat.season).order_by(PlayerWeeklyStat.season)
            )
        ).all()
        facts["weekly_weeks"] = {r[0]: (r[1], r[2], r[3]) for r in rows}
        for season, lo, hi, n in rows:
            print(f"          season {season}: weeks {lo}-{hi} ({n} distinct)")

    # -- season aggregates
    seasons_rows = await count(PlayerSeason)
    season_seasons = await seasons_of(PlayerSeason)
    facts["season_seasons"] = season_seasons
    rep.add(
        OK if seasons_rows else WARN, "player_seasons",
        f"{seasons_rows:,} rows, seasons {_fmt_seasons(season_seasons)}",
        fix="python -m rankings_ingester.ingest_stats --steps 4 5",
    )

    # -- derived metrics (what analytics + the AI assistant read)
    derived = await count(PlayerDerivedStats)
    derived_seasons = await seasons_of(PlayerDerivedStats)
    facts["derived_seasons"] = derived_seasons
    rep.add(
        OK if derived else FAIL, "player_derived_stats",
        f"{derived:,} rows, seasons {_fmt_seasons(derived_seasons)} (powers Analytics + Ask AI)",
        fix="python -m rankings_ingester.ingest_stats --steps 6",
    )

    # -- draft ranking lists, per source, with provenance
    rank_rows = (
        await db.execute(
            select(
                BaseRanking.source,
                func.count(),
                func.min(BaseRanking.rank),
                func.max(BaseRanking.rank),
                func.max(BaseRanking.season),
                func.max(BaseRanking.fetched_at),
            ).group_by(BaseRanking.source).order_by(BaseRanking.source)
        )
    ).all()
    facts["rankings"] = rank_rows
    if not rank_rows:
        rep.add(
            FAIL, "base_rankings", "no draft lists loaded",
            fix="python -m rankings_ingester.main",
        )
    for source, n, lo, hi, season, fetched in rank_rows:
        days, when = _age(fetched)
        season_label = season if season is not None else "unknown"
        detail = f"{n} players, ranks {lo}-{hi}, season {season_label}, fetched {when}"
        if season is None:
            rep.add(
                WARN, f"base_rankings [{source}]", detail + " (pre-dates provenance tracking)",
                fix="python -m rankings_ingester.main   # stamps season + fetched_at",
            )
        elif season != current_nfl_season():
            rep.add(
                WARN, f"base_rankings [{source}]", detail + f" -- current season is {current_nfl_season()}",
                fix=f"python -m rankings_ingester.main --year {current_nfl_season()}",
            )
        elif days is not None and days > RANKINGS_STALE_DAYS:
            rep.add(
                WARN, f"base_rankings [{source}]", detail + f" (>{RANKINGS_STALE_DAYS}d old)",
                fix="python -m rankings_ingester.main",
            )
        else:
            rep.add(OK, f"base_rankings [{source}]", detail)

    return facts


# ── 3. Is it consistent? ──────────────────────────────────────────────────────


async def check_consistency(db, rep: Report, facts: dict) -> None:
    """The checks that catch a half-finished ingest.

    Each stats step feeds the next: weekly -> season totals -> derived metrics.
    If a later step didn't run, rows still *exist* from the previous refresh, so
    nothing looks broken until a page renders blank. These comparisons catch it.
    """
    rep.section("3. Consistency")

    weekly_seasons = set(facts.get("weekly_seasons") or [])
    season_seasons = set(facts.get("season_seasons") or [])
    derived_seasons = set(facts.get("derived_seasons") or [])

    missing_agg = sorted(weekly_seasons - season_seasons)
    if missing_agg:
        rep.add(
            FAIL, "Season totals cover every season with game logs",
            f"missing aggregates for {_fmt_seasons(missing_agg)}",
            fix=f"python -m rankings_ingester.ingest_stats --steps 4 5 --seasons {' '.join(map(str, missing_agg))}",
        )
    else:
        rep.add(OK, "Season totals cover every season with game logs")

    missing_derived = sorted(season_seasons - derived_seasons)
    if missing_derived:
        rep.add(
            FAIL, "Derived metrics cover every aggregated season",
            f"missing derived stats for {_fmt_seasons(missing_derived)}",
            fix=f"python -m rankings_ingester.ingest_stats --steps 6 --seasons {' '.join(map(str, missing_derived))}",
        )
    else:
        rep.add(OK, "Derived metrics cover every aggregated season")

    # In-season freshness: are we missing recently played weeks?
    season = current_nfl_season()
    expected_week = approx_current_week()
    weeks = facts.get("weekly_weeks") or {}
    if expected_week is None:
        rep.add(INFO, "In-season freshness", f"offseason -- next season is {season}")
    elif season not in weeks:
        rep.add(
            WARN, "In-season freshness",
            f"no {season} game logs yet (calendar is around week {expected_week})",
            fix=f"python -m rankings_ingester.ingest_stats --seasons {season}",
        )
    else:
        latest = weeks[season][1]
        lag = expected_week - latest
        if lag > WEEKLY_LAG_WEEKS:
            rep.add(
                WARN, "In-season freshness",
                f"{season} data stops at week {latest}, calendar is around week {expected_week}",
                fix=f"python -m rankings_ingester.ingest_stats --seasons {season}",
            )
        else:
            rep.add(OK, "In-season freshness", f"{season} game logs through week {latest}")

    # Snap counts are merged in by step 5 -- easy to skip, and several charts need them.
    target = latest_completed_season()
    if target in season_seasons:
        total = (
            await db.execute(
                select(func.count()).select_from(PlayerSeason).where(PlayerSeason.season == target)
            )
        ).scalar() or 0
        with_snaps = (
            await db.execute(
                select(func.count()).select_from(PlayerSeason).where(
                    PlayerSeason.season == target, PlayerSeason.snap_count.isnot(None)
                )
            )
        ).scalar() or 0
        pct = 100 * with_snaps / total if total else 0
        if pct < 25:
            rep.add(
                WARN, f"Snap counts present for {target}",
                f"only {with_snaps:,}/{total:,} ({pct:.0f}%) season rows have snaps",
                fix=f"python -m rankings_ingester.ingest_stats --steps 5 --seasons {target}",
            )
        else:
            rep.add(OK, f"Snap counts present for {target}", f"{with_snaps:,}/{total:,} ({pct:.0f}%)")

    # Every fantasy position should have derived stats for a completed season.
    # Kickers silently had none in every season for months, because nflverse
    # labels them "PK" in its ID table and our position filter only accepted
    # "K" -- so they never got a gsis_id and never got stats. A whole position
    # group at zero is the symptom that check would have surfaced immediately.
    if target in derived_seasons:
        counts = dict(
            (
                await db.execute(
                    select(PlayerDerivedStats.position, func.count())
                    .where(PlayerDerivedStats.season == target)
                    .group_by(PlayerDerivedStats.position)
                )
            ).all()
        )
        # Fixed order so the line reads the same every run (FANTASY_POSITIONS is a set).
        order = [p for p in ("QB", "RB", "WR", "TE", "K") if p in FANTASY_POSITIONS]
        missing = [pos for pos in order if not counts.get(pos)]
        summary = ", ".join(f"{pos}={counts.get(pos, 0)}" for pos in order)
        if missing:
            rep.add(
                FAIL, f"All fantasy positions have {target} stats",
                f"no rows for {', '.join(missing)} ({summary})",
                fix=f"python -m rankings_ingester.ingest_stats --steps 1 --seasons {target}\n"
                    f"         python -m rankings_ingester.ingest_stats --full-refresh --seasons {target}",
            )
        else:
            rep.add(OK, f"All fantasy positions have {target} stats", summary)

    # Rank sanity. Two very different situations here, so don't conflate them:
    #   - Gaps are normal for a source that publishes a *global* draft rank and
    #     then filters positions (ESPN's top 300 spans ranks 1-427). Draft order
    #     is taken from the sort, not the numbers, so gaps are cosmetic.
    #   - Duplicate ranks are a genuine load bug: two players claim one slot.
    for source, n, lo, hi, _season, _fetched in facts.get("rankings") or []:
        dupes = (
            await db.execute(
                select(func.count()).select_from(
                    select(BaseRanking.rank)
                    .where(BaseRanking.source == source)
                    .group_by(BaseRanking.rank)
                    .having(func.count() > 1)
                    .subquery()
                )
            )
        ).scalar() or 0
        if dupes:
            rep.add(
                FAIL, f"Rank sanity [{source}]",
                f"{dupes} rank(s) claimed by more than one player",
                fix=f"python -m rankings_ingester.main --source {source}",
            )
        elif lo != 1:
            rep.add(
                WARN, f"Rank sanity [{source}]", f"starts at rank {lo}, not 1",
                fix=f"python -m rankings_ingester.main --source {source}",
            )
        elif hi != n:
            rep.add(
                OK, f"Rank sanity [{source}]",
                f"{n} players, no duplicates; ranks run 1-{hi} with gaps (source uses a global rank)",
            )
        else:
            rep.add(OK, f"Rank sanity [{source}]", f"dense 1-{n}, no duplicates")

    # Duplicate player identities that BOTH carry stats -- the failure the dedup
    # pass exists to fix. Only flags real collisions, not harmless namesakes.
    dupe_sql = text(
        """
        WITH norm AS (
            SELECT p.id,
                   regexp_replace(lower(p.full_name), '[^a-z0-9 ]', '', 'g') AS n,
                   p.position,
                   (SELECT count(*) FROM player_weekly_stats w WHERE w.player_id = p.id) AS games
            FROM players p
        )
        SELECT n, position, count(*) AS rows
        FROM norm
        WHERE games > 0
        GROUP BY n, position
        HAVING count(*) > 1
        ORDER BY rows DESC
        LIMIT 5
        """
    )
    dupes = (await db.execute(dupe_sql)).all()
    if dupes:
        sample = ", ".join(f"{n} ({pos}) x{c}" for n, pos, c in dupes)
        rep.add(
            WARN, "No duplicate player identities with stats", sample,
            fix="python -m rankings_ingester.dedup           # preview\n"
                "         python -m rankings_ingester.dedup --apply   # merge",
        )
    else:
        rep.add(OK, "No duplicate player identities with stats")

    # Ranked players missing analytics for the last completed season. Some is
    # normal (rookies have no NFL history); a lot means the derived step is stale.
    if facts.get("rankings") and target in derived_seasons:
        ranked = (
            await db.execute(select(func.count(func.distinct(BaseRanking.player_id))))
        ).scalar() or 0
        covered = (
            await db.execute(
                select(func.count(func.distinct(BaseRanking.player_id))).select_from(BaseRanking)
                .join(
                    PlayerDerivedStats,
                    (PlayerDerivedStats.player_id == BaseRanking.player_id)
                    & (PlayerDerivedStats.season == target),
                )
            )
        ).scalar() or 0
        pct = 100 * covered / ranked if ranked else 0
        detail = f"{covered}/{ranked} ranked players have {target} analytics ({pct:.0f}%)"
        if pct < 50:
            rep.add(
                WARN, "Ranked players have analytics", detail + " -- rookies aside, this looks low",
                fix=f"python -m rankings_ingester.ingest_stats --steps 6 --seasons {target}",
            )
        else:
            rep.add(OK, "Ranked players have analytics", detail)


# ── main ──────────────────────────────────────────────────────────────────────


async def run() -> int:
    print("=" * 72)
    print(" Fantasy Draft App -- health check")
    print(f" {datetime.now().strftime('%Y-%m-%d %H:%M')}   "
          f"current NFL season: {current_nfl_season()}   "
          f"last completed: {latest_completed_season()}")
    print("=" * 72)

    rep = Report()
    try:
        async with async_session() as db:
            await check_environment(db, rep)
            facts = await check_datasets(db, rep)
            await check_consistency(db, rep, facts)
    except Exception as exc:
        print(f"\n  {_MARK[FAIL]} Could not complete checks: {type(exc).__name__}: {exc}")
        print("\n  Most likely causes:")
        print("    - Postgres isn't running. Start the service, then re-run.")
        print(f"    - APP_DATABASE_URL points somewhere unexpected: {_redact(settings.database_url)}")
        print("    - Schema missing. Run: python -m alembic upgrade head")
        return 1

    print("\n" + "=" * 72)
    if rep.failed:
        print(f" RESULT: {rep.failed} failure(s), {rep.warned} warning(s)")
    elif rep.warned:
        print(f" RESULT: healthy, with {rep.warned} warning(s)")
    else:
        print(" RESULT: healthy. Everything checks out.")
    print("=" * 72)

    if rep.fixes:
        print("\nSuggested fixes, in order (run from backend/ with the venv active):\n")
        seen = set()
        for i, fix in enumerate((f for f in rep.fixes if not (f in seen or seen.add(f))), 1):
            print(f"  {i}. {fix}")
        print("\nOr just run the guided refresh:  python -m scripts.refresh_data")

    return 1 if rep.failed else 0


def main() -> None:
    argparse.ArgumentParser(
        description="Check the app's environment, data coverage, and data consistency."
    ).parse_args()
    raise SystemExit(asyncio.run(run()))


if __name__ == "__main__":
    main()
