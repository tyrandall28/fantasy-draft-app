from fastapi import APIRouter, Query
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.api.deps import DB
from app.models.player import BaseRanking, Player
from app.schemas.player import BaseRankingResponse, PlayerResponse

router = APIRouter(prefix="/api/players", tags=["players"])


@router.get("", response_model=list[PlayerResponse])
async def list_players(
    db: DB,
    position: str | None = Query(None),
    search: str | None = Query(None),
):
    stmt = select(Player)
    if position:
        stmt = stmt.where(Player.position == position.upper())
    if search:
        stmt = stmt.where(Player.full_name.ilike(f"%{search}%"))
    stmt = stmt.order_by(Player.full_name)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/base-rankings", response_model=list[BaseRankingResponse])
async def get_base_rankings(db: DB, source: str = Query(...)):
    stmt = (
        select(BaseRanking)
        .where(BaseRanking.source == source)
        .options(joinedload(BaseRanking.player))
        .order_by(BaseRanking.rank)
    )
    result = await db.execute(stmt)
    return result.scalars().all()
