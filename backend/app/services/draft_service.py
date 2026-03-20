"""Draft business logic: snake order, auto-pick, pick validation."""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.draft import DraftPick
from app.models.league import League, LeagueMember
from app.models.player import Player
from app.models.player import BaseRanking
from app.models.ranking import UserRanking, UserRankingEntry


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


async def get_auto_pick_player(
    db: AsyncSession, league_id: uuid.UUID, user_id: uuid.UUID
) -> int | None:
    """Find the highest-ranked undrafted player for this user.

    For human users: use their custom ranking list (ranking_id on LeagueMember).
    For bots: use the league's bot_ranking_source (a base ranking like espn_ppr).
    Fallback: first undrafted player by id.
    """
    drafted = await get_drafted_player_ids(db, league_id)

    # Load the member and the league (for bot_ranking_source)
    member_stmt = (
        select(LeagueMember)
        .where(LeagueMember.league_id == league_id, LeagueMember.user_id == user_id)
    )
    result = await db.execute(member_stmt)
    member = result.scalar_one_or_none()

    # Bot path: use base rankings from the league's configured source
    if member and member.is_bot:
        league_stmt = select(League).where(League.id == league_id)
        league_result = await db.execute(league_stmt)
        league = league_result.scalar_one_or_none()
        source = league.bot_ranking_source if league else "espn_ppr"

        base_stmt = (
            select(BaseRanking.player_id)
            .where(BaseRanking.source == source)
            .order_by(BaseRanking.rank)
        )
        result = await db.execute(base_stmt)
        for pid in result.scalars():
            if pid not in drafted:
                return pid

    # Human path: use their custom ranking list
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
