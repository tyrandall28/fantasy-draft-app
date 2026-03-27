"""Tests for incremental ingestion logic."""
from unittest.mock import patch, AsyncMock

import polars as pl
import pytest
import pytest_asyncio
from sqlalchemy import select, func

from app.models.player import Player, PlayerWeeklyStat, PlayerSeason
from rankings_ingester.ingest_stats import (
    step3_weekly_stats,
    step4_aggregate_seasons,
    get_existing_weeks,
    REQUIRED_WEEKLY_COLUMNS,
)


def _build_nflverse_df(
    gsis_ids: list[str],
    seasons: list[int],
    weeks: list[int],
) -> pl.DataFrame:
    """Build a fake nflverse player_stats DataFrame."""
    rows = []
    for gsis in gsis_ids:
        for season in seasons:
            for week in weeks:
                rows.append({
                    "player_id": gsis,
                    "season": season,
                    "week": week,
                    "season_type": "REG",
                    "opponent_team": "OPP",
                    "team": "KC",
                    "headshot_url": f"https://example.com/{gsis}.png",
                    "attempts": 30,
                    "completions": 20,
                    "passing_yards": 250,
                    "passing_tds": 2,
                    "passing_interceptions": 0,
                    "sacks_suffered": 1,
                    "passing_air_yards": 100,
                    "passing_epa": 5.5,
                    "passing_cpoe": 2.1,
                    "carries": 3,
                    "rushing_yards": 15,
                    "rushing_tds": 0,
                    "rushing_fumbles": 0,
                    "rushing_first_downs": 1,
                    "rushing_epa": 0.5,
                    "targets": 0,
                    "receptions": 0,
                    "receiving_yards": 0,
                    "receiving_tds": 0,
                    "receiving_air_yards": 0,
                    "receiving_yards_after_catch": 0,
                    "receiving_first_downs": 0,
                    "receiving_epa": 0.0,
                    "target_share": 0.0,
                    "fg_made": 0,
                    "fg_att": 0,
                    "fg_long": 0,
                    "pat_made": 0,
                    "pat_att": 0,
                    "special_teams_tds": 0,
                    "fantasy_points": 20.5,
                    "fantasy_points_ppr": 20.5,
                })
    return pl.DataFrame(rows)


@pytest_asyncio.fixture
async def player_with_gsis(db_session) -> Player:
    """Create a player with a gsis_id for linking to nflverse data."""
    player = Player(
        full_name="Test QB",
        position="QB",
        nfl_team="KC",
        bye_week=6,
        gsis_id="test-gsis-001",
    )
    db_session.add(player)
    await db_session.commit()
    await db_session.refresh(player)
    return player


@pytest_asyncio.fixture
async def player_with_existing_weeks(db_session, player_with_gsis) -> Player:
    """Create a player who already has weeks 1-3 of 2024 in the DB."""
    for week in range(1, 4):
        stat = PlayerWeeklyStat(
            player_id=player_with_gsis.id,
            season=2024,
            week=week,
            opponent="OPP",
            team="KC",
            pass_attempts=30,
            pass_completions=20,
            pass_yards=250,
            pass_tds=2,
            fantasy_points=20.5,
            fantasy_points_ppr=20.5,
        )
        db_session.add(stat)
    await db_session.commit()
    return player_with_gsis


class TestGetExistingWeeks:
    async def test_no_existing_weeks(self, db_session):
        result = await get_existing_weeks(db_session, [2024])
        assert result == set()

    async def test_finds_existing_weeks(self, db_session, player_with_existing_weeks):
        result = await get_existing_weeks(db_session, [2024])
        assert result == {(2024, 1), (2024, 2), (2024, 3)}

    async def test_filters_by_season(self, db_session, player_with_existing_weeks):
        result = await get_existing_weeks(db_session, [2023])
        assert result == set()


class TestStep3Incremental:
    @patch("rankings_ingester.ingest_stats.async_session")
    @patch("rankings_ingester.ingest_stats.nfl")
    async def test_incremental_skips_existing_weeks(
        self, mock_nfl, mock_session_factory, db_session, player_with_existing_weeks
    ):
        """In incremental mode, weeks 1-3 should be skipped; only weeks 4-5 inserted."""
        mock_nfl.load_player_stats.return_value = _build_nflverse_df(
            gsis_ids=["test-gsis-001"],
            seasons=[2024],
            weeks=[1, 2, 3, 4, 5],
        )

        # Make the context manager return our test session
        mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=db_session)
        mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

        inserted = await step3_weekly_stats(
            seasons=[2024], dry_run=False, full_refresh=False
        )

        assert (2024, 4) in inserted
        assert (2024, 5) in inserted
        assert (2024, 1) not in inserted
        assert (2024, 2) not in inserted
        assert (2024, 3) not in inserted

        # Verify DB has all 5 weeks
        result = await db_session.execute(
            select(func.count()).select_from(PlayerWeeklyStat)
            .where(PlayerWeeklyStat.season == 2024)
        )
        assert result.scalar() == 5

    @patch("rankings_ingester.ingest_stats.async_session")
    @patch("rankings_ingester.ingest_stats.nfl")
    async def test_full_refresh_replaces_all(
        self, mock_nfl, mock_session_factory, db_session, player_with_existing_weeks
    ):
        """In full-refresh mode, all weeks should be replaced."""
        mock_nfl.load_player_stats.return_value = _build_nflverse_df(
            gsis_ids=["test-gsis-001"],
            seasons=[2024],
            weeks=[1, 2, 3, 4, 5],
        )

        mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=db_session)
        mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

        inserted = await step3_weekly_stats(
            seasons=[2024], dry_run=False, full_refresh=True
        )

        assert len(inserted) == 5

    @patch("rankings_ingester.ingest_stats.async_session")
    @patch("rankings_ingester.ingest_stats.nfl")
    async def test_incremental_no_new_weeks_is_noop(
        self, mock_nfl, mock_session_factory, db_session, player_with_existing_weeks
    ):
        """If all weeks already exist, incremental should insert nothing."""
        mock_nfl.load_player_stats.return_value = _build_nflverse_df(
            gsis_ids=["test-gsis-001"],
            seasons=[2024],
            weeks=[1, 2, 3],
        )

        mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=db_session)
        mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

        inserted = await step3_weekly_stats(
            seasons=[2024], dry_run=False, full_refresh=False
        )

        assert inserted == set()

    @patch("rankings_ingester.ingest_stats.async_session")
    @patch("rankings_ingester.ingest_stats.nfl")
    async def test_returns_dirty_weeks(
        self, mock_nfl, mock_session_factory, db_session, player_with_gsis
    ):
        """Return value should be exactly the (season, week) pairs that were inserted."""
        mock_nfl.load_player_stats.return_value = _build_nflverse_df(
            gsis_ids=["test-gsis-001"],
            seasons=[2024],
            weeks=[8, 9],
        )

        mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=db_session)
        mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

        inserted = await step3_weekly_stats(
            seasons=[2024], dry_run=False, full_refresh=False
        )

        assert inserted == {(2024, 8), (2024, 9)}
