"""Who is allowed to see and act on a league.

One rule in one place. It was previously three: `ws/events.py` checked
membership on connect, `api/leagues.py` checked the commissioner on each
mutation, and `api/drafts.py` checked nothing at all — so any logged-in user
could start someone else's draft, and read any league by id including its
invite code, which is enough to join it.

A *participant* is a member or the commissioner. The commissioner is checked
separately because they own the league whether or not they hold a team in it.
"""
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.league import League, LeagueMember


async def is_participant(db: AsyncSession, league_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """Whether this user belongs in this league at all."""
    result = await db.execute(
        select(LeagueMember.id).where(
            LeagueMember.league_id == league_id,
            LeagueMember.user_id == user_id,
        )
    )
    if result.first() is not None:
        return True

    result = await db.execute(
        select(League.id).where(League.id == league_id, League.commissioner_id == user_id)
    )
    return result.first() is not None


async def load_league(db: AsyncSession, league_id: uuid.UUID) -> League | None:
    result = await db.execute(
        select(League).where(League.id == league_id).options(selectinload(League.members))
    )
    return result.scalar_one_or_none()


async def require_participant(
    db: AsyncSession, league_id: uuid.UUID, user_id: uuid.UUID
) -> League:
    """Return the league, or refuse.

    404 rather than 403 for an outsider: a league they can't see shouldn't be
    confirmed to exist, and the response is the same either way.
    """
    league = await load_league(db, league_id)
    if not league or not await is_participant(db, league_id, user_id):
        raise HTTPException(status_code=404, detail="League not found")
    return league


async def require_commissioner(
    db: AsyncSession, league_id: uuid.UUID, user_id: uuid.UUID
) -> League:
    """Return the league, or refuse. Mirrors the wording already in leagues.py."""
    league = await load_league(db, league_id)
    if not league or league.commissioner_id != user_id:
        raise HTTPException(status_code=403, detail="Not commissioner")
    return league
