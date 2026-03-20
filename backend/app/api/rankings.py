import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.api.deps import DB, CurrentUser
from app.models.player import BaseRanking
from app.models.ranking import UserRanking, UserRankingEntry
from app.schemas.ranking import (
    CreateRankingRequest,
    PatchEntryRequest,
    RankingDetailResponse,
    RankingResponse,
    ReorderRequest,
)
from app.services.ranking_service import (
    create_ranking_from_source,
    get_ranking_with_entries,
    reorder_entries,
)

router = APIRouter(prefix="/api/rankings", tags=["rankings"])

# Display names for known sources
SOURCE_LABELS = {
    "espn_ppr": "ESPN PPR",
    "espn_standard": "ESPN Standard",
    "sleeper_ppr": "Sleeper PPR ADP",
    "fantasypros_ppr": "FantasyPros PPR",
    "yahoo_ppr": "Yahoo PPR",
}


@router.get("/sources")
async def list_sources(user: CurrentUser, db: DB):
    """List available base ranking sources with player counts."""
    stmt = (
        select(BaseRanking.source, func.count(BaseRanking.id))
        .group_by(BaseRanking.source)
        .order_by(BaseRanking.source)
    )
    result = await db.execute(stmt)
    rows = result.all()
    return [
        {
            "value": source,
            "label": SOURCE_LABELS.get(source, source),
            "player_count": count,
        }
        for source, count in rows
    ]


@router.get("", response_model=list[RankingResponse])
async def list_rankings(user: CurrentUser, db: DB):
    stmt = select(UserRanking).where(UserRanking.user_id == user.id).order_by(UserRanking.updated_at.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=RankingResponse, status_code=status.HTTP_201_CREATED)
async def create_ranking(body: CreateRankingRequest, user: CurrentUser, db: DB):
    ranking = await create_ranking_from_source(db, user.id, body.source, body.name)
    return ranking


@router.get("/{ranking_id}", response_model=RankingDetailResponse)
async def get_ranking(ranking_id: uuid.UUID, user: CurrentUser, db: DB):
    ranking = await get_ranking_with_entries(db, ranking_id)
    if not ranking or ranking.user_id != user.id:
        raise HTTPException(status_code=404, detail="Ranking not found")
    return ranking


@router.put("/{ranking_id}/reorder")
async def reorder(ranking_id: uuid.UUID, body: ReorderRequest, user: CurrentUser, db: DB):
    ranking = await get_ranking_with_entries(db, ranking_id)
    if not ranking or ranking.user_id != user.id:
        raise HTTPException(status_code=404, detail="Ranking not found")
    await reorder_entries(db, ranking_id, body.entry_ids)
    return {"ok": True}


@router.patch("/{ranking_id}/entries/{entry_id}")
async def patch_entry(
    ranking_id: uuid.UUID, entry_id: int, body: PatchEntryRequest, user: CurrentUser, db: DB
):
    stmt = select(UserRankingEntry).where(
        UserRankingEntry.id == entry_id,
        UserRankingEntry.ranking_id == ranking_id,
    )
    result = await db.execute(stmt)
    entry = result.scalar_one_or_none()

    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    # Verify ownership
    ranking_stmt = select(UserRanking).where(UserRanking.id == ranking_id, UserRanking.user_id == user.id)
    r = await db.execute(ranking_stmt)
    if not r.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Ranking not found")

    if body.is_locked is not None:
        entry.is_locked = body.is_locked
    if body.rank is not None:
        entry.rank = body.rank

    await db.commit()
    return {"ok": True}


@router.delete("/{ranking_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ranking(ranking_id: uuid.UUID, user: CurrentUser, db: DB):
    stmt = select(UserRanking).where(UserRanking.id == ranking_id, UserRanking.user_id == user.id)
    result = await db.execute(stmt)
    ranking = result.scalar_one_or_none()
    if not ranking:
        raise HTTPException(status_code=404, detail="Ranking not found")
    await db.delete(ranking)
    await db.commit()
