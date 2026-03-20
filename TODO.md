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

## Features Backlog
- [ ] AI/stats analysis layer (Phase 2)
- [ ] Additional ranking sources (FantasyPros, Yahoo, etc.)
- [ ] Scheduled auto-ingestion of rankings (cron or Cloud Scheduler)
