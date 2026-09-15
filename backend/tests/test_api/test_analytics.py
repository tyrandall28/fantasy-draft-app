"""Tests for the analytics endpoints, focused on partially-played seasons.

The 2026 season starting exposed a whole class of bug: `min_games` defaults to 3,
but in week 1 every player has exactly one game, so every consumer of derived
stats returned nothing while the data was fully loaded. These pin the fix.
"""
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.player import Player, PlayerDerivedStats, PlayerWeeklyStat


async def _make_player(db: AsyncSession, name: str, position: str = "WR") -> Player:
    player = Player(full_name=name, position=position, nfl_team="DAL")
    db.add(player)
    await db.flush()
    return player


async def _add_season(
    db: AsyncSession,
    player: Player,
    season: int,
    *,
    weeks: int,
    ppr_per_game: float,
    position: str = "WR",
) -> None:
    """Give a player `weeks` game logs plus the matching derived-stats row."""
    for week in range(1, weeks + 1):
        db.add(
            PlayerWeeklyStat(
                player_id=player.id,
                season=season,
                week=week,
                fantasy_points_ppr=ppr_per_game,
            )
        )
    db.add(
        PlayerDerivedStats(
            player_id=player.id,
            season=season,
            position=position,
            games_played=weeks,
            ppr_per_game=ppr_per_game,
        )
    )
    await db.flush()


class TestPositionRankingsPartialSeason:
    async def test_week_one_season_is_not_filtered_to_nothing(
        self, client, auth_headers, db_session
    ):
        """The bug: min_games=3 against a 1-week season returned zero rows."""
        player = await _make_player(db_session, "Week One Wonder")
        await _add_season(db_session, player, 2026, weeks=1, ppr_per_game=33.8)
        await db_session.commit()

        resp = await client.get(
            "/api/analytics/position-rankings",
            params={"position": "WR", "season": 2026, "min_games": 3},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        rows = resp.json()
        assert len(rows) == 1
        assert rows[0]["full_name"] == "Week One Wonder"
        assert rows[0]["games_played"] == 1

    async def test_complete_season_still_honours_min_games(
        self, client, auth_headers, db_session
    ):
        """Clamping must not weaken the filter on a full season."""
        regular = await _make_player(db_session, "Full Season Guy")
        await _add_season(db_session, regular, 2025, weeks=17, ppr_per_game=19.0)
        # A one-game cameo in the same, fully-played season should be excluded.
        cameo = await _make_player(db_session, "One Game Cameo")
        await _add_season(db_session, cameo, 2025, weeks=1, ppr_per_game=40.0)
        await db_session.commit()

        resp = await client.get(
            "/api/analytics/position-rankings",
            params={"position": "WR", "season": 2025, "min_games": 3},
            headers=auth_headers,
        )
        names = [r["full_name"] for r in resp.json()]
        assert names == ["Full Season Guy"]

    async def test_clamp_uses_weeks_played_not_max_games(
        self, client, auth_headers, db_session
    ):
        """Ceiling is the weeks the season has reached, so an injured player
        with fewer games than the leaders is still filtered out normally."""
        healthy = await _make_player(db_session, "Played Every Week")
        await _add_season(db_session, healthy, 2026, weeks=5, ppr_per_game=15.0)
        hurt = await _make_player(db_session, "Hurt Week Two")
        await _add_season(db_session, hurt, 2026, weeks=1, ppr_per_game=30.0)
        await db_session.commit()

        resp = await client.get(
            "/api/analytics/position-rankings",
            params={"position": "WR", "season": 2026, "min_games": 3},
            headers=auth_headers,
        )
        names = [r["full_name"] for r in resp.json()]
        # 5 weeks played, so min_games=3 applies unclamped and excludes the
        # one-game player despite his flashy per-game average.
        assert names == ["Played Every Week"]

    async def test_season_with_no_data_returns_empty_not_error(
        self, client, auth_headers
    ):
        resp = await client.get(
            "/api/analytics/position-rankings",
            params={"position": "WR", "season": 1999},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == []


class TestSeasonsDetail:
    async def test_reports_completeness_per_season(self, client, auth_headers, db_session):
        done = await _make_player(db_session, "Complete Season")
        await _add_season(db_session, done, 2025, weeks=18, ppr_per_game=15.0)
        live = await _make_player(db_session, "In Progress")
        await _add_season(db_session, live, 2026, weeks=2, ppr_per_game=20.0)
        await db_session.commit()

        resp = await client.get("/api/analytics/seasons/detail", headers=auth_headers)
        assert resp.status_code == 200
        rows = {r["season"]: r for r in resp.json()}

        assert rows[2025]["is_complete"] is True
        assert rows[2025]["weeks_played"] == 18
        assert rows[2026]["is_complete"] is False
        assert rows[2026]["weeks_played"] == 2
        assert rows[2026]["max_games_played"] == 2

    async def test_newest_first(self, client, auth_headers, db_session):
        for season in (2024, 2026, 2025):
            p = await _make_player(db_session, f"Player {season}")
            await _add_season(db_session, p, season, weeks=18, ppr_per_game=10.0)
        await db_session.commit()

        resp = await client.get("/api/analytics/seasons/detail", headers=auth_headers)
        seasons = [r["season"] for r in resp.json()]
        assert seasons == sorted(seasons, reverse=True)

    async def test_empty_database(self, client, auth_headers):
        resp = await client.get("/api/analytics/seasons/detail", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []
