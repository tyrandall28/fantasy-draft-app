"""Tests for the draft endpoints, and for who is allowed to reach them.

`/draft/start` had no authorization at all — not membership, not ownership —
so any logged-in user who knew a league id could start that league's draft.
`/draft/state` and `/draft/results` were readable by anyone for the same
reason, as was the league itself, whose response carries the invite code.
"""
import pytest


async def _make_league(client, headers, **overrides):
    payload = {"name": "Draft League", "team_count": 2, **overrides}
    resp = await client.post("/api/leagues", headers=headers, json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _join(client, headers, invite_code):
    resp = await client.post(
        "/api/leagues/join", headers=headers, json={"invite_code": invite_code}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestStartDraftAccess:
    async def test_outsider_cannot_start_the_draft(self, client, auth_headers, auth_headers2):
        league = await _make_league(client, auth_headers)

        resp = await client.post(
            f"/api/leagues/{league['id']}/draft/start", headers=auth_headers2
        )
        assert resp.status_code == 403

        # And the league is untouched.
        still = await client.get(f"/api/leagues/{league['id']}", headers=auth_headers)
        assert still.json()["status"] == "setup"

    async def test_member_who_is_not_commissioner_cannot_start(
        self, client, auth_headers, auth_headers2
    ):
        league = await _make_league(client, auth_headers)
        await _join(client, auth_headers2, league["invite_code"])

        resp = await client.post(
            f"/api/leagues/{league['id']}/draft/start", headers=auth_headers2
        )
        assert resp.status_code == 403

    async def test_commissioner_can_start(self, client, auth_headers):
        league = await _make_league(client, auth_headers)

        resp = await client.post(f"/api/leagues/{league['id']}/draft/start", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "drafting"

    async def test_unknown_league_is_refused(self, client, auth_headers):
        resp = await client.post(
            "/api/leagues/11111111-1111-1111-1111-111111111111/draft/start",
            headers=auth_headers,
        )
        assert resp.status_code == 403

    async def test_requires_auth(self, client, auth_headers):
        league = await _make_league(client, auth_headers)
        resp = await client.post(f"/api/leagues/{league['id']}/draft/start")
        assert resp.status_code == 403


class TestDraftReadAccess:
    @pytest.mark.parametrize("path", ["/draft/state", "/draft/results"])
    async def test_outsider_cannot_read(self, client, auth_headers, auth_headers2, path):
        league = await _make_league(client, auth_headers)

        resp = await client.get(f"/api/leagues/{league['id']}{path}", headers=auth_headers2)
        assert resp.status_code == 404

    @pytest.mark.parametrize("path", ["/draft/state", "/draft/results"])
    async def test_member_can_read(self, client, auth_headers, auth_headers2, path):
        league = await _make_league(client, auth_headers)
        await _join(client, auth_headers2, league["invite_code"])

        resp = await client.get(f"/api/leagues/{league['id']}{path}", headers=auth_headers2)
        assert resp.status_code == 200


class TestLeagueReadAccess:
    async def test_outsider_cannot_read_the_league(self, client, auth_headers, auth_headers2):
        """The response carries invite_code, which is enough to join."""
        league = await _make_league(client, auth_headers)

        resp = await client.get(f"/api/leagues/{league['id']}", headers=auth_headers2)
        assert resp.status_code == 404

    async def test_member_can_read_the_league(self, client, auth_headers, auth_headers2):
        league = await _make_league(client, auth_headers)
        await _join(client, auth_headers2, league["invite_code"])

        resp = await client.get(f"/api/leagues/{league['id']}", headers=auth_headers2)
        assert resp.status_code == 200
        assert resp.json()["id"] == league["id"]

    async def test_commissioner_can_read_the_league(self, client, auth_headers):
        league = await _make_league(client, auth_headers)

        resp = await client.get(f"/api/leagues/{league['id']}", headers=auth_headers)
        assert resp.status_code == 200
