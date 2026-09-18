"""Turning a player's game logs into a full season timeline.

`player_weekly_stats` only holds games a player actually played, so a season
read straight out of the table is a list with holes in it. Plotted, those holes
close up: Dalton Kincaid's 2025 became twelve evenly-spaced dots, his week 10
and week 14 sat side by side, and the month he spent hurt read as a normal
week-to-week step. The x axis skipped numbers and nothing said why.

This module fills the holes back in. For each week of the season it says which
of four things happened:

    played    -- there is a game log
    missed    -- his team played that week and he has no log
    bye       -- his team didn't play that week
    inactive  -- before his first NFL game, so not an absence at all

Three decisions worth knowing about:

1. There is no schedule table, so the schedule is reconstructed from the logs
   themselves: the weeks a team appears in are the weeks it played, and the one
   gap is its bye. This resolves exactly -- every team in every ingested season
   comes back with 17 played weeks and one bye.

2. The season's length comes from the *team's* last ingested week, not the
   league's. During a season the league's max week ticks over as soon as the
   Thursday game lands; using it would mark all thirty-odd teams that hadn't
   kicked off yet as being on bye. A team's own max week can only advance once
   that team has played.

3. Weeks before a player's first-ever game are `inactive`, not `missed`. A
   rookie who debuted in week 5 didn't miss the first four -- he wasn't in the
   league. Distinguishing them keeps the red marks meaning "he was out".
"""
from dataclasses import dataclass

from sqlalchemy import func, select

from app.models.player import PlayerWeeklyStat

PLAYED = "played"
MISSED = "missed"
BYE = "bye"
INACTIVE = "inactive"


@dataclass
class TimelineSlot:
    """One week of a season, played or not."""

    week: int
    status: str
    team: str | None = None
    opponent: str | None = None
    # The game log, present only when status is "played".
    stat: PlayerWeeklyStat | None = None


def _team_at_week(week: int, played_weeks: dict[int, tuple[str | None, str | None]]) -> str | None:
    """Which team the player was on in a week he has no log for.

    The nearest week he did play, preferring the most recent one before it. A
    player traded in week 9 was on his old team for the weeks before and his new
    team after, so his byes -- and which weeks even existed for him -- follow the
    trade.
    """
    before = [w for w in played_weeks if w <= week]
    if before:
        return played_weeks[max(before)][0]
    after = [w for w in played_weeks if w > week]
    if after:
        return played_weeks[min(after)][0]
    return None


def build_timeline(
    season: int,
    played_weeks: dict[int, tuple[str | None, str | None]],
    team_weeks: dict[str, dict[int, str | None]],
    debut: tuple[int, int] | None,
) -> list[TimelineSlot]:
    """Every week of one season for one player, in order.

    `played_weeks` maps week -> (team, opponent) for games he played.
    `team_weeks` maps team -> {week: opponent} for every week those teams played.
    `debut` is the (season, week) of his first NFL game, if known.

    With no usable team schedule -- an unknown or un-ingested team -- only the
    games he played come back. Inventing a roster spot for him would invent the
    absences too.
    """
    if not played_weeks:
        return []

    schedules = [team_weeks.get(t, {}) for _, (t, _) in sorted(played_weeks.items()) if t]
    schedules = [s for s in schedules if s]
    if not schedules:
        return [
            TimelineSlot(week=w, status=PLAYED, team=t, opponent=o)
            for w, (t, o) in sorted(played_weeks.items())
        ]

    last_week = max(max(s) for s in schedules)

    slots: list[TimelineSlot] = []
    for week in range(1, last_week + 1):
        if week in played_weeks:
            team, opponent = played_weeks[week]
            slots.append(TimelineSlot(week=week, status=PLAYED, team=team, opponent=opponent))
            continue

        team = _team_at_week(week, played_weeks)
        schedule = team_weeks.get(team, {}) if team else {}
        if not schedule:
            continue
        if week not in schedule:
            slots.append(TimelineSlot(week=week, status=BYE, team=team))
        elif debut is not None and (season, week) < debut:
            slots.append(TimelineSlot(week=week, status=INACTIVE, team=team, opponent=schedule[week]))
        else:
            slots.append(TimelineSlot(week=week, status=MISSED, team=team, opponent=schedule[week]))

    return slots


async def _load_player_weeks(db, player_id: int, season: int) -> list[PlayerWeeklyStat]:
    stmt = (
        select(PlayerWeeklyStat)
        .where(PlayerWeeklyStat.player_id == player_id, PlayerWeeklyStat.season == season)
        .order_by(PlayerWeeklyStat.week)
    )
    return list((await db.execute(stmt)).scalars().all())


async def _load_team_weeks(db, teams: set[str], season: int) -> dict[str, dict[int, str | None]]:
    """Which weeks each team played that season, and against whom."""
    if not teams:
        return {}
    stmt = (
        select(PlayerWeeklyStat.team, PlayerWeeklyStat.week, PlayerWeeklyStat.opponent)
        .where(
            PlayerWeeklyStat.team.in_(teams),
            PlayerWeeklyStat.season == season,
        )
        .distinct()
    )
    weeks: dict[str, dict[int, str | None]] = {}
    for team, week, opponent in await db.execute(stmt):
        # A week can come back more than once if two players on the roster
        # recorded different opponent strings; the first is as good as any.
        weeks.setdefault(team, {}).setdefault(week, opponent)
    return weeks


async def _load_debut(db, player_id: int) -> tuple[int, int] | None:
    """The (season, week) of the player's first game in any ingested season."""
    first_season = await db.scalar(
        select(func.min(PlayerWeeklyStat.season)).where(PlayerWeeklyStat.player_id == player_id)
    )
    if first_season is None:
        return None
    first_week = await db.scalar(
        select(func.min(PlayerWeeklyStat.week)).where(
            PlayerWeeklyStat.player_id == player_id,
            PlayerWeeklyStat.season == first_season,
        )
    )
    return (first_season, first_week) if first_week is not None else None


async def player_season_timeline(db, player_id: int, season: int) -> list[TimelineSlot]:
    """A played/missed/bye/inactive slot for every week of the player's season."""
    logs = await _load_player_weeks(db, player_id, season)
    if not logs:
        return []

    played_weeks = {log.week: (log.team, log.opponent) for log in logs}
    stat_by_week = {log.week: log for log in logs}
    teams = {log.team for log in logs if log.team}

    team_weeks = await _load_team_weeks(db, teams, season)
    debut = await _load_debut(db, player_id)

    slots = build_timeline(season, played_weeks, team_weeks, debut)
    for slot in slots:
        if slot.status == PLAYED:
            slot.stat = stat_by_week[slot.week]
    return slots
