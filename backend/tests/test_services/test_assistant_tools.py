"""Tests for the AI assistant's query tools and data-coverage reporting.

The assistant's correctness guarantee is that every number comes from the DB and
every caveat is true. Two things broke that when the 2026 season started: the
`min_games` floor made a live season look empty, and the coverage facts were
hardcoded in the system prompt ("there are NO 2026 stats") while the database
held week 1.
"""
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.player import Player, PlayerDerivedStats, PlayerWeeklyStat
from app.services.assistant_service import _coverage_block
from app.services.assistant_tools import get_data_coverage, get_stat_leaders


async def _seed(
    db: AsyncSession,
    name: str,
    season: int,
    *,
    weeks: int,
    total_tds: int,
    position: str = "WR",
) -> Player:
    player = Player(full_name=name, position=position, nfl_team="DAL")
    db.add(player)
    await db.flush()
    for week in range(1, weeks + 1):
        db.add(PlayerWeeklyStat(player_id=player.id, season=season, week=week))
    db.add(
        PlayerDerivedStats(
            player_id=player.id,
            season=season,
            position=position,
            games_played=weeks,
            total_tds=total_tds,
            ppr_per_game=10.0,
        )
    )
    await db.flush()
    return player


class TestStatLeadersPartialSeason:
    async def test_in_progress_season_returns_leaders(self, db_session):
        await _seed(db_session, "Hot Start", 2026, weeks=1, total_tds=2)
        await db_session.commit()

        result = await get_stat_leaders(
            db_session, metric="total_tds", position="WR", season=2026
        )
        assert [l["player"] for l in result["leaders"]] == ["Hot Start"]
        assert result["min_games_applied"] == 1

    async def test_in_progress_season_carries_a_caveat(self, db_session):
        """The model must be told the sample is small, or it will present a
        week-1 leaderboard as a settled season result."""
        await _seed(db_session, "Hot Start", 2026, weeks=1, total_tds=2)
        await db_session.commit()

        result = await get_stat_leaders(db_session, metric="total_tds", season=2026)
        assert "note" in result
        assert "in progress" in result["note"]
        assert "1 week" in result["note"]

    async def test_complete_season_has_no_caveat_and_full_floor(self, db_session):
        await _seed(db_session, "Full Year", 2025, weeks=18, total_tds=12)
        await _seed(db_session, "Cameo", 2025, weeks=1, total_tds=3)
        await db_session.commit()

        result = await get_stat_leaders(db_session, metric="total_tds", season=2025)
        assert result.get("note") is None
        assert result["min_games_applied"] == 3
        assert [l["player"] for l in result["leaders"]] == ["Full Year"]

    async def test_unknown_metric_is_rejected(self, db_session):
        result = await get_stat_leaders(db_session, metric="vibes")
        assert "error" in result


class TestDataCoverage:
    async def test_identifies_complete_and_in_progress_seasons(self, db_session):
        await _seed(db_session, "A", 2024, weeks=18, total_tds=5)
        await _seed(db_session, "B", 2025, weeks=18, total_tds=5)
        await _seed(db_session, "C", 2026, weeks=3, total_tds=1)
        await db_session.commit()

        coverage = await get_data_coverage(db_session)
        assert coverage["latest_complete_season"] == 2025
        assert coverage["in_progress"]["season"] == 2026
        assert coverage["in_progress"]["weeks_played"] == 3

    async def test_no_in_progress_season_when_all_complete(self, db_session):
        await _seed(db_session, "A", 2025, weeks=18, total_tds=5)
        await db_session.commit()

        coverage = await get_data_coverage(db_session)
        assert coverage["in_progress"] is None
        assert coverage["latest_complete_season"] == 2025

    async def test_empty_database(self, db_session):
        coverage = await get_data_coverage(db_session)
        assert coverage["seasons"] == []
        assert coverage["latest_complete_season"] is None
        assert coverage["in_progress"] is None


class TestCoverageBlock:
    """The rendered prompt text has to state what's true, since the model
    repeats it to users."""

    def test_flags_the_in_progress_season(self):
        text = _coverage_block(
            {
                "seasons": [
                    {"season": 2025, "weeks_played": 18, "is_complete": True},
                    {"season": 2026, "weeks_played": 1, "is_complete": False},
                ],
                "latest_complete_season": 2025,
                "in_progress": {"season": 2026, "weeks_played": 1, "is_complete": False},
            }
        )
        assert "2022" not in text  # nothing hardcoded; only seasons we were given
        assert "Seasons in the database: 2025 through 2026." in text
        assert "Most recent COMPLETED season: 2025" in text
        assert "2026 season is IN PROGRESS" in text
        assert "1 week(s) played" in text
        assert "no data for seasons after 2026" in text

    def test_all_complete_has_no_in_progress_claim(self):
        text = _coverage_block(
            {
                "seasons": [{"season": 2025, "weeks_played": 18, "is_complete": True}],
                "latest_complete_season": 2025,
                "in_progress": None,
            }
        )
        assert "IN PROGRESS" not in text
        assert "no data for seasons after 2025" in text

    def test_empty_database_says_so(self):
        text = _coverage_block(
            {"seasons": [], "latest_complete_season": None, "in_progress": None}
        )
        assert "empty" in text
