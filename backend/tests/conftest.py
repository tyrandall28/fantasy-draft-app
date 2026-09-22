"""
Shared test fixtures for the Fantasy Draft App backend.

Uses SQLite (aiosqlite) as the test database so tests run without PostgreSQL.
Handles PostgreSQL-specific types (UUID, JSONB) via compilation hooks.

Each test gets a fresh database (tables created/dropped per test).
"""
import uuid
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.models.base import Base
from app.models import (
    User, Player, PlayerBio, PlayerSeason, PlayerWeeklyStat,
    BaseRanking, UserRanking, UserRankingEntry, League, LeagueMember, DraftPick,
)
from app.services.auth_service import create_access_token, hash_password
from app.services.rate_limit import limiter
from app.api.deps import get_db
from app.main import app


# ---------- PostgreSQL type compilation for SQLite ----------

@compiles(UUID, "sqlite")
def compile_uuid_sqlite(type_, compiler, **kw):
    return "VARCHAR(36)"


@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"


# ---------- Rate limiter ----------

@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Clear the auth rate limiter between tests.

    It's a module-level singleton holding per-IP counters, and every test
    client shares one address. Without this, the tests that log in repeatedly
    would start tripping the limit depending on suite order -- the same class
    of order-dependent failure conftest already went to some trouble to remove.
    """
    limiter.reset()
    yield
    limiter.reset()


# ---------- Database fixtures ----------

@pytest_asyncio.fixture
async def db_engine():
    """Create a fresh in-memory SQLite engine per test."""
    engine = create_async_engine("sqlite+aiosqlite://", echo=False)

    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine) -> AsyncGenerator[AsyncSession, None]:
    """Provide an async session for a test."""
    async_session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with async_session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def client(db_engine, db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """HTTP test client whose DB dependency mirrors production: one session per
    request, not one per test.

    Sharing a single `expire_on_commit=False` session across requests keeps the
    identity map (and any already-loaded relationship collections) alive between
    them, so a committed DELETE could still show up in a later GET. That made
    at least one test pass or fail purely on suite ordering. A fresh session per
    request is what the real app does, so assertions mean what they say.

    `db_session` stays in the signature so fixtures that seed data still run
    first and share the same in-memory engine.
    """
    request_session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    async def override_get_db():
        async with request_session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


# ---------- Auth fixtures ----------

@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession) -> tuple[User, str]:
    """Create a test user and return (user, access_token)."""
    user = User(
        id=uuid.uuid4(),
        email="test@example.com",
        username="testuser",
        hashed_password=hash_password("password123"),
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    token = create_access_token(user.id)
    return user, token


@pytest_asyncio.fixture
async def test_user2(db_session: AsyncSession) -> tuple[User, str]:
    """Create a second test user."""
    user = User(
        id=uuid.uuid4(),
        email="test2@example.com",
        username="testuser2",
        hashed_password=hash_password("password456"),
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    token = create_access_token(user.id)
    return user, token


@pytest.fixture
def auth_headers(test_user) -> dict[str, str]:
    """Auth headers for the primary test user."""
    _, token = test_user
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth_headers2(test_user2) -> dict[str, str]:
    """Auth headers for the second test user."""
    _, token = test_user2
    return {"Authorization": f"Bearer {token}"}


# ---------- Data fixtures ----------

@pytest_asyncio.fixture
async def test_player(db_session: AsyncSession) -> Player:
    """Create a test player."""
    player = Player(
        full_name="Patrick Mahomes",
        position="QB",
        nfl_team="KC",
        bye_week=6,
        gsis_id="00-0033873",
    )
    db_session.add(player)
    await db_session.commit()
    await db_session.refresh(player)
    return player


@pytest_asyncio.fixture
async def test_players(db_session: AsyncSession) -> list[Player]:
    """Create a set of test players across positions."""
    players = [
        Player(full_name="Patrick Mahomes", position="QB", nfl_team="KC", bye_week=6, gsis_id="gsis-1"),
        Player(full_name="Josh Allen", position="QB", nfl_team="BUF", bye_week=12, gsis_id="gsis-2"),
        Player(full_name="Saquon Barkley", position="RB", nfl_team="PHI", bye_week=5, gsis_id="gsis-3"),
        Player(full_name="Tyreek Hill", position="WR", nfl_team="MIA", bye_week=10, gsis_id="gsis-4"),
        Player(full_name="Travis Kelce", position="TE", nfl_team="KC", bye_week=6, gsis_id="gsis-5"),
    ]
    db_session.add_all(players)
    await db_session.commit()
    for p in players:
        await db_session.refresh(p)
    return players


@pytest_asyncio.fixture
async def test_player_with_stats(db_session: AsyncSession, test_player: Player) -> Player:
    """Create a test player with bio and season stats."""
    bio = PlayerBio(
        player_id=test_player.id,
        height_inches=75,
        weight_lbs=230,
        college="Texas Tech",
        draft_year=2017,
        draft_round=1,
        draft_pick=10,
        draft_overall=10,
    )
    db_session.add(bio)

    season = PlayerSeason(
        player_id=test_player.id,
        season=2024,
        games_played=17,
        pass_attempts=590,
        pass_completions=383,
        pass_yards=4839,
        pass_tds=38,
        interceptions=12,
        fantasy_points=350.5,
        fantasy_points_ppr=350.5,
    )
    db_session.add(season)

    for week in range(1, 4):
        weekly = PlayerWeeklyStat(
            player_id=test_player.id,
            season=2024,
            week=week,
            opponent="OPP",
            team="KC",
            pass_attempts=35,
            pass_completions=23,
            pass_yards=285,
            pass_tds=2,
            interceptions=1,
            fantasy_points=20.5,
            fantasy_points_ppr=20.5,
        )
        db_session.add(weekly)

    await db_session.commit()
    return test_player
