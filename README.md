# Fantasy Draft App

A full-stack fantasy football draft application that lets users create custom player rankings via drag-and-drop, then use those rankings for auto-pick in a real-time shared draft lobby with friends.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Backend | Python, FastAPI (async) |
| Database | PostgreSQL 15 |
| Real-time | WebSockets (native FastAPI) |
| Auth | JWT (email/password) |
| Drag & Drop | @dnd-kit |
| Player Stats | nflreadpy (nflverse) |

## Features

### Auth
- Email/password registration and login
- JWT access + refresh tokens with automatic refresh
- Protected routes on the frontend

### Player Rankings
- Seeded with a top-300 player database (ESPN PPR format)
- Create custom ranking lists from a base source
- Drag-and-drop reordering with @dnd-kit
- Lock individual players to prevent accidental movement
- Filter/search by name, position, or team

### Leagues
- Create a league with customizable settings (team count, roster size, position slots, pick timer, scoring type)
- Share a 12-character invite code for friends to join
- Lobby page shows all members, settings, and draft order
- Commissioner can randomize draft order and start the draft

### Player Stats & Analytics
- Comprehensive player database with 3,300+ players and cross-source identity resolution (gsis_id, espn_id, sleeper_id, yahoo_id, pfr_id)
- Player bio data: height, weight, college, NFL Draft capital, NFL Combine measurables (40-yard dash, bench press, vertical jump, broad jump, 3-cone, shuttle)
- 5 years of seasonal stats (2020-2024): passing, rushing, receiving, kicking, fantasy points, snap counts
- 29,000+ weekly game logs with per-game breakdowns and opponent data
- Data sourced from nflverse via `nflreadpy` — free, no API keys, regularly updated

### Live Draft
- Real-time WebSocket-powered draft room
- Snake draft order (odd rounds ascending, even rounds descending)
- Server-authoritative countdown timer per pick
- Auto-pick on timer expiry using the user's custom ranking list (falls back to default order)
- Draft board grid showing all picks color-coded by position
- Available player list with position filters and search
- Live roster panel showing your picks
- Automatic reconnection with exponential backoff

## Project Structure

```
fantasy-draft-app/
├── docker-compose.yml          # PostgreSQL for local dev
├── backend/
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── alembic.ini
│   ├── alembic/                # Database migrations
│   └── app/
│       ├── main.py             # FastAPI app entry point
│       ├── config.py           # Settings via environment variables
│       ├── database.py         # Async SQLAlchemy engine + session
│       ├── models/             # SQLAlchemy models (User, Player, PlayerBio, PlayerSeason, PlayerWeeklyStat, BaseRanking, UserRanking, League, LeagueMember, DraftPick)
│       ├── schemas/            # Pydantic request/response models
│       ├── api/                # REST endpoints (auth, players, rankings, leagues, drafts)
│       ├── ws/                 # WebSocket draft room manager
│       ├── services/           # Business logic (auth, rankings, draft)
│       └── seeds/              # Seed script + player data JSON
├── rankings_ingester/          # Data ingestion modules
│   ├── main.py                 # Rankings CLI (python -m rankings_ingester.main)
│   ├── ingest_stats.py         # Player stats CLI (python -m rankings_ingester.ingest_stats)
│   ├── loader.py               # DB upsert logic (players + base_rankings)
│   └── sources/
│       ├── espn.py             # ESPN PPR top 300 fetcher
│       └── sleeper.py          # Sleeper PPR ADP fetcher
└── frontend/
    ├── package.json
    ├── Dockerfile
    ├── vite.config.ts
    └── src/
        ├── main.tsx
        ├── App.tsx             # Route definitions
        ├── api/                # Fetch wrapper with JWT interceptor
        ├── context/            # AuthContext, DraftContext
        ├── hooks/              # useWebSocket
        ├── pages/              # Login, Register, Dashboard, Rankings, Lobby, DraftRoom, DraftResults
        ├── components/         # layout/, rankings/, draft/
        └── types/              # TypeScript interfaces
```

## Getting Started

### Prerequisites

- **Docker** (for PostgreSQL)
- **Python 3.12+**
- **Node.js 20+**

### 1. Start the database

```bash
docker-compose up -d
```

This starts a PostgreSQL instance on port 5432 with:
- User: `fantasy`
- Password: `fantasy_dev`
- Database: `fantasy_draft`

### 2. Set up the backend

```bash
cd backend

# Create a virtual environment
python -m venv venv
source venv/bin/activate    # On Windows Git Bash: source venv/Scripts/activate

# Install dependencies
pip install -r requirements.txt

# Run database migrations (creates all tables)
alembic upgrade head
```

**Note:** If Alembic migrations haven't been generated yet, you can create the initial migration:

```bash
PYTHONPATH=. alembic revision --autogenerate -m "initial"
PYTHONPATH=. alembic upgrade head
```

### 3. Seed the player data

```bash
# From the backend/ directory with venv activated
python -m app.seeds.seed_players
```

This loads 300 NFL players into the database with ESPN PPR rankings as initial seed data.

### 4. Update player rankings from ESPN (Rankings Ingester)

The rankings ingester is a standalone module that fetches fresh player rankings from ESPN's public fantasy API and updates the database. It should be run periodically (e.g. once daily) to keep rankings current.

```bash
# From the backend/ directory with venv activated

# Preview what would change without writing to the DB
PYTHONPATH=. python -m rankings_ingester.main --dry-run

# Fetch fresh ESPN PPR top 300 and update the database
PYTHONPATH=. python -m rankings_ingester.main

# Target a specific source or season year
PYTHONPATH=. python -m rankings_ingester.main --source espn_ppr --year 2025
```

