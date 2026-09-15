"""Tests for the season-derivation helpers.

These replaced hardcoded `--year 2025` / `--seasons 2022-2025` defaults in the
ingest CLIs, so getting them wrong means a refresh silently targets the wrong
season. Every case pins an explicit date.
"""
from datetime import date

from app.nfl_season import (
    approx_current_week,
    current_nfl_season,
    default_stat_seasons,
    latest_completed_season,
)


class TestCurrentNflSeason:
    def test_midseason(self):
        assert current_nfl_season(date(2026, 9, 15)) == 2026
        assert current_nfl_season(date(2026, 12, 25)) == 2026

    def test_january_playoffs_belong_to_previous_calendar_year(self):
        # The 2026 season's playoffs run into January 2027.
        assert current_nfl_season(date(2027, 1, 10)) == 2026
        assert current_nfl_season(date(2027, 2, 1)) == 2026

    def test_offseason_rolls_over_in_march(self):
        assert current_nfl_season(date(2026, 2, 28)) == 2025
        assert current_nfl_season(date(2026, 3, 1)) == 2026
        assert current_nfl_season(date(2026, 6, 1)) == 2026


class TestLatestCompletedSeason:
    def test_always_one_behind_current(self):
        for d in (date(2026, 3, 1), date(2026, 9, 15), date(2027, 1, 10)):
            assert latest_completed_season(d) == current_nfl_season(d) - 1

    def test_specific_dates(self):
        assert latest_completed_season(date(2026, 9, 15)) == 2025
        assert latest_completed_season(date(2026, 4, 1)) == 2025


class TestDefaultStatSeasons:
    def test_includes_in_progress_season(self):
        # Sept 2026: four completed seasons (2022-2025) plus 2026 in progress.
        assert default_stat_seasons(date(2026, 9, 15)) == [2022, 2023, 2024, 2025, 2026]

    def test_offseason_still_includes_upcoming(self):
        assert default_stat_seasons(date(2026, 4, 1)) == [2022, 2023, 2024, 2025, 2026]

    def test_history_is_configurable(self):
        assert default_stat_seasons(date(2026, 9, 15), history=2) == [2024, 2025, 2026]

    def test_always_contains_latest_completed(self):
        for d in (date(2026, 3, 1), date(2026, 9, 15), date(2027, 1, 10)):
            assert latest_completed_season(d) in default_stat_seasons(d)


class TestApproxCurrentWeek:
    def test_none_before_kickoff(self):
        assert approx_current_week(date(2026, 7, 1)) is None
        assert approx_current_week(date(2026, 9, 1)) is None

    def test_counts_up_from_kickoff(self):
        assert approx_current_week(date(2026, 9, 5)) == 1
        assert approx_current_week(date(2026, 9, 15)) == 2
        assert approx_current_week(date(2026, 11, 1)) == 9

    def test_none_once_the_season_is_over(self):
        # Well past the Super Bowl -- don't claim a week that doesn't exist.
        assert approx_current_week(date(2027, 2, 20)) is None
