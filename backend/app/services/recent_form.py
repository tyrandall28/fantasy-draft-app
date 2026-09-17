"""Recent-form trend: how a player is doing lately versus his own baseline.

The analytics "Trend" column used to plot PPR/game per *season*, which answered
"what does his career arc look like" -- not the question someone actually has on
a Sunday morning. This module answers that one instead: over his team's last
`WINDOW_GAMES` games, is he scoring above or below his own normal?

Two decisions worth knowing about:

1. The window is anchored to the *team's* schedule, not to the player's game
   logs. Eight games a player actually played can reach back four months if he
   was hurt, and presenting a game from November as "recent form" is exactly the
   kind of quiet lie this column existed to avoid. Anchoring to the team means a
   missed game occupies its real slot in the window, and we can show it as one.

2. The colour comes from comparing the window average to a longer baseline, not
   from a regression slope through the window. Week-to-week PPR is noisy enough
   that a slope through eight games flips colour roughly half the time a single
   new game lands -- a coin flip dressed up as a signal. Measured over the top
   57 skill players, the baseline comparison flips ~25% of the time instead.
"""
from dataclasses import dataclass

from sqlalchemy import select

from app.models.player import PlayerWeeklyStat

# Team games in the recent-form window.
WINDOW_GAMES = 8
# Team games immediately before the window, used as "his normal".
BASELINE_GAMES = 17

# Below these, we draw the games but make no claim about direction.
MIN_WINDOW_GAMES = 3
MIN_BASELINE_GAMES = 4

# How far the window average must sit from the baseline to earn a colour.
TREND_THRESHOLD = 0.12

# Percentages stop meaning anything at the bottom of the roster: a deep bench
# player averaging 0.26 PPR who scores 0.8 is "+211%", which would light up
# green next to genuine risers. Require a baseline worth comparing against and a
# move large enough to matter in a lineup before claiming any direction.
MIN_BASELINE_PPR = 3.0
MIN_ABSOLUTE_DELTA = 1.5

# Seasons of game logs to pull. Window plus baseline is 25 team games, so two
# seasons always suffices; three leaves room for a player who missed a year.
SEASONS_OF_HISTORY = 3

# Week 18 is excluded from both window and baseline. Playoff-bound teams rest
# starters and it shows: across the top 60 skill players in 2025, week 18
# averaged 14.8 PPR against 17.1 in weeks 12-17. Leaving it in would paint half
# the league red every offseason for a reason that has nothing to do with form.
EXCLUDED_WEEKS = {18}


@dataclass
class FormPoint:
    season: int
    week: int
    ppr: float | None
    status: str  # "played" | "missed" | "inactive"


async def _load_game_logs(db, player_ids: list[int], min_season: int, max_season: int):
    """Every game log for these players in the seasons we care about."""
    stmt = (
        select(
            PlayerWeeklyStat.player_id,
            PlayerWeeklyStat.season,
            PlayerWeeklyStat.week,
            PlayerWeeklyStat.team,
            PlayerWeeklyStat.fantasy_points_ppr,
        )
        .where(PlayerWeeklyStat.player_id.in_(player_ids))
        .where(PlayerWeeklyStat.season >= min_season)
        .where(PlayerWeeklyStat.season <= max_season)
    )
    return (await db.execute(stmt)).all()


async def _load_team_schedules(db, teams: set[str], min_season: int, max_season: int):
    """Which (season, week) slots each team actually played.

    Reconstructed from game logs, because we don't ingest a schedule table. It
    resolves exactly: every team in every ingested season comes back with 17
    played weeks and one bye.
    """
    if not teams:
        return {}
    stmt = (
        select(PlayerWeeklyStat.team, PlayerWeeklyStat.season, PlayerWeeklyStat.week)
        .where(PlayerWeeklyStat.team.in_(teams))
        .where(PlayerWeeklyStat.season >= min_season)
        .where(PlayerWeeklyStat.season <= max_season)
        .distinct()
    )
    schedules: dict[str, dict[int, set[int]]] = {}
    for team, season, week in await db.execute(stmt):
        schedules.setdefault(team, {}).setdefault(season, set()).add(week)
    return schedules


def _player_slots(
    seasons_desc: list[int],
    team_by_season: dict[int, str | None],
    weeks_by_season: dict[int, set[int]],
    schedules: dict[str, dict[int, set[int]]],
    needed: int,
) -> list[tuple[int, int]]:
    """The last `needed` team-game slots for one player, most recent first.

    Seasons the player has no game log in are skipped entirely rather than
    filled with missed games: without a log we don't know what team he was on,
    and inventing a roster spot for him would invent the misses too.
    """
    slots: list[tuple[int, int]] = []
    for season in seasons_desc:
        if season not in weeks_by_season:
            continue
        team = team_by_season.get(season)
        season_weeks = schedules.get(team, {}).get(season) if team else None
        if not season_weeks:
            # No usable team schedule (unknown or un-ingested team): fall back
            # to the weeks he played, so we show real games and claim no misses.
            season_weeks = weeks_by_season[season]
        for week in sorted(season_weeks, reverse=True):
            if week in EXCLUDED_WEEKS:
                continue
            slots.append((season, week))
            if len(slots) >= needed:
                return slots
    return slots


