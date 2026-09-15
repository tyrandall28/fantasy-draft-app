"""
Ingest player stats from nflverse via nflreadpy.

Steps:
  1. Load ff_playerids → populate external IDs + headshot on existing Player rows, create missing players
  2. Load combine data → populate player_bio
  3. Load player_stats (weekly) → populate player_weekly_stats (incremental by default)
  4. Aggregate weekly stats into player_seasons
  5. Load snap_counts → merge into weekly/season stats

Usage:
  cd backend
  python -m rankings_ingester.ingest_stats [--seasons 2022 2023 2024 2025] [--dry-run]
  python -m rankings_ingester.ingest_stats --seasons 2026 --steps 3 4 5       # incremental weekly update
  python -m rankings_ingester.ingest_stats --seasons 2026 --full-refresh       # re-download everything
"""
import argparse
import asyncio
import json
import logging
import math
import os
import sys
from datetime import date, datetime

import nflreadpy as nfl
from sqlalchemy import select, func, delete

from app.database import async_session
from app.nfl_season import default_stat_seasons
from app.models.player import Player, PlayerBio, PlayerDerivedStats, PlayerSeason, PlayerWeeklyStat

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Fantasy-relevant positions, in *our* vocabulary (matches the ranking sources).
FANTASY_POSITIONS = {"QB", "RB", "WR", "TE", "K"}

# nflverse is not internally consistent about kickers: `load_ff_playerids()`
# labels them "PK" while `load_player_stats()` labels them "K". Filtering the
# ID table on our own vocabulary therefore dropped every kicker, so none of them
# ever received a gsis_id -- and because steps 3-6 join on gsis_id, kickers got
# no weekly, season, or derived stats at all. The Analytics "K" tab was empty in
# every season as a result. Normalize the label on the way in.
POSITION_ALIASES = {"PK": "K"}

# The labels to accept from nflverse's ID table before normalization.
NFLVERSE_FANTASY_POSITIONS = FANTASY_POSITIONS | set(POSITION_ALIASES)


def normalize_position(pos: str | None) -> str | None:
    """Map an nflverse position label into our vocabulary ("PK" -> "K")."""
    if not pos:
        return None
    pos = pos.upper()
    return POSITION_ALIASES.get(pos, pos)

# ---------- Validation constants ----------

REQUIRED_WEEKLY_COLUMNS = {
    "player_id", "season", "week", "season_type", "opponent_team", "team",
    "attempts", "completions", "passing_yards", "passing_tds",
    "carries", "rushing_yards", "rushing_tds",
    "targets", "receptions", "receiving_yards", "receiving_tds",
    "fantasy_points", "fantasy_points_ppr",
}

REQUIRED_SNAP_COLUMNS = {
    "pfr_player_id", "season", "week", "offense_snaps", "offense_pct",
}

MIN_ROWS_PER_SEASON_WEEK = 50    # fewer than this per week is suspicious
MAX_ROWS_PER_SEASON = 50_000     # more than this per season is suspicious


# ---------- Safe type converters ----------

def safe_int(val) -> int | None:
    if val is None:
        return None
    try:
        v = float(val)
        if math.isnan(v):
            return None
        return int(v)
    except (ValueError, TypeError):
        return None


def safe_float(val) -> float | None:
    if val is None:
        return None
    try:
        v = float(val)
        if math.isnan(v):
            return None
        return round(v, 2)
    except (ValueError, TypeError):
        return None


def safe_str(val) -> str | None:
    if val is None:
        return None
    s = str(val)
    return s if s and s != "None" and s != "null" and s != "nan" else None


def safe_date(val) -> date | None:
    s = safe_str(val)
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except (ValueError, TypeError):
        return None


# ---------- Validation helpers ----------

def validate_dataframe(df, required_columns: set[str], label: str) -> bool:
    """Validate a polars DataFrame before writing to DB. Returns True if valid."""
    df_columns = set(df.columns)
    missing = required_columns - df_columns
    if missing:
        logger.error(f"  VALIDATION FAILED ({label}): missing columns {missing}")
        return False

    row_count = len(df)
    if row_count == 0:
        logger.warning(f"  VALIDATION WARNING ({label}): DataFrame is empty")
        return False

    logger.info(f"  Validation passed ({label}): {row_count} rows, all required columns present")
    return True


