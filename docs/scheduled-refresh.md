# Scheduled data refresh

How `python -m scripts.refresh_data` gets run automatically once this app is on
GCP. **Nothing here is live yet** — this is the design and the exact commands,
written to be read before it's built.

Implements the `TODO.md` item "Scheduled refresh". One change from what's
written there: **daily**, not weekly in-season. Reasoning in
[Picking the schedule](#picking-the-schedule).

---

## The shape of it

```
Cloud Scheduler  ──POST──>  Cloud Run Job  ──>  Cloud SQL
   (the clock)              (the compute)       (the data)
      │                          │
      │                          └── same container image as the API,
      │                              different command
      │
      └── cron string + timezone, nothing else
```

Three pieces, because the cloud splits what local `cron` bundles: *when* it
fires, *where* the code runs, and *how* that code is allowed to reach the
database. Cloud Scheduler is only the clock — it has no idea what your code
does. The Cloud Run Job is the part that matters.

**Why a Job and not an HTTP endpoint on the API service:** the refresh downloads
from nflverse and can run for minutes. Inside an HTTP request, a timeout leaves
a partial write — which for this data is the failure mode we least want. A Job
has a task timeout measured in hours, not request seconds, and retries built in.

**Why not GitHub Actions:** a GitHub runner is outside the GCP network. Reaching
Cloud SQL from there means either a public IP on the database or a long-lived
service-account key stored on GitHub. A Cloud Run Job already runs inside the
project with an identity attached — there is no key to leak. (Actions cron is
also UTC-only, so it drifts an hour at DST, and GitHub disables scheduled
workflows on public repos after 60 days without commits.)

---

## Prerequisites

None of this works until these exist. Listed so it's obvious what's blocking:

- [ ] Backend image pushed to Artifact Registry
- [ ] Cloud SQL Postgres instance, migrations applied (`alembic upgrade head`)
- [ ] `APP_SECRET_KEY` and `APP_DATABASE_URL` in Secret Manager
      (`app/config.py` refuses to start on the dev defaults when
      `APP_ENVIRONMENT=production` — that guard is deliberate, don't work around it)

Placeholders used below: `PROJECT_ID`, `REGION` (e.g. `us-central1`),
`INSTANCE` (the Cloud SQL instance name), `REPO` (Artifact Registry repo).

---

## 1. Two service accounts

Two, not one, because they do different jobs and should be able to do *only*
their own. This is the part worth understanding — it's most of the security of
the whole arrangement.

```bash
# The identity the refresh CODE runs as. Touches the database and secrets.
gcloud iam service-accounts create refresh-job \
  --display-name="Scheduled data refresh"

# The identity the CLOCK uses to start the job. Can start it, nothing else.
gcloud iam service-accounts create scheduler-invoker \
  --display-name="Cloud Scheduler invoker"
```

Grant each only what it needs:

```bash
# refresh-job: open a Cloud SQL connection, and read the two secrets.
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:refresh-job@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:refresh-job@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

> `secretAccessor` at project level lets it read *every* secret. Tighter, and
> what you actually want: bind the role on each individual secret instead, with
> `gcloud secrets add-iam-policy-binding app-database-url --member=... --role=...`.

The invoker's permission is granted in step 3, once the job exists to grant it
*on* — it's scoped to that one job rather than project-wide.

---

## 2. The Cloud Run Job

```bash
gcloud run jobs create refresh-data \
  --region=REGION \
  --image=REGION-docker.pkg.dev/PROJECT_ID/REPO/backend:latest \
  --command=python \
  --args=-m,scripts.refresh_data \
  --service-account=refresh-job@PROJECT_ID.iam.gserviceaccount.com \
  --set-cloudsql-instances=PROJECT_ID:REGION:INSTANCE \
  --set-secrets=APP_DATABASE_URL=app-database-url:latest,APP_SECRET_KEY=app-secret-key:latest \
  --set-env-vars=APP_ENVIRONMENT=production \
  --task-timeout=30m \
  --max-retries=1 \
  --memory=1Gi \
  --cpu=1
```

Flag by flag, since this is the whole lesson:

| Flag | What it's doing |
| --- | --- |
| `--image` | **The same image the API serves from.** `backend/Dockerfile` does `COPY . .`, so `scripts/` is already inside. No second build. |
| `--command` / `--args` | Overrides the Dockerfile's `CMD` (uvicorn) for this job only. Together they run `python -m scripts.refresh_data`. |
| `--service-account` | The identity from step 1. Omit it and you silently get the default compute SA, which is over-privileged. |
| `--set-cloudsql-instances` | Attaches the Cloud SQL socket. **This is the line that replaces the Auth Proxy** you'd need from GitHub Actions. |
| `--set-secrets` | Mounts Secret Manager values as env vars at runtime. Never bake these into the image. |
| `--task-timeout` | Hard kill after 30m. Default is 10m, which the first full stats pull may exceed. Max is 24h. |
| `--max-retries` | One retry on failure. Safe *only* because the script is idempotent — see below. |
| `--memory` | The weekly-stats step holds a dataframe; 512Mi is tight. |

> **Gotcha:** write `--args=-m,...` with the `=`. As a separate token,
> `gcloud` parses the leading `-m` as one of its own flags and fails oddly.
> `--args` is comma-delimited, which is why it's `-m,scripts.refresh_data`.

**Why `--max-retries=1` is safe here:** `scripts/refresh_data.py` is
non-destructive unless you pass `--full-refresh`, and it runs its steps in
dependency order (weekly logs → season totals → derived metrics). A re-run
re-does work rather than corrupting it. If that ever stops being true, this flag
has to go to `0`.

Test it by hand before it's ever on a schedule:

```bash
gcloud run jobs execute refresh-data --region=REGION --wait
```

`--wait` blocks and returns the task's exit code, so you find out now rather
than from a silent 10am failure.

---

## 3. The schedule

```bash
gcloud scheduler jobs create http refresh-data-daily \
  --location=REGION \
  --schedule="0 10 * * *" \
  --time-zone="America/New_York" \
  --uri="https://REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/PROJECT_ID/jobs/refresh-data:run" \
  --http-method=POST \
  --oauth-service-account-email=scheduler-invoker@PROJECT_ID.iam.gserviceaccount.com
```

And the invoker permission, scoped to this one job:

```bash
gcloud run jobs add-iam-policy-binding refresh-data \
  --region=REGION \
  --member="serviceAccount:scheduler-invoker@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

`--time-zone` is the quiet win: you write `10:00` and Google handles EST/EDT.
The `:run` URI is just the Cloud Run Admin API — Scheduler is literally making
an authenticated POST on your behalf, nothing more magical than that.

> There's a shorthand — `gcloud run jobs create ... --schedule="0 10 * * *"` —
> that creates both resources at once. It's fine, but it hides the two-piece
> structure, which is the thing worth understanding the first time.
>
> Verify the `--uri` form against current Google docs when you actually run
> this; the Cloud Run Jobs execution API has both a v1 and a v2 surface and the
> recommended one has moved before.

---

## Picking the schedule

`TODO.md` says weekly in-season. I'd make it **daily at 10:00 ET** instead.

The instinct — "after Monday Night Football the week is done" — is right about
football and wrong about cron:

- **MNF doesn't end at a fixed time.** Anywhere from ~11:15pm ET to past
  midnight, and the league does occasionally schedule Tuesday games.
- **nflverse doesn't publish the moment a game ends.** Its own pipeline lags by
  hours. A job at 00:30 Tuesday would reliably fetch a half-updated week, and
  `refresh_data` would write it without complaint.
- **Games aren't only on Monday.** Thursday, Sunday, and Saturdays late in the
  season. You said yourself there's football every 2–3 days — so daily isn't a
  fallback, it's the actual cadence.

Daily also self-heals. A failed Tuesday run just gets retried Wednesday, instead
of leaving the app stale for a week.

The cost argument is nil: a five-minute daily job on 1 vCPU is cents a month,
and Cloud Scheduler's first three jobs are free.

### Daily means a half-loaded week is the normal state

Worth being explicit, because this already bit once. Refreshing on a Friday in
week 2 loads Thursday night and nothing else: two teams have two games, thirty
have one. The analytics leaderboard clamped its games-played floor to
`max(week)`, read that as "two weeks played", and hid every player whose team
had not kicked off — 366 of 390.

Fixed in `app/services/season_coverage.py`, which is the only place that should
answer "how much of this season do we have". It counts per team, not per week,
because a bye and a game that has not started look identical in the data (no
row either way):

- `min_team_games` — games the least-played team has played. The only number a
  games-played floor may be clamped to.
- `latest_week` + `teams_in_latest_week` — the partial week, as counts rather
  than a verdict. There is no schedule table here, so a week holding 26 of 32
  teams is either a finished bye week or a Sunday in progress, and we do not
  guess.

With a daily job this is the state the app is in most days of the season, so
anything new that summarises a season should read coverage from that module
rather than reaching for `max(week)` again.

---

## Making it trustworthy

A scheduled job you don't check is worse than no job, because **this app fails
loud-looking-quiet**: a failed refresh doesn't show an error, it shows confident
stale numbers on the analytics pages.

Four things. The first two already exist:

- ✅ **Non-zero exit on failure.** `scripts/refresh_data.py:274` does
  `raise SystemExit(asyncio.run(run(args)))` and `run()` returns `1` on error.
  Without this, the platform records every run as a success.
- ✅ **Idempotent.** Covered above.
- ⬜ **An alert on failure.** In Cloud Logging, save a query like
  `resource.type="cloud_run_job" resource.labels.job_name="refresh-data" severity>=ERROR`,
  then create a log-based alerting policy on it with an email channel. Ten
  minutes of console work; the single highest-value item on this page.
- ⬜ **A "data as of" line in the UI.** The cheapest staleness detector there is,
  and the only one a human would actually notice. The row census in
  `refresh_data` already knows when it last wrote.

Overlap protection isn't needed yet — a daily job measured in minutes can't
collide with itself. It would matter if this ever went hourly.

---

## If you'd rather not hand-run commands

Everything above is one `gcloud` invocation per resource, which is good for
learning because each flag is visible. For something you'd rebuild from scratch,
the same three resources express cleanly in Terraform
(`google_cloud_run_v2_job`, `google_cloud_scheduler_job`,
`google_service_account`). Not worth it for a solo project yet — but that's the
path if the deploy ever needs to be reproducible.
