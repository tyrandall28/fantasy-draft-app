# Deploying to GCP

The app itself: one Cloud Run service, one Cloud SQL instance. The daily data
job is a separate piece with its own page — see
[`scheduled-refresh.md`](scheduled-refresh.md), which shares this image.

**No GCP resource here exists yet.** This is the plan and the exact commands.

Placeholders: `PROJECT_ID`, `REGION` (e.g. `us-central1`), `INSTANCE` (the
Cloud SQL instance name), `REPO` (Artifact Registry repo).

---

## One service, not two

The API serves the built frontend from `/`. That isn't a style preference — the
frontend already assumed it:

- `frontend/src/api/client.ts` uses `BASE_URL = ""`, i.e. relative URLs
- `frontend/src/context/DraftContext.tsx` builds the WebSocket URL from
  `window.location.host`

So same-origin means **CORS never applies in production** and `/ws` needs no
separate routing. `APP_CORS_ORIGINS` stays unset. Two services would need a
load balancer in front, real CORS configuration, and an edit to the WebSocket
URL — for no benefit at this size.

```
                    ┌─────────────────────────────┐
  browser ─────────>│  Cloud Run: fantasy-draft   │
                    │                             │
                    │  /            → static SPA  │
                    │  /api/*       → FastAPI     │
                    │  /ws/draft/*  → WebSocket   │
                    │  /healthz     → liveness    │
                    └──────────────┬──────────────┘
                                   │ Cloud SQL socket
                                   v
                    ┌─────────────────────────────┐
                    │  Cloud SQL: Postgres 17     │
                    └─────────────────────────────┘
```

---

## 1. Build and push

Build context is the **repo root**, because the Dockerfile builds both halves:

```bash
docker build -f backend/Dockerfile \
  -t REGION-docker.pkg.dev/PROJECT_ID/REPO/backend:latest .

docker push REGION-docker.pkg.dev/PROJECT_ID/REPO/backend:latest
```

The root `.dockerignore` is load-bearing. Without it, `COPY . .` puts
`backend/.env` — holding a real `APP_ANTHROPIC_API_KEY` — into an image layer
where anyone who can pull the image can read it back, and adds 293 MB of
Windows-built venv that can't execute on Linux. If you ever move the
Dockerfile or change the context, re-check that `backend/.env` is still
excluded.

---

## 2. Secrets

`app/config.py` **refuses to start** when `APP_ENVIRONMENT=production` while
`APP_SECRET_KEY` or `APP_DATABASE_URL` are still at their published dev
defaults. That's deliberate: a warning in a log nobody reads is how an
insecure deploy stays up for months. Don't work around it — set them.

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))" \
  | gcloud secrets create app-secret-key --data-file=-

# postgresql+asyncpg://USER:PASSWORD@/fantasy_draft?host=/cloudsql/PROJECT_ID:REGION:INSTANCE
printf '%s' "$DB_URL" | gcloud secrets create app-database-url --data-file=-
```

Note the URL form: over the Cloud SQL socket the host is a *path*, not an
address. Rotating `APP_SECRET_KEY` invalidates every issued JWT, so everyone
gets logged out — fine, but do it knowingly.

---

## 3. Deploy the service

```bash
gcloud run deploy fantasy-draft \
  --region=REGION \
  --image=REGION-docker.pkg.dev/PROJECT_ID/REPO/backend:latest \
  --add-cloudsql-instances=PROJECT_ID:REGION:INSTANCE \
  --set-secrets=APP_DATABASE_URL=app-database-url:latest,APP_SECRET_KEY=app-secret-key:latest \
  --set-env-vars=APP_ENVIRONMENT=production,APP_ASSISTANT_ENABLED=false \
  --max-instances=1 \
  --min-instances=0 \
  --timeout=3600 \
  --allow-unauthenticated