def validate_weekly_row_counts(df, seasons: list[int], label: str) -> bool:
    """Check that each season has a reasonable number of rows."""
    valid = True
    for season in seasons:
        season_rows = df.filter(df["season"] == season)
        count = len(season_rows)
        if count == 0:
            logger.warning(f"  VALIDATION WARNING ({label}): 0 rows for season {season}")
            valid = False
        elif count > MAX_ROWS_PER_SEASON:
            logger.warning(f"  VALIDATION WARNING ({label}): {count} rows for season {season} exceeds {MAX_ROWS_PER_SEASON}")
            valid = False
        else:
            logger.info(f"  Season {season}: {count} rows")
    return valid


# ---------- Backup helper ----------

def log_backup_snapshot(table_counts: dict[str, int], seasons: list[int]):
    """Log pre-write row counts as a backup reference."""
    backup_dir = os.path.join(os.path.dirname(__file__), "backups")
    os.makedirs(backup_dir, exist_ok=True)

    snapshot = {
        "timestamp": datetime.now().isoformat(),
        "seasons": seasons,
        "row_counts": table_counts,
    }

    filename = f"snapshot_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    filepath = os.path.join(backup_dir, filename)
    with open(filepath, "w") as f:
        json.dump(snapshot, f, indent=2)

    logger.info(f"  Backup snapshot saved to {filepath}")
    for table, count in table_counts.items():
        logger.info(f"    {table}: {count} rows")


async def get_existing_weeks(db, seasons: list[int]) -> set[tuple[int, int]]:
    """Get set of (season, week) pairs that already exist in player_weekly_stats."""
    result = await db.execute(
        select(PlayerWeeklyStat.season, PlayerWeeklyStat.week)
        .where(PlayerWeeklyStat.season.in_(seasons))
        .distinct()
    )
    return {(row[0], row[1]) for row in result.all()}


async def get_table_counts(db, seasons: list[int]) -> dict[str, int]:
    """Get row counts for stats tables for given seasons."""
    counts = {}

    result = await db.execute(
        select(func.count()).select_from(PlayerWeeklyStat).where(PlayerWeeklyStat.season.in_(seasons))
    )
    counts["player_weekly_stats"] = result.scalar() or 0

    result = await db.execute(
        select(func.count()).select_from(PlayerSeason).where(PlayerSeason.season.in_(seasons))
    )
    counts["player_seasons"] = result.scalar() or 0

    result = await db.execute(
        select(func.count()).select_from(PlayerBio)
    )
    counts["player_bio"] = result.scalar() or 0

    return counts


# ---------- Ingestion steps ----------

