import uuid
from datetime import datetime

from pydantic import BaseModel

from app.schemas.player import PlayerResponse


class CreateRankingRequest(BaseModel):
    source: str
    name: str


class RankingResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    source: str
    name: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RankingEntryResponse(BaseModel):
    id: int
    ranking_id: uuid.UUID
    player_id: int
    rank: int
    is_locked: bool
    player: PlayerResponse

    model_config = {"from_attributes": True}


class RankingDetailResponse(RankingResponse):
    entries: list[RankingEntryResponse]


class ReorderRequest(BaseModel):
    entry_ids: list[int]


class PatchEntryRequest(BaseModel):
    is_locked: bool | None = None
    rank: int | None = None
