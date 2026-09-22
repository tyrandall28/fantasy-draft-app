"""Tests for player API endpoints.

Every route requires a login — the whole router was open to the internet
before, which is why each test carries `auth_headers`.
"""
import pytest

from app.models.player import Player, PlayerBio, PlayerSeason, PlayerWeeklyStat


class TestListPlayers:
    async def test_empty_db(self, client, auth_headers):
        resp = await client.get("/api/players", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_returns_players(self, client, auth_headers, test_players):
        resp = await client.get("/api/players", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 5

    async def test_filter_by_position(self, client, auth_headers, test_players):
        resp = await client.get("/api/players?position=QB", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert all(p["position"] == "QB" for p in data)

    async def test_search_by_name(self, client, auth_headers, test_players):
        resp = await client.get("/api/players?search=mahomes", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["full_name"] == "Patrick Mahomes"

    async def test_search_case_insensitive(self, client, auth_headers, test_players):
        resp = await client.get("/api/players?search=KELCE", headers=auth_headers)
        assert resp.status_code == 200
        assert len(resp.json()) == 1


class TestPlayerStats:
    async def test_get_player_stats(self, client, auth_headers, test_player_with_stats):
        player = test_player_with_stats
        resp = await client.get(f"/api/players/{player.id}/stats", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()

        assert data["player"]["full_name"] == "Patrick Mahomes"
        assert data["bio"]["college"] == "Texas Tech"
        assert len(data["seasons"]) == 1
        assert data["seasons"][0]["season"] == 2024
        assert data["seasons"][0]["pass_yards"] == 4839

    async def test_player_not_found(self, client, auth_headers):
        resp = await client.get("/api/players/99999/stats", headers=auth_headers)
        assert resp.status_code == 404


class TestPlayerBio:
    async def test_get_bio(self, client, auth_headers, test_player_with_stats):
        player = test_player_with_stats
        resp = await client.get(f"/api/players/{player.id}/bio", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["college"] == "Texas Tech"
        assert data["height_inches"] == 75
        assert data["draft_round"] == 1

    async def test_bio_not_found(self, client, auth_headers, test_player):
        # test_player has no bio
        resp = await client.get(f"/api/players/{test_player.id}/bio", headers=auth_headers)
        assert resp.status_code == 404


class TestPlayerWeekly:
    async def test_get_weekly_stats(self, client, auth_headers, test_player_with_stats):
        player = test_player_with_stats
        resp = await client.get(f"/api/players/{player.id}/weekly?season=2024", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 3  # weeks 1-3
        assert data[0]["week"] == 1
        assert data[0]["pass_yards"] == 285

    async def test_weekly_empty_season(self, client, auth_headers, test_player_with_stats):
        player = test_player_with_stats
        resp = await client.get(f"/api/players/{player.id}/weekly?season=2023", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []


class TestPlayersRequireAuth:
    """The router was fully unauthenticated. Public nflverse data, so nothing
    leaked, but it was an open path to the database."""

    @pytest.mark.parametrize("path", [
        "/api/players",
        "/api/players/base-rankings?source=espn_ppr",
        "/api/players/1/stats",
        "/api/players/1/bio",
        "/api/players/1/weekly?season=2024",
    ])
    async def test_unauthenticated_request_is_refused(self, client, path):
        resp = await client.get(path)
        assert resp.status_code in (401, 403), f"{path} should require a login"


class TestListPlayersPaging:
    async def test_full_list_by_default(self, client, auth_headers, test_players):
        """No default page size on purpose — the draft room's fallback list
        filters client-side, so a default would silently truncate it."""
        resp = await client.get("/api/players", headers=auth_headers)
        assert len(resp.json()) == 5

    async def test_limit_applies(self, client, auth_headers, test_players):
        resp = await client.get("/api/players?limit=2", headers=auth_headers)
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    async def test_offset_applies(self, client, auth_headers, test_players):
        first = await client.get("/api/players?limit=2", headers=auth_headers)
        second = await client.get("/api/players?limit=2&offset=2", headers=auth_headers)
        names = lambda r: [p["full_name"] for p in r.json()]
        assert names(first) != names(second)
        assert not set(names(first)) & set(names(second))

    async def test_absurd_limit_is_capped_not_rejected(self, client, auth_headers, test_players):
        from app.api.players import MAX_PLAYER_LIMIT

        resp = await client.get("/api/players?limit=10000000", headers=auth_headers)
        assert resp.status_code == 200
        assert len(resp.json()) <= MAX_PLAYER_LIMIT

    async def test_limit_must_be_positive(self, client, auth_headers, test_players):
        resp = await client.get("/api/players?limit=0", headers=auth_headers)
        assert resp.status_code == 422
