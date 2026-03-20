import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.player import BaseRanking
from app.models.ranking import UserRanking, UserRankingEntry


async def create_ranking_from_source(
    db: AsyncSession, user_id: uuid.UUID, source: str, name: str
) -> UserRanking:
    ranking = UserRanking(user_id=user_id, source=source, name=name)
    db.add(ranking)
    await db.flush()

    stmt = select(BaseRanking).where(BaseRanking.source == source).order_by(BaseRanking.rank)
    result = await db.execute(stmt)
    base_entries = result.scalars().all()

    for entry in base_entries:
        db.add(
            UserRankingEntry(
                ranking_id=ranking.id,
                player_id=entry.player_id,
                rank=entry.rank,
            )
        )

    await db.commit()
    await db.refresh(ranking)
    return ranking


async def get_ranking_with_entries(
    db: AsyncSession, ranking_id: uuid.UUID
) -> UserRanking | None:
    stmt = (
        select(UserRanking)
        .where(UserRanking.id == ranking_id)
        .options(selectinload(UserRanking.entries).joinedload(UserRankingEntry.player))
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def reorder_entries(
    db: AsyncSession, ranking_id: uuid.UUID, entry_ids: list[int]
) -> None:
    stmt = (
        select(UserRankingEntry)
        .where(UserRankingEntry.ranking_id == ranking_id)
    )
    result = await db.execute(stmt)
    entries_by_id = {e.id: e for e in result.scalars().all()}

    for new_rank, eid in enumerate(entry_ids, start=1):
        entry = entries_by_id.get(eid)
        if entry:
            entry.rank = new_rank

    await db.commit()
