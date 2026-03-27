"""Tests for league API endpoints."""
import pytest


class TestCreateLeague:
    async def test_create_success(self, client, auth_headers):
        resp = await client.post("/api/leagues", headers=auth_headers, json={
            "name": "Test League",
            "team_count": 10,
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Test League"
        assert data["team_count"] == 10
        assert len(data["members"]) == 1  # commissioner auto-joined
        assert data["invite_code"]  # should have an invite code

    async def test_commissioner_is_creator(self, client, auth_headers, test_user):
        user, _ = test_user
        resp = await client.post("/api/leagues", headers=auth_headers, json={
            "name": "My League",
        })
        data = resp.json()
        assert data["commissioner_id"] == str(user.id)

    async def test_requires_auth(self, client):
        resp = await client.post("/api/leagues", json={"name": "Test"})
        assert resp.status_code == 403


class TestJoinLeague:
    async def test_join_by_invite_code(self, client, auth_headers, auth_headers2):
        # Create league with user 1
        create_resp = await client.post("/api/leagues", headers=auth_headers, json={
            "name": "Join Test",
        })
        league_id = create_resp.json()["id"]
        invite_code = create_resp.json()["invite_code"]

        # Join with user 2
        join_resp = await client.post("/api/leagues/join", headers=auth_headers2, json={
            "invite_code": invite_code,
        })
        assert join_resp.status_code == 200

        # Re-fetch to see both members (selectinload may have stale cache)
        get_resp = await client.get(f"/api/leagues/{league_id}", headers=auth_headers)
        assert len(get_resp.json()["members"]) == 2

    async def test_already_member(self, client, auth_headers):
        create_resp = await client.post("/api/leagues", headers=auth_headers, json={
            "name": "Dup Test",
        })
        invite_code = create_resp.json()["invite_code"]

        # Try to join again with same user
        join_resp = await client.post("/api/leagues/join", headers=auth_headers, json={
            "invite_code": invite_code,
        })
        assert join_resp.status_code == 400
        assert "already" in join_resp.json()["detail"].lower()

    async def test_invalid_invite_code(self, client, auth_headers):
        resp = await client.post("/api/leagues/join", headers=auth_headers, json={
            "invite_code": "INVALID_CODE",
        })
        assert resp.status_code == 404


class TestUpdateLeague:
    async def test_commissioner_can_update(self, client, auth_headers):
        create_resp = await client.post("/api/leagues", headers=auth_headers, json={
            "name": "Update Test",
        })
        league_id = create_resp.json()["id"]

        resp = await client.patch(f"/api/leagues/{league_id}", headers=auth_headers, json={
            "name": "Updated Name",
            "pick_time_seconds": 60,
        })
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated Name"
        assert resp.json()["pick_time_seconds"] == 60

    async def test_non_commissioner_cannot_update(self, client, auth_headers, auth_headers2):
        create_resp = await client.post("/api/leagues", headers=auth_headers, json={
            "name": "Protected League",
        })
        league_id = create_resp.json()["id"]

        resp = await client.patch(f"/api/leagues/{league_id}", headers=auth_headers2, json={
            "name": "Hacked",
        })
        assert resp.status_code == 403


class TestBots:
    async def test_add_bot(self, client, auth_headers):
        create_resp = await client.post("/api/leagues", headers=auth_headers, json={
            "name": "Bot League",
        })
        league_id = create_resp.json()["id"]

        resp = await client.post(f"/api/leagues/{league_id}/bots", headers=auth_headers)
        assert resp.status_code == 201

        # Re-fetch to get full member list
        get_resp = await client.get(f"/api/leagues/{league_id}", headers=auth_headers)
        members = get_resp.json()["members"]
        assert len(members) == 2
        bots = [m for m in members if m["is_bot"]]
        assert len(bots) == 1

    async def test_remove_bot(self, client, auth_headers):
        create_resp = await client.post("/api/leagues", headers=auth_headers, json={
            "name": "Remove Bot League",
        })
        league_id = create_resp.json()["id"]

        # Add a bot
        await client.post(f"/api/leagues/{league_id}/bots", headers=auth_headers)

        # Fetch league to find bot
        get_resp = await client.get(f"/api/leagues/{league_id}", headers=auth_headers)
        bot = [m for m in get_resp.json()["members"] if m["is_bot"]][0]

        # Remove it
        resp = await client.delete(
            f"/api/leagues/{league_id}/bots/{bot['user_id']}", headers=auth_headers
        )
        assert resp.status_code == 204

        # Verify it's gone
        league_resp = await client.get(f"/api/leagues/{league_id}", headers=auth_headers)
        members = league_resp.json()["members"]
        assert not any(m["is_bot"] for m in members)


class TestClaimPosition:
    async def test_claim_and_release(self, client, auth_headers):
        create_resp = await client.post("/api/leagues", headers=auth_headers, json={
            "name": "Position Test",
        })
        league_id = create_resp.json()["id"]

        # Claim position 3
        resp = await client.post(
            f"/api/leagues/{league_id}/claim-position",
            headers=auth_headers,
            json={"position": 3},
        )
        assert resp.status_code == 200

        # Release position
        resp = await client.post(
            f"/api/leagues/{league_id}/claim-position",
            headers=auth_headers,
            json={"position": None},
        )
        assert resp.status_code == 200
