"""WebSocket endpoint for draft rooms."""
import json
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from app.services.auth_service import decode_token
from app.ws.draft_room import draft_manager

router = APIRouter()


@router.websocket("/ws/draft/{league_id}")
async def draft_websocket(
    ws: WebSocket,
    league_id: uuid.UUID,
    token: str = Query(...),
):
    # Authenticate via JWT
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        await ws.close(code=4001, reason="Invalid token")
        return

    user_id = payload["sub"]
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
                player_id = data.get("player_id")
                if player_id:
                    await room.handle_make_pick(user_id, int(player_id))
            elif event == "toggle_timer":
                enabled = data.get("enabled", True)
                await room.handle_toggle_timer(bool(enabled))
            elif event == "undo_pick":
                await room.handle_undo_pick(user_id)
    except WebSocketDisconnect:
        room.disconnect(user_id)
        await room.broadcast({"event": "user_left", "user_id": user_id})