async def step1_external_ids(dry_run: bool = False):
    """Populate external IDs on Player rows from ff_playerids."""
    logger.info("Step 1: Loading player IDs from nflverse...")
    ids_df = nfl.load_ff_playerids()

    # Filter to fantasy-relevant positions, accepting nflverse's own labels
    # (notably "PK" for kickers) before they're normalized per row below.
    ids_df = ids_df.filter(ids_df["position"].is_in(list(NFLVERSE_FANTASY_POSITIONS)))
    logger.info(f"  {len(ids_df)} fantasy-relevant players in nflverse")

    async with async_session() as db:
        # Load all existing players once.
        all_players = (await db.execute(select(Player))).scalars().all()
        logger.info(f"  {len(all_players)} existing players in DB")

        # Primary index: gsis_id is nflverse's canonical unique key. Matching
        # on it (rather than name+position) is what keeps same-named players
        # distinct — e.g. the rookie Kyle Williams vs the retired one. Matching
        # by name would try to assign one player's gsis to the other's row.
        by_gsis: dict[str, Player] = {p.gsis_id: p for p in all_players if p.gsis_id}
        # Fallback index: rows not yet linked to a gsis_id, grouped by
        # name+position. Only consulted when a gsis has no row yet.
        unlinked_by_name: dict[str, list[Player]] = {}
        for p in all_players:
            if not p.gsis_id:
                unlinked_by_name.setdefault(p.full_name.lower() + "|" + p.position, []).append(p)

        # DB-wide sets of external IDs already in use, so we never assign a
        # value that already belongs to another row (the cause of the unique
        # violation). They grow as we assign new values within this run.
        used_espn = {p.espn_id for p in all_players if p.espn_id is not None}
        used_sleeper = {p.sleeper_id for p in all_players if p.sleeper_id is not None}
        used_yahoo = {p.yahoo_id for p in all_players if p.yahoo_id is not None}
        used_pfr = {p.pfr_id for p in all_players if p.pfr_id is not None}

        matched = 0
        linked = 0
        created = 0
        skipped = 0
        processed_gsis: set[str] = set()

        def heal(player: Player, field: str, value, used: set) -> None:
            """Fill a missing ID field, but only if the incoming value isn't
            already taken by another row (prevents unique-constraint violations)."""
            if value is None or value in used:
                return
            if getattr(player, field) is not None:
                return
            setattr(player, field, value)
            used.add(value)

        for row in ids_df.iter_rows(named=True):
            name = safe_str(row.get("name"))
            position = normalize_position(safe_str(row.get("position")))
            team = safe_str(row.get("team")) or "UNK"
            gsis_id = safe_str(row.get("gsis_id"))
            espn_id = safe_int(row.get("espn_id"))
            sleeper_id = safe_str(row.get("sleeper_id"))
            yahoo_id = safe_int(row.get("yahoo_id"))
            pfr_id = safe_str(row.get("pfr_id"))

            if not name or not position or position not in FANTASY_POSITIONS:
                continue
            if not gsis_id:
                skipped += 1
                continue
            if gsis_id in processed_gsis:
                skipped += 1
                continue
            processed_gsis.add(gsis_id)

            player = by_gsis.get(gsis_id)
            if player is not None:
                # Already correctly linked by gsis — only backfill missing IDs.
                heal(player, "espn_id", espn_id, used_espn)
                heal(player, "sleeper_id", sleeper_id, used_sleeper)
                heal(player, "yahoo_id", yahoo_id, used_yahoo)
                heal(player, "pfr_id", pfr_id, used_pfr)
                matched += 1
                continue

            # No row owns this gsis yet. Fall back to a single unlinked
            # name+position row (e.g. a player just created by the rankings
            # ingest with no gsis). Skip if ambiguous — creating is safer than
            # guessing which same-named row to link.
            candidates = unlinked_by_name.get(name.lower() + "|" + position, [])
            if len(candidates) == 1:
                player = candidates[0]
                player.gsis_id = gsis_id
                by_gsis[gsis_id] = player
                candidates.clear()  # no longer unlinked
                heal(player, "espn_id", espn_id, used_espn)
                heal(player, "sleeper_id", sleeper_id, used_sleeper)
                heal(player, "yahoo_id", yahoo_id, used_yahoo)
                heal(player, "pfr_id", pfr_id, used_pfr)
                linked += 1
                continue

            # Genuinely new player — create it, taking only IDs not already in use.
            new_espn = espn_id if espn_id not in used_espn else None
            new_sleeper = sleeper_id if sleeper_id not in used_sleeper else None
            new_yahoo = yahoo_id if yahoo_id not in used_yahoo else None
            new_pfr = pfr_id if pfr_id not in used_pfr else None
            player = Player(
                full_name=name,
                position=position,
                nfl_team=team if len(team) <= 5 else "UNK",
                bye_week=None,
                gsis_id=gsis_id,
                espn_id=new_espn,
                sleeper_id=new_sleeper,
                yahoo_id=new_yahoo,
                pfr_id=new_pfr,
            )
            db.add(player)
            by_gsis[gsis_id] = player
            for val, used in ((new_espn, used_espn), (new_sleeper, used_sleeper),
                              (new_yahoo, used_yahoo), (new_pfr, used_pfr)):
                if val is not None:
                    used.add(val)
            created += 1

        if not dry_run:
            await db.commit()

        logger.info(
            f"  Matched {matched} by gsis, linked {linked} by name, "
            f"created {created} new, skipped {skipped} (no gsis_id or duplicate)"
        )


