"""Tests for the season timeline behind the player-card weekly charts.

`player_weekly_stats` only holds games played, so a chart drawn straight from it
closes the gaps: a month on injured reserve became one week-to-week step and the
x axis silently skipped numbers. These pin the four things a week can be, and
the cases where guessing wrong would be worse than saying nothing.
"""
import pytest

from app.models.player import Player, PlayerWeeklyStat
from app.services.weekly_timeline import (
    BYE,
    INACTIVE,
    MISSED,
    PLAYED,
    build_timeline,
    player_season_timeline,
)

# A real NFL season: 18 weeks, and every team plays 17 of them.
FULL_SEASON = list(range(1, 19))


def _schedule(team: str, weeks: list[int], opponent: str = "OPP"):
    return {team: {w: opponent for w in weeks}}


def _statuses(slots):
    return {slot.week: slot.status for slot in slots}


class TestSlotShape:
    def test_every_team_game_gets_a_slot(self):
        played = {w: ("BUF", "OPP") for w in FULL_SEASON if w != 7}
        slots = build_timeline(2025, played, _schedule("BUF", [w for w in FULL_SEASON if w != 7]), (2022, 1))

        assert [s.week for s in slots] == FULL_SEASON
        assert all(s.status == PLAYED for s in slots if s.week != 7)

    def test_the_week_the_team_did_not_play_is_a_bye(self):
        played = {w: ("BUF", "OPP") for w in FULL_SEASON if w != 7}
        slots = build_timeline(2025, played, _schedule("BUF", [w for w in FULL_SEASON if w != 7]), (2022, 1))

        bye = next(s for s in slots if s.week == 7)
        assert bye.status == BYE
        assert bye.opponent is None

    def test_a_week_the_team_played_without_him_is_missed(self):
        """The case that started this: Kincaid's 2025."""
        team_weeks = [w for w in FULL_SEASON if w != 7]
        he_played = [1, 2, 3, 4, 5, 8, 9, 10, 14, 15, 16, 18]
        played = {w: ("BUF", "OPP") for w in he_played}

        slots = build_timeline(2025, played, _schedule("BUF", team_weeks), (2022, 1))
        statuses = _statuses(slots)

        assert len(slots) == 18
        assert statuses[7] == BYE
        assert [w for w, s in statuses.items() if s == MISSED] == [6, 11, 12, 13, 17]
        assert sum(1 for s in statuses.values() if s == PLAYED) == 12

    def test_missed_weeks_carry_the_opponent_he_missed(self):
        played = {w: ("BUF", "OPP") for w in FULL_SEASON if w not in (7, 12)}
        team_weeks = {"BUF": {w: f"T{w}" for w in FULL_SEASON if w != 7}}

        slots = build_timeline(2025, played, team_weeks, (2022, 1))

        missed = next(s for s in slots if s.week == 12)
        assert missed.status == MISSED
        assert missed.opponent == "T12"


class TestBeforeHisFirstGame:
    def test_weeks_before_a_debut_are_inactive_not_missed(self):
        """A rookie who debuted in week 5 did not miss the first four."""
        played = {w: ("BUF", "OPP") for w in range(5, 19) if w != 7}
        slots = build_timeline(2025, played, _schedule("BUF", [w for w in FULL_SEASON if w != 7]), (2025, 5))

        statuses = _statuses(slots)
        assert [statuses[w] for w in (1, 2, 3, 4)] == [INACTIVE] * 4
        assert statuses[5] == PLAYED

    def test_a_bye_before_the_debut_is_still_a_bye(self):
        """He can't have been inactive for a week nobody played."""
        played = {w: ("BUF", "OPP") for w in range(6, 19)}
        slots = build_timeline(2025, played, _schedule("BUF", [w for w in FULL_SEASON if w != 3]), (2025, 6))

        assert _statuses(slots)[3] == BYE

    def test_a_veteran_out_since_week_one_is_missed_not_inactive(self):
        """His debut was a previous season, so these are games he missed."""
        played = {w: ("BUF", "OPP") for w in range(10, 19)}
        slots = build_timeline(2025, played, _schedule("BUF", [w for w in FULL_SEASON if w != 7]), (2022, 1))

        statuses = _statuses(slots)
        assert statuses[1] == MISSED
        assert statuses[7] == BYE


