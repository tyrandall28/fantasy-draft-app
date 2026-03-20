import random
import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import DB, CurrentUser
from app.models.draft import DraftPick
from app.models.league import League, LeagueMember
from app.models.user import User
from app.services.auth_service import hash_password

router = APIRouter(prefix="/api/leagues/{league_id}/draft", tags=["draft"])


@router.post("/start")
async def start_draft(league_id: uuid.UUID, user: CurrentUser, db: DB):
    stmt = select(League).where(League.id == league_id).options(selectinload(League.members))
    result = await db.execute(stmt)
    league = result.scalar_one_or_none()

    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    if league.status != "setup":
        raise HTTPException(status_code=400, detail="Draft already started or completed")
    if len(league.members) < 1:
        raise HTTPException(status_code=400, detail="Need at least 1 member")

    # Auto-fill empty slots with bots
    bot_count = sum(1 for m in league.members if m.is_bot)
    while len(league.members) < league.team_count:
        bot_count += 1
        bot_id = uuid.uuid4()
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
            team_name=f"CPU {bot_count}",
            is_bot=True,
        )
        db.add(member)
        league.members.append(member)

    # Build draft order: members with a draft_position keep it,
    # others (including new bots) fill remaining slots randomly
    assigned = {}
    unassigned = []
    for m in league.members:
        if m.draft_position is not None:
            assigned[m.draft_position] = str(m.user_id)
        else:
            unassigned.append(str(m.user_id))

    random.shuffle(unassigned)
    draft_order = []
    unassigned_iter = iter(unassigned)
    for pos in range(1, league.team_count + 1):
        if pos in assigned:
            draft_order.append(assigned[pos])
        else:
            draft_order.append(next(unassigned_iter))

    league.draft_order = draft_order

    # Set draft_position on all members
    for i, uid in enumerate(draft_order):
        for m in league.members:
            if str(m.user_id) == uid:
                m.draft_position = i + 1

    league.status = "drafting"
    await db.commit()
    return {"ok": True, "status": "drafting"}


@router.get("/state")
async def get_draft_state(league_id: uuid.UUID, user: CurrentUser, db: DB):
    stmt = select(League).where(League.id == league_id).options(selectinload(League.members))
    result = await db.execute(stmt)
    league = result.scalar_one_or_none()
    if not league:
        raise HTTPException(status_code=404, detail="League not found")

    picks_stmt = (
        select(DraftPick)
        .where(DraftPick.league_id == league_id)
        .order_by(DraftPick.overall_pick)
    )
    picks_result = await db.execute(picks_stmt)
    picks = picks_result.scalars().all()

    # Build username map
    user_ids = [m.user_id for m in league.members]
    users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
    user_map = {u.id: u.username for u in users_result.scalars().all()}

    total_picks = league.team_count * league.roster_size
    current_pick = len(picks) + 1

    # Snake draft: determine who picks
    current_user_id = None
    if current_pick <= total_picks and league.draft_order:
        round_num = (current_pick - 1) // league.team_count + 1
        pick_in_round = (current_pick - 1) % league.team_count
        if round_num % 2 == 0:
            pick_in_round = league.team_count - 1 - pick_in_round
        current_user_id = league.draft_order[pick_in_round]

    pick_dicts = []
    for p in picks:
        pick_dicts.append({
            "league_id": str(p.league_id),
            "user_id": str(p.user_id),
            "player_id": p.player_id,
            "round_num": p.round_num,
            "pick_in_round": p.pick_in_round,
            "overall_pick": p.overall_pick,
            "is_auto": p.is_auto,
            "picked_at": p.picked_at.isoformat(),
            "player": {
                "id": p.player.id,
                "full_name": p.player.full_name,
                "position": p.player.position,
                "nfl_team": p.player.nfl_team,
                "bye_week": p.player.bye_week,
            },
            "username": user_map.get(p.user_id, ""),
        })

    return {
        "picks": pick_dicts,
        "current_pick": current_pick,
        "current_user_id": current_user_id,
        "seconds_remaining": league.pick_time_seconds,
        "status": league.status,
        "draft_order": league.draft_order,
        "team_count": league.team_count,
        "roster_size": league.roster_size,
    }


@router.get("/results")
async def get_draft_results(league_id: uuid.UUID, user: CurrentUser, db: DB):
    picks_stmt = (
        select(DraftPick)
        .where(DraftPick.league_id == league_id)
        .order_by(DraftPick.overall_pick)
    )
    result = await db.execute(picks_stmt)
    picks = result.scalars().all()

    # Group by user
    rosters: dict[str, list] = {}
    for p in picks:
        uid = str(p.user_id)
        if uid not in rosters:
            rosters[uid] = []
        rosters[uid].append({
            "player_id": p.player_id,
            "full_name": p.player.full_name,
            "position": p.player.position,
            "nfl_team": p.player.nfl_team,
            "round_num": p.round_num,
            "overall_pick": p.overall_pick,
        })

    return {"rosters": rosters}
