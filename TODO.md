# TODO — Fantasy Draft App

## Start here — deploy readiness, as of 2026-09-21

A pre-deploy audit ran on this date. The 500s and the authorization holes it
found are **fixed** (see the sections below, each marked `[x]` with what was
wrong). What follows is what it found and left, in the order worth doing.
Everything named here has a fuller entry further down.

1. **Silent failures in the UI.** A failed request renders as an empty table
   or as nothing happening. There is also no `ErrorBoundary`, so one render
   crash is a white screen. → *UI / UX Polish*
2. **The app is desktop-only.** → *Responsive layouts*, below, which now says
   what specifically breaks.
3. **Lint isn't in CI** and `npm run lint` is red with 31 errors. →
   *Code Health*
4. Smaller, individually cheap: the loose ends in *API hardening — leftovers*.

Verified green on the audit date: `pytest` (309), `alembic check`, `alembic`
up/down, `npm run build`, `scripts.doctor` (healthy, 1 expected local warning),
and the container image builds. No secret has ever been committed — every
commit was scanned, not just the working tree.

The deploy plan itself (`docs/deploy.md`) was reviewed and holds up: the
WebSocket request timeout, `--max-instances=1`, migrations as a one-off job,
and Secret Manager are all handled there and none of it needs revisiting.

## Auth & Security (Pre-Launch)

### Critical
- [x] **Secret key / DB credentials enforced in production** — the dev defaults are
  published in a public repo, so a deploy that forgot `APP_SECRET_KEY` would have
  signed JWTs with a value anyone could read off GitHub and forge tokens with.
  Rather than removing the defaults (which would break clone-and-run), setting
  `APP_ENVIRONMENT=production` now makes startup *fail* while `APP_SECRET_KEY` or
  `APP_DATABASE_URL` are still at their defaults. A crash, not a log warning.
- [ ] **Migrate tokens to HttpOnly cookies** — localStorage is vulnerable to XSS; requires backend + frontend refactor
- [x] **Registration validation** — there was none: `email: str` (with
  `EmailStr` imported and unused) and a bare `password: str`, so `"a"` / `"a"`
  was a valid account. Now 8-64 characters with at least one letter and one
  digit, a 3-character username floor, and a structural email check that
  lowercases on the way in (otherwise `Bob@x.com` and `bob@x.com` become two
  accounts, since `get_user_by_email` matches exactly). Deliberately light on
  composition rules — NIST SP 800-63B recommends against mandating them, and
  length is what actually helps. Login applies *no* rules, so nobody who
  registered under the old ones is locked out.
  - [ ] Real email validation would want `EmailStr`, which needs the
    `email-validator` package. Not added unprompted; the structural check
    rejects the garbage that matters and only sending mail proves an address
    exists anyway.
- [x] **A taken username returned 500** — `username` is UNIQUE in the database
  but only the email was checked, so the second person to want a username hit
  an IntegrityError on the first screen of the app. Both are checked now, and
  the insert catches IntegrityError anyway so a simultaneous signup loses the
  race with a 400 rather than a 500.
- [x] **League settings had no bounds** — `name: str` against a VARCHAR(100)
  column (a 500 on Postgres, invisible to the SQLite test suite), and bare
  `int`s for every count, so `team_count: 0`, `pick_time_seconds: -10` and
  arbitrary `position_slots` JSON were all stored happily. Bounded in
  `app/schemas/league.py`, well outside what the lobby's own selectors offer.
- [x] **`claim-position` took an untyped `dict`** — `{"position": "abc"}`
  compared a str to an int and came back as a 500. It has a schema now; the
  1..team_count range stays in the endpoint, which can name the number.
- [x] **A member's `ranking_id` was assigned unchecked** — an id that didn't
  exist hit the foreign key as a 500, and one belonging to *another user* was
  accepted. It was the only endpoint touching a ranking that didn't verify
  ownership.