**What it does:**
- Fetches the current ESPN PPR top 300 rankings via their public JSON API (no API key needed, no cost)
- Upserts players — adds new players, updates NFL team for traded players
- Replaces `base_rankings` for the source with fresh data — existing user-created custom rankings are not affected
- Validates data quality (checks for duplicates, missing fields, rank gaps)
- Logs all changes (new players, team changes, totals)

**Available flags:**
| Flag | Description |
|------|-------------|
| `--dry-run` | Fetch and validate only — no database writes |
| `--source espn_ppr` | Run a specific source only (default: all registered sources) |
| `--year 2025` | NFL season year (default: 2025) |

**Adding new sources:** Register a new fetch function in `rankings_ingester/main.py`'s `SOURCES` dict and create a corresponding fetcher in `rankings_ingester/sources/`.

### 5. Ingest player stats (bio, seasonal, weekly)

The stats ingester pulls comprehensive player data from [nflverse](https://github.com/nflverse) via the `nflreadpy` package. This populates external IDs, bio/combine data, seasonal stats, weekly game logs, and snap counts.

```bash
# From the backend/ directory with venv activated

# Run all 5 steps for the default seasons (2020-2024)
PYTHONPATH=. python -m rankings_ingester.ingest_stats

# Specify seasons
PYTHONPATH=. python -m rankings_ingester.ingest_stats --seasons 2022 2023 2024

# Run specific steps only
PYTHONPATH=. python -m rankings_ingester.ingest_stats --steps 1 2

# Preview without writing to DB
PYTHONPATH=. python -m rankings_ingester.ingest_stats --dry-run
```

**Steps:**
| Step | What it does |
|------|-------------|
| 1 | Loads nflverse player IDs → populates `gsis_id`, `espn_id`, `sleeper_id`, `yahoo_id`, `pfr_id` on Player rows, creates missing players |
| 2 | Loads bio + combine data → populates `player_bio` table (height, weight, college, draft info, 40-yard dash, etc.) |
| 3 | Loads weekly player stats → populates `player_weekly_stats` (passing, rushing, receiving, kicking, fantasy points per game) |
| 4 | Aggregates weekly stats → populates `player_seasons` (season totals) |
| 5 | Loads snap counts → merges into weekly stats and season aggregates |

**Data volume:** ~3,200 players, ~3,000 season rows, ~29,000 weekly stat rows for 5 seasons. Takes ~2 minutes to run.

### 6. Start the backend server

```bash
uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`. You can view the auto-generated docs at `http://localhost:8000/docs`.

### 7. Set up and start the frontend

```bash
cd frontend

# Install dependencies
npm install

# Start the dev server
npm run dev
```

The frontend will be available at `http://localhost:5173`. The Vite dev server proxies `/api` and `/ws` requests to the backend on port 8000.

## Usage Walkthrough

1. **Register** an account at `/register`
2. **Create a ranking list** — go to Rankings, pick "ESPN PPR" as the source, name your list, and drag players to reorder. Lock players you don't want to move.
3. **Create a league** — from the Dashboard, click "Create League" and give it a name
4. **Invite friends** — copy the invite code from the lobby and share it. Friends register and use "Join League" with the code.
5. **Set draft order** — the commissioner clicks "Randomize Draft Order" in the lobby
6. **Start the draft** — commissioner clicks "Start Draft" (requires 2+ members and a draft order)
7. **Draft!** — pick players when it's your turn. If the timer runs out, auto-pick kicks in using your custom ranking list.
8. **View results** — after all picks are made, the draft board shows the complete results

## Environment Variables

The backend reads settings from environment variables prefixed with `APP_`:

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_DATABASE_URL` | `postgresql+asyncpg://fantasy:fantasy_dev@localhost:5432/fantasy_draft` | Database connection string |
| `APP_SECRET_KEY` | `dev-secret-change-in-production` | JWT signing key |
| `APP_ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | Access token lifetime |
| `APP_REFRESH_TOKEN_EXPIRE_DAYS` | `7` | Refresh token lifetime |
| `APP_CORS_ORIGINS` | `["http://localhost:5173"]` | Allowed CORS origins |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/refresh` | Refresh JWT |
| GET | `/api/auth/me` | Current user |
| GET | `/api/players` | List players (`?position=QB&search=mahomes`) |
| GET | `/api/players/{id}/stats` | Player career stats (all seasons) |
| GET | `/api/players/{id}/bio` | Player bio + combine data |
| GET | `/api/players/{id}/weekly?season=2024` | Weekly game logs for a season |
| GET | `/api/players/base-rankings?source=espn_ppr` | Base ranking list |
| GET | `/api/rankings/sources` | Available base ranking sources |
| GET | `/api/rankings` | User's custom ranking lists |
| POST | `/api/rankings` | Create ranking from base source |
| GET | `/api/rankings/{id}` | Ranking with entries |
| PUT | `/api/rankings/{id}/reorder` | Bulk reorder entries |
| PATCH | `/api/rankings/{id}/entries/{entry_id}` | Toggle lock / move entry |
| DELETE | `/api/rankings/{id}` | Delete ranking |
| POST | `/api/leagues` | Create league |
| GET | `/api/leagues` | User's leagues |
| GET | `/api/leagues/{id}` | League detail |
| PATCH | `/api/leagues/{id}` | Update settings |
| POST | `/api/leagues/join` | Join via invite code |
| POST | `/api/leagues/{id}/set-draft-order` | Set/randomize draft order |
| PATCH | `/api/leagues/{id}/members/me` | Update team name / ranking |
| POST | `/api/leagues/{id}/draft/start` | Start draft |
| GET | `/api/leagues/{id}/draft/state` | Full draft state |
| GET | `/api/leagues/{id}/draft/results` | Post-draft rosters |
| WS | `/ws/draft/{league_id}?token={jwt}` | Live draft WebSocket |