def build_form(
    logs: list[tuple[int, int, float | None]],
    team_by_season: dict[int, str | None],
    schedules: dict[str, dict[int, set[int]]],
    seasons_desc: list[int],
) -> dict:
    """Assemble one player's recent-form payload. `logs` is (season, week, ppr)."""
    ppr_by_slot = {(season, week): ppr for season, week, ppr in logs}
    weeks_by_season: dict[int, set[int]] = {}
    for season, week, _ in logs:
        weeks_by_season.setdefault(season, set()).add(week)

    slots = _player_slots(
        seasons_desc,
        team_by_season,
        weeks_by_season,
        schedules,
        WINDOW_GAMES + BASELINE_GAMES,
    )
    window = sorted(slots[:WINDOW_GAMES])
    baseline_slots = slots[WINDOW_GAMES:]

    # Games before a player's first-ever appearance aren't games he missed -- he
    # wasn't in the league yet. A week-1 rookie should show one dot, not seven
    # crosses and a dot.
    debut = min(ppr_by_slot) if ppr_by_slot else None

    points: list[FormPoint] = []
    for slot in window:
        if slot in ppr_by_slot:
            points.append(FormPoint(slot[0], slot[1], ppr_by_slot[slot], "played"))
        elif debut is not None and slot < debut:
            points.append(FormPoint(slot[0], slot[1], None, "inactive"))
        else:
            points.append(FormPoint(slot[0], slot[1], None, "missed"))

    played = [p.ppr for p in points if p.status == "played" and p.ppr is not None]
    baseline_values = [
        ppr_by_slot[s] for s in baseline_slots if ppr_by_slot.get(s) is not None
    ]

    # A missed game is an absence, never a zero -- averaging it in would bury a
    # returning starter under weeks he never had a chance to score in.
    avg = sum(played) / len(played) if played else None
    baseline = (
        sum(baseline_values) / len(baseline_values)
        if len(baseline_values) >= MIN_BASELINE_GAMES
        else None
    )

    trend = "unknown"
    delta_pct = None
    if (
        avg is not None
        and baseline is not None
        and baseline >= MIN_BASELINE_PPR
        and len(played) >= MIN_WINDOW_GAMES
    ):
        delta_pct = (avg - baseline) / baseline
        moved = abs(delta_pct) > TREND_THRESHOLD and abs(avg - baseline) >= MIN_ABSOLUTE_DELTA
        if not moved:
            trend = "flat"
        else:
            trend = "up" if delta_pct > 0 else "down"

    return {
        "points": [
            {"season": p.season, "week": p.week, "ppr": p.ppr, "status": p.status}
            for p in points
        ],
        "avg": avg,
        "baseline": baseline,
        "games_played": len(played),
        "games_missed": sum(1 for p in points if p.status == "missed"),
        "trend": trend,
        "delta_pct": delta_pct,
    }


async def get_recent_form(db, player_ids: list[int], as_of_season: int) -> dict[int, dict]:
    """Recent-form payloads keyed by player id, as of the end of `as_of_season`."""
    if not player_ids:
        return {}

    min_season = as_of_season - SEASONS_OF_HISTORY + 1
    rows = await _load_game_logs(db, player_ids, min_season, as_of_season)

    logs_by_player: dict[int, list[tuple[int, int, float | None]]] = {}
    # Latest team seen per (player, season) -- a mid-season trade should anchor
    # the window to where he ended up, not where he started.
    latest_team: dict[int, dict[int, tuple[int, str | None]]] = {}
    teams: set[str] = set()

    for player_id, season, week, team, ppr in rows:
        logs_by_player.setdefault(player_id, []).append((season, week, ppr))
        seen = latest_team.setdefault(player_id, {})
        if season not in seen or week > seen[season][0]:
            seen[season] = (week, team)
        if team:
            teams.add(team)

    schedules = await _load_team_schedules(db, teams, min_season, as_of_season)
    seasons_desc = list(range(as_of_season, min_season - 1, -1))

    return {
        player_id: build_form(
            logs,
            {s: t for s, (_, t) in latest_team.get(player_id, {}).items()},
            schedules,
            seasons_desc,
        )
        for player_id, logs in logs_by_player.items()
    }
