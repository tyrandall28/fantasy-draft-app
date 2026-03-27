"""Tests for DataFrame validation helpers."""
import polars as pl
import pytest

from rankings_ingester.ingest_stats import (
    validate_dataframe,
    validate_weekly_row_counts,
    REQUIRED_WEEKLY_COLUMNS,
    REQUIRED_SNAP_COLUMNS,
    MAX_ROWS_PER_SEASON,
)


def _make_weekly_df(rows: int = 100, seasons: list[int] | None = None) -> pl.DataFrame:
    """Create a minimal valid weekly stats DataFrame."""
    seasons = seasons or [2024]
    data = {}
    for col in REQUIRED_WEEKLY_COLUMNS:
        if col == "season":
            data[col] = [seasons[i % len(seasons)] for i in range(rows)]
        elif col == "week":
            data[col] = [(i % 17) + 1 for i in range(rows)]
        elif col == "season_type":
            data[col] = ["REG"] * rows
        elif col in ("player_id", "opponent_team", "team"):
            data[col] = [f"val_{i}" for i in range(rows)]
        else:
            data[col] = [i for i in range(rows)]
    return pl.DataFrame(data)


def _make_snap_df(rows: int = 100) -> pl.DataFrame:
    """Create a minimal valid snap counts DataFrame."""
    data = {}
    for col in REQUIRED_SNAP_COLUMNS:
        if col in ("pfr_player_id",):
            data[col] = [f"pfr_{i}" for i in range(rows)]
        elif col in ("season", "week"):
            data[col] = [2024] * rows if col == "season" else [(i % 17) + 1 for i in range(rows)]
        else:
            data[col] = [i for i in range(rows)]
    return pl.DataFrame(data)


class TestValidateDataframe:
    def test_passes_with_all_columns(self):
        df = _make_weekly_df()
        assert validate_dataframe(df, REQUIRED_WEEKLY_COLUMNS, "test") is True

    def test_fails_missing_column(self):
        df = _make_weekly_df().drop("passing_yards")
        assert validate_dataframe(df, REQUIRED_WEEKLY_COLUMNS, "test") is False

    def test_fails_empty_dataframe(self):
        df = _make_weekly_df(rows=0)
        assert validate_dataframe(df, REQUIRED_WEEKLY_COLUMNS, "test") is False

    def test_snap_columns_valid(self):
        df = _make_snap_df()
        assert validate_dataframe(df, REQUIRED_SNAP_COLUMNS, "snaps") is True

    def test_snap_columns_missing(self):
        df = _make_snap_df().drop("offense_snaps")
        assert validate_dataframe(df, REQUIRED_SNAP_COLUMNS, "snaps") is False

    def test_extra_columns_ok(self):
        """Extra columns beyond required should not cause failure."""
        df = _make_weekly_df()
        df = df.with_columns(pl.lit("extra").alias("bonus_column"))
        assert validate_dataframe(df, REQUIRED_WEEKLY_COLUMNS, "test") is True


class TestValidateWeeklyRowCounts:
    def test_reasonable_counts(self):
        df = _make_weekly_df(rows=500, seasons=[2024])
        assert validate_weekly_row_counts(df, [2024], "test") is True

    def test_zero_rows_for_season(self):
        df = _make_weekly_df(rows=100, seasons=[2024])
        # Ask about 2023 which has no data
        assert validate_weekly_row_counts(df, [2023], "test") is False

    def test_excessive_rows(self):
        df = _make_weekly_df(rows=MAX_ROWS_PER_SEASON + 1, seasons=[2024])
        assert validate_weekly_row_counts(df, [2024], "test") is False
