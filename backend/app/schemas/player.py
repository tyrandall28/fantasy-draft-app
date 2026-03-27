from datetime import date

from pydantic import BaseModel


class PlayerResponse(BaseModel):
    id: int
    full_name: str
    position: str
    nfl_team: str
    bye_week: int | None = None
    headshot_url: str | None = None

    model_config = {"from_attributes": True}


class BaseRankingResponse(BaseModel):
    id: int
    source: str
    player_id: int
    rank: int
    tier: int
    player: PlayerResponse

    model_config = {"from_attributes": True}


class PlayerBioResponse(BaseModel):
    player_id: int
    height_inches: int | None = None
    weight_lbs: int | None = None
    birth_date: date | None = None
    college: str | None = None
    draft_year: int | None = None
    draft_round: int | None = None
    draft_pick: int | None = None
    draft_overall: int | None = None
    years_exp: int | None = None
    forty_yard_dash: float | None = None
    bench_press: int | None = None
    vertical_jump: float | None = None
    broad_jump: int | None = None
    three_cone: float | None = None
    shuttle: float | None = None

    model_config = {"from_attributes": True}


class PlayerSeasonResponse(BaseModel):
    season: int
    games_played: int | None = None
    # Passing
    pass_attempts: int | None = None
    pass_completions: int | None = None
    pass_yards: int | None = None
    pass_tds: int | None = None
    interceptions: int | None = None
    sacks: int | None = None
    pass_air_yards: int | None = None
    pass_epa: float | None = None
    pass_cpoe: float | None = None
    # Rushing
    rush_attempts: int | None = None
    rush_yards: int | None = None
    rush_tds: int | None = None
    rush_fumbles: int | None = None
    rush_first_downs: int | None = None
    rush_epa: float | None = None
    # Receiving
    targets: int | None = None
    receptions: int | None = None
    rec_yards: int | None = None
    rec_tds: int | None = None
    rec_air_yards: int | None = None
    rec_yards_after_catch: int | None = None
    rec_first_downs: int | None = None
    rec_epa: float | None = None
    target_share: float | None = None
    air_yards_share: float | None = None
    wopr: float | None = None
    # Kicking
    fg_made: int | None = None
    fg_att: int | None = None
    fg_pct: float | None = None
    fg_long: int | None = None
    pat_made: int | None = None
    pat_att: int | None = None
    # Special teams
    special_teams_tds: int | None = None
    # Fantasy
    fantasy_points: float | None = None
    fantasy_points_ppr: float | None = None
    # Snap counts
    snap_count: int | None = None
    snap_pct: float | None = None

    model_config = {"from_attributes": True}


class PlayerWeeklyResponse(BaseModel):
    season: int
    week: int
    opponent: str | None = None
    team: str | None = None
    # Passing
    pass_attempts: int | None = None
    pass_completions: int | None = None
    pass_yards: int | None = None
    pass_tds: int | None = None
    interceptions: int | None = None
    sacks: int | None = None
    pass_epa: float | None = None
    # Rushing
    rush_attempts: int | None = None
    rush_yards: int | None = None
    rush_tds: int | None = None
    rush_fumbles: int | None = None
    rush_epa: float | None = None
    # Receiving
    targets: int | None = None
    receptions: int | None = None
    rec_yards: int | None = None
    rec_tds: int | None = None
    rec_yards_after_catch: int | None = None
    rec_epa: float | None = None
    target_share: float | None = None
    # Kicking
    fg_made: int | None = None
    fg_att: int | None = None
    fg_long: int | None = None
    pat_made: int | None = None
    pat_att: int | None = None
    # Special teams
    special_teams_tds: int | None = None
    # Fantasy
    fantasy_points: float | None = None
    fantasy_points_ppr: float | None = None
    # Snap counts
    snap_count: int | None = None
    snap_pct: float | None = None

    model_config = {"from_attributes": True}


class PlayerDetailResponse(BaseModel):
    """Full player profile: info + bio + career stats."""
    player: PlayerResponse
    bio: PlayerBioResponse | None = None
    seasons: list[PlayerSeasonResponse] = []

    model_config = {"from_attributes": True}
