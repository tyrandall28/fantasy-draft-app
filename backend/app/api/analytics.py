"""Analytics API endpoints for derived player stats."""
from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.orm import joinedload

from app.api.deps import DB
from app.models.player import Player, PlayerDerivedStats, PlayerWeeklyStat
from app.nfl_season import REGULAR_SEASON_WEEKS
from app.schemas.player import PlayerDerivedStatsResponse

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


async def _weeks_played(db: DB, season: int) -> int | None:
    """How many weeks of the given season have game logs. None if the season
    hasn't started (or wasn't ingested)."""
    return (
        await db.execute(
            select(func.max(PlayerWeeklyStat.week)).where(PlayerWeeklyStat.season == season)
        )
    ).scalar()

VALID_POSITIONS = {"QB", "RB", "WR", "TE", "K"}
VALID_SORT_FIELDS = {
    "ppr_per_game", "standard_per_game", "pass_yards_per_game",
    "rush_yards_per_game", "rec_yards_per_game", "targets_per_game",
    "receptions_per_game", "tds_per_game", "yards_per_carry",
    "yards_per_target", "yards_per_reception", "catch_rate",
    "completion_pct", "td_rate", "pass_epa_per_game", "rush_epa_per_game",
    "cpoe", "target_share", "air_yards_per_game", "yac_per_reception",
    "snap_pct", "fg_pct", "fg_made_per_game", "fg_long", "xp_pct",
    "median_ppr", "stdev_ppr", "total_tds", "total_yards",
    "fantasy_points_ppr", "games_played",
}


@router.get("/position-rankings", response_model=list[PlayerDerivedStatsResponse])
async def get_position_rankings(
    db: DB,
    position: str = Query(..., description="Position group (QB, RB, WR, TE, K)"),
    season: int = Query(2025, description="NFL season year"),
    sort_by: str = Query("ppr_per_game", description="Metric to sort by"),
    sort_dir: str = Query("desc", description="Sort direction (asc or desc)"),
    min_games: int = Query(3, description="Minimum games played"),
    limit: int = Query(50, description="Max results"),
):
    """Position rankings table sorted by any derived stat metric."""
    pos = position.upper()
    if pos not in VALID_POSITIONS:
        pos = "QB"
    if sort_by not in VALID_SORT_FIELDS:
        sort_by = "ppr_per_game"
    if sort_dir not in ("asc", "desc"):
        sort_dir = "desc"
    if limit > 200:
        limit = 200

    # `min_games` filters out small-sample noise, but it can't ask for more games
    # than the season has had. In week 1 every player has games_played=1, so the
    # default of 3 would match nothing and the page would look empty even though
    # the data is fully loaded. Clamp to the weeks actually played.
    weeks = await _weeks_played(db, season)
    if weeks is not None:
        min_games = min(min_games, weeks)

    col = getattr(PlayerDerivedStats, sort_by)
    order = col.desc().nullslast() if sort_dir == "desc" else col.asc().nullsfirst()

    stmt = (
        select(PlayerDerivedStats)
        .options(joinedload(PlayerDerivedStats.player))
        .where(
            PlayerDerivedStats.position == pos,
            PlayerDerivedStats.season == season,
            PlayerDerivedStats.games_played >= min_games,
        )
        .order_by(order)
        .limit(limit)
    )

    result = await db.execute(stmt)
    rows = result.scalars().all()

    return [
        PlayerDerivedStatsResponse(
            player_id=r.player_id,
            season=r.season,
            position=r.position,
            games_played=r.games_played,
            full_name=r.player.full_name,
            nfl_team=r.player.nfl_team,
            headshot_url=r.player.headshot_url,
            ppr_per_game=r.ppr_per_game,
            standard_per_game=r.standard_per_game,
            pass_yards_per_game=r.pass_yards_per_game,
            rush_yards_per_game=r.rush_yards_per_game,
            rec_yards_per_game=r.rec_yards_per_game,
            targets_per_game=r.targets_per_game,
            receptions_per_game=r.receptions_per_game,
            tds_per_game=r.tds_per_game,
            yards_per_carry=r.yards_per_carry,
            yards_per_target=r.yards_per_target,
            yards_per_reception=r.yards_per_reception,
            catch_rate=r.catch_rate,
            completion_pct=r.completion_pct,
            td_rate=r.td_rate,
            pass_epa_per_game=r.pass_epa_per_game,
            rush_epa_per_game=r.rush_epa_per_game,
            cpoe=r.cpoe,
            target_share=r.target_share,
            air_yards_per_game=r.air_yards_per_game,
            yac_per_reception=r.yac_per_reception,
            snap_pct=r.snap_pct,
            fg_pct=r.fg_pct,
            fg_made_per_game=r.fg_made_per_game,
            fg_long=r.fg_long,
            xp_pct=r.xp_pct,
            median_ppr=r.median_ppr,
            stdev_ppr=r.stdev_ppr,
            total_tds=r.total_tds,
            total_yards=r.total_yards,
            fantasy_points_ppr=r.fantasy_points_ppr,
        )
        for r in rows
    ]


