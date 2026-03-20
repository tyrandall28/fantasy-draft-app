from pydantic import BaseModel


class PlayerResponse(BaseModel):
    id: int
    full_name: str
    position: str
    nfl_team: str
    bye_week: int

    model_config = {"from_attributes": True}


class BaseRankingResponse(BaseModel):
    id: int
    source: str
    player_id: int
    rank: int
    tier: int
    player: PlayerResponse

    model_config = {"from_attributes": True}