async def step2_bio_and_combine(dry_run: bool = False):
    """Populate player_bio from ff_playerids + combine data."""
    logger.info("Step 2: Loading bio + combine data...")

    ids_df = nfl.load_ff_playerids()
    combine_df = nfl.load_combine()

    async with async_session() as db:
        # Backup before delete
        bio_count = (await db.execute(select(func.count()).select_from(PlayerBio))).scalar() or 0
        logger.info(f"  Existing bio rows before write: {bio_count}")

        # Build gsis_id -> player_id map
        result = await db.execute(select(Player).where(Player.gsis_id.is_not(None)))
        gsis_map = {p.gsis_id: p for p in result.scalars()}
        logger.info(f"  {len(gsis_map)} players with gsis_id in DB")

        # Build pfr_id -> combine row map
        combine_map: dict[str, dict] = {}
        for row in combine_df.iter_rows(named=True):
            pfr_id = safe_str(row.get("pfr_id"))
            if pfr_id:
                combine_map[pfr_id] = row

        # Delete existing bio data for clean re-ingest
        if not dry_run:
            await db.execute(delete(PlayerBio))
            await db.flush()

        count = 0
        seen_player_ids: set[int] = set()
        for row in ids_df.iter_rows(named=True):
            gsis_id = safe_str(row.get("gsis_id"))
            if not gsis_id or gsis_id not in gsis_map:
                continue

            player = gsis_map[gsis_id]
            if player.id in seen_player_ids:
                continue
            seen_player_ids.add(player.id)
            pfr_id = safe_str(row.get("pfr_id"))

            combine_row = combine_map.get(pfr_id, {}) if pfr_id else {}

            bio = PlayerBio(
                player_id=player.id,
                height_inches=safe_int(row.get("height")),
                weight_lbs=safe_int(row.get("weight")),
                birth_date=safe_date(row.get("birthdate")),
                college=safe_str(row.get("college")),
                draft_year=safe_int(row.get("draft_year")),
                draft_round=safe_int(row.get("draft_round")),
                draft_pick=safe_int(row.get("draft_pick")),
                draft_overall=safe_int(row.get("draft_ovr")),
                years_exp=None,
                forty_yard_dash=safe_float(combine_row.get("forty")),
                bench_press=safe_int(combine_row.get("bench")),
                vertical_jump=safe_float(combine_row.get("vertical")),
                broad_jump=safe_int(combine_row.get("broad_jump")),
                three_cone=safe_float(combine_row.get("cone")),
                shuttle=safe_float(combine_row.get("shuttle")),
            )
            db.add(bio)
            count += 1

        if not dry_run:
            await db.commit()

        logger.info(f"  Created {count} player bio records")