### Critical (draft integrity)
- [x] **Draft turn enforcement re-enabled** — the "Not your turn" check was
  commented out *and* the line below it reassigned `user_id = expected_user`,
  so any connected client could make the pick for whoever was on the clock.
  Enforced again, with one deliberate exception: the commissioner may pick for
  the team on the clock (that's how a dropped player gets drafted for), and the
  pick is attributed to that team rather than to him.
- [x] **League membership checked on WebSocket connect** — `ws/events.py`
  verified the JWT but never checked that the user belonged to the league, so
  any authenticated user could join any draft room by id and receive its
  broadcasts. `_is_league_participant` now admits members and the commissioner
  and closes everyone else with 4003.
- [x] **Undo and the timer toggle restricted to the commissioner** — neither
  had any authorization check. Both are commissioner-only now, hidden in the
  draft room UI for everyone else (the state broadcast carries
  `commissioner_id`), and enforced server-side regardless of the UI.
- [x] **Starting a draft is the commissioner's** — `POST /draft/start` had no
  check of any kind, not membership and not ownership, so any logged-in user
  who knew a league id could start that league's draft: settings locked,
  everyone assigned a slot, bots filling the empty seats. The lobby also
  offered the button to every member, so it now shows "waiting for the
  commissioner" to everyone else rather than a button the server refuses.
- [x] **Reading a league requires belonging to it** — `GET /api/leagues/{id}`,
  `/draft/state` and `/draft/results` were readable by any authenticated user.
  The league response carries `invite_code`, so that read was enough to then
  join the league. The rule now lives in `app/services/league_access.py`,
  shared with the WebSocket check rather than written a third time.
- Covered by `tests/test_ws/test_draft_authorization.py` — 13 tests, each of
  which fails against the old code — and `tests/test_api/test_drafts.py` for
  the REST side.

### High
- [x] **Rate limiting on auth endpoints** — login 10/15min, register 5/hour,
  refresh 60/15min, per IP, in `app/services/rate_limit.py`. Refresh shares no
  bucket with login: a login is a guess at a password, a refresh presents a
  token this server signed, and the frontend treats a failed refresh as "log
  out" — so spending login quota on it signed people out mid-draft. The client
  now also keeps its tokens unless the server actually rejects them (401/403),
  where any non-OK response used to clear them. Sliding window,
  keyed off the first `X-Forwarded-For` entry because behind Cloud Run the
  direct peer is Google's front end and identical for every caller. Not
  slowapi: its default backend is an in-process dict, which is exactly this, so
  the dependency would have bought decorator syntax rather than stronger
  limits. Revisit with a shared store if this ever runs multi-instance.
- [ ] **WebSocket auth via header** — currently passes JWT in query string which gets logged
- [ ] **HTTPS enforcement** — required before any real users
- [ ] **Refresh token rotation** — issue new refresh token on each use, invalidate old one

### Medium
- [ ] **Server-side logout** — add `/api/auth/logout` with token blacklist/revocation
- [ ] **Account lockout** — lock after N failed login attempts
- [ ] **Tighten CORS** — specify exact methods/headers instead of `["*"]`
- [ ] **Reduce access token expiry** — 30min → 15min

### Future
- [ ] Email verification on register
- [ ] OAuth (Google login)
- [ ] Login audit trail
- [ ] 2FA (TOTP)

---

## API hardening — leftovers

Found in the 2026-09-21 audit and deliberately left: none is a 500, a data
loss, or reachable from the UI. Each is a few lines. Grouped so they can be
done in one pass.

- [ ] **`set-draft-order` accepts ids that aren't in the league** —
  `{"order": ["nope", "also-nope"]}` returns 200 and stores it as
  `league.draft_order`. It's commissioner-only, so this is self-inflicted
  rather than an attack, but a bad order is read straight by
  `get_snake_pick_user` and would put the draft on a user who isn't there.
  Validate that `order` is exactly the set of member ids.
- [ ] **`set-draft-order` has no status check** — every other league mutation
  refuses once `status != "setup"`. This one can be called mid-draft, which
  reorders who is on the clock underneath a running room.
- [ ] **An unknown ranking source silently creates an empty ranking** —
  `POST /api/rankings {"source": "not_a_source"}` returns 201 with zero
  entries. Check against the sources `/api/rankings/sources` reports and 400
  otherwise.
- [ ] **No cap on rankings per user** — each is ~300 rows and nothing limits
  how many a single account creates. A per-user ceiling (say 25) is enough.
- [ ] **`LoginRequest.password` has no `max_length`** — bcrypt truncates at 72
  bytes so hashing stays cheap, but the body is still parsed in full. Register
  is bounded; login deliberately isn't validated, so bound the length only.
- [ ] **Usernames are case-sensitive** — `Tyler` and `tyler` are two accounts
  with two teams in a lobby. A product decision, not a bug: either normalise
  on the way in like email, or match case-insensitively on the duplicate
  check. Note the DB UNIQUE index is case-sensitive either way.
- [ ] **`get_current_user` trusts the token's `sub` shape** — `api/deps.py`
  does `uuid.UUID(payload["sub"])` with no guard, so a token we signed with a
  malformed subject would 500. Unreachable while only this app mints tokens;
  one `try` makes it a 401 regardless.
- [ ] **The WebSocket reconnects after a policy close** — `hooks/useWebSocket.ts`
  retries on every `onclose`, including the deliberate 4001 (invalid token)
  and 4003 (not a member) from `ws/events.py`. It backs off to 30s, so it's
  waste rather than a hammer, but a rejected client should stop and say why.
- [ ] **Rate limiting trusts the first `X-Forwarded-For` entry** —
  `services/rate_limit.py` says so in its own docstring. Confirm which entry
  Cloud Run actually gives you before relying on it: if a client-supplied
  header lands first, the limiter is bypassed by varying one header. Taking
  the *last* entry is the usual answer behind a single trusted proxy.

---

## Data & Infrastructure (Pre-Launch)
- [x] **Missing migration for `player_derived_stats`** — the table existed only in
  the dev database; `alembic upgrade head` on a fresh DB didn't create it, which
  would have broken Analytics and the AI assistant on first deploy. Added as
  revision `b7e41f0c92a5`; the full chain now reproduces the model schema with
  zero drift, verified both directions.
- [x] **Broken migration downgrade** — `d5861c438c7e` emitted
  `drop_constraint(None, ...)`, which cannot compile, so `alembic downgrade` had
  never worked. Constraints are now named explicitly (matching the names
  Postgres already assigned, so existing databases are unaffected).
- [x] **Ranking provenance** — `base_rankings` now carries `season` and
  `fetched_at`, so freshness is knowable. Previously there was no way to tell a
  list pulled this morning from one pulled last August.
- [x] **Stale hardcoded season defaults** — the ingest CLIs defaulted to
  `--year 2025` / `--seasons 2022-2025`. Running a refresh in 2026 would have
  silently repopulated the prior season. Now derived from the date in
  `app/nfl_season.py`.
- [x] **Operational tooling** — `scripts/doctor.py` (health + data consistency
  report with fix suggestions) and `scripts/refresh_data.py` (one-command
  ordered refresh that verifies itself). Documented in `RUNBOOK.md`.
  - [x] `doctor` reported the AI assistant as "enabled" whenever a key was
    present, ignoring `APP_ASSISTANT_ENABLED`. With the flag off it claimed
    enabled while `/api/assistant/query` answered 503. It reports
    `settings.assistant_enabled` now, and says which half is missing.
- [x] **Nothing stopped a duplicate draft pick** — the draft room reads the
  taken players, checks the pick, then inserts, with awaits in between and the
  auto-pick timer on the same event loop, so a human pick landing as the clock
  expires could put one player on two rosters or two rows in one slot. Unique
  constraints on `(league_id, player_id)` and `(league_id, overall_pick)` in
  revision `9dfa74bbe207`; both write paths turn the IntegrityError into a
  message and a state resync rather than a dead connection.
- [x] **CI** — `.github/workflows/ci.yml`: backend tests, fresh-database
  migration + `alembic check` drift guard + downgrade check, frontend
  typecheck/build.
- [ ] **Automated DB backups** — Cloud SQL handles this on GCP, configure retention
- [ ] **Lock down Alembic migrations** — no more drop/recreate once real users exist
- [ ] **Environment-based config** — dev vs staging vs prod settings
- [ ] **Scheduled refresh** — Cloud Scheduler hitting `scripts.refresh_data`
  in-season, once the app is deployed. Design and exact commands in
  `docs/scheduled-refresh.md`, which argues for daily rather than weekly.
  The repo-side prerequisites are done: `--stats --current-season` exists so
  the job loads only the in-progress season (the default pulls five, four of
  which can never change) and names no year to go stale; exit codes now
  distinguish a failed download from a health-check complaint, which is why
  the doc sets `--max-retries=0`. What's left is the GCP resources themselves.
  Partial weeks are handled: `app/services/season_coverage.py` measures coverage
  per team, so a mid-week refresh no longer hides the teams that haven't played.

---

## Deployment (GCP)

Target is Cloud Run + Cloud SQL. `docs/deploy.md` has the commands and the
pre-launch checklist; `docs/scheduled-refresh.md` covers the daily data job.
This section is the state of the work.

- [x] **The image was carrying a secret.** `backend/Dockerfile` did `COPY . .`
  with no `.dockerignore`, so a build baked in `backend/.env` — holding the real
  `APP_ANTHROPIC_API_KEY` — where anyone who can pull the image can read it back
  out of a layer. It also copied `backend/venv/`: 293 MB of Windows-built
  packages that cannot execute on Linux. Root `.dockerignore` now excludes both,
  plus caches, docs and git.
- [x] **One image serves both halves.** The frontend is built in a first stage
  and served from `/` by FastAPI, because `api/client.ts` uses relative URLs
  (`BASE_URL = ""`) and `DraftContext.tsx` derives the WebSocket URL from
  `window.location.host` — the code already assumed same-origin. So CORS never
  applies in production and `/ws` needs no extra routing. The build context is
  the repo root: `docker build -f backend/Dockerfile .`
  - Client-side routes are handled by an `SPAStaticFiles` fallback to
    `index.html`, except under `/assets/`, where a miss stays a 404 rather than
    silently returning a page of HTML in place of a missing bundle.
- [x] **`$PORT` is respected**, which Cloud Run injects, with 8000 as the
  default so local use is unchanged. The container also runs as a non-root user.
- [x] **`GET /healthz`** — liveness only, no database query on purpose: a probe
  that touches Cloud SQL turns a brief database blip into a restart loop.
- [x] **The AI assistant is held.** `APP_ASSISTANT_ENABLED=false` in production;
  `/api/assistant/status` tells the frontend, which renders a coming-soon page
  with no input box instead of letting someone type a question and collect a
  503. Enforced server-side too, so a hand-rolled POST can't spend credits.
  Message *length* is now capped as well (2k for a question, 120k for a
  conversation) — only the message *count* was bounded before, so one request
  could push megabytes into a metered context window.

### Open
- [x] **Decided: pin Cloud Run to `--max-instances=1`.**
  `DraftRoomManager` keeps rooms in a process-local dict
  (`app/ws/draft_room.py`), so with two instances, two users in the same draft
  land on different ones and never see each other's picks. Nothing errors —
  they silently draft in separate realities. One instance removes the
  possibility and is ample at this scale. Written into `docs/deploy.md` with
  the reasoning, because **raising that number breaks the draft**.
  - [ ] The real fix — shared state (Redis pub/sub) or sticky routing by
    league id — is deferred to the draft board rework, since that code is
    being rewritten anyway. Blocks horizontal scaling until then.
- [x] **`/api/players` and `/api/analytics` now require a login.** Both
  routers were fully open to the internet. Nothing private leaked (it's public
  nflverse data) but they were an unauthenticated path straight to Cloud SQL,
  where reads are metered. Router-level `Depends(get_current_user)` on both.
  The app is unaffected: every caller already goes through `apiFetch`, which
  attaches the token, from pages behind `ProtectedRoute`.
  - Analytics was already bounded (200 rows per ranking query, 200 ids per
    sparkline/recent-form batch), so auth was the only missing half there.
  - `/api/players` gained `limit`/`offset` with a hard ceiling of 1,000 on an
    explicitly requested page. `limit` is deliberately *not* defaulted: the
    draft room uses this as its fallback list and filters client-side, so a
    default page size would silently truncate the board and its search box.
  - [ ] Move that draft-room fallback onto `/base-rankings` (~300 draftable
    players, ranked) instead of all ~3,700, during the draft rework. Then this
    endpoint can default to a page like everything else.
- [ ] **Turn the AI assistant back on behind a real quota.** What "held" is
  waiting for: per-user daily question limits, and a spend ceiling. The
  endpoint-level rate limiter in `app/services/rate_limit.py` is the obvious
  place to start, keyed by user id rather than IP.
  - Decided *against* an admin bypass so the owner could use it in production.
    It would need an `is_admin` column, a way to set it, and would leave one
    database row between the API key and everyone. The assistant runs fully
    locally, where it costs the same credits, so the bypass buys nothing.
- [ ] **`requirements.txt` installs pytest into the production image.** Minor
  (a few MB) but it belongs in a dev-only file, and the same change is a
  natural moment to do the lockfile item below.
- [x] **The image has been built and verified** (2026-09-21). Previously this
  was correct by inspection only — the daemon had never run, and
  `.dockerignore` had been checked by simulating Docker's pattern rules rather
  than against a real build context. A real build now confirms all of it:

  | Check | Result |
  | --- | --- |
  | Builds from the repo root | exit 0, ~600 MB |
  | `backend/.env` excluded | no `.env` anywhere in the image |
  | `backend/venv/` excluded | `/app` is 1.9 MB, not 293 MB |
  | SPA served from the container | `/`, JS and CSS all 200 |
  | `$PORT` honoured | ran on 8000 inside, mapped to a free host port |
  | `/healthz` | 200 after a ~3 s cold start, no database touched |

  Also verified against a real empty Postgres 17, run from inside the
  production image: **every migration applies cleanly from scratch**, which is
  the same path the Cloud Run `migrate` job in `docs/deploy.md` takes.

  Reproduce with:

  ```powershell
  docker build -f backend/Dockerfile -t fantasy-draft .
  docker run --rm fantasy-draft sh -c 'ls -la /app/.env 2>&1; du -sh /app'
  # ^ should say "No such file" and show ~2 MB, not 300+ MB
  ```

  To exercise it end to end, give it a database rather than opening the native
  one to Docker — a throwaway Postgres on a private network publishes no port,
  so nothing on the host or LAN can reach it and `pg_hba.conf` stays untouched:

  ```powershell
  docker network create fd-net
  docker run -d --name fd-db --network fd-net `
    -e POSTGRES_USER=fantasy -e POSTGRES_PASSWORD=fantasy_dev `
    -e POSTGRES_DB=fantasy_draft postgres:17
  docker run -d --name fd-app --network fd-net -p 8080:8000 -e PORT=8000 `
    -e APP_DATABASE_URL="postgresql+asyncpg://fantasy:fantasy_dev@fd-db:5432/fantasy_draft" `
    fantasy-draft
  docker exec fd-app python -m alembic upgrade head
  # optional: copy real data in, reading over loopback only
  #   pg_dump -h localhost -U fantasy -d fantasy_draft --no-owner --no-privileges -f dump.sql
  #   docker exec -i fd-db psql -U fantasy -d fantasy_draft < dump.sql
  # teardown, including the volume that `docker rm -f` leaves behind:
  #   docker rm -f fd-app fd-db; docker network rm fd-net; docker volume prune -f
  ```

  Do **not** use `docker-compose.yml` for this — it binds 5432 on the host and
  collides with the native Postgres service.

- [ ] **HTTPS / secrets checklist before first deploy** — `APP_SECRET_KEY` and
  `APP_DATABASE_URL` from Secret Manager, `APP_ENVIRONMENT=production` (which
  makes startup fail if either is still at its public default), Cloud SQL
  backups configured.

---

## Dependency Pinning

- [x] **Fresh installs had completely broken auth** — `requirements.txt` had
  `passlib[bcrypt]==1.7.4` with bcrypt itself unpinned. Local dev had bcrypt
  4.0.1; any fresh install (CI, and a GCP deploy) got bcrypt 5.0.0. passlib
  1.7.4 detects its backend via `bcrypt.__about__.__version__`, removed in
  bcrypt 4.1, so detection failed and its 72-byte probe hit bcrypt 5's new
  hard error: every `hash_password`/`verify_password` raised
  `ValueError: password cannot be longer than 72 bytes`. Caught by the first CI
  run. passlib is unmaintained (last release 2020), so it's gone — auth now
  calls `bcrypt` directly. Hash format is unchanged (`$2b$`), and tests pin
  backward compatibility against real passlib-generated hashes, including the
  72-byte truncation behaviour so long-password users aren't locked out.
- [x] **`anthropic` was unpinned** (`>=0.49.0`) — local had 0.111.0, CI resolved
  to 1.6.0, a major version apart. Both happen to work with our usage, but the
  divergence was invisible. Pinned to `==1.6.0` and the local venv upgraded to
  match.

### Open
- [ ] **No real lockfile for Python** — `requirements.txt` pins direct
  dependencies but not the transitive tree, which is exactly how bcrypt drifted.
  `pip-tools` (`requirements.in` -> compiled `requirements.txt` with hashes) or
  `uv` would make local and CI provably identical. Worth doing before deploying.
- [ ] **CI Node version vs local** — CI uses `node-version: "20"` while local dev
  is on v24.19.0. Vite 7 requires `^20.19 || >=22.12`, so both satisfy it, but
  matching them (or adding an `engines` field plus `.nvmrc`) would remove
  another source of "works locally, fails in CI".

---

## In-Season Data Handling

The 2026 season starting exposed a family of bugs where a partially-played
season made fully-loaded data look missing.

- [x] **`min_games` floor made an in-progress season look empty** — the analytics
  API and the assistant's `get_stat_leaders` both default to `games_played >= 3`.
  In week 1 every player has exactly one game, so both returned zero rows while
  the data was fully present (the Analytics page said "No data available. Run
  the ingestion pipeline with step 6", which had in fact already run). Both now
  clamp `min_games` to the weeks the season has actually reached.
- [x] **Draft value panel was reading the in-progress season** — `useAnalyticsData`
  picked the newest season with any data (2026), and `draftValue.ts` filters at
  `DEFAULT_MIN_GAMES = 6`, so the entire VOR panel in the live draft room came
  back empty. Replacement level and tier breaks are baselines and need a
  complete season, so the hook now exposes `analysisSeason` (newest *complete*)
  alongside `season` (newest), and the draft panel uses the former.
- [x] **Assistant's data-coverage facts were hardcoded and had gone stale** — the
  system prompt asserted "the 2026 season has not been played yet, so there are
  NO 2026 stats" while the database held week 1. Coverage is now derived from the
  DB on each request, and leaderboards for an in-progress season carry a `note`
  telling the model to caveat the sample size.
- [x] **Empty-state message blamed the wrong thing** — told the user to run step 6
  regardless of cause. Now distinguishes "no data ingested for this season" from
  "no players match the current filters".
- [x] **Kickers had no stats in any season** — nflverse labels kickers `PK` in
  `load_ff_playerids()` but `K` in `load_player_stats()`. Our position filter
  only accepted `K`, so no kicker ever received a `gsis_id`, and since steps 3-6
  join on `gsis_id` they got no weekly, season, or derived rows at all. The
  Analytics "K" tab was empty in every season. Fixed with a `PK -> K` alias at
  ingest; 153/155 kickers are now linked and populated. `scripts.doctor` now
  fails if any fantasy position has zero rows for a completed season.

### Incomplete positions are now labelled, not silently empty
- [x] **K and DST carry an explicit "coming soon" notice** — a single source of
  truth in `frontend/src/lib/positionData.ts` describes what data each position
  actually has and why, rendered by `PositionDataNotice`. Applied on the
  Analytics page (dimmed tab + badge + notice panel), the player card, and the
  rankings analytics column. DST previously fell back to `KEY_STATS["WR"]`, so a
  defense rendered with receiving labels and a column of dashes.
- [x] **No more structurally-zero metrics on display** — PPR columns removed from
  the kicker table and key-stat grid, the K tab lands sorted on FG/G, and the
  PPR trend sparkline is hidden (and not even fetched) for positions without
  fantasy scoring.

### Missed games are drawn, not omitted
- [x] **Weekly charts closed the gaps where a player didn't play** —
  `player_weekly_stats` only holds games played, so the player-card charts drew
  one point per game played, evenly spaced. Dalton Kincaid's 2025 came out as
  twelve dots with his week 10 next to his week 14; the five games he missed and
  Buffalo's bye were invisible except as skipped numbers on the axis, and the
  regression line ran straight through them. `/api/players/{id}/weekly` now
  returns a slot for every week of the season tagged `played` / `missed` / `bye` /
  `inactive` (`app/services/weekly_timeline.py`), reconstructing each team's
  schedule from the logs themselves since there is no schedule table. The charts
  shade the absences, break the line across them, and the game-log table gets a
  dimmed row per missed week. Applied to the weekly trend chart (player card and
  rankings analytics column), the head-to-head comparison, and the snap-trend
  chart. Averages and regressions still use played games only — an absence is not
  a zero.

### Open
- [ ] **Kicker fantasy points are ~0** — nflverse's `fantasy_points_ppr` doesn't
  include kicking scoring, so `ppr_per_game` for kickers is near zero and they
  are effectively unrankable in any cross-position VOR calculation. The UI now
  hides and explains this rather than showing zeros, but the underlying data is
  still missing. Fix: compute kicker points ourselves from the distance buckets
  nflverse does provide (`fg_made_0_19` ... `fg_made_60_`, `pat_made`) using
  standard scoring (3 pts under 40, 4 for 40-49, 5 for 50+, 1 per XP). Needs new
  columns on `player_weekly_stats` plus a migration, so it's a small feature
  rather than a patch.
- [ ] **Team defense stats entirely absent** — nflverse models defenses as teams,
  not players, so DST has no gsis_id and no stats of any kind. Would need a
  separate team-level ingest (points allowed, sacks, takeaways, defensive TDs)
  and its own table. Larger than the kicker gap; DST is labelled in the UI for
  now.
- [ ] **In-progress season in cross-position widgets** — the boom/bust (8+ games)
  and target-share (6+ games) charts are legitimately empty early in a season
  since they need a real sample. They now say why, but a "not enough of the
  season played yet" message would read better than the games-threshold wording.
- [ ] **No frontend test runner** — `positionData.ts` and the season-selection
  logic in `useAnalyticsData` are pure functions worth unit testing, but the
  project has no Vitest setup. Backend has 198 tests; frontend has none.

---

## Code Health

### Frontend lint — 31 ESLint errors (pre-existing)
`npm run lint` is red. The build and typecheck are green; this is lint only.
Breakdown:
- **13x `@typescript-eslint/no-explicit-any`** — mostly `catch (err: any)` in
  page components, plus a few Recharts callback props. Mechanical to fix: drop
  the annotation and narrow with `err instanceof Error ? err.message : String(err)`.
- **~10x `react-hooks` compiler errors** — "Calling setState synchronously
  within an effect", "Cannot access variable before it is declared", "Cannot
  call impure function during render". These come from the new compiler-aware
  rules in eslint-plugin-react-hooks v7 and need actual effect restructuring,
  not annotation changes. Do these deliberately, one page at a time.
- **6x `react-refresh/only-export-components`** — context files exporting both a
  provider component and a hook. Fix by splitting hooks into their own modules.
- **1x `no-empty`**, **4 `exhaustive-deps` warnings**.

Lint is deliberately not in CI until these are resolved — a permanently red
check gets ignored, and a `continue-on-error` check is worse than none.

- [ ] **Add the lint job once the count is zero.** Until then anyone who
  clones the repo and runs `npm run lint` sees 31 errors, which reads worse
  than the code is. This is the only one of the three CI checks missing.

### Frontend bundle — one 1.03 MB chunk
`npm run build` emits a single `index-*.js` of ~1,036 kB (~302 kB gzipped) and
Vite warns about it every build. Recharts and @dnd-kit are the weight, and
neither is needed on the login screen. Route-level `React.lazy` on the four
heavy pages (Analytics, Draft room, Rankings, Assistant) is the cheap version;
`build.rollupOptions.output.manualChunks` splitting the vendor libs is the
thorough one. Matters most on the first visit over a phone connection, which
is exactly the visit a portfolio link gets.

### Test suite
- [x] **Order-dependent test fixed** — `conftest.client` shared one
  `expire_on_commit=False` session across every request in a test, so a
  committed DELETE could still appear in a later GET via the identity map.
  `TestBots::test_remove_bot` passed or failed purely on suite ordering. Each
  request now gets its own session, matching production.
- [ ] **WebSocket integration tests** — the draft room has no end-to-end test
  covering connect / pick / timer / broadcast.
- [ ] **AI assistant tests** — partly covered: `test_assistant_tools.py` tests
  `get_stat_leaders` and the data-coverage helpers. Still untested:
  `compare_players`, `get_player_profile`, and the agentic loop in
  `assistant_service.py`, which needs a stubbed client.

### Analytics metrics
- [x] **`td_rate` was a duplicate of `tds_per_game` under a misleading name** —
  `ingest_stats.py` computed both as `div(total_tds, gp)`, so they were the same
  number in every row while the name promised a rate per opportunity. It was
  never a visible column (no column def referenced it, and it wasn't in the
  assistant's `_PROFILE_FIELDS`), but it *was* in the analytics sort whitelist
  and in `assistant_tools.METRICS` as "touchdown rate", which put it in the
  `get_stat_leaders` tool enum — so "who has the best TD rate?" was silently
  answered with TDs per game. Dropped whole: migration `c4a92f1db730` plus the
  model, schema, TS type, sort whitelist, `METRICS` entry and the ingester line.
  Nothing was lost — `tds_per_game` carries the same number under the right name.

### Open
- [ ] **A real TD efficiency metric** — the thing `td_rate` pretended to be:
  TDs per opportunity, with a position-dependent denominator (pass TDs per
  attempt for QBs, TDs per touch for RBs, TDs per target for WR/TE). All the
  inputs already exist on `player_seasons`. Wants explicitly named columns
  (`pass_td_rate` / `td_per_touch` / `td_per_target`) rather than one
  overloaded `td_rate`, because `get_stat_leaders` can be called without a
  position filter and a single column would rank QB TDs/attempt against RB
  TDs/touch. Needs a migration, a derived-stats re-run, and a decision about
  whether the columns become visible on the analytics table.

---

## UI / UX Polish
- [ ] Row height alignment between custom list and source list on Rankings page
- [ ] **Responsive layouts (mobile/tablet)** — the app is desktop-only today:
  17 breakpoint utilities (`sm:`/`md:`/`lg:`) in the entire `src/` tree, and
  three layouts with hard minimum widths:
  - `pages/AnalyticsPage.tsx` — the rankings table is `min-w-[1400px]`, so the
    flagship page horizontally scrolls even on a 13" laptop.
  - `components/draft/DraftBoard.tsx` and `pages/LobbyPage.tsx` — inline
    `minWidth: max(columns * 120, 600)px`.
  - The lobby's three-column shell (`w-72` sidebars) and the draft room's
    resizable bottom panel both assume a wide viewport.
  Worth weighing: recruiters open a portfolio link on a phone as often as not,
  and this is the first impression. The tables genuinely need horizontal
  scroll — the honest fix is a scroll container with a sticky first column,
  not a reflow — but the shells around them should stack.
- [ ] **No `ErrorBoundary` anywhere** — one render-time exception blanks the
  page with no message and no way back. A single boundary at the router level,
  with a "something broke, reload" panel, is most of the value.
- [ ] Error handling + toast notifications
  - [x] **API errors no longer render as `[object Object]`.** `apiFetch` threw
    `new Error(body.detail)`, but on a 422 FastAPI sends `detail` as a *list of
    objects*, which stringifies to exactly that — so every rejected password
    showed it. `formatApiError` in `api/client.ts` now normalises both shapes.
    The backend's own `field_validator`s already wrote good sentences; the
    catch is that `Field(min_length=...)` fires *before* them, so pydantic's
    robotic phrasing is what a user hits first and it needs handling too.
  - [ ] **`AnalyticsPage` swallows fetch errors silently** —
    `.catch(() => setRawData([]))` renders a failed request as an empty table,
    so "no data loaded" and "the request failed" look identical. This is the
    highest-value item here: it costs real time to diagnose from the UI alone.
    `RankingsPage` and `DraftResultsPage` have no error handling at all.
- [ ] Loading states and skeleton screens

---

## Draft / CPU Logic
- [x] **Smarter CPU positional drafting** — CPUs currently pick best available by rank regardless of position. They should respect roster needs (e.g. don't draft 8 WRs). Should factor in `position_slots` config, track what positions the CPU team already has, and prioritize unfilled starting slots before bench picks. All major fantasy platforms (ESPN, Sleeper, Yahoo) do this.
- [x] **CPU draft variance** — add slight randomization so not all CPUs draft identically from the same source list (e.g. pick from top 3 available instead of always #1). Done: `pick_with_variance` in `app/services/draft_service.py` makes a weighted random choice among the top eligible candidates.

## League Settings
- [x] Team count selector (6/8/10/12/14)
- [x] Pick timer selector (30s/60s/2min/5min/no timer)
- [x] Position slot configuration (QB/RB/WR/TE/FLEX/K/DST/BN counts)
- [x] CPU ranking source selector (ESPN/Sleeper)
- [ ] Scoring type selector (PPR/Half-PPR/Standard)
- [x] League name editing in settings panel

---

## Player Stats & Analytics (Phase 2)

This is the foundation for all advanced features — AI analysis, graphs, projections, and the third tab in the draft room bottom panel. The strategy is broken into four parts.

### Part 1: Player Identity Resolution (the hard problem)

Matching players across data sources by name is fragile. Different sources use different formatting ("Travis Kelce" vs "T.Kelce", "Patrick Mahomes II" vs "Patrick Mahomes", punctuation in D.J. Moore vs DJ Moore, etc.). Typos, suffix inconsistencies (Jr. vs Jr), and traded players changing teams make name+team+position matching unreliable.

**Solution: External ID mapping.** The nflverse dataset (which nfl_data_py pulls from) provides a roster table that includes multiple external IDs for every player:
- `gsis_id` — the NFL's official Game Statistics & Information System ID (the closest thing to a universal NFL player ID)
- `espn_id` — ESPN's internal player ID
- `sleeper_player_id` — Sleeper's player ID
- `yahoo_id`, `pfr_id` (Pro Football Reference), `rotowire_id`, etc.

**The plan:**
- Add an `external_ids` JSONB column (or individual columns) to our existing `Player` model to store these IDs
- When we ingest player stats from nfl_data_py, we match to our Player rows using `gsis_id` — it's a guaranteed unique identifier, no fuzzy matching needed
- When we ingest rankings from ESPN, we can match on `espn_id` instead of name. Same for Sleeper rankings using `sleeper_player_id`
- This completely eliminates the name-matching problem. Two sources never need to agree on how to spell a name — they just need to refer to the same ID
- As a one-time bootstrap step, we ingest the nflverse roster table to populate our Player rows with all their external IDs. After that, every future data source can link cleanly via ID

**Fallback for edge cases:** For any source that doesn't provide a known ID, we can use fuzzy matching (normalized lowercase name + position + team) as a last resort, but this should be rare.

### Part 2: Data Source — nfl_data_py

`nfl_data_py` is a Python package that wraps the nflverse public dataset. It's free, requires no API keys, and is the same data that powers most serious NFL analytics communities. It's updated regularly throughout the season.

**Available data we plan to ingest:**

**Seasonal stats** (per player per year):
- Passing: attempts, completions, yards, TDs, INTs, comp%, passer rating, sacks taken, air yards
- Rushing: carries, yards, TDs, yards per carry, fumbles
- Receiving: targets, receptions, yards, TDs, catch%, yards after catch, air yards, target share
- Fantasy: total fantasy points (PPR, half-PPR, standard), points per game, position rank
- Usage: snap count, snap percentage, red zone targets/carries, two-minute drill usage
- Efficiency: yards per route run, breakaway run rate, contested catch rate (where available)

**Roster/bio data** (per player):
- Height, weight, age, college, draft round, draft pick number, years of experience
- Combine measurables: 40-yard dash, bench press, vertical jump, broad jump, 3-cone, shuttle

**Weekly game logs** (per player per week per year):
- Same counting stats as seasonal but broken out per game
- Opponent, home/away, game result
- Enables "how did he do vs. this defense?" and "what's his recent trend?" analysis

**Advanced/Next Gen Stats** (where available, ~2018+):
- QB: air yards, time to throw, aggressiveness, expected completion %
- WR/TE: separation, cushion, target share, yards after catch over expected
- RB: rush yards over expected, stacked box rate, efficiency metrics

**Data volume estimates:**
- Seasonal: ~300 relevant players × 5 seasons = ~1,500 rows (tiny)
- Weekly: ~300 players × 17 weeks × 5 seasons = ~25,500 rows (still small)
- Bio/roster: ~300 rows
- Play-by-play (future/optional): ~50K plays per season — big but manageable if needed later for AI

### Part 3: Database Schema Design

Using "wide tables" — one row has many columns for all stat categories, with NULLs for position-irrelevant stats. This is better than a normalized key-value approach (like a generic `stat_name`/`stat_value` table) because:
- Queries are simple SELECTs, not pivot/aggregation nightmares
- Columns have proper types (integer, float) instead of everything being a string
- Charting and AI features can directly query columns without transformation
- The column count is manageable (~40-50 stats per table)

**Planned tables:**

`player_bio` — one row per player
- height_inches, weight_lbs, college, draft_year, draft_round, draft_pick
- forty_yard_dash, bench_press, vertical_jump, broad_jump, three_cone, shuttle
- birth_date, years_exp, headshot_url

`player_seasons` — one row per player per season
- season (year), games_played, games_started
- pass_attempts, pass_completions, pass_yards, pass_tds, interceptions, sacks, passer_rating
- rush_attempts, rush_yards, rush_tds, fumbles, yards_per_carry
- targets, receptions, rec_yards, rec_tds, catch_pct, yards_after_catch
- snap_count, snap_pct, fantasy_points_ppr, fantasy_points_half, fantasy_points_std
- position_rank_ppr (their finish that year among their position)

`player_weekly_stats` — one row per player per game
- season, week, opponent, home_away, team_score, opp_score
- Same stat columns as player_seasons but for that single game
- Enables trend charts, matchup analysis, consistency metrics

The Player model gets updated with:
- `gsis_id`, `espn_id`, `sleeper_id` (for cross-source linking)
- FK relationships to the new tables

### Part 4: Presentation — Player Card UI

When a user clicks any player name (in rankings, draft board, available players list), a slide-out panel or modal appears.

**Player card layout concept:**
- **Header:** Player name, team, position, jersey number, age, experience, draft pedigree
- **Season selector:** Dropdown or tabs to switch between years
- **Key stats grid:** 4-6 headline numbers for that position (e.g., for a WR: targets, receptions, yards, TDs, catch%, YAC)
- **Season-by-season table:** Compact table showing career progression — user can scan multiple years at a glance
- **Trend sparklines:** Small inline charts next to key stats showing trajectory over recent seasons (trending up/down/flat)
- **Radar/spider chart:** Visual comparison to position average (volume vs efficiency vs touchdown production vs usage)
- **Weekly breakdown (expandable):** Game log table for the selected season, sortable by week or by stat

**Later additions (for AI/analytics tab):**
- Player comparison tool (overlay two players' radar charts)
- Projection models using historical trends
- "Similar players" analysis (find historical comps based on stat profiles)
- Strength of schedule analysis using weekly matchup data
- Consistency score (high floor vs boom/bust visualization)

### Implementation Order

- [x] **Step 1:** Add `nflreadpy` to requirements, write roster ingestion script (populates external IDs, creates missing players — 278 matched, 2,938 created)
- [x] **Step 2:** Create Alembic migrations for `player_bio`, `player_seasons`, `player_weekly_stats` tables and external ID columns on `Player`
- [x] **Step 3:** Write weekly stats ingestion script (29,410 game logs from nflreadpy)
- [x] **Step 4:** Write bio/combine ingestion script (3,215 player bios with combine measurables)
- [x] **Step 5:** Write seasonal stats aggregation + snap counts merge (3,081 season rows, snap counts from nflverse)
- [x] **Step 6:** Create API endpoints: `GET /api/players/{id}/stats`, `GET /api/players/{id}/bio`, `GET /api/players/{id}/weekly?season=2024`
- [x] **Step 7:** Build player card modal component on frontend
- [x] **Step 8:** Wire player card into rankings page, draft board, and available players list
- [x] **Step 9:** Add charts/visualizations (sparklines, radar chart)
- [x] **Step 10:** Refactor rankings ingestion (ESPN, Sleeper) to match on external IDs instead of name (+ one-time `rankings_ingester.dedup` cleanup for existing duplicate Player rows)

---

## Features Backlog
- [ ] AI/stats analysis layer (Phase 2 — depends on player stats ingestion above)
- [ ] Additional ranking sources (FantasyPros, Yahoo, etc.)
- [ ] Scheduled auto-ingestion of rankings (cron or Cloud Scheduler)
