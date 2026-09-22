import random
import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import DB, CurrentUser
from app.models.league import League, LeagueMember
from app.models.ranking import UserRanking
from app.models.user import User
from app.services.auth_service import hash_password
from app.services.league_access import require_participant
from app.schemas.league import (
    ClaimPositionRequest,
    CreateLeagueRequest,
    JoinLeagueRequest,
    LeagueResponse,
    MemberResponse,
    SetDraftOrderRequest,
    UpdateLeagueRequest,
    UpdateMemberRequest,
)

router = APIRouter(prefix="/api/leagues", tags=["leagues"])


async def _get_league_with_members(db, league_id: uuid.UUID) -> League | None:
    stmt = select(League).where(League.id == league_id).options(selectinload(League.members))
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


def _league_response(league: League, user_map: dict[uuid.UUID, str]) -> dict:
    members = []
    for m in league.members:
        members.append(MemberResponse(
            league_id=m.league_id,
            user_id=m.user_id,
            team_name=m.team_name,
            draft_position=m.draft_position,
            ranking_id=m.ranking_id,
            username=user_map.get(m.user_id, "") if not m.is_bot else m.team_name,
            is_bot=m.is_bot,
        ))
    return LeagueResponse(
        id=league.id,
        name=league.name,
        invite_code=league.invite_code,
        commissioner_id=league.commissioner_id,
        team_count=league.team_count,
        roster_size=league.roster_size,
        bench_size=league.bench_size,
        position_slots=league.position_slots,
        pick_time_seconds=league.pick_time_seconds,
        scoring_type=league.scoring_type,
        bot_ranking_source=league.bot_ranking_source or "espn_ppr",
        draft_order=league.draft_order,
        status=league.status,
        created_at=league.created_at,
        members=members,
    ).model_dump(mode="json")


async def _build_user_map(db, league: League) -> dict[uuid.UUID, str]:
    user_ids = [m.user_id for m in league.members]
    if not user_ids:
        return {}
    result = await db.execute(select(User).where(User.id.in_(user_ids)))
    return {u.id: u.username for u in result.scalars().all()}


@router.post("", response_model=LeagueResponse, status_code=status.HTTP_201_CREATED)
async def create_league(body: CreateLeagueRequest, user: CurrentUser, db: DB):
    league = League(
        name=body.name,
        commissioner_id=user.id,
        team_count=body.team_count,
        roster_size=body.roster_size,
        bench_size=body.bench_size,
        pick_time_seconds=body.pick_time_seconds,
        scoring_type=body.scoring_type,
        bot_ranking_source=body.bot_ranking_source,
    )
    if body.position_slots:
        league.position_slots = body.position_slots
    db.add(league)
    await db.flush()

    member = LeagueMember(league_id=league.id, user_id=user.id, team_name=f"{user.username}'s Team")
    db.add(member)
    await db.commit()

    league = await _get_league_with_members(db, league.id)
    user_map = await _build_user_map(db, league)
    return _league_response(league, user_map)


@router.get("", response_model=list[LeagueResponse])
async def list_leagues(user: CurrentUser, db: DB):
    stmt = (
        select(League)
        .join(LeagueMember)
        .where(LeagueMember.user_id == user.id)
        .options(selectinload(League.members))
    )
    result = await db.execute(stmt)
    leagues = result.scalars().unique().all()
    responses = []
    for lg in leagues:
        user_map = await _build_user_map(db, lg)
        responses.append(_league_response(lg, user_map))
    return responses


@router.get("/{league_id}", response_model=LeagueResponse)
async def get_league(league_id: uuid.UUID, user: CurrentUser, db: DB):
    # Members only. Any logged-in user could read any league by id, and the
    # response carries `invite_code` — which is all you need to then join it.
    league = await require_participant(db, league_id, user.id)
    user_map = await _build_user_map(db, league)
    return _league_response(league, user_map)


@router.patch("/{league_id}", response_model=LeagueResponse)
async def update_league(league_id: uuid.UUID, body: UpdateLeagueRequest, user: CurrentUser, db: DB):
    league = await _get_league_with_members(db, league_id)
    if not league or league.commissioner_id != user.id:
        raise HTTPException(status_code=403, detail="Not commissioner")
    if league.status != "setup":
        raise HTTPException(status_code=400, detail="Cannot edit after draft started")

    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(league, field, val)
    await db.commit()
    await db.refresh(league)
    user_map = await _build_user_map(db, league)
    return _league_response(league, user_map)


@router.post("/join", response_model=LeagueResponse)
async def join_league(body: JoinLeagueRequest, user: CurrentUser, db: DB):
    stmt = select(League).where(League.invite_code == body.invite_code).options(selectinload(League.members))
    result = await db.execute(stmt)
    league = result.scalar_one_or_none()
    if not league:
        raise HTTPException(status_code=404, detail="Invalid invite code")

    if any(m.user_id == user.id for m in league.members):
        raise HTTPException(status_code=400, detail="Already a member")

    if len(league.members) >= league.team_count:
        raise HTTPException(status_code=400, detail="League is full")

    member = LeagueMember(league_id=league.id, user_id=user.id, team_name=f"{user.username}'s Team")
    db.add(member)
    await db.commit()

    league = await _get_league_with_members(db, league.id)
    user_map = await _build_user_map(db, league)
    return _league_response(league, user_map)