@router.get("/sparklines")
async def get_sparklines(
    db: DB,
    player_ids: str = Query(..., description="Comma-separated player IDs"),
):
    """Return PPR/game history across all seasons for a set of players.

    Returns dict of player_id -> list of {season, ppr_per_game, games_played}.
    """
    try:
        ids = [int(x.strip()) for x in player_ids.split(",") if x.strip()]
    except ValueError:
        return {}
    if not ids or len(ids) > 200:
        return {}

    stmt = (
        select(
            PlayerDerivedStats.player_id,
            PlayerDerivedStats.season,
            PlayerDerivedStats.ppr_per_game,
            PlayerDerivedStats.games_played,
        )
        .where(PlayerDerivedStats.player_id.in_(ids))
        .order_by(PlayerDerivedStats.player_id, PlayerDerivedStats.season)
    )
    result = await db.execute(stmt)
    rows = result.all()

    data: dict[int, list[dict]] = {}
    for player_id, season, ppr, gp in rows:
        if player_id not in data:
            data[player_id] = []
        data[player_id].append({
            "season": season,
            "ppr_per_game": ppr,
            "games_played": gp,
        })
    return data


@router.get("/seasons", response_model=list[int])
async def get_available_seasons(db: DB):
    """Return list of seasons that have derived stats data."""
    result = await db.execute(
        select(PlayerDerivedStats.season)
        .distinct()
        .order_by(PlayerDerivedStats.season.desc())
    )
    return [r[0] for r in result.all()]


@router.get("/seasons/detail")
async def get_seasons_detail(db: DB):
    """Every season with derived stats, newest first, plus how complete it is.

    Consumers need different seasons for different jobs, and "newest" is the
    wrong default for some of them:
      - The analytics explorer defaults to newest, and warns when it's partial.
      - Draft value (VOR, replacement level) needs a *complete* season; one week
        of games can't establish a replacement baseline.
    Returning completeness here lets each caller choose correctly from one
    request, instead of guessing from the season number.
    """
    weeks_by_season = dict(
        (
            await db.execute(
                select(PlayerWeeklyStat.season, func.max(PlayerWeeklyStat.week)).group_by(
                    PlayerWeeklyStat.season
                )
            )
        ).all()
    )
    rows = (
        await db.execute(
            select(
                PlayerDerivedStats.season,
                func.max(PlayerDerivedStats.games_played),
            )
            .group_by(PlayerDerivedStats.season)
            .order_by(PlayerDerivedStats.season.desc())
        )
    ).all()

    return [
        {
            "season": season,
            "weeks_played": weeks_by_season.get(season) or 0,
            "max_games_played": max_games or 0,
            "is_complete": bool(
                weeks_by_season.get(season) and weeks_by_season[season] >= REGULAR_SEASON_WEEKS
            ),
            "regular_season_weeks": REGULAR_SEASON_WEEKS,
        }
        for season, max_games in rows
    ]
