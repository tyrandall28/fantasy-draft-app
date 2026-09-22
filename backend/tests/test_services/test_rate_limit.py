"""Tests for the auth rate limiter.

Login and register had no limit before this, so an attacker could try
passwords as fast as the network allowed — and because bcrypt spends ~100ms of
CPU per attempt, could also use the login endpoint to exhaust the container.
"""
import pytest

from app.services.rate_limit import (
    LOGIN_LIMIT,
    REFRESH_LIMIT,
    REGISTER_LIMIT,
    RateLimiter,
    client_key,
    limiter,
)


class FakeRequest:
    """Enough of a Request for `client_key`."""

    def __init__(self, headers: dict[str, str] | None = None, host: str | None = "1.2.3.4"):
        self.headers = headers or {}
        self.client = type("C", (), {"host": host})() if host else None


class TestClientKey:
    def test_uses_direct_address_when_unproxied(self):
        assert client_key(FakeRequest()) == "1.2.3.4"

    def test_prefers_the_first_forwarded_address(self):
        """Behind Cloud Run the direct peer is Google's front end, the same for
        everybody — using it would make one shared limit for the internet."""
        req = FakeRequest({"x-forwarded-for": "203.0.113.7, 130.211.0.1"})
        assert client_key(req) == "203.0.113.7"

    def test_handles_a_single_forwarded_address(self):
        assert client_key(FakeRequest({"x-forwarded-for": "203.0.113.7"})) == "203.0.113.7"

    def test_falls_back_when_there_is_no_client(self):
        assert client_key(FakeRequest(host=None)) == "unknown"

    def test_ignores_an_empty_forwarded_header(self):
        assert client_key(FakeRequest({"x-forwarded-for": ""}, host="9.9.9.9")) == "9.9.9.9"


class TestRateLimiter:
    def test_allows_requests_up_to_the_limit(self):
        rl = RateLimiter()
        for i in range(5):
            assert rl.check("login", "ip", 5, 60) is None, f"request {i + 1} should be allowed"

    def test_blocks_the_request_past_the_limit(self):
        rl = RateLimiter()
        for _ in range(5):
            rl.check("login", "ip", 5, 60)
        retry_after = rl.check("login", "ip", 5, 60)
        assert retry_after is not None
        assert 0 < retry_after <= 61

    def test_limits_are_per_address(self):
        rl = RateLimiter()
        for _ in range(5):
            rl.check("login", "attacker", 5, 60)
        assert rl.check("login", "attacker", 5, 60) is not None
        assert rl.check("login", "someone-else", 5, 60) is None

    def test_limits_are_per_bucket(self):
        """Exhausting login must not lock the same address out of register."""
        rl = RateLimiter()
        for _ in range(5):
            rl.check("login", "ip", 5, 60)
        assert rl.check("login", "ip", 5, 60) is not None
        assert rl.check("register", "ip", 5, 60) is None

    def test_window_slides(self, monkeypatch):
        """Hits aging out of the window free up capacity again."""
        rl = RateLimiter()
        clock = {"t": 1_000.0}
        monkeypatch.setattr(
            "app.services.rate_limit.time.monotonic", lambda: clock["t"]
        )

        for _ in range(5):
            assert rl.check("login", "ip", 5, 60) is None
        assert rl.check("login", "ip", 5, 60) is not None

        clock["t"] += 61  # the first five have now aged out
        assert rl.check("login", "ip", 5, 60) is None

    def test_disabled_limiter_allows_everything(self):
        rl = RateLimiter()
        rl.enabled = False
        for _ in range(100):
            assert rl.check("login", "ip", 5, 60) is None

    def test_reset_clears_state(self):
        rl = RateLimiter()
        for _ in range(5):
            rl.check("login", "ip", 5, 60)
        assert rl.check("login", "ip", 5, 60) is not None
        rl.reset()
        assert rl.check("login", "ip", 5, 60) is None

    def test_sweep_discards_keys_that_have_gone_quiet(self, monkeypatch):
        """Memory must not grow without bound under a distributed attempt."""
        rl = RateLimiter()
        clock = {"t": 1_000.0}
        monkeypatch.setattr(
            "app.services.rate_limit.time.monotonic", lambda: clock["t"]
        )

        for i in range(1_200):
            rl.check("login", f"ip-{i}", 5, 60)
        assert len(rl._hits) == 1_200

        clock["t"] += 3_600  # everything is now stale
        rl.check("login", "fresh-ip", 5, 60)
        assert len(rl._hits) < 1_200, "stale keys should have been swept"


class TestLoginEndpointIsLimited:
    async def test_repeated_failures_eventually_return_429(self, client):
        attempts, _window = LOGIN_LIMIT
        payload = {"email": "victim@example.com", "password": "wrong-password1"}

        for i in range(attempts):
            resp = await client.post("/api/auth/login", json=payload)
            assert resp.status_code == 401, f"attempt {i + 1} should be a normal failure"

        resp = await client.post("/api/auth/login", json=payload)
        assert resp.status_code == 429
        assert "Retry-After" in resp.headers

    async def test_register_is_limited_more_tightly_than_login(self, client):
        attempts, _window = REGISTER_LIMIT
        assert attempts < LOGIN_LIMIT[0]

        for i in range(attempts):
            resp = await client.post("/api/auth/register", json={
                "email": f"spam{i}@example.com",
                "username": f"spammer{i}",
                "password": "password123",
            })
            assert resp.status_code == 201, f"account {i + 1} should have been created"

        resp = await client.post("/api/auth/register", json={
            "email": "spam-extra@example.com",
            "username": "spamextra",
            "password": "password123",
        })
        assert resp.status_code == 429

    async def test_a_rejected_request_still_counts(self, client):
        """A 422 costs the server work too, so it must consume quota — or the
        limit is trivially bypassed by sending malformed bodies."""
        limiter.reset()
        attempts, _ = LOGIN_LIMIT
        for _ in range(attempts):
            await client.post("/api/auth/login", json={"email": "x@y.com", "password": "p"})
        resp = await client.post("/api/auth/login", json={"email": "x@y.com", "password": "p"})
        assert resp.status_code == 429


class TestRefreshHasItsOwnBucket:
    """Refresh shared the login bucket, which conflated a password guess with
    a token this server already signed. The frontend treats a failed refresh
    as "log out", so spending login quota on it signed people out mid-draft.
    """

    async def test_refresh_is_not_limited_by_failed_logins(self, client):
        reg = await client.post("/api/auth/register", json={
            "email": "stillhere@example.com",
            "username": "stillhere",
            "password": "password123",
        })
        refresh_token = reg.json()["refresh_token"]

        # Burn the whole login bucket on wrong passwords.
        for _ in range(LOGIN_LIMIT[0] + 1):
            await client.post("/api/auth/login", json={
                "email": "stillhere@example.com",
                "password": "wrongpassword1",
            })

        resp = await client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
        assert resp.status_code == 200, "a live session should survive someone fat-fingering a password"

    async def test_refresh_is_still_capped(self, client):
        reg = await client.post("/api/auth/register", json={
            "email": "loop@example.com",
            "username": "looper",
            "password": "password123",
        })
        token = reg.json()["refresh_token"]

        attempts, _window = REFRESH_LIMIT
        assert attempts > LOGIN_LIMIT[0], "refresh should be the looser of the two"

        for _ in range(attempts):
            resp = await client.post("/api/auth/refresh", json={"refresh_token": token})
            token = resp.json()["refresh_token"]

        resp = await client.post("/api/auth/refresh", json={"refresh_token": token})
        assert resp.status_code == 429