async def step3_weekly_stats(
    seasons: list[int],
    dry_run: bool = False,
    full_refresh: bool = False,
) -> set[tuple[int, int]]:
    """Load weekly player stats from nflverse. Returns set of (season, week) pairs inserted."""
    logger.info(f"Step 3: Loading weekly stats for seasons {seasons}...")
    mode = "FULL REFRESH" if full_refresh else "INCREMENTAL"
    logger.info(f"  Mode: {mode}")

    stats_df = nfl.load_player_stats(seasons)
    # Regular season only
    stats_df = stats_df.filter(stats_df["season_type"] == "REG")
    logger.info(f"  {len(stats_df)} weekly stat rows loaded from nflverse")

    # Validate the data before doing anything
    if not validate_dataframe(stats_df, REQUIRED_WEEKLY_COLUMNS, "weekly_stats"):
        logger.error("  Aborting step 3 due to validation failure")
        return set()

    if not validate_weekly_row_counts(stats_df, seasons, "weekly_stats"):
        logger.warning("  Row count warnings detected — proceeding with caution")

    async with async_session() as db:
        # Backup snapshot
        table_counts = await get_table_counts(db, seasons)
        log_backup_snapshot(table_counts, seasons)

        # Build gsis_id -> player_id map
        result = await db.execute(select(Player).where(Player.gsis_id.is_not(None)))
        gsis_map = {p.gsis_id: p.id for p in result.scalars()}

        # Update headshot URLs
        headshot_map: dict[str, str] = {}
        for row in stats_df.select("player_id", "headshot_url").unique().iter_rows(named=True):
            gsis = safe_str(row.get("player_id"))
            url = safe_str(row.get("headshot_url"))
            if gsis and url:
                headshot_map[gsis] = url

        if headshot_map:
            result2 = await db.execute(select(Player).where(Player.gsis_id.in_(list(headshot_map.keys()))))
            for p in result2.scalars():
                if p.gsis_id in headshot_map:
                    p.headshot_url = headshot_map[p.gsis_id]

        # Determine which weeks to process
        inserted_weeks: set[tuple[int, int]] = set()

        if full_refresh:
            # Delete all existing data for these seasons
            if not dry_run:
                await db.execute(
                    delete(PlayerWeeklyStat).where(PlayerWeeklyStat.season.in_(seasons))
                )
            logger.info(f"  Full refresh: deleted existing data for seasons {seasons}")
        else:
            # Incremental: find which weeks already exist
            existing_weeks = await get_existing_weeks(db, seasons)
            logger.info(f"  Found {len(existing_weeks)} existing (season, week) pairs in DB")

            # Get all (season, week) pairs in the new data
            all_new_weeks: set[tuple[int, int]] = set()
            for row in stats_df.select("season", "week").unique().iter_rows(named=True):
                s = safe_int(row.get("season"))
                w = safe_int(row.get("week"))
                if s is not None and w is not None:
                    all_new_weeks.add((s, w))

            weeks_to_skip = existing_weeks & all_new_weeks
            weeks_to_insert = all_new_weeks - existing_weeks

            logger.info(f"  Skipping {len(weeks_to_skip)} weeks already in DB")
            logger.info(f"  Inserting {len(weeks_to_insert)} new weeks")

            if not weeks_to_insert:
                logger.info("  No new weeks to insert — step 3 complete")
                if not dry_run:
                    await db.commit()  # commit headshot updates
                return set()

            # Filter DataFrame to only new weeks
            import polars as pl
            week_pairs = pl.DataFrame({
                "season": [s for s, _ in weeks_to_insert],
                "week": [w for _, w in weeks_to_insert],
            })
            stats_df = stats_df.join(week_pairs, on=["season", "week"], how="inner")
            logger.info(f"  Filtered to {len(stats_df)} rows for new weeks only")

        # Insert the data
        count = 0
        batch = []
        for row in stats_df.iter_rows(named=True):
            gsis_id = safe_str(row.get("player_id"))
            if not gsis_id or gsis_id not in gsis_map:
                continue

            player_id = gsis_map[gsis_id]
            season = safe_int(row.get("season"))
            week = safe_int(row.get("week"))

            if season is not None and week is not None:
                inserted_weeks.add((season, week))

            stat = PlayerWeeklyStat(
                player_id=player_id,
                season=season,
                week=week,
                opponent=safe_str(row.get("opponent_team")),
                team=safe_str(row.get("team")),
                # Passing
                pass_attempts=safe_int(row.get("attempts")),
                pass_completions=safe_int(row.get("completions")),
                pass_yards=safe_int(row.get("passing_yards")),
                pass_tds=safe_int(row.get("passing_tds")),
                interceptions=safe_int(row.get("passing_interceptions")),
                sacks=safe_int(row.get("sacks_suffered")),
                pass_air_yards=safe_int(row.get("passing_air_yards")),
                pass_epa=safe_float(row.get("passing_epa")),
                pass_cpoe=safe_float(row.get("passing_cpoe")),
                # Rushing
                rush_attempts=safe_int(row.get("carries")),
                rush_yards=safe_int(row.get("rushing_yards")),
                rush_tds=safe_int(row.get("rushing_tds")),
                rush_fumbles=safe_int(row.get("rushing_fumbles")),
                rush_first_downs=safe_int(row.get("rushing_first_downs")),
                rush_epa=safe_float(row.get("rushing_epa")),
                # Receiving
                targets=safe_int(row.get("targets")),
                receptions=safe_int(row.get("receptions")),
                rec_yards=safe_int(row.get("receiving_yards")),
                rec_tds=safe_int(row.get("receiving_tds")),
                rec_air_yards=safe_int(row.get("receiving_air_yards")),
                rec_yards_after_catch=safe_int(row.get("receiving_yards_after_catch")),
                rec_first_downs=safe_int(row.get("receiving_first_downs")),
                rec_epa=safe_float(row.get("receiving_epa")),
                target_share=safe_float(row.get("target_share")),
                # Kicking
                fg_made=safe_int(row.get("fg_made")),
                fg_att=safe_int(row.get("fg_att")),
                fg_long=safe_int(row.get("fg_long")),
                pat_made=safe_int(row.get("pat_made")),
                pat_att=safe_int(row.get("pat_att")),
                # Special teams
                special_teams_tds=safe_int(row.get("special_teams_tds")),
                # Fantasy
                fantasy_points=safe_float(row.get("fantasy_points")),
                fantasy_points_ppr=safe_float(row.get("fantasy_points_ppr")),
            )
            batch.append(stat)
            count += 1

            if len(batch) >= 500:
                db.add_all(batch)
                await db.flush()
                batch = []

        if batch:
            db.add_all(batch)

        if not dry_run:
            await db.commit()

        logger.info(f"  Inserted {count} weekly stat records across {len(inserted_weeks)} weeks")
        return inserted_weeks