@router.post("/{league_id}/set-draft-order")
async def set_draft_order(league_id: uuid.UUID, body: SetDraftOrderRequest, user: CurrentUser, db: DB):
    league = await _get_league_with_members(db, league_id)
    if not league or league.commissioner_id != user.id:
        raise HTTPException(status_code=403, detail="Not commissioner")

    member_ids = [str(m.user_id) for m in league.members]

    if body.order:
        league.draft_order = body.order
    else:
        random.shuffle(member_ids)
        league.draft_order = member_ids

    for i, uid in enumerate(league.draft_order):
        for m in league.members:
            if str(m.user_id) == uid:
                m.draft_position = i + 1

    await db.commit()
    return {"ok": True, "draft_order": league.draft_order}


@router.patch("/{league_id}/members/me")
async def update_my_membership(league_id: uuid.UUID, body: UpdateMemberRequest, user: CurrentUser, db: DB):
    stmt = select(LeagueMember).where(
        LeagueMember.league_id == league_id, LeagueMember.user_id == user.id
    )
    result = await db.execute(stmt)
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Not a member")

    if body.team_name is not None:
        member.team_name = body.team_name

    if body.ranking_id is not None:
        # This was assigned straight through. An id that didn't exist hit the
        # foreign key and came back as a 500, and one belonging to *someone
        # else* was accepted — the only endpoint touching a ranking that
        # didn't check who owns it. Everything in /api/rankings does.
        owned = await db.execute(
            select(UserRanking.id).where(
                UserRanking.id == body.ranking_id,
                UserRanking.user_id == user.id,
            )
        )
        if owned.first() is None:
            raise HTTPException(status_code=404, detail="Ranking not found")
        member.ranking_id = body.ranking_id

    await db.commit()
    return {"ok": True}


@router.post("/{league_id}/bots", status_code=status.HTTP_201_CREATED)
async def add_bot(league_id: uuid.UUID, user: CurrentUser, db: DB):
    league = await _get_league_with_members(db, league_id)
    if not league or league.commissioner_id != user.id:
        raise HTTPException(status_code=403, detail="Not commissioner")
    if league.status != "setup":
        raise HTTPException(status_code=400, detail="Cannot add bots after draft started")
    if len(league.members) >= league.team_count:
        raise HTTPException(status_code=400, detail="League is full")

    # Count existing bots to generate name
    bot_count = sum(1 for m in league.members if m.is_bot)
    bot_num = bot_count + 1
    bot_id = uuid.uuid4()

    # Create a placeholder user for the bot (satisfies FK constraints)
    bot_user = User(
        id=bot_id,
        email=f"bot-{bot_id}@cpu.local",
        username=f"CPU_{bot_id.hex[:8]}",
        hashed_password=hash_password(uuid.uuid4().hex),
    )
    db.add(bot_user)
    await db.flush()

    member = LeagueMember(
        league_id=league.id,
        user_id=bot_id,
        team_name=f"CPU {bot_num}",
        is_bot=True,
    )
    db.add(member)
    await db.commit()

    league = await _get_league_with_members(db, league.id)
    user_map = await _build_user_map(db, league)
    return _league_response(league, user_map)


@router.delete("/{league_id}/bots/{bot_user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_bot(league_id: uuid.UUID, bot_user_id: uuid.UUID, user: CurrentUser, db: DB):
    league = await _get_league_with_members(db, league_id)
    if not league or league.commissioner_id != user.id:
        raise HTTPException(status_code=403, detail="Not commissioner")
    if league.status != "setup":
        raise HTTPException(status_code=400, detail="Cannot remove bots after draft started")

    member = next((m for m in league.members if m.user_id == bot_user_id and m.is_bot), None)
    if not member:
        raise HTTPException(status_code=404, detail="Bot not found")

    # Remove the member and the placeholder user
    await db.delete(member)
    bot_user = await db.get(User, bot_user_id)
    if bot_user:
        await db.delete(bot_user)
    await db.commit()


@router.post("/{league_id}/claim-position")
async def claim_draft_position(
    league_id: uuid.UUID, body: ClaimPositionRequest, user: CurrentUser, db: DB
):
    """User claims an open draft position (1-based). Pass {"position": N} or {"position": null} to release."""
    league = await _get_league_with_members(db, league_id)
    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    if league.status != "setup":
        raise HTTPException(status_code=400, detail="Cannot change positions after draft started")

    member = next((m for m in league.members if m.user_id == user.id), None)
    if not member:
        raise HTTPException(status_code=404, detail="Not a member")

    position = body.position

    # Release current position
    if position is None:
        member.draft_position = None
        await db.commit()
        return {"ok": True}

    # Validate position range
    if position < 1 or position > league.team_count:
        raise HTTPException(status_code=400, detail=f"Position must be 1-{league.team_count}")

    # Check if position is taken by someone else
    for m in league.members:
        if m.draft_position == position and m.user_id != user.id:
            raise HTTPException(status_code=400, detail="Position already taken")

    member.draft_position = position
    await db.commit()
    return {"ok": True}
