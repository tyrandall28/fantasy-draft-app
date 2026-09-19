"""Tool definitions and query functions for the natural-language DB assistant.

Phase 1: the LLM picks one of these typed tools and fills in structured args;
*our code* runs deterministic, parameterized SQLAlchemy queries. The model never
produces a stat value — every number in an answer comes straight from the DB.

See AI_NL_QUERY_PLAN.md for the overall design.
"""
import re

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.models.player import Player, PlayerDerivedStats
from app.nfl_season import REGULAR_SEASON_WEEKS, latest_completed_season
from app.services import season_coverage

# Valid positions and metrics. Mirrors app/api/analytics.py — the metric enum is
# what keeps the model from ever requesting a column that doesn't exist.
VALID_POSITIONS = ("QB", "RB", "WR", "TE", "K")

# metric column -> human-readable label (label is for nicer tool output / answers)
METRICS: dict[str, str] = {
    "ppr_per_game": "PPR points per game",
    "standard_per_game": "standard points per game",
    "fantasy_points_ppr": "total PPR points",
    "total_tds": "total touchdowns",
    "total_yards": "total yards",
    "tds_per_game": "touchdowns per game",
    "pass_tds_per_game": "passing touchdowns per game",
    "rush_tds_per_game": "rushing touchdowns per game",
    "int_per_game": "interceptions thrown per game (lower is better)",
    "pass_yards_per_game": "passing yards per game",
    "rush_yards_per_game": "rushing yards per game",
    "rec_yards_per_game": "receiving yards per game",
    "targets_per_game": "targets per game",
    "receptions_per_game": "receptions per game",
    "yards_per_carry": "yards per carry",
    "yards_per_target": "yards per target",
    "yards_per_reception": "yards per reception",
    "catch_rate": "catch rate (%)",
    "completion_pct": "completion percentage",
    "td_rate": "touchdown rate",
    "pass_epa_per_game": "passing EPA per game",
    "rush_epa_per_game": "rushing EPA per game",
    "cpoe": "completion percentage over expected",
    "target_share": "target share (%)",
    "air_yards_per_game": "air yards per game",
    "yac_per_reception": "yards after catch per reception",
    "snap_pct": "snap share (%)",
    "fg_pct": "field goal percentage",
    "fg_made_per_game": "field goals made per game",
    "fg_long": "longest field goal",
    "xp_pct": "extra point percentage",
    "median_ppr": "median weekly PPR (consistency)",
    "stdev_ppr": "weekly PPR std dev (volatility)",
    "games_played": "games played",
}

# Fields returned in a player's stat dict (curated — the most useful, not all 30).
_PROFILE_FIELDS = (
    "ppr_per_game", "fantasy_points_ppr", "total_tds", "total_yards",
    "pass_yards_per_game", "rush_yards_per_game", "rec_yards_per_game",
    "targets_per_game", "receptions_per_game", "tds_per_game",
    "pass_tds_per_game", "rush_tds_per_game", "int_per_game",
    "yards_per_carry", "yards_per_target", "catch_rate", "completion_pct",
    "cpoe", "target_share", "snap_pct", "median_ppr", "stdev_ppr",
    "fg_pct", "fg_made_per_game",
)

_SUFFIXES = frozenset({"jr", "sr", "ii", "iii", "iv", "v"})


def normalize_name(name: str) -> str:
    """Lowercased, punctuation- and suffix-stripped name for fuzzy matching.

    Mirrors rankings_ingester.dedup.normalize_name so identity resolution here
    behaves the same way the ingester does. "Ja'Marr Chase" -> "jamarr chase".
    """
    if not name:
        return ""
    s = re.sub(r"[^a-z0-9\s]", "", name.lower())
    return " ".join(p for p in s.split() if p not in _SUFFIXES).strip()


async def _latest_season(db: AsyncSession) -> int:
    """Most recent season that has derived stats (falls back to the last completed one)."""
    result = await db.execute(select(func.max(PlayerDerivedStats.season)))
    return result.scalar() or latest_completed_season()


async def get_data_coverage(db: AsyncSession) -> dict:
    """What seasons the database actually holds, and how complete each one is.

    The system prompt used to state coverage as a hardcoded sentence ("stats
    exist for 2022 through 2025; the 2026 season has not been played yet").
    That went stale the moment the 2026 season kicked off, and a stale coverage
    claim makes the assistant confidently wrong about what it can see. Derived
    from the data instead.

    `min_team_games` counts games every team has played, not the highest week
    number on file: refresh mid-week and only the Thursday teams have the new
    week, so `max(week)` would have the assistant claim a week of results that
    thirty teams have not played.
    """
    coverage = await season_coverage.coverage_by_season(db)
    seasons = [
        {
            "season": cov.season,
            "min_team_games": cov.min_team_games,
            "is_complete": cov.is_complete,
        }
        | (
            {
                "partial_week": cov.latest_week,
                "teams_played_in_partial_week": cov.teams_in_latest_week,
                "total_teams": cov.total_teams,
            }
            if cov.has_partial_week
            else {}
        )
        for cov in sorted(coverage.values(), key=lambda c: c.season)
    ]
    complete = [s["season"] for s in seasons if s["is_complete"]]
    in_progress = [s for s in seasons if not s["is_complete"]]
    return {
        "seasons": seasons,
        "latest_complete_season": max(complete) if complete else None,
        "in_progress": in_progress[0] if in_progress else None,
    }