async def step4_aggregate_seasons(seasons: list[int], dry_run: bool = False):
    """Aggregate weekly stats into season totals."""
    logger.info(f"Step 4: Aggregating season totals for {seasons}...")

    async with async_session() as db:
        if not dry_run:
            await db.execute(
                delete(PlayerSeason).where(PlayerSeason.season.in_(seasons))
            )

        for season in seasons:
            # Get all players who have weekly stats for this season
            result = await db.execute(
                select(PlayerWeeklyStat.player_id)
                .where(PlayerWeeklyStat.season == season)
                .distinct()
            )
            player_ids = [r for r in result.scalars()]

            count = 0
            for pid in player_ids:
                result = await db.execute(
                    select(PlayerWeeklyStat)
                    .where(PlayerWeeklyStat.player_id == pid, PlayerWeeklyStat.season == season)
                )
                weeks = result.scalars().all()
                if not weeks:
                    continue

                def sum_int(attr):
                    vals = [getattr(w, attr) for w in weeks if getattr(w, attr) is not None]
                    return sum(vals) if vals else None

                def sum_float(attr):
                    vals = [getattr(w, attr) for w in weeks if getattr(w, attr) is not None]
                    return round(sum(vals), 2) if vals else None

                def avg_float(attr):
                    vals = [getattr(w, attr) for w in weeks if getattr(w, attr) is not None]
                    return round(sum(vals) / len(vals), 2) if vals else None

                ps = PlayerSeason(
                    player_id=pid,
                    season=season,
                    games_played=len(weeks),
                    # Passing
                    pass_attempts=sum_int("pass_attempts"),
                    pass_completions=sum_int("pass_completions"),
                    pass_yards=sum_int("pass_yards"),
                    pass_tds=sum_int("pass_tds"),
                    interceptions=sum_int("interceptions"),
                    sacks=sum_int("sacks"),
                    pass_air_yards=sum_int("pass_air_yards"),
                    pass_epa=sum_float("pass_epa"),
                    pass_cpoe=avg_float("pass_cpoe"),
                    # Rushing
                    rush_attempts=sum_int("rush_attempts"),
                    rush_yards=sum_int("rush_yards"),
                    rush_tds=sum_int("rush_tds"),
                    rush_fumbles=sum_int("rush_fumbles"),
                    rush_first_downs=sum_int("rush_first_downs"),
                    rush_epa=sum_float("rush_epa"),
                    # Receiving
                    targets=sum_int("targets"),
                    receptions=sum_int("receptions"),
                    rec_yards=sum_int("rec_yards"),
                    rec_tds=sum_int("rec_tds"),
                    rec_air_yards=sum_int("rec_air_yards"),
                    rec_yards_after_catch=sum_int("rec_yards_after_catch"),
                    rec_first_downs=sum_int("rec_first_downs"),
                    rec_epa=sum_float("rec_epa"),
                    target_share=avg_float("target_share"),
                    # Kicking
                    fg_made=sum_int("fg_made"),
                    fg_att=sum_int("fg_att"),
                    fg_long=max((getattr(w, "fg_long") for w in weeks if getattr(w, "fg_long") is not None), default=None),
                    pat_made=sum_int("pat_made"),
                    pat_att=sum_int("pat_att"),
                    # Special teams
                    special_teams_tds=sum_int("special_teams_tds"),
                    # Fantasy
                    fantasy_points=sum_float("fantasy_points"),
                    fantasy_points_ppr=sum_float("fantasy_points_ppr"),
                )
                # In dry-run the DELETE above is skipped, so adding rows would
                # let autoflush collide with existing ones on uq_player_season.
                if not dry_run:
                    db.add(ps)
                count += 1

            logger.info(f"  {season}: {count} player seasons aggregated")

        if not dry_run:
            await db.commit()


async def step5_snap_counts(seasons: list[int], dry_run: bool = False):
    """Merge snap count data into weekly stats and season aggregates."""
    logger.info(f"Step 5: Loading snap counts for {seasons}...")

    snaps_df = nfl.load_snap_counts(seasons)
    logger.info(f"  {len(snaps_df)} snap count rows loaded")

    # Validate
    if not validate_dataframe(snaps_df, REQUIRED_SNAP_COLUMNS, "snap_counts"):
        logger.error("  Aborting step 5 due to validation failure")
        return

    async with async_session() as db:
        # Build pfr_id -> player_id map
        result = await db.execute(select(Player).where(Player.pfr_id.is_not(None)))
        pfr_map = {p.pfr_id: p.id for p in result.scalars()}

        updated = 0
        for row in snaps_df.iter_rows(named=True):
            pfr_id = safe_str(row.get("pfr_player_id"))
            if not pfr_id or pfr_id not in pfr_map:
                continue

            player_id = pfr_map[pfr_id]
            season = safe_int(row.get("season"))
            week = safe_int(row.get("week"))
            off_snaps = safe_int(row.get("offense_snaps"))
            off_pct = safe_float(row.get("offense_pct"))

            if season is None or week is None:
                continue

            # Update weekly stat row
            result = await db.execute(
                select(PlayerWeeklyStat).where(
                    PlayerWeeklyStat.player_id == player_id,
                    PlayerWeeklyStat.season == season,
                    PlayerWeeklyStat.week == week,
                )
            )
            weekly = result.scalar_one_or_none()
            if weekly:
                weekly.snap_count = off_snaps
                weekly.snap_pct = off_pct
                updated += 1

        if not dry_run:
            await db.commit()

        logger.info(f"  Updated {updated} weekly stat rows with snap counts")

        # Now aggregate snap counts into season totals
        for season in seasons:
            result = await db.execute(
                select(PlayerSeason).where(PlayerSeason.season == season)
            )
            for ps in result.scalars():
                weekly_result = await db.execute(
                    select(PlayerWeeklyStat).where(
                        PlayerWeeklyStat.player_id == ps.player_id,
                        PlayerWeeklyStat.season == season,
                    )
                )
                weeks = weekly_result.scalars().all()
                snap_counts = [w.snap_count for w in weeks if w.snap_count is not None]
                snap_pcts = [w.snap_pct for w in weeks if w.snap_pct is not None]
                if snap_counts:
                    ps.snap_count = sum(snap_counts)
                if snap_pcts:
                    ps.snap_pct = round(sum(snap_pcts) / len(snap_pcts), 2)

        if not dry_run:
            await db.commit()

        logger.info(f"  Aggregated snap counts into season totals")


