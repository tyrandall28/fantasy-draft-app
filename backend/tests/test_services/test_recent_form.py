"""Tests for the recent-form trend behind the analytics Form column.

The column it replaced plotted one point per season, which meant week 1 of a new
season -- a single game -- sat at the end of a four-season line carrying the same
weight as a 17-game year. These pin the replacement's edges: the window follows
the team's schedule, missed games stay in place instead of being closed up, and
nothing gets coloured off a sample too thin to mean anything.
"""
import pytest

from app.services.recent_form import (
    MIN_BASELINE_PPR,
    build_form,
    get_recent_form,
)
from app.models.player import Player, PlayerWeeklyStat


def _schedule(team: str, seasons: dict[int, list[int]]):
    return {team: {s: set(w) for s, w in seasons.items()}}


FULL_SEASON = list(range(1, 19))


class TestWindowShape:
    def test_window_is_last_eight_team_games(self):
        logs = [(2025, w, 10.0) for w in FULL_SEASON]
        form = build_form(logs, {2025: "DAL"}, _schedule("DAL", {2025: FULL_SEASON}), [2025])

        assert len(form["points"]) == 8
        # Week 18 is excluded, so the window ends at 17 and starts at 10.
        assert (form["points"][0]["season"], form["points"][0]["week"]) == (2025, 10)
        assert (form["points"][-1]["season"], form["points"][-1]["week"]) == (2025, 17)

    def test_window_rolls_back_into_the_previous_season(self):
        """Week 1 of a new season must not be a one-point chart."""
        logs = [(2025, w, 12.0) for w in FULL_SEASON] + [(2026, 1, 20.0)]
        sched = _schedule("DAL", {2025: FULL_SEASON, 2026: [1]})
        form = build_form(logs, {2025: "DAL", 2026: "DAL"}, sched, [2026, 2025])

        assert len(form["points"]) == 8
        assert form["points"][-1] == {
            "season": 2026,
            "week": 1,
            "ppr": 20.0,
            "status": "played",
        }
        # Seven slots of 2025 ahead of it, newest first, week 18 skipped.
        assert [p["week"] for p in form["points"][:-1]] == [11, 12, 13, 14, 15, 16, 17]
        assert all(p["season"] == 2025 for p in form["points"][:-1])

    def test_bye_week_is_not_a_slot(self):
        """A bye is not a game the team played, so it never enters the window."""
        weeks = [w for w in FULL_SEASON if w != 12]
        logs = [(2025, w, 10.0) for w in weeks]
        form = build_form(logs, {2025: "DAL"}, _schedule("DAL", {2025: weeks}), [2025])

        assert 12 not in [p["week"] for p in form["points"]]
        assert all(p["status"] == "played" for p in form["points"])


class TestMissedGames:
    def test_missed_game_keeps_its_slot_and_is_marked(self):
        weeks = [w for w in FULL_SEASON if w not in (13, 14)]
        logs = [(2025, w, 10.0) for w in weeks]
        form = build_form(logs, {2025: "DAL"}, _schedule("DAL", {2025: FULL_SEASON}), [2025])

        missed = {p["week"] for p in form["points"] if p["status"] == "missed"}
        assert missed == {13, 14}
        assert form["games_missed"] == 2
        assert form["games_played"] == 6
        # The slots are still there, so the window covers real calendar time.
        assert len(form["points"]) == 8

    def test_missed_game_is_absence_not_zero(self):
        """Averaging a missed game as 0 would bury a returning starter."""
        weeks = [w for w in FULL_SEASON if w not in (14, 15, 16)]
        logs = [(2025, w, 20.0) for w in weeks]
        form = build_form(logs, {2025: "DAL"}, _schedule("DAL", {2025: FULL_SEASON}), [2025])

        assert form["avg"] == 20.0

    def test_games_before_debut_are_inactive_not_missed(self):
        """A rookie hasn't 'missed' the games played before he was in the league."""
        logs = [(2025, 16, 8.0), (2025, 17, 9.0)]
        form = build_form(logs, {2025: "DAL"}, _schedule("DAL", {2025: FULL_SEASON}), [2025])

        statuses = {p["week"]: p["status"] for p in form["points"]}
        assert statuses[10] == "inactive"
        assert statuses[15] == "inactive"
        assert statuses[16] == "played"
        assert form["games_missed"] == 0