async def resolve_player(db: AsyncSession, name: str) -> tuple[Player | None, list[Player]]:
    """Resolve a free-text player name to a Player.

    Returns (best_match, all_candidates). Handles same-name players (e.g. the
    rookie Kyle Williams vs the retired one) by preferring the candidate with the
    most recent season of stats. `all_candidates` lets the caller surface
    ambiguity so the assistant can clarify.
    """
    norm = normalize_name(name)
    if not norm:
        return None, []

    # Narrow with a LIKE on the longest token, then match on normalized form.
    longest = max(norm.split(), key=len)
    rows = (
        await db.execute(select(Player).where(Player.full_name.ilike(f"%{longest}%")))
    ).scalars().all()

    candidates = [p for p in rows if normalize_name(p.full_name) == norm]
    if not candidates:
        # Loosen: substring match on the normalized name (handles partial input).
        candidates = [p for p in rows if norm in normalize_name(p.full_name)]
    if not candidates:
        return None, []
    if len(candidates) == 1:
        return candidates[0], candidates

    # Disambiguate by most-recent season of derived stats.
    ids = [p.id for p in candidates]
    season_rows = (
        await db.execute(
            select(PlayerDerivedStats.player_id, func.max(PlayerDerivedStats.season))
            .where(PlayerDerivedStats.player_id.in_(ids))
            .group_by(PlayerDerivedStats.player_id)
        )
    ).all()
    latest_by_id = {pid: season for pid, season in season_rows}
    best = max(candidates, key=lambda p: latest_by_id.get(p.id, 0))
    return best, candidates


def _stats_dict(r: PlayerDerivedStats) -> dict:
    """Curated, non-null derived-stat fields for one player-season."""
    out = {
        "season": r.season,
        "position": r.position,
        "games_played": r.games_played,
    }
    for field in _PROFILE_FIELDS:
        val = getattr(r, field)
        if val is not None:
            out[field] = val
    return out


# ── Tool implementations ────────────────────────────────────────────────────

async def get_stat_leaders(
    db: AsyncSession,
    *,
    metric: str,
    position: str | None = None,
    season: int | None = None,
    limit: int = 10,
    sort_dir: str = "desc",
    min_games: int = 3,
) -> dict:
    """Leaderboard for a single metric, optionally filtered by position."""
    if metric not in METRICS:
        return {"error": f"Unknown metric '{metric}'. Valid metrics: {sorted(METRICS)}"}
    if season is None:
        season = await _latest_season(db)
    limit = max(1, min(limit, 50))

    # A partially played season can't satisfy a games floor higher than the
    # games its teams have played -- in week 1 everyone has one game, so the
    # default of 3 would return an empty leaderboard and the assistant would
    # report "no data" for a season that is fully loaded. Clamp to the
    # least-played team rather than to `max(week)`, which treats a Thursday
    # night game as a full week and drops every other team's players. Then tell
    # the model the sample is small so it can say so.
    floor = await season_coverage.min_team_games(db, season)
    if floor is not None:
        min_games = min(min_games, floor)

    col = getattr(PlayerDerivedStats, metric)
    order = col.desc().nullslast() if sort_dir != "asc" else col.asc().nullsfirst()

    stmt = (
        select(PlayerDerivedStats)
        .join(Player, Player.id == PlayerDerivedStats.player_id)
        .options(joinedload(PlayerDerivedStats.player))
        .where(
            PlayerDerivedStats.season == season,
            PlayerDerivedStats.games_played >= min_games,
            col.is_not(None),
        )
        .order_by(order)
        .limit(limit)
    )
    if position:
        pos = position.upper()
        if pos not in VALID_POSITIONS:
            return {"error": f"Unknown position '{position}'. Valid: {VALID_POSITIONS}"}
        stmt = stmt.where(PlayerDerivedStats.position == pos)

    rows = (await db.execute(stmt)).scalars().all()
    leaders = []
    for i, r in enumerate(rows, start=1):
        leaders.append({
            "rank": i,
            "player": r.player.full_name,
            "team": r.player.nfl_team,
            "position": r.position,
            "games_played": r.games_played,
            metric: getattr(r, metric),
            "ppr_per_game": r.ppr_per_game,
        })
    result = {
        "metric": metric,
        "metric_label": METRICS[metric],
        "season": season,
        "position": position.upper() if position else "all",
        "min_games_applied": min_games,
        "leaders": leaders,
    }
    if floor is not None and floor < REGULAR_SEASON_WEEKS:
        result["note"] = (
            f"The {season} season is still in progress -- every team has played only "
            f"{floor} game(s), so these are small-sample numbers. Say so in your answer."
        )
    return result


