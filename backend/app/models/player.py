from datetime import datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Player(Base):
    __tablename__ = "players"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)
    position: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    nfl_team: Mapped[str] = mapped_column(String(5), nullable=False)
    bye_week: Mapped[int] = mapped_column(Integer, nullable=True)

    # External IDs for cross-source identity resolution
    gsis_id: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True, index=True)
    espn_id: Mapped[int | None] = mapped_column(Integer, unique=True, nullable=True)
    sleeper_id: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True)
    yahoo_id: Mapped[int | None] = mapped_column(Integer, unique=True, nullable=True)
    pfr_id: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True)
    headshot_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Relationships
    bio: Mapped["PlayerBio | None"] = relationship(back_populates="player", uselist=False)
    seasons: Mapped[list["PlayerSeason"]] = relationship(back_populates="player")
    weekly_stats: Mapped[list["PlayerWeeklyStat"]] = relationship(back_populates="player")


class BaseRanking(Base):
    __tablename__ = "base_rankings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    player_id: Mapped[int] = mapped_column(Integer, ForeignKey("players.id"), nullable=False, index=True)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    tier: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Provenance — which season this list is for and when we fetched it. Without
    # these there's no way to tell a fresh list from a year-old one. Nullable
    # because rows loaded before provenance tracking existed have neither;
    # `scripts.doctor` reports those as "unknown" until the next refresh.
    season: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    player: Mapped["Player"] = relationship(lazy="joined")


class PlayerBio(Base):
    __tablename__ = "player_bio"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_id: Mapped[int] = mapped_column(Integer, ForeignKey("players.id"), unique=True, nullable=False, index=True)
    height_inches: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weight_lbs: Mapped[int | None] = mapped_column(Integer, nullable=True)
    birth_date: Mapped[str | None] = mapped_column(Date, nullable=True)
    college: Mapped[str | None] = mapped_column(String(100), nullable=True)
    draft_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    draft_round: Mapped[int | None] = mapped_column(Integer, nullable=True)
    draft_pick: Mapped[int | None] = mapped_column(Integer, nullable=True)
    draft_overall: Mapped[int | None] = mapped_column(Integer, nullable=True)
    years_exp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    forty_yard_dash: Mapped[float | None] = mapped_column(Float, nullable=True)
    bench_press: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vertical_jump: Mapped[float | None] = mapped_column(Float, nullable=True)
    broad_jump: Mapped[int | None] = mapped_column(Integer, nullable=True)
    three_cone: Mapped[float | None] = mapped_column(Float, nullable=True)
    shuttle: Mapped[float | None] = mapped_column(Float, nullable=True)

    player: Mapped["Player"] = relationship(back_populates="bio")


