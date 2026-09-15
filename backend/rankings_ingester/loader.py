"""Load normalized rankings into the database — upsert players, replace base rankings."""
import logging
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.player import BaseRanking, Player
from app.nfl_season import current_nfl_season

logger = logging.getLogger(__name__)


# External-ID fields a rankings entry may carry. Listed in priority order:
# espn_id and sleeper_id are integer/string scalars sourced from the
# respective fantasy APIs. Matching on these is the canonical link and
# avoids the entire "James Cook vs James Cook III" name-mismatch class
# of bug.
_EXTERNAL_ID_FIELDS = ("espn_id", "sleeper_id", "yahoo_id", "gsis_id", "pfr_id")


async def _find_by_external_id(db: AsyncSession, entry: dict) -> Player | None:
    """Look up a Player by any external ID present on the entry."""
    for field in _EXTERNAL_ID_FIELDS:
        value = entry.get(field)
        if value is None:
            continue
        stmt = select(Player).where(getattr(Player, field) == value)
        existing = await db.execute(stmt)
        player = existing.scalar_one_or_none()
        if player:
            return player
    return None


async def _find_by_name_position(db: AsyncSession, entry: dict) -> Player | None:
    """Legacy fallback when no external ID matches. Position + exact name."""
    stmt = select(Player).where(
        Player.full_name == entry["full_name"],
        Player.position == entry["position"],
    )
    existing = await db.execute(stmt)
    return existing.scalar_one_or_none()


def _heal_external_ids(player: Player, entry: dict) -> bool:
    """Backfill missing external IDs on an existing Player row from this
    ingest. Returns True if anything changed."""
    changed = False
    for field in _EXTERNAL_ID_FIELDS:
        value = entry.get(field)
        if value is None:
            continue
        current = getattr(player, field, None)
        if current is None:
            setattr(player, field, value)
            changed = True
    return changed


async def upsert_player(db: AsyncSession, entry: dict) -> tuple[Player, bool]:
    """Find existing player (by external ID first, then name+position) or
    create a new one. Updates team/bye/external-IDs if changed.

    Returns (player, is_new).
    """
    player = await _find_by_external_id(db, entry)
    matched_by = "external_id" if player else None
    if player is None:
        player = await _find_by_name_position(db, entry)
        matched_by = "name+position" if player else None

    is_new = player is None

    if is_new:
        player = Player(
            full_name=entry["full_name"],
            position=entry["position"],
            nfl_team=entry["nfl_team"],
            bye_week=entry.get("bye_week", 0),
        )
        # Populate any external IDs from this entry on the new row.
        _heal_external_ids(player, entry)
        db.add(player)
        await db.flush()
        logger.info(f"  New player: {player.full_name} ({player.position}, {player.nfl_team})")
        return player, True

    # Existing row — update what's changed.
    changed = False
    if entry["nfl_team"] != "UNK" and player.nfl_team != entry["nfl_team"]:
        logger.info(f"  Team change: {player.full_name} {player.nfl_team} -> {entry['nfl_team']}")
        player.nfl_team = entry["nfl_team"]
        changed = True
    if entry["bye_week"] > 0 and player.bye_week != entry["bye_week"]:
        player.bye_week = entry["bye_week"]
        changed = True

    # Heal missing external IDs. If we matched by name+position and the
    # entry carries an ID the row was missing, persist it so future ingests
    # match by ID (no more drift).
    if _heal_external_ids(player, entry):
        if matched_by == "name+position":
            logger.info(f"  Linked external ID on existing row: {player.full_name}")
        changed = True

    if changed:
        await db.flush()

    return player, False


def assign_tiers(entries: list[dict]) -> list[dict]:
    """Assign tiers based on rank ranges."""
    for entry in entries:
        rank = entry["rank"]
        if rank <= 12:
            entry["tier"] = 1
        elif rank <= 36:
            entry["tier"] = 2
        elif rank <= 72:
            entry["tier"] = 3
        elif rank <= 120:
            entry["tier"] = 4
        elif rank <= 180:
            entry["tier"] = 5
        elif rank <= 250:
            entry["tier"] = 6
        else:
            entry["tier"] = 7
    return entries


async def load_rankings(
    db: AsyncSession,
    source: str,
    entries: list[dict],
    *,
    season: int | None = None,
    dry_run: bool = False,
) -> dict:
    """
    Upsert players and replace base rankings for the given source.

    `season` is stamped on every row alongside a `fetched_at` timestamp so
    `scripts.doctor` can tell a fresh list from a stale one. Defaults to the
    current NFL season.

    Returns stats: {new_players, updated_players, total_rankings}
    """
    entries = assign_tiers(entries)
    season = season if season is not None else current_nfl_season()
    fetched_at = datetime.now(timezone.utc)

    stats = {"new_players": 0, "updated_players": 0, "total_rankings": 0}

    # Delete old base rankings for this source
    if not dry_run:
        await db.execute(delete(BaseRanking).where(BaseRanking.source == source))
        logger.info(f"Cleared old base rankings for source '{source}'")

    for entry in entries:
        player, is_new = await upsert_player(db, entry)

        if is_new:
            stats["new_players"] += 1
        else:
            stats["updated_players"] += 1

        if not dry_run:
            db.add(BaseRanking(
                source=source,
                player_id=player.id,
                rank=entry["rank"],
                tier=entry.get("tier", 1),
                season=season,
                fetched_at=fetched_at,
            ))
        stats["total_rankings"] += 1

    if not dry_run:
        await db.commit()
        logger.info(
            f"Loaded {stats['total_rankings']} rankings for '{source}' "
            f"({stats['new_players']} new players, {stats['updated_players']} existing)"
        )
    else:
        logger.info(f"[DRY RUN] Would load {stats['total_rankings']} rankings for '{source}'")
        await db.rollback()

    return stats
