import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

# League settings had no bounds at all: `name: str` against a VARCHAR(100)
# column, and bare `int`s for every count. So `{"name": "x" * 5000}` passed
# validation and died in Postgres as a 500, and team_count=-3 or
# pick_time_seconds=-10 stored happily and broke the draft downstream.
#
# The ceilings sit well above what the lobby offers (6-14 teams, a 30s-5min
# timer) — they rule out the absurd, they don't second-guess the UI. Note that
# SQLite ignores VARCHAR lengths, so the length bugs these close can't be
# reproduced by the test suite; they only appear on Postgres.

MAX_LEAGUE_NAME = 100  # matches League.name
MAX_TEAM_NAME = 50  # matches LeagueMember.team_name
MAX_SOURCE_NAME = 50  # matches League.bot_ranking_source

TEAM_COUNT = (2, 20)
ROSTER_SIZE = (1, 50)
BENCH_SIZE = (0, 40)
PICK_SECONDS = (0, 3600)  # 0 means "no timer" — draft_room.py checks for it

# The slot keys the draft actually understands (draft_service.compute_open_slots,
# and the lobby's POSITION_ORDER). An unknown key would silently do nothing.
VALID_SLOT_POSITIONS = {"QB", "RB", "WR", "TE", "FLEX", "K", "DST", "BN"}
MAX_SLOTS_PER_POSITION = 20

# Nothing branches on scoring_type yet — it's displayed — but an arbitrary
# string is still meaningless to every reader of it.
VALID_SCORING_TYPES = {"ppr", "half_ppr", "standard"}


def validate_position_slots(v: dict | None) -> dict | None:
    """Slots are free-form JSONB, so the shape has to be checked here."""
    if v is None:
        return v
    unknown = set(v) - VALID_SLOT_POSITIONS
    if unknown:
        raise ValueError(
            f"Unknown roster slots: {', '.join(sorted(unknown))}. "
            f"Valid slots are {', '.join(sorted(VALID_SLOT_POSITIONS))}."
        )
    for pos, count in v.items():
        # bool is an int subclass, and {"QB": true} is not a slot count.
        if not isinstance(count, int) or isinstance(count, bool):
            raise ValueError(f"{pos} must be a whole number of slots.")
        if not 0 <= count <= MAX_SLOTS_PER_POSITION:
            raise ValueError(f"{pos} must be between 0 and {MAX_SLOTS_PER_POSITION} slots.")
    return v


def validate_name(v: str | None) -> str | None:
    """Trim, and refuse a name that is nothing but whitespace."""
    if v is None:
        return v
    v = v.strip()
    if not v:
        raise ValueError("Name cannot be empty.")
    return v


def validate_scoring_type(v: str | None) -> str | None:
    if v is not None and v not in VALID_SCORING_TYPES:
        raise ValueError(f"Scoring must be one of: {', '.join(sorted(VALID_SCORING_TYPES))}.")
    return v


class CreateLeagueRequest(BaseModel):
    name: str = Field(..., max_length=MAX_LEAGUE_NAME)
    team_count: int = Field(10, ge=TEAM_COUNT[0], le=TEAM_COUNT[1])
    roster_size: int = Field(15, ge=ROSTER_SIZE[0], le=ROSTER_SIZE[1])
    bench_size: int = Field(6, ge=BENCH_SIZE[0], le=BENCH_SIZE[1])
    position_slots: dict | None = None
    pick_time_seconds: int = Field(90, ge=PICK_SECONDS[0], le=PICK_SECONDS[1])
    scoring_type: str = "ppr"
    bot_ranking_source: str = Field("espn_ppr", min_length=1, max_length=MAX_SOURCE_NAME)

    @field_validator("name")
    @classmethod
    def _check_name(cls, v: str) -> str:
        return validate_name(v)

    @field_validator("position_slots")
    @classmethod
    def _check_slots(cls, v: dict | None) -> dict | None:
        return validate_position_slots(v)

    @field_validator("scoring_type")
    @classmethod
    def _check_scoring(cls, v: str) -> str:
        return validate_scoring_type(v)


class UpdateLeagueRequest(BaseModel):
    """Every field optional; the bounds apply to whatever is actually sent."""

    name: str | None = Field(None, max_length=MAX_LEAGUE_NAME)
    team_count: int | None = Field(None, ge=TEAM_COUNT[0], le=TEAM_COUNT[1])
    roster_size: int | None = Field(None, ge=ROSTER_SIZE[0], le=ROSTER_SIZE[1])
    bench_size: int | None = Field(None, ge=BENCH_SIZE[0], le=BENCH_SIZE[1])
    position_slots: dict | None = None
    pick_time_seconds: int | None = Field(None, ge=PICK_SECONDS[0], le=PICK_SECONDS[1])
    scoring_type: str | None = None
    bot_ranking_source: str | None = Field(None, min_length=1, max_length=MAX_SOURCE_NAME)

    @field_validator("name")
    @classmethod
    def _check_name(cls, v: str | None) -> str | None:
        return validate_name(v)

    @field_validator("position_slots")
    @classmethod
    def _check_slots(cls, v: dict | None) -> dict | None:
        return validate_position_slots(v)

    @field_validator("scoring_type")
    @classmethod
    def _check_scoring(cls, v: str | None) -> str | None:
        return validate_scoring_type(v)


class JoinLeagueRequest(BaseModel):
    # Codes are 12 characters (League.generate_invite_code); the bound just
    # stops an arbitrarily long string reaching the query.
    invite_code: str = Field(..., min_length=1, max_length=64)

    @field_validator("invite_code")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Enter an invite code.")
        return v


class SetDraftOrderRequest(BaseModel):
    # user_ids; null = randomize. Whether those ids are actually the league's
    # members is checked in the endpoint, which is the only place that knows.
    order: list[str] | None = Field(None, max_length=TEAM_COUNT[1])


class ClaimPositionRequest(BaseModel):
    """A draft slot to take, or null to give the one you hold back.

    The endpoint took a bare `dict` and compared `body.get("position")` to an
    int, so `{"position": "abc"}` raised TypeError and came back as a 500. The
    1..team_count range stays in the endpoint, which is what knows team_count
    and can say "Position must be 1-10" instead of a schema error.
    """

    position: int | None = None


class UpdateMemberRequest(BaseModel):
    team_name: str | None = Field(None, max_length=MAX_TEAM_NAME)
    ranking_id: uuid.UUID | None = None

    @field_validator("team_name")
    @classmethod
    def _check_team_name(cls, v: str | None) -> str | None:
        return validate_name(v)


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