class TestTrendDirection:
    def _form(self, window_ppr: float, baseline_ppr: float):
        """A player with a full baseline season and a window at a given level."""
        logs = [(2024, w, baseline_ppr) for w in FULL_SEASON]
        logs += [(2025, w, baseline_ppr) for w in range(1, 10)]
        logs += [(2025, w, window_ppr) for w in range(10, 19)]
        sched = _schedule("DAL", {2024: FULL_SEASON, 2025: FULL_SEASON})
        return build_form(logs, {2024: "DAL", 2025: "DAL"}, sched, [2025, 2024])

    def test_window_above_baseline_trends_up(self):
        assert self._form(20.0, 10.0)["trend"] == "up"

    def test_window_below_baseline_trends_down(self):
        assert self._form(5.0, 15.0)["trend"] == "down"

    def test_small_move_is_flat(self):
        assert self._form(10.5, 10.0)["trend"] == "flat"

    def test_tiny_baseline_makes_no_claim(self):
        """A 0.3 PPR bench player scoring 1.0 is '+233%' and means nothing."""
        form = self._form(1.0, 0.3)
        assert form["baseline"] < MIN_BASELINE_PPR
        assert form["trend"] == "unknown"

    def test_large_percentage_but_small_points_is_flat(self):
        """+40% on a 4.0 baseline is 1.6 points -- not a lineup decision."""
        form = self._form(5.4, 4.0)
        assert form["delta_pct"] > 0.12
        assert form["trend"] == "flat"

    def test_no_baseline_makes_no_claim(self):
        logs = [(2025, w, 15.0) for w in range(10, 18)]
        form = build_form(logs, {2025: "DAL"}, _schedule("DAL", {2025: FULL_SEASON}), [2025])

        assert form["baseline"] is None
        assert form["trend"] == "unknown"

    def test_too_few_games_played_makes_no_claim(self):
        """Back from a long injury: two games can't outvote a season."""
        logs = [(2024, w, 10.0) for w in FULL_SEASON]
        logs += [(2025, w, 10.0) for w in range(1, 10)]
        logs += [(2025, 16, 30.0), (2025, 17, 30.0)]
        sched = _schedule("DAL", {2024: FULL_SEASON, 2025: FULL_SEASON})
        form = build_form(logs, {2024: "DAL", 2025: "DAL"}, sched, [2025, 2024])

        assert form["games_played"] == 2
        assert form["trend"] == "unknown"


class TestDegradedData:
    def test_unknown_team_falls_back_to_games_played(self):
        """Without a team schedule we can't prove an absence, so claim none."""
        logs = [(2025, w, 10.0) for w in (2, 5, 9, 11, 12, 13, 15, 17)]
        form = build_form(logs, {2025: None}, {}, [2025])

        assert form["games_played"] == 8
        assert form["games_missed"] == 0

    def test_player_with_no_logs_is_empty(self):
        form = build_form([], {}, {}, [2025])
        assert form["points"] == []
        assert form["trend"] == "unknown"


@pytest.mark.asyncio
class TestEndToEnd:
    async def test_reconstructs_schedule_from_teammates(self, db_session):
        """The team schedule comes from other players' logs -- there's no
        schedule table. A teammate who played every week defines the slots."""
        star = Player(full_name="Hurt Star", position="RB", nfl_team="DAL")
        teammate = Player(full_name="Iron Man", position="WR", nfl_team="DAL")
        db_session.add_all([star, teammate])
        await db_session.flush()

        for week in FULL_SEASON:
            db_session.add(
                PlayerWeeklyStat(
                    player_id=teammate.id, season=2025, week=week,
                    team="DAL", fantasy_points_ppr=12.0,
                )
            )
            if week not in (15, 16):
                db_session.add(
                    PlayerWeeklyStat(
                        player_id=star.id, season=2025, week=week,
                        team="DAL", fantasy_points_ppr=18.0,
                    )
                )
        await db_session.commit()

        forms = await get_recent_form(db_session, [star.id], 2026)
        statuses = {p["week"]: p["status"] for p in forms[star.id]["points"]}

        assert statuses[15] == "missed"
        assert statuses[16] == "missed"
        assert statuses[17] == "played"
        assert forms[star.id]["games_missed"] == 2
