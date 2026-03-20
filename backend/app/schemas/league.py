import uuid
from datetime import datetime

from pydantic import BaseModel


class CreateLeagueRequest(BaseModel):
    name: str
    team_count: int = 10
    roster_size: int = 15
    bench_size: int = 6
    position_slots: dict | None = None
    pick_time_seconds: int = 90
    scoring_type: str = "ppr"
    bot_ranking_source: str = "espn_ppr"


class UpdateLeagueRequest(BaseModel):
    name: str | None = None
    team_count: int | None = None
    roster_size: int | None = None
    bench_size: int | None = None
    position_slots: dict | None = None
    pick_time_seconds: int | None = None
    scoring_type: str | None = None
    bot_ranking_source: str | None = None


class JoinLeagueRequest(BaseModel):
    invite_code: str


class SetDraftOrderRequest(BaseModel):
    order: list[str] | None = None  # user_ids; null = randomize


class UpdateMemberRequest(BaseModel):
    team_name: str | None = None
    ranking_id: uuid.UUID | None = None


class MemberResponse(BaseModel):
    league_id: uuid.UUID
    user_id: uuid.UUID
    team_name: str
    draft_position: int | None
    ranking_id: uuid.UUID | None
    username: str = ""
    is_bot: bool = False

    model_config = {"from_attributes": True}


class LeagueResponse(BaseModel):
    id: uuid.UUID
    name: str
    invite_code: str
    commissioner_id: uuid.UUID
    team_count: int
    roster_size: int
    bench_size: int
    position_slots: dict
    pick_time_seconds: int
    scoring_type: str
    bot_ranking_source: str
    draft_order: list[str] | None
    status: str
    created_at: datetime
    members: list[MemberResponse] = []

    model_config = {"from_attributes": True}
