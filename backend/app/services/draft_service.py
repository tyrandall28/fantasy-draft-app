"""Draft business logic: snake order, auto-pick, pick validation."""
import random
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.draft import DraftPick
from app.models.league import League, LeagueMember
from app.models.player import Player
from app.models.player import BaseRanking
from app.models.ranking import UserRanking, UserRankingEntry


# Positions eligible for the FLEX starter slot in standard fantasy.
FLEX_POSITIONS = frozenset({"RB", "WR", "TE"})

# Positions a bot will consider for FLEX. TE is technically FLEX-eligible
# but in practice nobody drafts a 2nd TE for FLEX over a 3rd RB/WR — TE
# scoring depth drops off a cliff. Keeping TE out of the bot's FLEX
# preference prevents the "back-to-back TE" pattern users were seeing.
BOT_FLEX_POSITIONS = frozenset({"RB", "WR"})

# Variance config: when multiple ranked players are roster-need-eligible,
# pick from the top N with these weights. Keeps the best player most likely
# but stops two bots running the same source from drafting identically.
BOT_VARIANCE_TOP_N = 3
BOT_VARIANCE_WEIGHTS = (0.6, 0.3, 0.1)


def get_snake_pick_user(draft_order: list[str], overall_pick: int, team_count: int) -> str:
    """Return user_id for the given overall pick using snake draft order."""
    round_num = (overall_pick - 1) // team_count + 1
    pick_in_round = (overall_pick - 1) % team_count
    if round_num % 2 == 0:
        pick_in_round = team_count - 1 - pick_in_round
    return draft_order[pick_in_round]


def get_round_and_pick(overall_pick: int, team_count: int) -> tuple[int, int]:
    round_num = (overall_pick - 1) // team_count + 1
    pick_in_round = (overall_pick - 1) % team_count + 1
    if round_num % 2 == 0:
        pick_in_round = team_count + 1 - pick_in_round
    return round_num, pick_in_round


async def get_drafted_player_ids(db: AsyncSession, league_id: uuid.UUID) -> set[int]:
    result = await db.execute(
        select(DraftPick.player_id).where(DraftPick.league_id == league_id)
    )
    return set(result.scalars().all())


async def make_pick(
    db: AsyncSession,
    league: League,
    user_id: uuid.UUID,
    player_id: int,
    overall_pick: int,
    is_auto: bool = False,
) -> DraftPick:
    round_num, pick_in_round = get_round_and_pick(overall_pick, league.team_count)

    pick = DraftPick(
        league_id=league.id,
        user_id=user_id,
        player_id=player_id,
        round_num=round_num,
        pick_in_round=pick_in_round,
        overall_pick=overall_pick,
        is_auto=is_auto,
    )
    db.add(pick)
    await db.commit()
    await db.refresh(pick)
    return pick


def compute_open_slots(
    pick_positions: list[str], position_slots: dict
) -> tuple[dict[str, int], int]:
    """Return (dedicated_open_by_position, flex_open).

    Mirrors the frontend `deriveOpenSlots`: dedicated slots get filled first,
    RB/WR/TE overflow goes into FLEX, the rest land on the bench (ignored).
    """
    by_position = {
        pos: position_slots.get(pos, 0)
        for pos in ("QB", "RB", "WR", "TE", "K", "DST")
    }
    flex = position_slots.get("FLEX", 0)
    for pos in pick_positions:
        if by_position.get(pos, 0) > 0:
            by_position[pos] -= 1
        elif pos in FLEX_POSITIONS and flex > 0:
            flex -= 1
        # else: bench filler, no-op
    return by_position, flex


def is_position_needed(
    position: str,
    open_by_position: dict[str, int],
    flex_open: int,
) -> bool:
    """Should a bot consider drafting this position right now?

    Rules:
    - Dedicated starter slot open → always needed.
    - RB/WR/TE with FLEX open → needed.
    - K/DST: only when ≤2 other starter slots remain (no K in round 4).
    - All starter slots filled → anything goes (bench picks).
    """
    total_starter_open = sum(open_by_position.values()) + flex_open

    # Once every starter slot is full, the bot is picking bench depth.
    if total_starter_open == 0:
        return True

    if position in ("K", "DST"):
        if open_by_position.get(position, 0) == 0:
            return False
        # Hold off on K/DST while plenty of starter slots are still open.
        other_open = total_starter_open - open_by_position.get(position, 0)
        return other_open <= 2

    if open_by_position.get(position, 0) > 0:
        return True
    if position in BOT_FLEX_POSITIONS and flex_open > 0:
        return True

    # Dedicated slot filled and not flex-eligible into open flex → skip
    # (unless all starters were already filled, handled above).
    # NOTE: TE is in FLEX_POSITIONS (technically eligible) but NOT in
    # BOT_FLEX_POSITIONS — bots avoid stacking TEs in FLEX.
    return False


