# TODO — Fantasy Draft App

## Auth & Security (Pre-Launch)

### Critical
- [ ] **Secret key via env var only** — remove default `"dev-secret-change-in-production"` from `config.py`, require `APP_SECRET_KEY` env var
- [ ] **Migrate tokens to HttpOnly cookies** — localStorage is vulnerable to XSS; requires backend + frontend refactor
- [ ] **DB credentials via env var only** — remove default connection string from `config.py`
- [ ] **Password validation** — enforce minimum length (8+), complexity rules on register

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
- [ ] **Automated DB backups** — Cloud SQL handles this on GCP, configure retention
- [ ] **Lock down Alembic migrations** — no more drop/recreate once real users exist
- [ ] **Environment-based config** — dev vs staging vs prod settings

---

## UI / UX Polish
- [ ] Row height alignment between custom list and source list on Rankings page
- [ ] Responsive layouts (mobile/tablet)
- [ ] Error handling + toast notifications
- [ ] Loading states and skeleton screens

---

## Draft / CPU Logic
- [ ] **Smarter CPU positional drafting** — CPUs currently pick best available by rank regardless of position. They should respect roster needs (e.g. don't draft 8 WRs). Should factor in `position_slots` config, track what positions the CPU team already has, and prioritize unfilled starting slots before bench picks. All major fantasy platforms (ESPN, Sleeper, Yahoo) do this.
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
- [ ] **Step 6:** Create API endpoints: `GET /api/players/{id}/stats`, `GET /api/players/{id}/bio`, `GET /api/players/{id}/weekly?season=2024`
- [ ] **Step 7:** Build player card modal component on frontend
- [ ] **Step 8:** Wire player card into rankings page, draft board, and available players list
- [ ] **Step 9:** Add charts/visualizations (sparklines, radar chart)
- [ ] **Step 10:** Refactor rankings ingestion (ESPN, Sleeper) to match on external IDs instead of name

---

## Features Backlog
- [ ] AI/stats analysis layer (Phase 2 — depends on player stats ingestion above)
- [ ] Additional ranking sources (FantasyPros, Yahoo, etc.)
- [ ] Scheduled auto-ingestion of rankings (cron or Cloud Scheduler)
