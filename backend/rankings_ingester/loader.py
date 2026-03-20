"""Load normalized rankings into the database — upsert players, replace base rankings."""
import logging

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.player import BaseRanking, Player

logger = logging.getLogger(__name__)


async def upsert_player(db: AsyncSession, entry: dict) -> Player:
    """Find existing player by name+position or create a new one. Update team/bye if changed."""
    stmt = select(Player).where(
        Player.full_name == entry["full_name"],
        Player.position == entry["position"],
    )
    result = await db.execute(stmt)
    player = result.scalar_one_or_none()

    if player:
        # Update team if player was traded
        changed = False
        if entry["nfl_team"] != "UNK" and player.nfl_team != entry["nfl_team"]:
            logger.info(f"  Team change: {player.full_name} {player.nfl_team} -> {entry['nfl_team']}")
            player.nfl_team = entry["nfl_team"]
            changed = True
        if entry["bye_week"] > 0 and player.bye_week != entry["bye_week"]:
            player.bye_week = entry["bye_week"]
            changed = True
        if changed:
            await db.flush()
    else:
        # New player — use bye_week from entry (may be 0 if not available)
        player = Player(
            full_name=entry["full_name"],
            position=entry["position"],
            nfl_team=entry["nfl_team"],
            bye_week=entry.get("bye_week", 0),
        )
        db.add(player)
        await db.flush()
        logger.info(f"  New player: {player.full_name} ({player.position}, {player.nfl_team})")

    return player


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
    dry_run: bool = False,
) -> dict:
    """
    Upsert players and replace base rankings for the given source.

    Returns stats: {new_players, updated_players, total_rankings}
    """
    entries = assign_tiers(entries)

    stats = {"new_players": 0, "updated_players": 0, "total_rankings": 0}

    # Delete old base rankings for this source
    if not dry_run:
        await db.execute(delete(BaseRanking).where(BaseRanking.source == source))
        logger.info(f"Cleared old base rankings for source '{source}'")

    for entry in entries:
        # Check if player exists before upsert to track new vs updated
        existing = await db.execute(
            select(Player).where(
                Player.full_name == entry["full_name"],
                Player.position == entry["position"],
            )
        )
        is_new = existing.scalar_one_or_none() is None

        player = await upsert_player(db, entry)

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
