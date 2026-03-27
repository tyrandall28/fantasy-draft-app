from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.api.deps import DB
from app.models.player import BaseRanking, Player, PlayerBio, PlayerSeason, PlayerWeeklyStat
from app.schemas.player import (
    BaseRankingResponse,
    PlayerBioResponse,
    PlayerDetailResponse,
    PlayerResponse,
    PlayerSeasonResponse,
    PlayerWeeklyResponse,
)

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


@router.get("/{player_id}/stats", response_model=PlayerDetailResponse)
async def get_player_stats(player_id: int, db: DB):
    """Full player profile: bio + all season stats."""
    result = await db.execute(select(Player).where(Player.id == player_id))
    player = result.scalar_one_or_none()
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    bio_result = await db.execute(
        select(PlayerBio).where(PlayerBio.player_id == player_id)
    )
    bio = bio_result.scalar_one_or_none()

    seasons_result = await db.execute(
        select(PlayerSeason)
        .where(PlayerSeason.player_id == player_id)
        .order_by(PlayerSeason.season.desc())
    )
    seasons = seasons_result.scalars().all()

    return PlayerDetailResponse(
        player=player,
        bio=bio,
        seasons=seasons,
    )


@router.get("/{player_id}/bio", response_model=PlayerBioResponse | None)
async def get_player_bio(player_id: int, db: DB):
    result = await db.execute(
        select(PlayerBio).where(PlayerBio.player_id == player_id)
    )
    bio = result.scalar_one_or_none()
    if not bio:
        raise HTTPException(status_code=404, detail="Bio not found")
    return bio


@router.get("/{player_id}/weekly", response_model=list[PlayerWeeklyResponse])
async def get_player_weekly(
    player_id: int,
    db: DB,
    season: int = Query(..., description="NFL season year"),
):
    """Weekly game logs for a player in a given season."""
    result = await db.execute(
        select(PlayerWeeklyStat)
        .where(
            PlayerWeeklyStat.player_id == player_id,
            PlayerWeeklyStat.season == season,
        )
        .order_by(PlayerWeeklyStat.week)
    )
    return result.scalars().all()