```

| Flag | Why |
| --- | --- |
| `--max-instances=1` | **The important one.** See below. |
| `--set-env-vars` | `APP_ASSISTANT_ENABLED=false` holds the AI feature. `APP_ANTHROPIC_API_KEY` is deliberately *not* set here. |
| `--timeout=3600` | Cloud Run's default request timeout is 5 minutes, and a WebSocket counts as one long request — a draft would drop every 5 minutes. One hour is the maximum. |
| `--min-instances=0` | Scale to zero when nobody's using it, so it costs nothing idle. The tradeoff is a cold start (a few seconds) on the first request. |
| `--allow-unauthenticated` | Refers to *Google* IAM, not your app. Your login still applies; this just means the public internet may reach the service at all. |

`PORT` is injected by Cloud Run and the container honours it. Point the startup
probe at `/healthz`, which deliberately does not query the database — a probe
that touches Cloud SQL turns a brief database blip into a restart loop.

### Why `--max-instances=1` is not optional

`DraftRoomManager` (`backend/app/ws/draft_room.py`) keeps live draft rooms in a
**process-local dict**. Two instances means two separate dicts:

```
  user A ──> instance 1 ──> room {picks, timer}     A and B are in the
  user B ──> instance 2 ──> room {picks, timer}     same draft and cannot
                                                    see each other
```

Nothing errors. Both clients stay connected, the timers run independently, and
each sees only their own picks — the hardest kind of bug to diagnose from a
user report. One instance removes the possibility entirely, and is ample here.

The real fix is shared state (Redis pub/sub) or sticky routing by league id.
Both are deferred until the draft board rework, since that code is being
rewritten anyway. Until then, **if you ever raise `--max-instances`, the draft
breaks silently.** That's the tradeoff, written down.

---

## 4. Migrations

The service does not migrate on startup, on purpose: with several instances
booting at once they'd race, and a failed migration inside a container start
looks like a crash loop. Run it as a one-off job against the same image:

```bash
gcloud run jobs create migrate \
  --region=REGION \
  --image=REGION-docker.pkg.dev/PROJECT_ID/REPO/backend:latest \
  --command=python --args=-m,alembic,upgrade,head \
  --add-cloudsql-instances=PROJECT_ID:REGION:INSTANCE \
  --set-secrets=APP_DATABASE_URL=app-database-url:latest,APP_SECRET_KEY=app-secret-key:latest \
  --set-env-vars=APP_ENVIRONMENT=production

gcloud run jobs execute migrate --region=REGION --wait
```

Then populate the data once, before anyone uses the app — the `refresh-data`
job from [`scheduled-refresh.md`](scheduled-refresh.md) with `--first-time`
instead of its usual args.

---

## 5. Before you tell anyone the URL

- [ ] `python -m alembic upgrade head` has run against Cloud SQL
- [ ] Data loaded (`--first-time`), and `scripts.doctor` is clean
- [ ] Register an account on the live site and make a ranking — end to end
- [ ] Ask AI shows the "coming soon" page and no input box
- [ ] Cloud SQL automated backups on, with a retention window you've chosen
- [ ] The daily refresh job exists and has been run once by hand
- [ ] A log-based alert on refresh failure (the highest-value item in
      `scheduled-refresh.md` — a failed refresh shows confident stale numbers,
      not an error)

Cloud Run terminates TLS and redirects HTTP to HTTPS on its own `.run.app`
domain, so the `TODO.md` "HTTPS enforcement" item is satisfied by default
there. It needs revisiting only if you map a custom domain.

---

## Known limits of this deploy

Not blockers at this size, but know them:

- **One instance** — the draft-room constraint above. No horizontal scaling.
- **Tokens live in `localStorage`** (`TODO.md`), so an XSS bug is a token
  theft. Moving to HttpOnly cookies is a backend + frontend change.
- **The WebSocket JWT travels in the query string**, which is the one place it
  gets written to an access log. Browsers can't set headers on a WebSocket
  handshake, so fixing it needs a ticket-style exchange.
- **Rate limiting is per-instance and in-memory**, which is exact at one
  instance and would need a shared store beyond that.
- **No refresh-token rotation** and no server-side logout, so a stolen refresh
  token is good until it expires.