def pick_with_variance(eligible: list[int]) -> int:
    """Pick one player_id from the top eligible candidates with weighted
    randomness so two bots running the same ranking don't draft identically."""
    if not eligible:
        raise ValueError("pick_with_variance called with empty list")
    top = eligible[:BOT_VARIANCE_TOP_N]
    weights = BOT_VARIANCE_WEIGHTS[: len(top)]
    return random.choices(top, weights=weights, k=1)[0]


async def _get_user_pick_positions(
    db: AsyncSession, league_id: uuid.UUID, user_id: uuid.UUID
) -> list[str]:
    """Positions of every pick this user has made in this league."""
    stmt = (
        select(Player.position)
        .join(DraftPick, DraftPick.player_id == Player.id)
        .where(DraftPick.league_id == league_id, DraftPick.user_id == user_id)
        .order_by(DraftPick.overall_pick)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def _get_bot_pick(
    db: AsyncSession,
    league: League,
    user_id: uuid.UUID,
    drafted: set[int],
) -> int | None:
    """Smart bot pick: walks the ranking source, skips positions the bot
    doesn't currently need, applies slight variance among the eligible top.
    """
    source = league.bot_ranking_source or "espn_ppr"

    # Pull the full ranked list joined to player positions in one query so
    # the bot doesn't issue N+1 queries while scanning candidates.
    ranking_stmt = (
        select(BaseRanking.player_id, Player.position)
        .join(Player, Player.id == BaseRanking.player_id)
        .where(BaseRanking.source == source)
        .order_by(BaseRanking.rank)
    )
    ranked = (await db.execute(ranking_stmt)).all()

    pick_positions = await _get_user_pick_positions(db, league.id, user_id)
    open_by_position, flex_open = compute_open_slots(pick_positions, league.position_slots)

    eligible: list[int] = []
    fallback: int | None = None
    for player_id, position in ranked:
        if player_id in drafted:
            continue
        if fallback is None:
            fallback = player_id  # best-available regardless of need
        if is_position_needed(position, open_by_position, flex_open):
            eligible.append(player_id)
            if len(eligible) >= BOT_VARIANCE_TOP_N:
                break

    if eligible:
        return pick_with_variance(eligible)
    return fallback


async def get_auto_pick_player(
    db: AsyncSession, league_id: uuid.UUID, user_id: uuid.UUID
) -> int | None:
    """Find the highest-ranked undrafted player for this user.

    For human users: use their custom ranking list (ranking_id on LeagueMember).
    For bots: use the league's bot_ranking_source filtered by current roster
    needs, with slight variance so identical bots don't draft identically.
    Fallback: first undrafted player by id.
    """
    drafted = await get_drafted_player_ids(db, league_id)

    member_stmt = (
        select(LeagueMember)
        .where(LeagueMember.league_id == league_id, LeagueMember.user_id == user_id)
    )
    result = await db.execute(member_stmt)
    member = result.scalar_one_or_none()

    # Bot path: roster-need-aware walk over the league's base ranking source.
    if member and member.is_bot:
        league_stmt = select(League).where(League.id == league_id)
        league_result = await db.execute(league_stmt)
        league = league_result.scalar_one_or_none()
        if league:
            pid = await _get_bot_pick(db, league, user_id, drafted)
            if pid is not None:
                return pid

    # Human path: use their custom ranking list verbatim.
    if member and member.ranking_id:
        entries_stmt = (
            select(UserRankingEntry.player_id)
            .where(UserRankingEntry.ranking_id == member.ranking_id)
            .order_by(UserRankingEntry.rank)
        )
        result = await db.execute(entries_stmt)
        for pid in result.scalars():
            if pid not in drafted:
                return pid

    # Fallback: pick any undrafted player ordered by id
    stmt = select(Player.id).order_by(Player.id)
    result = await db.execute(stmt)
    for pid in result.scalars():
        if pid not in drafted:
            return pid

    return None
