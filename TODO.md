# TODO — Fantasy Draft App

## Auth & Security (Pre-Launch)

### Critical
- [x] **Secret key / DB credentials enforced in production** — the dev defaults are
  published in a public repo, so a deploy that forgot `APP_SECRET_KEY` would have
  signed JWTs with a value anyone could read off GitHub and forge tokens with.
  Rather than removing the defaults (which would break clone-and-run), setting
  `APP_ENVIRONMENT=production` now makes startup *fail* while `APP_SECRET_KEY` or
  `APP_DATABASE_URL` are still at their defaults. A crash, not a log warning.
- [ ] **Migrate tokens to HttpOnly cookies** — localStorage is vulnerable to XSS; requires backend + frontend refactor
- [ ] **Password validation** — enforce minimum length (8+), complexity rules on register

### Critical (draft integrity)
- [ ] **Re-enable draft turn enforcement** — `app/ws/draft_room.py` has the
  "Not your turn" check commented out (`# TODO: re-enable turn enforcement after
  testing`), and the line below it reassigns `user_id = expected_user`. Any
  connected client can therefore make the pick for whoever is on the clock.
- [ ] **Check league membership on WebSocket connect** — `ws/events.py` verifies
  the JWT but never checks that the user belongs to the league, so any
  authenticated user can join any draft room and receive its broadcasts.
- [ ] **Restrict undo to the commissioner** — `handle_undo_pick` has no
  authorization check; any connected client can undo the last pick.

### High
- [ ] **Rate limiting on auth endpoints** — prevent brute force on login/register (e.g. `slowapi`)
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
- [x] **CI** — `.github/workflows/ci.yml`: backend tests, fresh-database
  migration + `alembic check` drift guard + downgrade check, frontend
  typecheck/build.
- [ ] **Automated DB backups** — Cloud SQL handles this on GCP, configure retention
- [ ] **Lock down Alembic migrations** — no more drop/recreate once real users exist
- [ ] **Environment-based config** — dev vs staging vs prod settings
- [ ] **Scheduled refresh** — Cloud Scheduler hitting `scripts.refresh_data`
  in-season, once the app is deployed. Design and exact commands in
  `docs/scheduled-refresh.md`, which argues for daily rather than weekly.
  Partial weeks are handled: `app/services/season_coverage.py` measures coverage
  per team, so a mid-week refresh no longer hides the teams that haven't played.

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

### Test suite
- [x] **Order-dependent test fixed** — `conftest.client` shared one
  `expire_on_commit=False` session across every request in a test, so a
  committed DELETE could still appear in a later GET via the identity map.
  `TestBots::test_remove_bot` passed or failed purely on suite ordering. Each
  request now gets its own session, matching production.
- [ ] **WebSocket integration tests** — the draft room has no end-to-end test
  covering connect / pick / timer / broadcast.
- [ ] **AI assistant tests** — `assistant_tools.py` and `assistant_service.py`
  have no coverage. The tool functions are pure DB queries and easy to test;
  the agentic loop needs a stubbed client.

### Analytics metrics
- [ ] **`td_rate` is a duplicate of `tds_per_game` under a misleading name** —
  `ingest_stats.py` computes both as `div(total_tds, gp)`, so they are the same
  number in every row. The name promises a rate per opportunity, and it is
  exposed as a sortable column on the analytics table *and* offered to the AI
  assistant as "touchdown rate" (`assistant_tools.METRICS`), so a question like
  "who has the best TD rate?" is silently answered with TDs per game. Either
  make it a real rate (TDs per attempt for QBs, per touch for skill positions)
  or drop the column and its `METRICS` entry — but not half of it, since both
  the sort whitelist in `api/analytics.py` and the assistant metric map have to
  agree with whatever the ingester writes.

---

## UI / UX Polish
- [ ] Row height alignment between custom list and source list on Rankings page
- [ ] Responsive layouts (mobile/tablet)
- [ ] Error handling + toast notifications
- [ ] Loading states and skeleton screens

---

## Draft / CPU Logic
- [x] **Smarter CPU positional drafting** — CPUs currently pick best available by rank regardless of position. They should respect roster needs (e.g. don't draft 8 WRs). Should factor in `position_slots` config, track what positions the CPU team already has, and prioritize unfilled starting slots before bench picks. All major fantasy platforms (ESPN, Sleeper, Yahoo) do this.
- [ ] **CPU draft variance** — add slight randomization so not all CPUs draft identically from the same source list (e.g. pick from top 3 available instead of always #1)

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
