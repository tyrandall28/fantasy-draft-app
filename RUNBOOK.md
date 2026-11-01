# Runbook

Everything you need to run this app and keep its data current. Written to be
followed without thinking, including by you in six months.

Commands are PowerShell (Windows). They work unchanged in Git Bash except where
noted. **Every backend command assumes you are in `backend/` with the venv
activated** — that's the first block below.

**The one command to remember:**

```powershell
python -m scripts.doctor
```

It tells you what state everything is in and prints the exact command to fix
anything that's wrong. When in doubt, run it.

---

## Table of contents

1. [Start the app (you've run it before)](#1-start-the-app)
2. [First-time setup (new machine, or empty database)](#2-first-time-setup)
3. [Refresh the data](#3-refresh-the-data)
4. [What data is in here](#4-what-data-is-in-here)
5. [How to verify it worked](#5-how-to-verify-it-worked)
6. [Troubleshooting](#6-troubleshooting)
7. [Command reference](#7-command-reference)

---

## 1. Start the app

You need three things running: Postgres, the backend, the frontend.

### Postgres

It's installed as a Windows service with automatic startup, so it's probably
already running. Check:

```powershell
Get-Service postgresql-x64-17
```

If `Status` isn't `Running`:

```powershell
Start-Service postgresql-x64-17
```

> **This machine runs Postgres natively, so ignore `docker-compose.yml` here.**
> Running it as well would start a *second*, empty database on the same port and
> everything would look mysteriously broken. The compose file is for a machine
> with no Postgres installed — see First-time setup, Step 1.

### Backend

```powershell
cd backend
.\venv\Scripts\Activate.ps1
python -m scripts.doctor          # confirm the data is healthy first
uvicorn app.main:app --reload --port 8000
```

API at http://localhost:8000, interactive docs at http://localhost:8000/docs.

### Frontend

In a second terminal:

```powershell
cd frontend
npm run dev
```

App at http://localhost:5173. Vite proxies `/api` and `/ws` to port 8000, so
both have to be running.

---

## 2. First-time setup

For a brand-new machine or an empty database. Takes about 10 minutes, most of it
downloads.

### Step 1 — Postgres database and user

Once per machine. **No Postgres installed?** From the repo root,
`docker compose up -d` starts Postgres 17 on port 5432 with this user and
database already created; skip to Step 2. Otherwise, using `psql` as the
superuser:

```powershell
psql -U postgres -c "CREATE USER fantasy WITH PASSWORD 'fantasy_dev';"
psql -U postgres -c "CREATE DATABASE fantasy_draft OWNER fantasy;"
```

### Step 2 — Python environment

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Step 3 — Create the tables

```powershell
python -m alembic upgrade head
```

This is the **only** correct way to create the schema. Don't create tables by
hand — if the database and the migrations disagree, `scripts.doctor` will tell
you, and everything downstream gets confusing.

### Step 4 — Load all the data

```powershell
python -m scripts.refresh_data --first-time
```

One command. It fetches draft rankings, downloads five seasons of NFL stats,
builds the season and derived-metric tables in the right order, and then runs the
health check and prints the result. Expect a few minutes.

### Step 5 — (Optional) enable the AI assistant

The "Ask AI" page needs an Anthropic API key. Create `backend/.env`:

```
APP_ANTHROPIC_API_KEY=sk-ant-...
APP_ASSISTANT_MODEL=claude-opus-5
```

`backend/.env` is gitignored, and `.dockerignore` keeps it out of the container
image — a key baked into a layer is readable by anyone who can pull it.

Without a key the rest of the app works fine and the "Ask AI" page shows a
"coming soon" notice with no input box, rather than letting you type a question
and collecting an error.

**The assistant is held off in any deployed instance** — set
`APP_ASSISTANT_ENABLED=false` there. Questions cost real credits and the
endpoint has no per-user quota yet, so an open deploy is an open tab. The flag
defaults to `true`, so local development with a key set needs nothing.

### Step 6 — Frontend

```powershell
cd ..\frontend
npm install
```

Then follow [Start the app](#1-start-the-app).

---

## 3. Refresh the data

### The normal refresh

```powershell
cd backend
.\venv\Scripts\Activate.ps1
python -m scripts.refresh_data
```

That's it. During the season, run it weekly — Tuesday or Wednesday, once
nflverse has published the weekend's games.

It is **safe to run any time**. It's incremental, but not naively so: weeks of
the season *currently being played* are re-read on every run, while weeks of
finished seasons are loaded once and then left alone.

That distinction matters in-season and is worth understanding. A week's games
don't all arrive together — Thursday night lands two days before Sunday's
thirteen, and Monday night a day after — so a week that already exists in the
database still has to be re-read to fill in. nflverse also issues stat
corrections for a week days after it was played. Re-reading the live season
picks up both; skipping a week because it already exists picks up neither.

What it does, in order:

| # | What | Why the order matters |
|---|------|----------------------|
| — | Pre-flight | Refuses to run if the schema is behind the migrations |
| — | Draft rankings | Fetches ESPN + Sleeper top-300 lists, replaces the old ones |
| 1 | External IDs | Links our player rows to nflverse IDs |
| 2 | Bio + combine | Height, weight, college, draft position, 40-time |
| 3 | Weekly game logs | **The download.** The raw per-game stats |
| 4 | Season totals | Aggregates step 3 |
| 5 | Snap counts | Merges into steps 3 and 4 |
| 6 | Derived metrics | Computes per-game rates, EPA, boom/bust from 3 and 4 |

Steps 4–6 only recompute seasons that actually got new data in step 3. Then it
prints a before/after row count for every table and runs the health check.

### Just the rankings (a few seconds)

Draft lists change often in preseason; the stats don't change at all in the
offseason.

```powershell
python -m scripts.refresh_data --rankings
```

### Just the stats

```powershell
python -m scripts.refresh_data --stats
```

### See what it would do, without doing it

```powershell
python -m scripts.refresh_data --dry-run
```

### When you suspect the data is wrong

`--full-refresh` deletes and re-downloads the named seasons instead of adding to
them. Use it if you think a season got partially loaded or the upstream data was
corrected.

```powershell
python -m scripts.refresh_data --full-refresh --seasons 2026
```

### Merge duplicate players

Rarely needed — external-ID matching prevents it now. But if the doctor reports
duplicate identities with stats:

```powershell
python -m rankings_ingester.dedup           # preview the merges
python -m rankings_ingester.dedup --apply   # do them
```

---

## 4. What data is in here

Two independent pipelines feed two unrelated kinds of data. Understanding the
split explains most of the app.

```
  ESPN API ─────┐                             nflverse (nflreadpy)
  Sleeper API ──┴─→ base_rankings                     │
                    "who to draft, in order"          │
                    ~300 players per source           ▼
                    refreshed in seconds        players / player_bio
                                                      │
                                                      ▼
                                              player_weekly_stats
                                               (one row per game)
                                                      │
                                         ┌────────────┴────────────┐
                                         ▼                         ▼
                                   player_seasons         player_derived_stats
                                  (season totals)          (rates, EPA, EPA,
                                                            boom/bust)
                                                                   │
                                                                   ▼
                                                     Analytics pages + Ask AI
```

### The tables

| Table | One row per | What's in it | Where it comes from |
|-------|-------------|--------------|---------------------|
| `players` | player | Name, position, team, bye week, and the external IDs (`gsis_id`, `espn_id`, `sleeper_id`, `yahoo_id`, `pfr_id`) that let sources be joined without matching on names | nflverse + rankings |
| `player_bio` | player | Height, weight, college, draft year/round/pick, combine numbers (40, bench, vertical, broad, 3-cone, shuttle) | nflverse combine data |
| `player_weekly_stats` | player per game | Passing/rushing/receiving/kicking counting stats, fantasy points, snap counts, opponent. **The source of truth** — everything below is derived from it | nflverse weekly stats |
| `player_seasons` | player per season | The same stats summed over a season, plus games played | Computed (step 4) |
| `player_derived_stats` | player per season | Per-game rates, efficiency (YPC, catch rate, completion %), advanced (EPA/game, CPOE, target share, air yards, snap %), consistency (median and stdev of weekly PPR), totals. **This is what the Analytics pages and the AI assistant read** | Computed (step 6) |
| `base_rankings` | player per source | Draft rank and tier, plus `season` and `fetched_at` so you can tell how fresh the list is | ESPN + Sleeper APIs |
| `users`, `leagues`, `league_members`, `draft_picks`, `user_rankings`, `user_ranking_entries` | — | Your app's own data: accounts, leagues, drafts, custom ranking lists. **Never touched by a data refresh** | Created by using the app |

### Which seasons

- **Stats:** the last four completed seasons plus the one in progress. The
  defaults are derived from today's date, not hardcoded, so they don't rot.
- **Rankings:** the current season only. Each refresh replaces the previous list
  for that source.

Check exactly what's loaded at any time:

```powershell
python -m scripts.doctor
```

### Where it comes from

| Source | What | Cost | Key needed |
|--------|------|------|-----------|
| [nflverse](https://github.com/nflverse) via `nflreadpy` | All player stats, bio, combine, snap counts | Free | No |
| ESPN public fantasy API | PPR top-300 draft rankings | Free | No |
| Sleeper public API | PPR ADP top-300 | Free | No |
| Anthropic API | The "Ask AI" assistant only | Paid per use | Yes |

Only the assistant costs money. Everything else is public and unauthenticated.

---

## 5. How to verify it worked

Run the doctor. It's the answer to "did that work?"

```powershell
python -m scripts.doctor
```

`refresh_data` runs it automatically at the end, so a refresh already tells you.

### What it checks

**Environment** — Postgres reachable, schema matches the migrations, whether
`APP_SECRET_KEY` is still the insecure default, whether the AI assistant is
configured.

**Datasets** — row counts for every table, which seasons each covers, which
weeks are present per season, and for each ranking source: how many players,
which season, and how long ago it was fetched.

**Consistency** — the part that catches a half-finished ingest:

| Check | Catches |
|-------|---------|
| Season totals cover every season with game logs | Step 4 didn't run |
| Derived metrics cover every aggregated season | Step 6 didn't run — Analytics would silently show stale numbers |
| In-season freshness | Weekly data is more than two weeks behind the calendar |
| Snap counts present | Step 5 was skipped |
| Rank sanity per source | Two players sharing a rank (a real load bug) |
| No duplicate player identities with stats | Player rows that should be merged |
| Ranked players have analytics | Derived stats are stale relative to the ranking list |

### Reading the output

- `[ OK ]` — fine.
- `[INFO]` — context, not a problem.
- `[WARN]` — works, but something is stale or not production-ready.
- `[FAIL]` — actually broken. Exit code is 1, so CI catches it.

Anything not OK gets an exact fix command printed at the bottom, in the order to
run them.

### A healthy result looks like this

```
 RESULT: healthy, with 1 warning(s)

Suggested fixes, in order (run from backend/ with the venv active):
  1. Set APP_SECRET_KEY to a random value before deploying.
```

That one warning is expected in local development.

### Things that look wrong but aren't

- **`base_rankings [espn_ppr]  300 players ... ranks run 1-429 with gaps`** —
  correct. ESPN publishes a *global* draft rank and we take their filtered top
  300, so the numbers have holes. Draft order comes from the sort, not the
  numbers. Duplicate ranks would be a real problem; gaps are not.
- **`Ranked players have analytics  239/351 (68%)`** — correct. Rookies have no
  NFL history yet. Well below 50% would suggest stale derived stats.
- **`2026 game logs through week 1`** in September — correct. Only played games
  exist.
- **A `--dry-run` of the stats pipeline reporting counts for steps 4–6** — those
  steps re-derive from what's already committed, so their numbers reflect
  existing rows, not the dry run. Only steps 1–3 genuinely dry-run.
- **The Analytics page showing an amber "season in progress" banner** — correct
  early in a season. Per-game rates off one or two games swing wildly, so the
  leaderboard is real but noisy. The draft room's value panel deliberately uses
  the most recent *complete* season instead, since replacement level can't be
  computed from one week.
- **Boom/bust and target-share charts empty in September** — they need 8 and 6
  games respectively. They can't say anything meaningful until the season has
  been played, so they say so instead of drawing noise.
- **Kicker PPR/G showing as ~0** — a known gap, not a load failure. nflverse's
  fantasy-point totals exclude kicking scoring, so kicker fantasy points aren't
  populated. FG%, FG/G, longest FG and XP% are all correct. Tracked in
  `TODO.md`.

---

## 6. Troubleshooting

### "Cannot reach the database"

```powershell
Get-Service postgresql-x64-17      # is it running?
Start-Service postgresql-x64-17    # start it
```

If it's running, check where the app is pointed — the doctor prints the URL with
the password redacted. Default is
`postgresql+asyncpg://fantasy:fantasy_dev@localhost:5432/fantasy_draft`,
overridable with `APP_DATABASE_URL`.

### "Schema out of date" / stats pages return 500

```powershell
python -m alembic upgrade head
```

### `refresh_data` stops at "STOP: schema is at X, migrations are at Y"

Working as intended — it won't ingest into a stale schema. Run the upgrade above,
then re-run the refresh.

### A refresh failed partway through

Just re-run it. Each step commits independently, and re-reading a week replaces
it rather than duplicating it, so it picks up where it stopped. Then run the
doctor to confirm.

### Rankings came back empty

The ESPN and Sleeper endpoints are public and occasionally unavailable, and ESPN
returns nothing for a season it hasn't published yet. Retry; if it persists,
check that the season you're asking for exists:

```powershell
python -m rankings_ingester.main --dry-run
```

### The Analytics or Ask AI pages are blank

Almost always missing derived stats:

```powershell
python -m scripts.doctor                                  # confirm
python -m rankings_ingester.ingest_stats --steps 6        # rebuild
```

### The "Ask AI" page says "coming soon"

Either `APP_ANTHROPIC_API_KEY` isn't set or `APP_ASSISTANT_ENABLED=false`. Both
have to be right for the assistant to answer; `GET /api/assistant/status` says
which state it's in. See [step 5](#step-5--optional-enable-the-ai-assistant).
This is the intended state on a deployed instance.

### Start completely over

Destroys all app data — accounts, leagues, drafts — as well as player data.

```powershell
python -m scripts.reset_db          # prompts for confirmation
python -m scripts.refresh_data --first-time
```

### `npm run dev` warns about the Node version

Harmless. Node 20.14 vs the requested 20.19; everything works.

---

## 7. Command reference

All from `backend/` with the venv active.

| Command | What it does | Writes to DB? |
|---------|--------------|:---:|
| `python -m scripts.doctor` | Health + data report with fix suggestions | No |
| `python -m scripts.refresh_data` | Full incremental refresh, then verify | Yes |
| `python -m scripts.refresh_data --first-time` | Populate an empty database | Yes |
| `python -m scripts.refresh_data --rankings` | Draft lists only | Yes |
| `python -m scripts.refresh_data --stats` | NFL stats only | Yes |
| `python -m scripts.refresh_data --dry-run` | Print the plan | No |
| `python -m scripts.refresh_data --full-refresh --seasons 2026` | Re-download named seasons | Yes |
| `python -m alembic upgrade head` | Apply migrations | Schema |
| `python -m alembic current` | Show applied revision | No |
| `python -m alembic check` | Fail if models drifted from migrations | No |
| `python -m rankings_ingester.main` | Rankings only, raw | Yes |
| `python -m rankings_ingester.ingest_stats --steps 6` | One stats step | Yes |
| `python -m rankings_ingester.dedup` / `--apply` | Preview / merge duplicate players | On `--apply` |
| `python -m scripts.reset_db` | **Wipe every table** | Yes |
| `python -m pytest -q` | Run the test suite (SQLite, no Postgres needed) | No |

Frontend, from `frontend/`:

| Command | What it does |
|---------|--------------|
| `npm run dev` | Dev server on :5173 |
| `npm run build` | Typecheck and production build |
| `npm run lint` | ESLint; clean, and CI fails on any error or warning |

### Adding a season by hand

You shouldn't need to — the defaults follow the calendar. But:

```powershell
python -m rankings_ingester.ingest_stats --seasons 2021 2022
python -m rankings_ingester.main --year 2027
```
