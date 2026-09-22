"""WebSocket endpoint for draft rooms."""
import json
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from sqlalchemy import select

from app.database import async_session
from app.models.league import League, LeagueMember
from app.services.auth_service import decode_token
from app.ws.draft_room import draft_manager

router = APIRouter()


async def _is_league_participant(league_id: uuid.UUID, user_id: str) -> bool:
    """Whether this user is allowed in this league's draft room.

    A member, or the commissioner. The commissioner is checked separately
    because they own the league whether or not they hold a team in it.

    A malformed user id from a token means no: a UUID that doesn't parse can't
    match a row, and letting the ValueError escape would surface as a 500 on a
    connection that should simply be refused.
    """
    try:
        uid = uuid.UUID(user_id)
    except (ValueError, AttributeError, TypeError):
        return False

    async with async_session() as db:
        result = await db.execute(
            select(LeagueMember.id).where(
                LeagueMember.league_id == league_id,
                LeagueMember.user_id == uid,
            )
        )
        if result.first() is not None:
            return True

        result = await db.execute(
            select(League.id).where(League.id == league_id, League.commissioner_id == uid)
        )
        return result.first() is not None


@router.websocket("/ws/draft/{league_id}")
async def draft_websocket(
    ws: WebSocket,
    league_id: uuid.UUID,
    token: str = Query(...),
):
    # Authenticate via JWT.
    #
    # The token arrives in the query string, which is the one place it will be
    # written to an access log — browsers can't set headers on a WebSocket
    # handshake, so fixing that needs a ticket-style exchange. Tracked in
    # TODO.md under "WebSocket auth via header"; it is not fixed here.
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        await ws.close(code=4001, reason="Invalid token")
        return

    user_id = payload["sub"]

    # Authorize. Verifying the token only established *who* is connecting; it
    # said nothing about whether they belong in this league. Without this, any
    # authenticated user could open any league's draft room by id and receive
    # every pick broadcast in it.
    if not await _is_league_participant(league_id, user_id):
        await ws.close(code=4003, reason="Not a member of this league")
        return

    room = draft_manager.get_room(league_id)

    await room.connect(user_id, ws)

    # Start timer if this is the first connection and draft is active
    if len(room.connections) == 1 and not room.timer_task:
        await room.start_draft_timer()

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            event = data.get("event")
            if event == "make_pick":
                # int() on arbitrary JSON raises, and the only handler around
                # this loop catches WebSocketDisconnect — so {"player_id":
                # "abc"} used to kill the connection with an unhandled
                # ValueError. Ignore the frame instead.
                try:
                    player_id = int(data["player_id"])
                except (KeyError, TypeError, ValueError):
                    continue
                await room.handle_make_pick(user_id, player_id)
            elif event == "toggle_timer":
                enabled = data.get("enabled", True)
                await room.handle_toggle_timer(user_id, bool(enabled))
            elif event == "undo_pick":
                await room.handle_undo_pick(user_id)
    except WebSocketDisconnect:
        room.disconnect(user_id)
        await room.broadcast({"event": "user_left", "user_id": user_id})