async def compare_players(
    db: AsyncSession,
    *,
    player_names: list[str],
    seasons: list[int] | None = None,
) -> dict:
    """Side-by-side derived stats for two or more players."""
    if not seasons:
        seasons = [await _latest_season(db)]
    results = []
    notes = []
    for name in player_names:
        player, candidates = await resolve_player(db, name)
        if not player:
            notes.append(f"No player found matching '{name}'.")
            continue
        if len(candidates) > 1:
            others = ", ".join(f"{c.full_name} ({c.nfl_team})" for c in candidates if c.id != player.id)
            notes.append(
                f"'{name}' is ambiguous; used {player.full_name} ({player.nfl_team}). "
                f"Other matches: {others}."
            )
        rows = (
            await db.execute(
                select(PlayerDerivedStats).where(
                    PlayerDerivedStats.player_id == player.id,
                    PlayerDerivedStats.season.in_(seasons),
                ).order_by(PlayerDerivedStats.season)
            )
        ).scalars().all()
        results.append({
            "player": player.full_name,
            "team": player.nfl_team,
            "position": player.position,
            "seasons": [_stats_dict(r) for r in rows] or "no stats for the requested season(s)",
        })
    return {"requested_seasons": seasons, "players": results, "notes": notes}


async def get_player_profile(
    db: AsyncSession,
    *,
    player_name: str,
    seasons: list[int] | None = None,
) -> dict:
    """Career derived stats for a single player (all seasons by default)."""
    player, candidates = await resolve_player(db, player_name)
    if not player:
        return {"error": f"No player found matching '{player_name}'."}

    stmt = select(PlayerDerivedStats).where(PlayerDerivedStats.player_id == player.id)
    if seasons:
        stmt = stmt.where(PlayerDerivedStats.season.in_(seasons))
    rows = (await db.execute(stmt.order_by(PlayerDerivedStats.season))).scalars().all()

    note = None
    if len(candidates) > 1:
        others = ", ".join(f"{c.full_name} ({c.nfl_team})" for c in candidates if c.id != player.id)
        note = f"'{player_name}' is ambiguous; used {player.full_name} ({player.nfl_team}). Others: {others}."

    return {
        "player": player.full_name,
        "team": player.nfl_team,
        "position": player.position,
        "seasons": [_stats_dict(r) for r in rows] or "no stats found",
        "note": note,
    }


# ── Tool schemas (sent to the Claude API) ───────────────────────────────────

_METRIC_KEYS = sorted(METRICS)

TOOL_SCHEMAS = [
    {
        "name": "get_stat_leaders",
        "description": (
            "Get a ranked leaderboard of players for a single statistic, optionally "
            "filtered by position. Use for questions like 'who led WRs in touchdowns in "
            "2024' or 'top 5 RBs by yards per carry'. Map the user's words to the closest "
            "metric (e.g. 'touchdowns'->total_tds, 'most points'->fantasy_points_ppr, "
            "'most consistent'->median_ppr, 'boom or bust'->stdev_ppr)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "metric": {"type": "string", "enum": _METRIC_KEYS,
                           "description": "The statistic to rank by."},
                "position": {"type": "string", "enum": list(VALID_POSITIONS),
                             "description": "Optional position filter."},
                "season": {"type": "integer",
                           "description": "NFL season year. Omit for the most recent season."},
                "limit": {"type": "integer", "description": "How many players to return (1-50). Default 10."},
                "sort_dir": {"type": "string", "enum": ["desc", "asc"],
                             "description": "desc = highest first (default), asc = lowest first."},
                "min_games": {"type": "integer", "description": "Minimum games played. Default 3."},
            },
            "required": ["metric"],
        },
    },
    {
        "name": "compare_players",
        "description": (
            "Compare the stats of two or more players side by side for one or more seasons. "
            "Use for questions like 'how does Josh Jacobs compare to Kenneth Walker'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "player_names": {"type": "array", "items": {"type": "string"},
                                 "description": "Full names of the players to compare."},
                "seasons": {"type": "array", "items": {"type": "integer"},
                            "description": "Season years. Omit for the most recent season."},
            },
            "required": ["player_names"],
        },
    },
    {
        "name": "get_player_profile",
        "description": (
            "Get one player's derived stats across seasons (career arc). Use for questions "
            "about a single player, e.g. 'how has CeeDee Lamb trended' or 'what were Bijan "
            "Robinson's 2024 numbers'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "player_name": {"type": "string", "description": "Full name of the player."},
                "seasons": {"type": "array", "items": {"type": "integer"},
                            "description": "Optional season filter. Omit for all seasons."},
            },
            "required": ["player_name"],
        },
    },
]

# name -> coroutine function
TOOL_FUNCS = {
    "get_stat_leaders": get_stat_leaders,
    "compare_players": compare_players,
    "get_player_profile": get_player_profile,
}
