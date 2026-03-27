"""Tests for player API endpoints."""
import pytest

from app.models.player import Player, PlayerBio, PlayerSeason, PlayerWeeklyStat


class TestListPlayers:
    async def test_empty_db(self, client):
        resp = await client.get("/api/players")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_returns_players(self, client, test_players):
        resp = await client.get("/api/players")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 5

    async def test_filter_by_position(self, client, test_players):
        resp = await client.get("/api/players?position=QB")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert all(p["position"] == "QB" for p in data)

    async def test_search_by_name(self, client, test_players):
        resp = await client.get("/api/players?search=mahomes")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["full_name"] == "Patrick Mahomes"

    async def test_search_case_insensitive(self, client, test_players):
        resp = await client.get("/api/players?search=KELCE")
        assert resp.status_code == 200
        assert len(resp.json()) == 1


class TestPlayerStats:
    async def test_get_player_stats(self, client, test_player_with_stats):
        player = test_player_with_stats
        resp = await client.get(f"/api/players/{player.id}/stats")
        assert resp.status_code == 200
        data = resp.json()

        assert data["player"]["full_name"] == "Patrick Mahomes"
        assert data["bio"]["college"] == "Texas Tech"
        assert len(data["seasons"]) == 1
        assert data["seasons"][0]["season"] == 2024
        assert data["seasons"][0]["pass_yards"] == 4839

    async def test_player_not_found(self, client):
        resp = await client.get("/api/players/99999/stats")
        assert resp.status_code == 404


class TestPlayerBio:
    async def test_get_bio(self, client, test_player_with_stats):
        player = test_player_with_stats
        resp = await client.get(f"/api/players/{player.id}/bio")
        assert resp.status_code == 200
        data = resp.json()
        assert data["college"] == "Texas Tech"
        assert data["height_inches"] == 75
        assert data["draft_round"] == 1

    async def test_bio_not_found(self, client, test_player):
        # test_player has no bio
        resp = await client.get(f"/api/players/{test_player.id}/bio")
        assert resp.status_code == 404


class TestPlayerWeekly:
    async def test_get_weekly_stats(self, client, test_player_with_stats):
        player = test_player_with_stats
        resp = await client.get(f"/api/players/{player.id}/weekly?season=2024")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 3  # weeks 1-3
        assert data[0]["week"] == 1
        assert data[0]["pass_yards"] == 285

    async def test_weekly_empty_season(self, client, test_player_with_stats):
        player = test_player_with_stats
        resp = await client.get(f"/api/players/{player.id}/weekly?season=2023")
        assert resp.status_code == 200
        assert resp.json() == []