async def step6_compute_derived_stats(seasons: list[int], dry_run: bool = False):
    """Compute derived analytics metrics from season totals and weekly stats."""
    logger.info(f"Step 6: Computing derived stats for {seasons}...")
    import statistics

    async with async_session() as db:
        if not dry_run:
            await db.execute(
                delete(PlayerDerivedStats).where(PlayerDerivedStats.season.in_(seasons))
            )

        for season in seasons:
            # Get all player seasons for this year
            result = await db.execute(
                select(PlayerSeason)
                .where(PlayerSeason.season == season)
                .options()
            )
            player_seasons = result.scalars().all()

            # Build player_id -> Player map for position lookup
            pids = [ps.player_id for ps in player_seasons]
            if not pids:
                logger.info(f"  {season}: no player seasons found, skipping")
                continue

            player_result = await db.execute(
                select(Player).where(Player.id.in_(pids))
            )
            player_map = {p.id: p for p in player_result.scalars()}

            count = 0
            for ps in player_seasons:
                player = player_map.get(ps.player_id)
                if not player or (ps.games_played or 0) < 1:
                    continue

                gp = ps.games_played
                pos = player.position

                # Helper for safe division
                def div(a, b):
                    if a is None or b is None or b == 0:
                        return None
                    return round(a / b, 2)

                # Total TDs
                total_tds = sum(filter(None, [
                    ps.pass_tds, ps.rush_tds, ps.rec_tds,
                    ps.special_teams_tds,
                ]))

                # Total yards
                total_yards = sum(filter(None, [
                    ps.pass_yards, ps.rush_yards, ps.rec_yards,
                ]))

                # Kicking percentages
                fg_pct = div(ps.fg_made, ps.fg_att) if ps.fg_att and ps.fg_att > 0 else None
                if fg_pct is not None:
                    fg_pct = round(fg_pct * 100, 1)
                xp_pct = div(ps.pat_made, ps.pat_att) if ps.pat_att and ps.pat_att > 0 else None
                if xp_pct is not None:
                    xp_pct = round(xp_pct * 100, 1)

                # Boom/bust: compute from weekly data
                weekly_result = await db.execute(
                    select(PlayerWeeklyStat.fantasy_points_ppr)
                    .where(
                        PlayerWeeklyStat.player_id == ps.player_id,
                        PlayerWeeklyStat.season == season,
                    )
                )
                weekly_ppr = [r[0] for r in weekly_result.all() if r[0] is not None]

                median_ppr = round(statistics.median(weekly_ppr), 2) if len(weekly_ppr) >= 2 else None
                stdev_ppr = round(statistics.stdev(weekly_ppr), 2) if len(weekly_ppr) >= 2 else None

                derived = PlayerDerivedStats(
                    player_id=ps.player_id,
                    season=season,
                    position=pos,
                    games_played=gp,
                    # Per-game rates
                    ppr_per_game=div(ps.fantasy_points_ppr, gp),
                    standard_per_game=div(ps.fantasy_points, gp),
                    pass_yards_per_game=div(ps.pass_yards, gp),
                    rush_yards_per_game=div(ps.rush_yards, gp),
                    rec_yards_per_game=div(ps.rec_yards, gp),
                    targets_per_game=div(ps.targets, gp),
                    receptions_per_game=div(ps.receptions, gp),
                    tds_per_game=div(total_tds, gp),
                    # Efficiency
                    yards_per_carry=div(ps.rush_yards, ps.rush_attempts),
                    yards_per_target=div(ps.rec_yards, ps.targets),
                    yards_per_reception=div(ps.rec_yards, ps.receptions),
                    catch_rate=round((ps.receptions / ps.targets) * 100, 1) if ps.targets and ps.receptions and ps.targets > 0 else None,
                    completion_pct=round((ps.pass_completions / ps.pass_attempts) * 100, 1) if ps.pass_attempts and ps.pass_completions and ps.pass_attempts > 0 else None,
                    td_rate=div(total_tds, gp),
                    # Advanced
                    pass_epa_per_game=div(ps.pass_epa, gp),
                    rush_epa_per_game=div(ps.rush_epa, gp),
                    cpoe=ps.pass_cpoe,
                    target_share=round(ps.target_share * 100, 1) if ps.target_share else None,
                    air_yards_per_game=div(ps.rec_air_yards, gp),
                    yac_per_reception=div(ps.rec_yards_after_catch, ps.receptions),
                    snap_pct=ps.snap_pct,
                    # Kicking
                    fg_pct=fg_pct,
                    fg_made_per_game=div(ps.fg_made, gp),
                    fg_long=ps.fg_long,
                    xp_pct=xp_pct,
                    # Boom/bust
                    median_ppr=median_ppr,
                    stdev_ppr=stdev_ppr,
                    # Totals
                    total_tds=total_tds,
                    total_yards=total_yards,
                    fantasy_points_ppr=ps.fantasy_points_ppr,
                )
                # In dry-run the DELETE above is skipped, so adding rows would
                # let autoflush collide with existing ones on uq_player_derived_season.
                if not dry_run:
                    db.add(derived)
                count += 1

            logger.info(f"  {season}: {count} derived stat records computed")

        if not dry_run:
            await db.commit()


async def main():
    parser = argparse.ArgumentParser(description="Ingest player stats from nflverse")
    default_seasons = default_stat_seasons()
    parser.add_argument(
        "--seasons", nargs="+", type=int,
        default=default_seasons,
        help=(
            "Seasons to ingest (default: the last 4 completed seasons plus the "
            f"in-progress one — currently {default_seasons[0]}-{default_seasons[-1]})"
        ),
    )
    parser.add_argument("--dry-run", action="store_true", help="Don't write to DB")
    parser.add_argument(
        "--steps", nargs="+", type=int, default=[1, 2, 3, 4, 5, 6],
        help="Which steps to run (default: all)",
    )
    parser.add_argument(
        "--full-refresh", action="store_true",
        help="Delete and re-download all data for specified seasons (default: incremental)",
    )
    args = parser.parse_args()

    logger.info(f"Ingesting stats for seasons: {args.seasons}")
    if args.dry_run:
        logger.info("[DRY RUN MODE]")
        # Steps 4-6 derive from what's already committed, so a dry run only
        # proves the *downloads* (steps 1-3) are healthy. On an empty database
        # a full dry run reports zeros for 4-6 -- that's expected, not a failure.
        if any(step in args.steps for step in (4, 5, 6)):
            logger.info(
                "[DRY RUN] Steps 4-6 re-derive from data already in the DB; "
                "their counts reflect existing rows, not this run's downloads."
            )
    if args.full_refresh:
        logger.info("[FULL REFRESH MODE]")
    else:
        logger.info("[INCREMENTAL MODE — existing weeks will be preserved]")

    if 1 in args.steps:
        await step1_external_ids(dry_run=args.dry_run)
    if 2 in args.steps:
        await step2_bio_and_combine(dry_run=args.dry_run)

    # Step 3 returns which weeks were inserted, so steps 4-5 know what to re-aggregate
    inserted_weeks: set[tuple[int, int]] = set()
    if 3 in args.steps:
        inserted_weeks = await step3_weekly_stats(
            args.seasons, dry_run=args.dry_run, full_refresh=args.full_refresh
        )

    # Determine which seasons need re-aggregation
    if args.full_refresh or not inserted_weeks:
        dirty_seasons = args.seasons
    else:
        dirty_seasons = sorted({s for s, _ in inserted_weeks})
        logger.info(f"  Dirty seasons (need re-aggregation): {dirty_seasons}")

    if 4 in args.steps and dirty_seasons:
        await step4_aggregate_seasons(dirty_seasons, dry_run=args.dry_run)
    if 5 in args.steps and dirty_seasons:
        await step5_snap_counts(dirty_seasons, dry_run=args.dry_run)
    if 6 in args.steps and dirty_seasons:
        await step6_compute_derived_stats(dirty_seasons, dry_run=args.dry_run)

    logger.info("Done!")


if __name__ == "__main__":
    asyncio.run(main())
