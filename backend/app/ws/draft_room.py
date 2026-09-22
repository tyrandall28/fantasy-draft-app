"""WebSocket draft room manager — handles connections, timer, auto-pick, broadcasting."""
import asyncio
import json
import uuid
from datetime import datetime, timezone

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.database import async_session
from app.models.draft import DraftPick
from app.models.league import League, LeagueMember
from app.models.user import User
from app.services.auth_service import decode_token
from app.services.draft_service import (
    get_auto_pick_player,
    get_drafted_player_ids,
    get_snake_pick_user,
    make_pick,
)


class DraftRoom:
    def __init__(self, league_id: uuid.UUID):
        self.league_id = league_id
        self.connections: dict[str, WebSocket] = {}  # user_id -> ws
        self.timer_task: asyncio.Task | None = None
        self.seconds_remaining: int = 0
        self.timer_enabled: bool = True
        self._bot_ids: set[str] = set()  # cached bot user_ids

    async def connect(self, user_id: str, ws: WebSocket):
        await ws.accept()
        self.connections[user_id] = ws
        await self.broadcast({"event": "user_joined", "user_id": user_id})
        await self.send_state(ws)

    def disconnect(self, user_id: str):
        self.connections.pop(user_id, None)

    async def broadcast(self, data: dict):
        message = json.dumps(data)
        disconnected = []
        for uid, ws in self.connections.items():
            try:
                await ws.send_text(message)
            except Exception:
                disconnected.append(uid)
        for uid in disconnected:
            self.connections.pop(uid, None)

    async def send_state(self, ws: WebSocket):
        async with async_session() as db:
            state = await self._build_state(db)
            await ws.send_text(json.dumps({"event": "draft_state", **state}))

    async def _is_commissioner(self, user_id: str) -> bool:
        async with async_session() as db:
            result = await db.execute(
                select(League.commissioner_id).where(League.id == self.league_id)
            )
            commissioner_id = result.scalar_one_or_none()
        return commissioner_id is not None and str(commissioner_id) == user_id

    async def _load_bot_ids(self, db):
        """Load and cache the set of bot user_ids for this league."""
        stmt = select(LeagueMember.user_id).where(
            LeagueMember.league_id == self.league_id,
            LeagueMember.is_bot == True,
        )
        result = await db.execute(stmt)
        self._bot_ids = {str(uid) for uid in result.scalars().all()}

    async def _build_state(self, db) -> dict:
        stmt = select(League).where(League.id == self.league_id).options(selectinload(League.members))
        result = await db.execute(stmt)
        league = result.scalar_one_or_none()
        if not league:
            return {"error": "League not found"}

        picks_result = await db.execute(
            select(DraftPick)
            .where(DraftPick.league_id == self.league_id)
            .order_by(DraftPick.overall_pick)
        )
        picks = picks_result.scalars().all()

        user_ids = [m.user_id for m in league.members]
        users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
        user_map = {u.id: u.username for u in users_result.scalars().all()}
        bot_ids = {str(m.user_id) for m in league.members if m.is_bot}
        self._bot_ids = bot_ids

        total_picks = league.team_count * league.roster_size
        current_pick = len(picks) + 1
        current_user_id = None
        status = league.status

        if current_pick > total_picks:
            status = "completed"
        elif league.draft_order:
            current_user_id = get_snake_pick_user(league.draft_order, current_pick, league.team_count)

        pick_list = []
        for p in picks:
            pick_list.append({
                "user_id": str(p.user_id),
                "player_id": p.player_id,
                "round_num": p.round_num,
                "pick_in_round": p.pick_in_round,
                "overall_pick": p.overall_pick,
                "is_auto": p.is_auto,
                "picked_at": p.picked_at.isoformat() if p.picked_at else None,
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
            "picks": pick_list,
            "current_pick": current_pick,
            "current_user_id": current_user_id,
            # So the room can hide the commissioner-only controls (undo, timer
            # toggle) rather than offering buttons the server will refuse.
            "commissioner_id": str(league.commissioner_id),
            "seconds_remaining": self.seconds_remaining,
            "status": status,
            "draft_order": league.draft_order,
            "team_count": league.team_count,
            "roster_size": league.roster_size,
            "timer_enabled": self.timer_enabled,
            "bot_ids": list(bot_ids),
        }

    async def handle_make_pick(self, user_id: str, player_id: int):
        async with async_session() as db:
            stmt = select(League).where(League.id == self.league_id).options(selectinload(League.members))
            result = await db.execute(stmt)
            league = result.scalar_one_or_none()
            if not league or league.status != "drafting":
                await self._send_error(user_id, "Draft not active")
                return

            picks_result = await db.execute(
                select(DraftPick).where(DraftPick.league_id == self.league_id)
            )
            picks = picks_result.scalars().all()
            current_pick = len(picks) + 1
            total_picks = league.team_count * league.roster_size

            if current_pick > total_picks:
                await self._send_error(user_id, "Draft is complete")
                return

            expected_user = get_snake_pick_user(league.draft_order, current_pick, league.team_count)

            # Turn enforcement. This was commented out "after testing" and the
            # line below it reassigned user_id = expected_user, which meant any
            # connected client could pick for whoever was on the clock.
            #
            # The commissioner keeps that ability on purpose — it's how you
            # make a pick for someone who has dropped off, and how bots got
            # picked for before. Everyone else may only pick on their own turn.
            if expected_user != user_id:
                is_commissioner = str(league.commissioner_id) == user_id
                if not is_commissioner:
                    await self._send_error(user_id, "Not your turn")
                    return
                # Attribute the pick to the team it belongs to, not to the
                # commissioner who entered it.
                user_id = expected_user

            drafted = await get_drafted_player_ids(db, self.league_id)
            if player_id in drafted:
                await self._send_error(user_id, "Player already drafted")
                return

            try:
                pick = await make_pick(db, league, uuid.UUID(user_id), player_id, current_pick)
            except IntegrityError:
                # The check above and this insert are separated by awaits, and
                # the auto-pick timer runs on the same loop — so the pick can
                # be taken in between. The unique constraints on draft_picks
                # are what actually decide it; this turns losing that race
                # into a message rather than a dead connection.
                await db.rollback()
                await self._send_error(user_id, "That pick was just taken — try again")
                ws = self.connections.get(user_id)
                if ws:
                    await self.send_state(ws)
                return

            await self._broadcast_pick(db, pick, league)

    async def _broadcast_pick(self, db, pick: DraftPick, league: League):
        users_result = await db.execute(select(User).where(User.id == pick.user_id))
        user = users_result.scalar_one_or_none()

        await self.broadcast({
            "event": "pick_made",
            "user_id": str(pick.user_id),
            "player_id": pick.player_id,
            "round_num": pick.round_num,
            "pick_in_round": pick.pick_in_round,
            "overall_pick": pick.overall_pick,
            "is_auto": pick.is_auto,
            "player": {
                "id": pick.player.id,
                "full_name": pick.player.full_name,
                "position": pick.player.position,
                "nfl_team": pick.player.nfl_team,
                "bye_week": pick.player.bye_week,
            },
            "username": user.username if user else "",
        })

        # Check if draft complete
        picks_result = await db.execute(
            select(DraftPick).where(DraftPick.league_id == self.league_id)
        )
        pick_count = len(picks_result.scalars().all())
        total_picks = league.team_count * league.roster_size

        if pick_count >= total_picks:
            league.status = "completed"
            await db.commit()
            await self.broadcast({"event": "draft_complete"})
            if self.timer_task:
                self.timer_task.cancel()
            return

        # Schedule next turn as a NEW task — never call start_turn_timer inline
        # from _broadcast_pick to avoid recursive chains
        next_pick = pick_count + 1
        next_user_id = get_snake_pick_user(league.draft_order, next_pick, league.team_count)
        self._schedule_turn(league, next_user_id, next_pick)

    def _schedule_turn(self, league: League, user_id: str, overall_pick: int):
        """Schedule the next turn as an async task. Breaks recursion."""
        if self.timer_task:
            self.timer_task.cancel()
        self.timer_task = asyncio.create_task(
            self._run_turn(league, user_id, overall_pick)
        )

    async def _run_turn(self, league: League, user_id: str, overall_pick: int):
        """Single task that handles one turn: bot or human."""
        try:
            is_bot = user_id in self._bot_ids

            if is_bot:
                # Bot turn: brief pause so clients see the turn, then auto-pick
                self.seconds_remaining = 0
                await self.broadcast({
                    "event": "turn_start",
                    "user_id": user_id,
                    "overall_pick": overall_pick,
                    "seconds_remaining": 0,
                })
                await asyncio.sleep(0.8)
            else:
                # Human turn: start countdown
                no_timer = not self.timer_enabled or league.pick_time_seconds == 0
                self.seconds_remaining = 0 if no_timer else league.pick_time_seconds
                await self.broadcast({
                    "event": "turn_start",
                    "user_id": user_id,
                    "overall_pick": overall_pick,
                    "seconds_remaining": self.seconds_remaining,
                })

                if no_timer:
                    # Timer disabled — wait indefinitely for manual pick
                    self.timer_task = None
                    return

                # Countdown
                while self.seconds_remaining > 0:
                    await asyncio.sleep(1)
                    self.seconds_remaining -= 1
                    if self.seconds_remaining % 5 == 0 or self.seconds_remaining <= 10:
                        await self.broadcast({
                            "event": "timer_tick",
                            "seconds_remaining": self.seconds_remaining,
                        })

            # Auto-pick (bot immediately, human on timer expiry)
            async with async_session() as db:
                player_id = await get_auto_pick_player(db, self.league_id, uuid.UUID(user_id))
                if player_id:
                    stmt = select(League).where(League.id == self.league_id).options(selectinload(League.members))
                    result = await db.execute(stmt)
                    lg = result.scalar_one()
                    try:
                        pick = await make_pick(
                            db, lg, uuid.UUID(user_id), player_id, overall_pick, is_auto=True
                        )
                    except IntegrityError:
                        # The human got there first, between the auto-pick
                        # choosing a player and writing it. Their pick stands
                        # and already scheduled the next turn; this one just
                        # stops. Unhandled, it would die as a task exception
                        # nobody sees and leave the room with no live timer.
                        await db.rollback()
                        return
                    await self._broadcast_pick(db, pick, lg)

        except asyncio.CancelledError:
            pass

    async def handle_undo_pick(self, user_id: str):
        """Remove the most recent pick — player returns to the available pool via state rebroadcast."""
        async with async_session() as db:
            stmt = select(League).where(League.id == self.league_id).options(selectinload(League.members))
            result = await db.execute(stmt)
            league = result.scalar_one_or_none()
            if not league or league.status not in ("drafting", "completed"):
                await self._send_error(user_id, "Draft not active")
                return

            # Undo rewrites shared history and can reopen a completed draft, so
            # it belongs to the commissioner alone. It previously had no check
            # at all: any connected client could erase the last pick, including
            # somebody else's, repeatedly.
            if str(league.commissioner_id) != user_id:
                await self._send_error(user_id, "Only the commissioner can undo a pick")
                return

            # Find the last pick
            picks_result = await db.execute(
                select(DraftPick)
                .where(DraftPick.league_id == self.league_id)
                .order_by(DraftPick.overall_pick.desc())
                .limit(1)
            )
            last_pick = picks_result.scalar_one_or_none()
            if not last_pick:
                await self._send_error(user_id, "No picks to undo")
                return

            await db.delete(last_pick)

            # If draft was completed, revert to drafting
            if league.status == "completed":
                league.status = "drafting"

            await db.commit()

            # Cancel current timer
            if self.timer_task:
                self.timer_task.cancel()
                self.timer_task = None

            # Rebroadcast full state — picks list shrinks, so the undone player
            # disappears from draftedPlayerIds and reappears in available players
            state = await self._build_state(db)
            await self.broadcast({"event": "draft_state", **state})

            # Restart turn timer for the reverted pick
            if league.status == "drafting" and league.draft_order:
                picks_result2 = await db.execute(
                    select(DraftPick).where(DraftPick.league_id == self.league_id)
                )
                pick_count = len(picks_result2.scalars().all())
                current_pick = pick_count + 1
                current_user = get_snake_pick_user(league.draft_order, current_pick, league.team_count)
                self._schedule_turn(league, current_user, current_pick)

    async def handle_toggle_timer(self, user_id: str, enabled: bool):
        # Also commissioner-only. The pick clock is a league-wide setting, and
        # switching it off is how you'd stop the auto-pick that's about to draft
        # for a stalling opponent — not a decision any participant should own.
        if not await self._is_commissioner(user_id):
            await self._send_error(user_id, "Only the commissioner can change the timer")
            return

        self.timer_enabled = enabled
        if not enabled and self.timer_task:
            self.timer_task.cancel()
            self.timer_task = None
            self.seconds_remaining = 0
        await self.broadcast({
            "event": "settings_updated",
            "timer_enabled": self.timer_enabled,
        })

    async def start_draft_timer(self):
        """Called when draft first starts to begin the first turn timer."""
        async with async_session() as db:
            stmt = select(League).where(League.id == self.league_id).options(selectinload(League.members))
            result = await db.execute(stmt)
            league = result.scalar_one_or_none()
            if not league or not league.draft_order:
                return

            # Cache bot ids
            self._bot_ids = {str(m.user_id) for m in league.members if m.is_bot}

            picks_result = await db.execute(
                select(DraftPick).where(DraftPick.league_id == self.league_id)
            )
            pick_count = len(picks_result.scalars().all())
            current_pick = pick_count + 1
            current_user = get_snake_pick_user(league.draft_order, current_pick, league.team_count)
            self._schedule_turn(league, current_user, current_pick)

    async def _send_error(self, user_id: str, message: str):
        ws = self.connections.get(user_id)
        if ws:
            try:
                await ws.send_text(json.dumps({"event": "error", "message": message}))
            except Exception:
                pass


class DraftRoomManager:
    def __init__(self):
        self.rooms: dict[str, DraftRoom] = {}

    def get_room(self, league_id: uuid.UUID) -> DraftRoom:
        key = str(league_id)
        if key not in self.rooms:
            self.rooms[key] = DraftRoom(league_id)
        return self.rooms[key]

    def remove_room(self, league_id: uuid.UUID):
        self.rooms.pop(str(league_id), None)


draft_manager = DraftRoomManager()
