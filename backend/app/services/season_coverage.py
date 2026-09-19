"""How much of a season the database actually holds.

`max(week)` is the obvious measure and the wrong one. Refresh the data on a
Friday and the only week-2 rows are Thursday night's two teams: `max(week)`
jumps to 2 while thirty teams are still sitting on one game. Anything that
reads that as "two weeks played" -- above all the games-played floor on the
analytics leaderboard -- then measures every player against a bar only the
Thursday teams can clear, and the page empties out.

A bye looks exactly like a game that hasn't kicked off yet: no row either way.
So the number that survives both is per team, not per week:

  min_team_games  the fewest games any team has played. This is what a
                  games-played floor may clamp to -- never `max(week)`.
                  Mid-week it tracks the teams that haven't played; during a
                  bye week it tracks the teams on bye. Both are right, because
                  in both cases those players genuinely have fewer games.

  latest_week + teams_in_latest_week
                  the partial week, stated as counts rather than as a verdict.
                  There is no schedule table here, so a week with 26 of 32
                  teams is either a finished bye week or a Sunday afternoon in
                  progress and we cannot tell which. Report the counts and let
                  the reader draw the line.

Reporting these consistently is the whole point of the module -- the same
`max(week)` clamp was written twice, in the analytics API and in the assistant
tools, and drifted into the same bug in both places.
"""
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.player import PlayerWeeklyStat
from app.nfl_season import REGULAR_SEASON_WEEKS


@dataclass(frozen=True)
class SeasonCoverage:
    """What one season's game logs add up to."""

    season: int
    min_team_games: int
    latest_week: int
    teams_in_latest_week: int
    total_teams: int

    @property
    def is_complete(self) -> bool:
        """Every week of the regular season is in, including all of the last one.

        The team check matters: week 18 is played over a single weekend and
        every team is in it (verified back through 2022), so a refresh run
        mid-Saturday would otherwise flip the season to "complete" on a
        handful of games -- and draft value picks the newest complete season
        to set its replacement baseline from.
        """
        return (
            self.latest_week >= REGULAR_SEASON_WEEKS
            and self.teams_in_latest_week >= self.total_teams
        )

    @property
    def has_partial_week(self) -> bool:
        return self.teams_in_latest_week < self.total_teams

    def clamp_min_games(self, min_games: int) -> int:
        """Lower a games-played floor to what the season can actually supply.

        In week 1 every player has one game, so an unclamped floor of 3 matches
        nobody and a fully loaded season reads as empty.
        """
        return min(min_games, self.min_team_games)


def _team_games_subquery(season: int | None = None):
    """Distinct weeks each team appears in. Rows with no team group together,
    which is what test fixtures produce and is harmless: one bucket whose count
    is the season's week span."""
    stmt = select(
        PlayerWeeklyStat.season.label("season"),
        PlayerWeeklyStat.team.label("team"),
        func.count(func.distinct(PlayerWeeklyStat.week)).label("games"),
    ).group_by(PlayerWeeklyStat.season, PlayerWeeklyStat.team)
    if season is not None:
        stmt = stmt.where(PlayerWeeklyStat.season == season)
    return stmt.subquery()


async def min_team_games(db: AsyncSession, season: int) -> int | None:
    """Games played by the least-played team, or None if the season has no logs.

    The only number a games-played floor should ever be clamped to.
    """
    sub = _team_games_subquery(season)
    return (await db.execute(select(func.min(sub.c.games)))).scalar()


async def coverage_by_season(db: AsyncSession) -> dict[int, SeasonCoverage]:
    """Coverage for every season that has game logs, keyed by season."""
    sub = _team_games_subquery()
    floors = dict(
        (
            await db.execute(
                select(sub.c.season, func.min(sub.c.games)).group_by(sub.c.season)
            )
        ).all()
    )

    # Teams per (season, week), so we can pick out the latest week and say how
    # much of it has been played.
    per_week = (
        await db.execute(
            select(
                PlayerWeeklyStat.season,
                PlayerWeeklyStat.week,
                func.count(func.distinct(PlayerWeeklyStat.team)),
            ).group_by(PlayerWeeklyStat.season, PlayerWeeklyStat.week)
        )
    ).all()

    latest: dict[int, tuple[int, int]] = {}
    for season, week, teams in per_week:
        if season not in latest or week > latest[season][0]:
            latest[season] = (week, teams)

    team_totals = dict(
        (
            await db.execute(
                select(
                    PlayerWeeklyStat.season,
                    func.count(func.distinct(PlayerWeeklyStat.team)),
                ).group_by(PlayerWeeklyStat.season)
            )
        ).all()
    )

    out: dict[int, SeasonCoverage] = {}
    for season, (week, teams_that_week) in latest.items():
        out[season] = SeasonCoverage(
            season=season,
            min_team_games=floors.get(season) or 0,
            latest_week=week,
            teams_in_latest_week=teams_that_week,
            total_teams=team_totals.get(season) or 0,
        )
    return out
