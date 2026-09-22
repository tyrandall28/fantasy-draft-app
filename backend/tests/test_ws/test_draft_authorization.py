"""Authorization in the draft room.

Every test here covers a hole that was open in a deploy-ready branch, so they
are regression tests in the strict sense — each one failed before the fix:

  * turn enforcement was commented out ("re-enable after testing") *and* the
    next line reassigned `user_id = expected_user`, so any connected client
    could make the pick for whoever was on the clock;
  * the WebSocket handshake verified the JWT but never checked league
    membership, so any authenticated user could open any league's draft room;
  * undo and the timer toggle had no authorization at all.

`DraftRoom` and the connect handshake both reach for the module-level
`async_session` rather than taking a session argument, so each test points that
name at the test engine. That's the seam a refactor should remove; until then
patching it is what makes these testable at all.
"""
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.draft import DraftPick
from app.models.league import League, LeagueMember
from app.models.player import Player
from app.models.user import User
from app.ws import draft_room as draft_room_module
from app.ws import events as events_module
from app.ws.draft_room import DraftRoom
from app.ws.events import _is_league_participant


class FakeWebSocket:
    """Captures what the room sends instead of holding a socket open."""

    def __init__(self) -> None:
        self.sent: list[str] = []
        self.accepted = False
        self.closed_with: tuple[int, str] | None = None

    async def accept(self) -> None:
        self.accepted = True

    async def send_text(self, message: str) -> None:
        self.sent.append(message)

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed_with = (code, reason)


@pytest.fixture
def patch_session(db_engine, monkeypatch):
    """Point the draft room's module-level session factory at the test engine."""
    factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(draft_room_module, "async_session", factory)
    monkeypatch.setattr(events_module, "async_session", factory)
    return factory


@pytest.fixture
def make_room():
    """Build DraftRooms and cancel their timer tasks afterwards.

    A successful pick schedules the next turn as a background task. Left
    running, it outlives the test and pytest reports "Task was destroyed but it
    is pending" — harmless here but exactly the noise that hides a real leak
    later.
    """
    rooms: list[DraftRoom] = []

    def factory(league_id) -> DraftRoom:
        room = DraftRoom(league_id)
        rooms.append(room)
        return room

    yield factory

    for room in rooms:
        if room.timer_task:
            room.timer_task.cancel()


@pytest_asyncio.fixture
async def drafting_league(db_session: AsyncSession):
    """A two-team league mid-draft.

    `commish` owns the league and holds team 1; `member` holds team 2. The
    snake order is [commish, member], so pick 1 belongs to the commissioner and
    pick 2 to the member.
    """
    commish = User(
        id=uuid.uuid4(),
        email="commish@example.com",
        username="commish",
        hashed_password="x",
    )
    member = User(
        id=uuid.uuid4(),
        email="member@example.com",
        username="member",
        hashed_password="x",
    )
    outsider = User(
        id=uuid.uuid4(),
        email="outsider@example.com",
        username="outsider",
        hashed_password="x",
    )
    db_session.add_all([commish, member, outsider])
    await db_session.flush()

    league = League(
        id=uuid.uuid4(),
        name="Test League",
        invite_code="testcode1",
        commissioner_id=commish.id,
        team_count=2,
        roster_size=2,
        draft_order=[str(commish.id), str(member.id)],
        status="drafting",
    )
    db_session.add(league)
    await db_session.flush()

    db_session.add_all([
        LeagueMember(league_id=league.id, user_id=commish.id, team_name="Team Commish"),
        LeagueMember(league_id=league.id, user_id=member.id, team_name="Team Member"),
    ])

    players = [
        Player(full_name="Ja'Marr Chase", position="WR", nfl_team="CIN", gsis_id="00-0036900"),
        Player(full_name="Bijan Robinson", position="RB", nfl_team="ATL", gsis_id="00-0037746"),
    ]
    db_session.add_all(players)
    await db_session.commit()
    for p in players:
        await db_session.refresh(p)

    return {
        "league": league,
        "commish": commish,
        "member": member,
        "outsider": outsider,
        "players": players,
    }


def errors_sent(ws: FakeWebSocket) -> list[str]:
    import json

    return [
        json.loads(m)["message"]
        for m in ws.sent
        if json.loads(m).get("event") == "error"
    ]


class TestConnectAuthorization:
    """`_is_league_participant` — the check the handshake was missing."""

    async def test_member_is_allowed(self, patch_session, drafting_league):
        league, member = drafting_league["league"], drafting_league["member"]
        assert await _is_league_participant(league.id, str(member.id)) is True

    async def test_commissioner_is_allowed(self, patch_session, drafting_league):
        league, commish = drafting_league["league"], drafting_league["commish"]
        assert await _is_league_participant(league.id, str(commish.id)) is True

    async def test_authenticated_outsider_is_refused(self, patch_session, drafting_league):
        """The hole: a valid token for a user with no connection to the league."""
        league, outsider = drafting_league["league"], drafting_league["outsider"]
        assert await _is_league_participant(league.id, str(outsider.id)) is False

    async def test_unknown_league_is_refused(self, patch_session, drafting_league):
        member = drafting_league["member"]
        assert await _is_league_participant(uuid.uuid4(), str(member.id)) is False

    async def test_malformed_user_id_is_refused_not_raised(self, patch_session, drafting_league):
        """A junk `sub` claim must close the socket, not raise a ValueError."""
        league = drafting_league["league"]
        assert await _is_league_participant(league.id, "not-a-uuid") is False


