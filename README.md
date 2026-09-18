# Fantasy Draft App

[![CI](https://github.com/tyrandall28/fantasy-draft-app/actions/workflows/ci.yml/badge.svg)](https://github.com/tyrandall28/fantasy-draft-app/actions/workflows/ci.yml)

A full-stack fantasy football draft platform. Build your own player rankings by
drag-and-drop, then draft against friends or CPU opponents in a real-time shared
lobby — with five seasons of NFL stats, analytics, and a natural-language data
assistant alongside the board.

> **Running it?** See **[RUNBOOK.md](RUNBOOK.md)** — start-up, data refresh, and
> troubleshooting, step by step. The short version is `python -m scripts.doctor`,
> which reports the state of everything and prints the command to fix whatever
> isn't right.

## Screenshots

<!-- Drop the files listed in docs/screenshots/README.md into that folder and these render. -->
| Live draft room | Rankings editor |
|---|---|
| ![Live draft room](docs/screenshots/draft-room.png) | ![Rankings editor](docs/screenshots/rankings.png) |

| Player analytics | AI assistant |
|---|---|
| ![Player analytics](docs/screenshots/analytics.png) | ![Ask AI](docs/screenshots/assistant.png) |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, Recharts |
| Backend | Python 3.12, FastAPI (async), SQLAlchemy 2.0, Alembic |
| Database | PostgreSQL 17 |
| Real-time | WebSockets (native FastAPI) |
| Auth | JWT access + refresh tokens |
| Drag & drop | @dnd-kit |
| Player data | nflverse via `nflreadpy`; ESPN + Sleeper public APIs |
| AI assistant | Anthropic API (Claude) with tool-calling over the stats DB |

## Features

### Rankings
- Seeded with ESPN PPR and Sleeper ADP top-300 lists
- Build custom ranking lists from any base source
- Drag-and-drop reordering, with per-player locks so a stray drag can't move a guy you've decided on
- Side-by-side comparison against the source list, showing where you disagree
- Search and filter by name, position, or team

### Leagues
- Configurable team count, roster size, position slots, pick timer, and CPU ranking source
- 12-character invite codes
- Lobby with draft-order randomization and position claiming
- CPU opponents that respect roster needs instead of blindly taking the top name

### Live draft
- WebSocket draft room with server-authoritative pick timer
- Snake order (odd rounds ascending, even descending)
- Auto-pick from your custom list when the clock runs out
- Draft board color-coded by position, live roster panel, undo
- Resizable bottom panel with value-over-replacement widgets: best available, positional value curves, tier depletion
- Automatic reconnection with exponential backoff

### Stats & analytics
- **3,573 players** with cross-source identity resolution — every row carries `gsis_id`, `espn_id`, `sleeper_id`, `yahoo_id`, and `pfr_id`, so sources join on IDs instead of trying to agree on how to spell "Ja'Marr Chase"
- **24,193 weekly game logs** across the 2022–2026 seasons
- **2,782 player-seasons** of totals, plus a derived-metrics table with per-game rates, efficiency, EPA/CPOE, target share, snap share, and boom/bust consistency
- **3,352 player bios** including draft capital and combine measurables (1,807 with a recorded 40 time)
- Charts for weekly trends, boom/bust distribution, target share vs. air yards, snap trends, and head-to-head comparison
- Weekly charts plot the whole season, not just the games played: a week the
  player's team played without him is shaded red and crossed, his bye is shaded
  grey, so a month on injured reserve reads as a month rather than as one
  week-to-week step

### AI assistant ("Ask AI")
Ask questions in plain English — *"Who led WRs in touchdowns in 2024?"*,
*"Compare Jacobs and Walker"* — and get answers computed from the database.

The model never produces a statistic. It picks one of three typed tools
(`get_stat_leaders`, `compare_players`, `get_player_profile`) and fills in
structured arguments; the backend runs deterministic parameterized SQL and feeds
the rows back. A metric enum means the model can't request a column that doesn't
exist, and every response carries a debug trace of the model's reasoning, the
tools it chose, the exact arguments, and token usage.

Requires an Anthropic API key. Everything else in the app runs without one.

## Architecture

```
                     ┌──────────────────────────────┐
  ESPN API ─────────→│  rankings_ingester           │
  Sleeper API ──────→│   • external-ID matching     │──→ base_rankings
                     │   • validation + dedup       │
                     └──────────────────────────────┘
                     ┌──────────────────────────────┐
  nflverse ─────────→│  ingest_stats (6 steps)      │──→ players, player_bio,
  (nflreadpy)        │   weekly → seasons → derived │    player_weekly_stats,
                     └──────────────────────────────┘    player_seasons,
                                                          player_derived_stats
                                    │
                     ┌──────────────┴───────────────┐
                     │  FastAPI                     │
                     │   REST  /api/*               │←── React + Vite frontend
                     │   WS    /ws/draft/{league}   │
                     └──────────────────────────────┘
```

Two independent pipelines: draft rankings (fast, refreshed often) and NFL stats
(slower, incremental). Both are described in
[RUNBOOK.md § What data is in here](RUNBOOK.md#4-what-data-is-in-here).

## Project structure

```
fantasy-draft-app/
├── RUNBOOK.md                  # how to run and refresh everything
├── TODO.md                     # known issues and roadmap
├── .github/workflows/ci.yml    # tests, migration check, frontend build
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI entry point
│   │   ├── config.py           # settings from APP_* env vars
│   │   ├── nfl_season.py       # derives the current season from the date
│   │   ├── models/             # SQLAlchemy models
│   │   ├── schemas/            # Pydantic request/response models
│   │   ├── api/                # REST endpoints
│   │   ├── ws/                 # WebSocket draft room
│   │   └── services/           # auth, rankings, draft, AI assistant
│   ├── rankings_ingester/      # data pipelines
│   │   ├── main.py             # rankings CLI
│   │   ├── ingest_stats.py     # stats CLI (6 steps)
│   │   ├── loader.py           # player upsert + ranking load
│   │   ├── dedup.py            # duplicate-identity merge
│   │   └── sources/            # espn.py, sleeper.py
│   ├── scripts/
│   │   ├── doctor.py           # health + data consistency report
│   │   ├── refresh_data.py     # one-command refresh, then verify
│   │   └── reset_db.py         # wipe everything (dev only)
│   ├── alembic/versions/       # migrations
│   └── tests/                  # 198 tests, SQLite-backed
└── frontend/
    └── src/
        ├── pages/              # Login, Dashboard, Rankings, Lobby, DraftRoom, Analytics, Assistant
        ├── components/         # layout/, rankings/, draft/, analytics/
        ├── context/            # Auth, Draft, PlayerCard
        ├── hooks/              # useWebSocket, analytics, draft value
        └── lib/draftValue.ts   # VOR / value-curve math
```

## Quick start

Full instructions, including first-time database setup, are in
**[RUNBOOK.md](RUNBOOK.md)**. If everything is already installed:

```powershell
# Terminal 1 — backend
cd backend
.\venv\Scripts\Activate.ps1
python -m scripts.doctor            # verify data health
uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend
npm run dev
```

Frontend at http://localhost:5173, API docs at http://localhost:8000/docs.

> PostgreSQL runs natively here as the `postgresql-x64-17` service. The
> `docker-compose.yml` in this repo is vestigial — using it starts a second,
> empty database on the same port. See the RUNBOOK.

## Refreshing data

```powershell
cd backend
python -m scripts.refresh_data      # incremental; safe to run any time
python -m scripts.doctor            # what's loaded, how fresh, is it consistent
```

`refresh_data` runs the pipelines in dependency order, recomputes only what
changed, prints a before/after row count per table, and finishes by running the
health check. Season defaults come from the calendar, so they never go stale.
Details in [RUNBOOK.md § Refresh the data](RUNBOOK.md#3-refresh-the-data).

## Testing

```powershell
cd backend
python -m pytest -q                 # 198 tests, in-memory SQLite, no Postgres needed
```

CI additionally applies every migration to an empty PostgreSQL database and runs
`alembic check` to prove the models and the migrations agree — the drift guard
that catches a table which only ever existed on someone's laptop.

## Environment variables

Backend settings are read from `APP_`-prefixed environment variables, or from a
gitignored `backend/.env`.

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_ENVIRONMENT` | `development` | Set to `production` on a deployed instance. The app then refuses to start while the two settings below are at their defaults. |
| `APP_DATABASE_URL` | `postgresql+asyncpg://fantasy:fantasy_dev@localhost:5432/fantasy_draft` | Database connection string. Localhost dev credentials; also rejected in production |
| `APP_SECRET_KEY` | `dev-secret-change-in-production` | JWT signing key. The default is published in this repo, so it is rejected when `APP_ENVIRONMENT=production` |
| `APP_ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | Access token lifetime |
| `APP_REFRESH_TOKEN_EXPIRE_DAYS` | `7` | Refresh token lifetime |
| `APP_CORS_ORIGINS` | `["http://localhost:5173"]` | Allowed CORS origins |
| `APP_ANTHROPIC_API_KEY` | _(unset)_ | Enables the AI assistant; without it that page returns a clear 503 |
| `APP_ASSISTANT_MODEL` | `claude-opus-5` | Model for the assistant |

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/refresh` | Refresh JWT |
| GET | `/api/auth/me` | Current user |
| GET | `/api/players` | List players (`?position=QB&search=mahomes`) |
| GET | `/api/players/{id}/stats` | Career stats, all seasons |
| GET | `/api/players/{id}/bio` | Bio + combine data |
| GET | `/api/players/{id}/weekly?season=2025` | Every week of the season: game logs plus `status` for the weeks he missed and his bye |
| GET | `/api/players/base-rankings?source=espn_ppr` | A base ranking list |
| GET | `/api/rankings/sources` | Available base sources |
| GET/POST | `/api/rankings` | List / create custom ranking lists |
| GET/DELETE | `/api/rankings/{id}` | Ranking detail / delete |
| PUT | `/api/rankings/{id}/reorder` | Bulk reorder |
| PATCH | `/api/rankings/{id}/entries/{entry_id}` | Toggle lock, move entry |
| GET/POST | `/api/leagues` | List / create leagues |
| GET/PATCH | `/api/leagues/{id}` | League detail / update settings |
| POST | `/api/leagues/join` | Join by invite code |
| POST | `/api/leagues/{id}/set-draft-order` | Set or randomize draft order |
| POST/DELETE | `/api/leagues/{id}/bots[/{user_id}]` | Add / remove a CPU team |
| POST | `/api/leagues/{id}/claim-position` | Claim a draft slot |
| POST | `/api/leagues/{id}/draft/start` | Start the draft |
| GET | `/api/leagues/{id}/draft/state` | Full draft state |
| GET | `/api/leagues/{id}/draft/results` | Post-draft rosters |
| GET | `/api/analytics/*` | Aggregated stats for the analytics pages |
| POST | `/api/assistant/query` | Natural-language stats question |
| WS | `/ws/draft/{league_id}?token={jwt}` | Live draft socket |

## Status

Working: auth, rankings, leagues, live draft with CPU opponents, stats
ingestion, analytics, and the AI assistant (phase 1).

Known issues and next steps are tracked in **[TODO.md](TODO.md)** — the notable
ones being draft turn enforcement (currently disabled), 31 outstanding ESLint
errors, and deployment to GCP.