class PlayerSeason(Base):
    __tablename__ = "player_seasons"
    __table_args__ = (UniqueConstraint("player_id", "season", name="uq_player_season"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_id: Mapped[int] = mapped_column(Integer, ForeignKey("players.id"), nullable=False, index=True)
    season: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    games_played: Mapped[int | None] = mapped_column(Integer, nullable=True)
    games_started: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Passing
    pass_attempts: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pass_completions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pass_yards: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pass_tds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    interceptions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sacks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pass_air_yards: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pass_epa: Mapped[float | None] = mapped_column(Float, nullable=True)
    pass_cpoe: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Rushing
    rush_attempts: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rush_yards: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rush_tds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rush_fumbles: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rush_first_downs: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rush_epa: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Receiving
    targets: Mapped[int | None] = mapped_column(Integer, nullable=True)
    receptions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rec_yards: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rec_tds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rec_air_yards: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rec_yards_after_catch: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rec_first_downs: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rec_epa: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_share: Mapped[float | None] = mapped_column(Float, nullable=True)
    air_yards_share: Mapped[float | None] = mapped_column(Float, nullable=True)
    wopr: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Kicking
    fg_made: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fg_att: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fg_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    fg_long: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pat_made: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pat_att: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Special teams
    special_teams_tds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Fantasy
    fantasy_points: Mapped[float | None] = mapped_column(Float, nullable=True)
    fantasy_points_ppr: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Snap counts (aggregated from snap_counts data)
    snap_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    snap_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

    player: Mapped["Player"] = relationship(back_populates="seasons")


class PlayerWeeklyStat(Base):
    __tablename__ = "player_weekly_stats"
    __table_args__ = (UniqueConstraint("player_id", "season", "week", name="uq_player_week"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_id: Mapped[int] = mapped_column(Integer, ForeignKey("players.id"), nullable=False, index=True)
    season: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    week: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    opponent: Mapped[str | None] = mapped_column(String(5), nullable=True)
    team: Mapped[str | None] = mapped_column(String(5), nullable=True)

    # Passing
    pass_attempts: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pass_completions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pass_yards: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pass_tds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    interceptions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sacks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pass_air_yards: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pass_epa: Mapped[float | None] = mapped_column(Float, nullable=True)
    pass_cpoe: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Rushing
    rush_attempts: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rush_yards: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rush_tds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rush_fumbles: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rush_first_downs: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rush_epa: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Receiving
    targets: Mapped[int | None] = mapped_column(Integer, nullable=True)
    receptions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rec_yards: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rec_tds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rec_air_yards: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rec_yards_after_catch: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rec_first_downs: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rec_epa: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_share: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Kicking
    fg_made: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fg_att: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fg_long: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pat_made: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pat_att: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Special teams
    special_teams_tds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Fantasy
    fantasy_points: Mapped[float | None] = mapped_column(Float, nullable=True)
    fantasy_points_ppr: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Snap counts
    snap_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    snap_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

    player: Mapped["Player"] = relationship(back_populates="weekly_stats")


class PlayerDerivedStats(Base):
    """Pre-computed per-player-per-season derived metrics for analytics."""
    __tablename__ = "player_derived_stats"
    __table_args__ = (UniqueConstraint("player_id", "season", name="uq_player_derived_season"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_id: Mapped[int] = mapped_column(Integer, ForeignKey("players.id"), nullable=False, index=True)
    season: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    position: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    games_played: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Per-game rates
    ppr_per_game: Mapped[float | None] = mapped_column(Float, nullable=True)
    standard_per_game: Mapped[float | None] = mapped_column(Float, nullable=True)
    pass_yards_per_game: Mapped[float | None] = mapped_column(Float, nullable=True)
    rush_yards_per_game: Mapped[float | None] = mapped_column(Float, nullable=True)
    rec_yards_per_game: Mapped[float | None] = mapped_column(Float, nullable=True)
    targets_per_game: Mapped[float | None] = mapped_column(Float, nullable=True)
    receptions_per_game: Mapped[float | None] = mapped_column(Float, nullable=True)
    tds_per_game: Mapped[float | None] = mapped_column(Float, nullable=True)
    pass_tds_per_game: Mapped[float | None] = mapped_column(Float, nullable=True)
    rush_tds_per_game: Mapped[float | None] = mapped_column(Float, nullable=True)
    int_per_game: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Efficiency stats
    yards_per_carry: Mapped[float | None] = mapped_column(Float, nullable=True)
    yards_per_target: Mapped[float | None] = mapped_column(Float, nullable=True)
    yards_per_reception: Mapped[float | None] = mapped_column(Float, nullable=True)
    catch_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    completion_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    td_rate: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Advanced stats
    pass_epa_per_game: Mapped[float | None] = mapped_column(Float, nullable=True)
    rush_epa_per_game: Mapped[float | None] = mapped_column(Float, nullable=True)
    cpoe: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_share: Mapped[float | None] = mapped_column(Float, nullable=True)
    air_yards_per_game: Mapped[float | None] = mapped_column(Float, nullable=True)
    yac_per_reception: Mapped[float | None] = mapped_column(Float, nullable=True)
    snap_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Kicking
    fg_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    fg_made_per_game: Mapped[float | None] = mapped_column(Float, nullable=True)
    fg_long: Mapped[int | None] = mapped_column(Integer, nullable=True)
    xp_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Boom/bust (computed from weekly data)
    median_ppr: Mapped[float | None] = mapped_column(Float, nullable=True)
    stdev_ppr: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Totals (useful for sorting)
    total_tds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_yards: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fantasy_points_ppr: Mapped[float | None] = mapped_column(Float, nullable=True)

    player: Mapped["Player"] = relationship()