class TestTurnEnforcement:
    async def test_user_cannot_pick_out_of_turn(self, patch_session, drafting_league, make_room):
        """Pick 1 belongs to the commissioner; the member must not take it."""
        league, member = drafting_league["league"], drafting_league["member"]
        player = drafting_league["players"][0]

        room = make_room(league.id)
        ws = FakeWebSocket()
        room.connections[str(member.id)] = ws

        await room.handle_make_pick(str(member.id), player.id)

        assert errors_sent(ws) == ["Not your turn"]
        async with patch_session() as db:
            picks = (await db.execute(select(DraftPick))).scalars().all()
        assert picks == []

    async def test_user_can_pick_on_their_own_turn(self, patch_session, drafting_league, make_room):
        league, commish = drafting_league["league"], drafting_league["commish"]
        player = drafting_league["players"][0]

        room = make_room(league.id)
        ws = FakeWebSocket()
        room.connections[str(commish.id)] = ws

        await room.handle_make_pick(str(commish.id), player.id)

        assert errors_sent(ws) == []
        async with patch_session() as db:
            picks = (await db.execute(select(DraftPick))).scalars().all()
        assert len(picks) == 1
        assert picks[0].user_id == commish.id

    async def test_commissioner_may_pick_for_the_team_on_the_clock(
        self, patch_session, drafting_league, make_room
    ):
        """The one allowed override — and the pick belongs to that team, not him.

        Pick 2 is the member's. The commissioner entering it is how a dropped
        player gets drafted for; attributing it to the commissioner would put
        the player on the wrong roster.
        """
        league = drafting_league["league"]
        commish, member = drafting_league["commish"], drafting_league["member"]
        first, second = drafting_league["players"]

        room = make_room(league.id)
        ws = FakeWebSocket()
        room.connections[str(commish.id)] = ws

        await room.handle_make_pick(str(commish.id), first.id)   # his own pick 1
        await room.handle_make_pick(str(commish.id), second.id)  # member's pick 2

        assert errors_sent(ws) == []
        async with patch_session() as db:
            picks = (
                await db.execute(select(DraftPick).order_by(DraftPick.overall_pick))
            ).scalars().all()
        assert [p.user_id for p in picks] == [commish.id, member.id]


class TestUndoAuthorization:
    async def test_non_commissioner_cannot_undo(self, patch_session, drafting_league, make_room):
        league, commish, member = (
            drafting_league["league"],
            drafting_league["commish"],
            drafting_league["member"],
        )
        player = drafting_league["players"][0]

        room = make_room(league.id)
        commish_ws, member_ws = FakeWebSocket(), FakeWebSocket()
        room.connections[str(commish.id)] = commish_ws
        room.connections[str(member.id)] = member_ws

        await room.handle_make_pick(str(commish.id), player.id)
        await room.handle_undo_pick(str(member.id))

        assert errors_sent(member_ws) == ["Only the commissioner can undo a pick"]
        async with patch_session() as db:
            picks = (await db.execute(select(DraftPick))).scalars().all()
        assert len(picks) == 1, "the pick should have survived a non-commissioner undo"

    async def test_commissioner_can_undo(self, patch_session, drafting_league, make_room):
        league, commish = drafting_league["league"], drafting_league["commish"]
        player = drafting_league["players"][0]

        room = make_room(league.id)
        ws = FakeWebSocket()
        room.connections[str(commish.id)] = ws

        await room.handle_make_pick(str(commish.id), player.id)
        await room.handle_undo_pick(str(commish.id))

        assert errors_sent(ws) == []
        async with patch_session() as db:
            picks = (await db.execute(select(DraftPick))).scalars().all()
        assert picks == []


class TestTimerToggleAuthorization:
    async def test_non_commissioner_cannot_disable_the_timer(
        self, patch_session, drafting_league, make_room
    ):
        league, member = drafting_league["league"], drafting_league["member"]

        room = make_room(league.id)
        ws = FakeWebSocket()
        room.connections[str(member.id)] = ws
        assert room.timer_enabled is True

        await room.handle_toggle_timer(str(member.id), False)

        assert errors_sent(ws) == ["Only the commissioner can change the timer"]
        assert room.timer_enabled is True

    async def test_commissioner_can_disable_the_timer(self, patch_session, drafting_league, make_room):
        league, commish = drafting_league["league"], drafting_league["commish"]

        room = make_room(league.id)
        ws = FakeWebSocket()
        room.connections[str(commish.id)] = ws

        await room.handle_toggle_timer(str(commish.id), False)

        assert errors_sent(ws) == []
        assert room.timer_enabled is False


class TestStateExposesCommissioner:
    async def test_state_carries_commissioner_id(self, patch_session, drafting_league, make_room):
        """The frontend hides the commissioner-only controls based on this."""
        league, commish = drafting_league["league"], drafting_league["commish"]

        room = make_room(league.id)
        async with patch_session() as db:
            state = await room._build_state(db)

        assert state["commissioner_id"] == str(commish.id)
