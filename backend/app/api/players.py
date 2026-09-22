from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.api.deps import DB, get_current_user
from app.models.player import BaseRanking, Player, PlayerBio, PlayerSeason
from app.schemas.player import (
    BaseRankingResponse,
    PlayerBioResponse,
    PlayerDetailResponse,
    PlayerResponse,
    PlayerSeasonResponse,
    PlayerWeeklyResponse,
)
from app.services.weekly_timeline import PLAYED, player_season_timeline

# Every route here requires a logged-in user. These were all open to the
# internet, which exposed nothing private (it's public nflverse data) but did
# put an unauthenticated path straight to Cloud SQL, where the reads are
# metered. The app itself is unaffected: every caller is behind a login screen
# already.
router = APIRouter(
    prefix="/api/players",
    tags=["players"],
    dependencies=[Depends(get_current_user)],
)

# Ceiling on an explicitly requested page. There are ~3,700 players, so this
# is well above any real need while still refusing `?limit=10000000`.
MAX_PLAYER_LIMIT = 1_000


@router.get("", response_model=list[PlayerResponse])
async def list_players(
    db: DB,
    position: str | None = Query(None),
    search: str | None = Query(None),
    limit: int | None = Query(
        None,
        ge=1,
        description=f"Page size, up to {MAX_PLAYER_LIMIT}. Omit for the full list.",
    ),
    offset: int = Query(0, ge=0),
):
    """Every player, or a filtered page of them.

    `limit` is deliberately *not* defaulted to a page size. The draft room
    uses this endpoint as its fallback list when the user has no ranking of
    their own, and filters it client-side, so a default page would silently
    truncate the draft board and its search box. A cap applies to explicitly
    requested pages instead; requiring a login is what actually closes this
    endpoint off. Moving that caller onto `/base-rankings` (~300 draftable
    players rather than ~3,700 mostly-irrelevant ones) is tracked in TODO.md
    for the draft rework, and would let this default to a page.
    """
    stmt = select(Player)
    if position:
        stmt = stmt.where(Player.position == position.upper())
    if search:
        stmt = stmt.where(Player.full_name.ilike(f"%{search}%"))
    stmt = stmt.order_by(Player.full_name)
    if limit is not None:
        stmt = stmt.limit(min(limit, MAX_PLAYER_LIMIT))
    if offset:
        stmt = stmt.offset(offset)
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
    """A player's season week by week: every game his team played, plus the bye.

    Weeks he sat out come back with `status` set and no stats, so callers can
    keep the slot rather than closing the gap. Returns an empty list if he has
    no game logs that season at all.
    """
    slots = await player_season_timeline(db, player_id, season)
    responses: list[PlayerWeeklyResponse] = []
    for slot in slots:
        if slot.status == PLAYED and slot.stat is not None:
            row = PlayerWeeklyResponse.model_validate(slot.stat)
            row.status = PLAYED
        else:
            row = PlayerWeeklyResponse(
                season=season,
                week=slot.week,
                team=slot.team,
                opponent=slot.opponent,
                status=slot.status,
            )
        responses.append(row)
    return responses
