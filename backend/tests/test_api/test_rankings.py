"""Tests for rankings API endpoints."""
import pytest

from app.models.player import BaseRanking


class TestListRankings:
    async def test_empty(self, client, auth_headers):
        resp = await client.get("/api/rankings", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_requires_auth(self, client):
        resp = await client.get("/api/rankings")
        assert resp.status_code == 403


class TestCreateRanking:
    async def test_create_from_source(self, client, auth_headers, db_session, test_players):
        # Create base rankings for a source
        for i, player in enumerate(test_players):
            br = BaseRanking(
                source="espn_ppr",
                player_id=player.id,
                rank=i + 1,
                tier=1,
            )
            db_session.add(br)
        await db_session.flush()

        resp = await client.post("/api/rankings", headers=auth_headers, json={
            "source": "espn_ppr",
            "name": "My ESPN Ranking",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["source"] == "espn_ppr"
        assert data["name"] == "My ESPN Ranking"

    async def test_requires_auth(self, client):
        resp = await client.post("/api/rankings", json={
            "source": "espn_ppr",
            "name": "Test",
        })
        assert resp.status_code == 403


class TestGetRanking:
    async def test_get_with_entries(self, client, auth_headers, db_session, test_players):
        # Create base rankings
        for i, player in enumerate(test_players):
            db_session.add(BaseRanking(
                source="espn_ppr", player_id=player.id, rank=i + 1, tier=1,
            ))
        await db_session.flush()

        # Create user ranking
        create_resp = await client.post("/api/rankings", headers=auth_headers, json={
            "source": "espn_ppr",
            "name": "Test Ranking",
        })
        ranking_id = create_resp.json()["id"]

        # Fetch it
        resp = await client.get(f"/api/rankings/{ranking_id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Test Ranking"
        assert len(data["entries"]) == 5  # all 5 test players

    async def test_other_user_cannot_access(self, client, auth_headers, auth_headers2, db_session, test_players):
        for i, player in enumerate(test_players):
            db_session.add(BaseRanking(
                source="espn_ppr", player_id=player.id, rank=i + 1, tier=1,
            ))
        await db_session.flush()

        create_resp = await client.post("/api/rankings", headers=auth_headers, json={
            "source": "espn_ppr",
            "name": "Private Ranking",
        })
        ranking_id = create_resp.json()["id"]

        # User 2 tries to access user 1's ranking
        resp = await client.get(f"/api/rankings/{ranking_id}", headers=auth_headers2)
        assert resp.status_code == 404


class TestDeleteRanking:
    async def test_delete(self, client, auth_headers, db_session, test_players):
        for i, player in enumerate(test_players):
            db_session.add(BaseRanking(
                source="espn_ppr", player_id=player.id, rank=i + 1, tier=1,
            ))
        await db_session.flush()

        create_resp = await client.post("/api/rankings", headers=auth_headers, json={
            "source": "espn_ppr",
            "name": "Delete Me",
        })
        ranking_id = create_resp.json()["id"]

        resp = await client.delete(f"/api/rankings/{ranking_id}", headers=auth_headers)
        assert resp.status_code == 204

        # Confirm gone
        resp = await client.get(f"/api/rankings/{ranking_id}", headers=auth_headers)
        assert resp.status_code == 404
