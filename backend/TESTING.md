# Testing Guide

## Quick Start

```bash
cd backend

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install test dependencies (first time only)
pip install pytest pytest-asyncio aiosqlite

# Run all tests
PYTHONPATH=. pytest

# Run with verbose output
PYTHONPATH=. pytest -v
```

## How It Works

Tests use **SQLite in-memory** as the database, so you don't need PostgreSQL running. Each test gets a completely fresh database (tables created and destroyed per test), which means:

- Tests are fully isolated — no state leaks between tests
- No cleanup or teardown scripts needed
- Fast (~7 seconds for the full suite)

PostgreSQL-specific types (`UUID`, `JSONB`) are handled via SQLAlchemy compilation hooks that translate them to SQLite equivalents (`VARCHAR(36)`, `JSON`). This happens automatically in `tests/conftest.py`.

## Test Structure

```
tests/
├── conftest.py                      # Shared fixtures (DB, auth, test data)
├── test_api/                        # API endpoint tests
│   ├── test_auth.py                 # Registration, login, refresh, /me
│   ├── test_players.py              # Player list, search, stats, bio, weekly
│   ├── test_rankings.py             # CRUD, ownership isolation
│   └── test_leagues.py              # Create, join, settings, bots, positions
└── test_ingestion/                  # Stats ingestion pipeline tests
    ├── test_helpers.py              # safe_int, safe_float, safe_str, safe_date
    ├── test_validation.py           # DataFrame column/row count validation
    └── test_incremental.py          # Incremental vs full-refresh logic
```

## Running Specific Tests

```bash
# Run a single test file
PYTHONPATH=. pytest tests/test_api/test_auth.py -v

# Run a single test class
PYTHONPATH=. pytest tests/test_api/test_players.py::TestPlayerStats -v

# Run a single test
PYTHONPATH=. pytest tests/test_api/test_auth.py::TestRegister::test_register_success -v

# Run only ingestion tests
PYTHONPATH=. pytest tests/test_ingestion/ -v

# Run only API tests
PYTHONPATH=. pytest tests/test_api/ -v
```

## What Each Test File Covers

### API Tests

**test_auth.py** (9 tests)
- `TestRegister` — successful registration, duplicate email rejection
- `TestLogin` — correct credentials, wrong password, nonexistent user
- `TestRefresh` — valid refresh token, invalid token rejection
- `TestMe` — authenticated access, unauthenticated rejection

**test_players.py** (11 tests)
- `TestListPlayers` — empty DB, full list, position filter, name search (case-insensitive)
- `TestPlayerStats` — full player detail (bio + seasons), 404 for missing player
- `TestPlayerBio` — bio retrieval, 404 when no bio exists
- `TestPlayerWeekly` — weekly game log retrieval, empty season returns empty list

**test_rankings.py** (7 tests)
- `TestListRankings` — empty list, auth required
- `TestCreateRanking` — create from base source, auth required
- `TestGetRanking` — fetch with entries, other user cannot access (ownership isolation)
- `TestDeleteRanking` — delete and confirm 404 on re-fetch

**test_leagues.py** (10 tests)
- `TestCreateLeague` — creation, commissioner assignment, auth required
- `TestJoinLeague` — join via invite code, duplicate join rejection, invalid code
- `TestUpdateLeague` — commissioner can update settings, non-commissioner blocked
- `TestBots` — add CPU player, remove CPU player
- `TestClaimPosition` — claim and release draft position

### Ingestion Tests

**test_helpers.py** (28 tests)
- Tests for `safe_int`, `safe_float`, `safe_str`, `safe_date` type converters
- Covers normal values, None, NaN, invalid strings, edge cases (zero, negative)

**test_validation.py** (9 tests)
- `TestValidateDataframe` — all columns present, missing column, empty DataFrame, extra columns OK
- `TestValidateWeeklyRowCounts` — reasonable counts pass, zero rows warn, excessive rows warn

**test_incremental.py** (7 tests)
- `TestGetExistingWeeks` — queries DB for existing (season, week) pairs
- `TestStep3Incremental` — incremental skips existing weeks, full-refresh replaces all, no-op when no new weeks, returns correct dirty weeks

The incremental tests mock `nflreadpy` so they don't make network calls. They verify the logic that decides which weeks to insert vs skip.

## Shared Fixtures (conftest.py)

| Fixture | Scope | Description |
|---------|-------|-------------|
| `db_engine` | per-test | Fresh SQLite in-memory engine with all tables |
| `db_session` | per-test | Async SQLAlchemy session |
| `client` | per-test | httpx `AsyncClient` with FastAPI app, DB overridden |
| `test_user` | per-test | User + access token (`test@example.com` / `testuser`) |
| `test_user2` | per-test | Second user + token for multi-user tests |
| `auth_headers` | per-test | `{"Authorization": "Bearer <token>"}` for test_user |
| `auth_headers2` | per-test | Same for test_user2 |
| `test_player` | per-test | Single QB (Patrick Mahomes) |
| `test_players` | per-test | 5 players across QB/RB/WR/TE |
| `test_player_with_stats` | per-test | Player with bio, 1 season, 3 weekly stat rows |

Fixtures are composable — use what you need. For example, `test_player_with_stats` depends on `test_player`, so requesting it gives you both.

## Adding New Tests

1. Create a test file in the appropriate directory (`test_api/` or `test_ingestion/`)
2. Use `async def test_*` methods — pytest-asyncio runs them automatically
3. Request fixtures by name in function parameters:

```python
class TestMyFeature:
    async def test_something(self, client, auth_headers, test_players):
        resp = await client.get("/api/my-endpoint", headers=auth_headers)
        assert resp.status_code == 200
```

4. For tests that need DB access without HTTP, use `db_session` directly:

```python
async def test_db_query(self, db_session):
    result = await db_session.execute(select(Player))
    players = result.scalars().all()
    assert len(players) == 0
```