class TestSeasonLength:
    def test_an_in_progress_season_stops_at_the_last_week_played(self):
        """Week 1 of a new season is one slot, not one slot and seventeen crosses."""
        slots = build_timeline(2026, {1: ("BUF", "NYJ")}, _schedule("BUF", [1]), (2026, 1))

        assert len(slots) == 1
        assert slots[0].status == PLAYED

    def test_the_teams_own_last_week_bounds_the_season(self):
        """Not the league's.

        Mid-week the league's max week jumps as soon as the Thursday game lands.
        Bounding by that would mark every team yet to kick off as on bye.
        """
        played = {w: ("BUF", "OPP") for w in range(1, 4)}
        slots = build_timeline(2026, played, _schedule("BUF", [1, 2, 3]), (2022, 1))

        assert [s.week for s in slots] == [1, 2, 3]


class TestTrades:
    def test_a_traded_player_gets_both_teams_byes(self):
        """His weeks follow him: the old team's bye, then the new team's."""
        played = {
            **{w: ("DEN", "OPP") for w in range(1, 9) if w != 5},
            **{w: ("BUF", "OPP") for w in range(9, 19) if w != 12},
        }
        team_weeks = {
            "DEN": {w: "OPP" for w in FULL_SEASON if w != 5},
            "BUF": {w: "OPP" for w in FULL_SEASON if w != 12},
        }

        slots = build_timeline(2025, played, team_weeks, (2022, 1))
        statuses = _statuses(slots)

        assert statuses[5] == BYE
        assert statuses[12] == BYE
        assert sum(1 for s in statuses.values() if s == MISSED) == 0


class TestRefusingToGuess:
    def test_no_schedule_means_only_the_games_he_played(self):
        """An un-ingested team can't tell us what he missed, so claim nothing."""
        played = {3: (None, "OPP"), 9: (None, "OPP")}
        slots = build_timeline(2025, played, {}, (2022, 1))

        assert [(s.week, s.status) for s in slots] == [(3, PLAYED), (9, PLAYED)]

    def test_no_games_means_no_slots(self):
        assert build_timeline(2025, {}, _schedule("BUF", FULL_SEASON), None) == []


@pytest.mark.asyncio
class TestAgainstTheDatabase:
    async def test_timeline_reconstructs_the_schedule_from_game_logs(self, db_session):
        """End to end: two rosters, one bye, one injury, no schedule table."""
        star = Player(full_name="Star Te", position="TE", nfl_team="BUF")
        teammate = Player(full_name="Team Mate", position="WR", nfl_team="BUF")
        db_session.add_all([star, teammate])
        await db_session.flush()

        team_weeks = [w for w in FULL_SEASON if w != 7]
        for week in team_weeks:
            # The teammate plays every week, so he *is* the team's schedule.
            db_session.add(
                PlayerWeeklyStat(
                    player_id=teammate.id, season=2025, week=week, team="BUF", opponent=f"T{week}"
                )
            )
            if week not in (11, 12):
                db_session.add(
                    PlayerWeeklyStat(
                        player_id=star.id,
                        season=2025,
                        week=week,
                        team="BUF",
                        opponent=f"T{week}",
                        fantasy_points_ppr=10.0,
                    )
                )
        await db_session.commit()

        slots = await player_season_timeline(db_session, star.id, 2025)
        statuses = _statuses(slots)

        assert len(slots) == 18
        assert statuses[7] == BYE
        assert statuses[11] == MISSED
        assert statuses[12] == MISSED
        assert statuses[1] == PLAYED
        # Only played slots carry a game log.
        assert next(s for s in slots if s.week == 1).stat is not None
        assert next(s for s in slots if s.week == 11).stat is None
        assert next(s for s in slots if s.week == 11).opponent == "T11"

    async def test_a_player_with_no_logs_that_season_gets_nothing(self, db_session):
        player = Player(full_name="No Games", position="RB", nfl_team="BUF")
        db_session.add(player)
        await db_session.flush()
        db_session.add(
            PlayerWeeklyStat(player_id=player.id, season=2024, week=1, team="BUF", opponent="NYJ")
        )
        await db_session.commit()

        assert await player_season_timeline(db_session, player.id, 2025) == []
