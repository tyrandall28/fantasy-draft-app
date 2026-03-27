"""Tests for authentication endpoints."""
import pytest


class TestRegister:
    async def test_register_success(self, client):
        resp = await client.post("/api/auth/register", json={
            "email": "new@example.com",
            "username": "newuser",
            "password": "password123",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert "access_token" in data
        assert "refresh_token" in data

    async def test_register_duplicate_email(self, client):
        payload = {
            "email": "dup@example.com",
            "username": "user1",
            "password": "password123",
        }
        resp1 = await client.post("/api/auth/register", json=payload)
        assert resp1.status_code == 201

        payload["username"] = "user2"  # different username, same email
        resp2 = await client.post("/api/auth/register", json=payload)
        assert resp2.status_code == 400
        assert "already registered" in resp2.json()["detail"].lower()


class TestLogin:
    async def test_login_success(self, client):
        # Register first
        await client.post("/api/auth/register", json={
            "email": "login@example.com",
            "username": "loginuser",
            "password": "password123",
        })

        resp = await client.post("/api/auth/login", json={
            "email": "login@example.com",
            "password": "password123",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert "refresh_token" in data

    async def test_login_wrong_password(self, client):
        await client.post("/api/auth/register", json={
            "email": "wrong@example.com",
            "username": "wronguser",
            "password": "correct_password",
        })

        resp = await client.post("/api/auth/login", json={
            "email": "wrong@example.com",
            "password": "incorrect_password",
        })
        assert resp.status_code == 401

    async def test_login_nonexistent_user(self, client):
        resp = await client.post("/api/auth/login", json={
            "email": "ghost@example.com",
            "password": "password123",
        })
        assert resp.status_code == 401


class TestRefresh:
    async def test_refresh_token(self, client):
        reg = await client.post("/api/auth/register", json={
            "email": "refresh@example.com",
            "username": "refreshuser",
            "password": "password123",
        })
        refresh_token = reg.json()["refresh_token"]

        resp = await client.post("/api/auth/refresh", json={
            "refresh_token": refresh_token,
        })
        assert resp.status_code == 200
        assert "access_token" in resp.json()

    async def test_refresh_invalid_token(self, client):
        resp = await client.post("/api/auth/refresh", json={
            "refresh_token": "not.a.valid.token",
        })
        assert resp.status_code == 401


class TestMe:
    async def test_me_authenticated(self, client, auth_headers):
        resp = await client.get("/api/auth/me", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "test@example.com"
        assert data["username"] == "testuser"

    async def test_me_no_token(self, client):
        resp = await client.get("/api/auth/me")
        assert resp.status_code == 403  # HTTPBearer returns 403 when no credentials
