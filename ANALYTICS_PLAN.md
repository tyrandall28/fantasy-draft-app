# Analytics Feature Plan

> Temporary planning document. Once features are implemented and documented in README.md, this file can be deleted.

## Overview

Two tiers of analytics features built on top of existing per-week player stat data (player_weekly_stats, player_seasons tables).

---

## Free Tier — Pre-built Widgets

These are server-computed, cached, and displayed in the draft page bottom panel analytics tab and/or a dedicated analytics page.

### 1. Position Rankings Table

**What it is:** A sortable table of players within a position group, ranked by any derived stat metric.

**Example view:** All RBs sorted by PPR points per game in 2025.

**How it works:**
- Query `player_seasons` for the selected position and season
- Compute per-game rates: `stat_value / games_played`
- Available sort columns: PPR/game, yards/game, TDs, catch rate (receptions/targets), yards/carry (rush_yards/rush_attempts), yards/target (rec_yards/targets)
- Include all players with >= 3 games played (low threshold so injured players aren't hidden)
- Players with < 8 games get a **"small sample" indicator** — a subtle badge or muted row color (e.g., italic text + "(5g)" label) so users understand the per-game rates may be inflated
- This way a player who scored 25 PPR/game over 5 games before injury still appears at the top, but the user sees the caveat immediately

**Formula examples:**
- PPR/game = `fantasy_points_ppr / games_played`
- Yards/carry = `rush_yards / rush_attempts` (only show if rush_attempts >= 50)
- Catch rate = `receptions / targets` (only show if targets >= 20)
- TD rate = `(pass_tds + rush_tds + rec_tds) / games_played`

---

### 2. Player Comparison Radar Chart

**What it is:** Select 2-3 players and overlay their key metrics on a radar/spider chart to visually compare strengths and weaknesses.

**How it works:**
- User picks players to compare (must be same position group for meaningful comparison)
- For each player, pull their season stats and compute 5-6 key metrics
- Normalize each metric to a 0-100 scale relative to all players at that position (percentile rank)
- Plot on a radar chart where each axis is a metric

**Metrics by position:**

| Position | Axes |
|----------|------|
| QB | Pass yards/game, TD rate, INT rate (inverted — lower is better), Rush yards/game, Completion %, EPA/play |
| RB | Rush yards/game, Yards/carry, Targets/game, Catch rate, TDs/game, Snap % |
| WR | Rec yards/game, Targets/game, Yards/target, TDs/game, Target share, Catch rate |
| TE | Rec yards/game, Targets/game, Catch rate, TDs/game, Target share, Snap % |
| K | FG %, FG made/game, Long FG, XP %, Fantasy points/game |

**Normalization formula:**
- For each metric, rank the player among all players at that position who meet the minimum threshold
- Percentile = `(rank_position / total_qualifying_players) * 100`
- Inverted metrics (INT rate, fumbles) use `100 - percentile` so higher is always better on the chart

---

### 3. Season-over-Season Sparklines

**What it is:** Tiny inline trend lines displayed next to player names in the available players list and rankings, showing PPR production trajectory across the last 3-4 seasons.

**How it works:**
- For each player, pull `fantasy_points_ppr` from `player_seasons` for the last 3-4 years
- Normalize to per-game (divide by games_played) so injury-shortened seasons don't mislead
- Render as a small SVG sparkline (50x16px or similar) — just a line, no axes or labels
- Color: green if trending up (latest season > earliest), red if trending down, gray if flat (within 10%)

**Trend direction formula:**
- Compute slope of linear regression across available seasons' PPR/game values
- Positive slope > 0.5 = green (trending up)
- Negative slope < -0.5 = red (trending down)
- Otherwise = gray (flat)

---

### 4. Boom/Bust Scatter Chart

**What it is:** A scatter plot for a set of players (e.g., all available RBs) showing their weekly scoring consistency vs. their ceiling. Helps identify reliable floor players vs. high-variance boom/bust players.

**How it works:**
- Pull all `player_weekly_stats` rows for each player in the selected season
- For each player, compute two values:
  - **X-axis: Median weekly PPR** — represents their "floor" / typical week. Median is used instead of mean because it's less skewed by one monster game.
  - **Y-axis: Standard deviation of weekly PPR** — represents their variance. High stdev = boom/bust, low stdev = consistent.
- Plot each player as a dot. The chart forms four quadrants:

```
                    HIGH VARIANCE (boom/bust)
                          |
    Inconsistent &     |     Boom-or-Bust Stars
    Low-scoring           |     (high ceiling, unpredictable)
                          |
  ————————————————————————+————————————————————————
                          |
    Irrelevant            |     Reliable Studs
    (low floor, low       |     (high floor, consistent)
     ceiling)             |
                          |
                    LOW VARIANCE (consistent)
           LOW MEDIAN                HIGH MEDIAN
```

**Minimum threshold:** Only include players with >= 8 games played in the season to avoid noise.

**Additional detail:** Each dot is color-coded by position and sized by snap percentage (bigger dot = more snaps = more opportunity). Hovering shows player name and exact values.

**Why median + stdev:**
- Mean would make a player who scored 2, 2, 2, 2, 40 look like a 9.6 PPR/week player (misleading)
- Median for that player = 2 (accurate representation of a typical week)
- Stdev captures that the 40-point game makes them high variance
- This combination honestly represents both "what do I usually get?" and "how much does it swing?"

---

### 5. Snap % Trend Line

**What it is:** A line chart showing a player's offensive snap percentage week-over-week across a season. Rising snap share often predicts breakout performance; declining snap share is a red flag.

**How it works:**
- Pull `snap_pct` from `player_weekly_stats` for the selected player and season
- Plot week on X-axis, snap % on Y-axis
- Overlay a dotted trend line (linear regression) to make the direction clear
- Color the trend line green (rising), red (declining), or gray (flat) using the same slope thresholds as sparklines

**Why this matters for drafting:**
- A backup RB whose snap% went from 20% to 55% over the last 6 weeks is likely inheriting a starting role
- A WR whose snap% dropped from 90% to 60% may be losing targets to a rookie
- This is one of the most actionable "leading indicators" in fantasy — usage predicts production

---

### 6. Target Share vs. Air Yards Quadrant Chart

**What it is:** A scatter plot for WRs and TEs showing target share (X-axis) vs. air yards share (Y-axis). Identifies undervalued pass catchers who are getting deep looks but haven't converted to TDs yet.

**How it works:**
- Pull season-level `target_share` and `rec_air_yards` from `player_seasons`
- Compute air yards per game: `rec_air_yards / games_played`
- Plot target share (X) vs. air yards/game (Y) for all qualifying WR/TE (min 20 targets)

**Quadrant interpretation:**

| Quadrant | Meaning |
|----------|---------|
| High target share + high air yards | Alpha WR — primary deep threat with volume |
| High target share + low air yards | Possession/slot receiver — high floor, lower ceiling |
| Low target share + high air yards | Deep threat specialist — boom/bust, could break out with more targets |
| Low target share + low air yards | Depth player — limited fantasy relevance |

**Why this is useful:**
- Air yards represent "opportunity quality" — a WR with lots of deep targets is one good game away from a huge week
- Target share represents "opportunity volume" — how much of the passing game runs through them
- The combination identifies players whose production hasn't matched their opportunity (buy-low candidates)

---

### 7. "Who Should I Draft?" — Position Scarcity via Value Over Replacement

**What it is:** A decision-support widget that shows the user which positions to prioritize in their draft, based on how much elite players at each position beat the "replacement-level" player you'd otherwise settle for later. Lives in the no-selection state of the rankings page analytics panel (`PositionOverviewView`).

**Core concept — Value Over Replacement (VOR):**

A player's draft value isn't their raw points — it's how much they beat the worst player you'd still consider a "starter" at that position. A 20 PPG QB isn't as valuable as a 20 PPG RB if QB12 also scores 17 but RB30 scores 9. The RB gives you +11 over replacement, the QB only +3. This methodology is known as **Value-Based Drafting (VBD)** and is the foundation of serious fantasy draft theory.

**Formula:**
```
VOR(player) = player_ppr_per_game − replacement_ppg(position)
replacement_ppg(pos) = PPG of the Nth-best player at that position
```

**Default replacement thresholds (12-team standard league):**

| Position | N (replacement rank) | Rationale |
|----------|---------------------|-----------|
| QB | 12 | 1 starter × 12 teams |
| RB | 30 | 2 starters × 12 teams + ~half the FLEX slots |
| WR | 36 | 2 starters × 12 teams + ~half the FLEX + modern 3-WR trends |
| TE | 12 | 1 starter × 12 teams |
| K | 12 | 1 starter × 12 teams |
| DST | 12 | 1 starter × 12 teams |

Thresholds are parameters, not constants — a future league-aware version can compute them from `roster_slots × num_teams`.

---

#### Three widgets in PositionOverviewView

All three are derived from the position-rankings data already fetched by `useAnalyticsData` — no backend work required.

##### Widget 1: Draft Priority Board

A ranked list of positions by the VOR of their top-tier players (average VOR of the top 5 at each position). Tells the user at a glance *"RBs drop off hardest — grab them early. QBs are flat — wait."*

```
1. RB   +11.4 VOR  ████████████  ← steepest cliff
2. WR    +9.2      █████████
3. TE    +6.1      ██████
4. QB    +3.8      ████         ← flattest, wait
```

Each row: position badge, average top-5 VOR, horizontal bar (normalized to the max VOR).

##### Widget 2: Position Value Curves

A single Recharts `LineChart` with all four skill positions overlaid. X = positional rank (1 to ~36), Y = PPR/game. A dotted horizontal line marks each position's replacement level. The steepness of each line visualizes the scarcity story — steep = draft early, flat = wait.

This is the most visual piece: users see *where* the cliffs are, not just that they exist.

##### Widget 3: Tier Break Detection

Auto-detect natural tier boundaries by finding PPG drops that exceed `mean + k × stddev` of the step-to-step differences within each position (start with k = 1.0, tune by eye). Display as compact rows:

```
RB  │ T1: #1–#4  │ T2: #5–#11  │ T3: #12–#18  │ T4: #19–#30
WR  │ T1: #1–#6  │ T2: #7–#14  │ T3: #15–#24 │ ...
```

This is the most actionable piece — it tells the user *"if you miss RB5, wait until the tier 3 run because T2 is flat."*

---

#### Why this fits the rankings page

The user is building a personal ranking *before* the draft — they need to know which positions to prioritize, not who's "still available." VOR + tiers answer exactly that question without needing live draft state. The widgets live in the 0-selected state of the analytics side panel, turning the empty state into actionable pre-draft guidance.

---

#### Future extension path — live draft advisor

The key architectural insight: **VOR is stateless computation over a player pool.** The static version is literally the identity case of the dynamic version where `drafted_set = ∅`. The math doesn't change — remove drafted players from the pool, recompute, re-render. This makes the extension path essentially free if v1 is built correctly.

```
static  → VOR(p) = p.ppg − replacement_ppg(all_players)
dynamic → VOR(p) = p.ppg − replacement_ppg(all_players − drafted)
```

##### Tier 1 — Live draft updates

Subscribe to the existing WebSocket `DraftRoomManager`, maintain a `draftedIds: Set<number>`, pass `pool.filter(p => !draftedIds.has(p.id))` into the same compute functions. Draft board auto-updates on every pick. Zero new math, one new data source. The replacement threshold naturally shifts as each position gets depleted — if 20 RBs are gone, the "last starter" is now a much worse player, the cliff gets steeper, the priority board re-ranks on its own.

##### Tier 2 — Hypothetical picks

The user hovers or clicks a player and sees *"what happens if I take them?"* Clone the pool, remove the hypothetical pick, recompute, render a **delta view**:

> *"RB priority unchanged at +11.4. WR drops from +9.2 to +7.1. Your next best WR tier break is now at pick #18."*

This is just `compute(pool) → compute(pool − {hypothetical})` and a diff. Because the computation is cheap enough to run on every hover, the interaction can feel exploratory rather than prescriptive.

##### Tier 3 — Snake-draft simulation (the killer feature)

Between the user's pick #24 and pick #25 in a 12-team snake, ~22 other players will be taken. Estimate them by having each phantom team grab their current best-VOR available, with a bit of noise for realism. Now the tool can answer the *actual* draft question:

> *"If I take Garrett Wilson here, what's the RB landscape at my next pick?"*

Not "best available now" — **best available at your next turn**, which is the real decision being made. Show two panels side by side: "Take WR now" vs "Take RB now," each projecting forward to the user's next pick and showing the VOR of what'll be left:

> *"Taking WR leaves me with RB #18 at +4.1 VOR. Taking RB leaves me with WR #14 at +5.8 VOR."*

That's a decision-making tool, not an instruction. The user poses hypotheticals; the tool shows consequences. This is meaningfully different from ESPN's "draft this player next" because it respects the user's autonomy and lets them explore trade-offs rather than forcing a single answer.

---

#### v1 architecture — keeping the door open

To make Tiers 1–3 drop-in extensions, v1 follows this structure:

1. **Pure compute functions** in `src/lib/draftValue.ts`:
   - `computeVOR(pool: PlayerDerivedStats[], thresholds: Record<Position, number>)`
   - `detectTiers(sortedByPPG: PlayerDerivedStats[], sigmaK: number)`
   - `computePriorityBoard(pool, thresholds)`

   None of these know about the UI or about "drafted players" — they take a pool and return annotated data. To extend, pass a filtered pool.

2. **A hook `useDraftValueAnalysis(pool, options)`** wraps the pure functions. Later, a `useLiveDraftValue(leagueId)` can subscribe to the WS stream, maintain the drafted set, and call the same compute path with the filtered pool.

3. **PositionOverviewView renders from the hook output**, not from raw position data. When the hook later returns live-updated VORs, the view doesn't need to change.

4. **Replacement thresholds are an explicit parameter**, not hardcoded. Shape is `{QB: 12, RB: 30, ...}` so a future league-aware version can compute from `roster_slots × num_teams`.

**Effort estimate for future tiers given this foundation:** Tier 1 is roughly a half-day of work. Tier 2 is a couple hours on top of that. Tier 3 is larger because the simulation logic is new, but the VOR engine underneath is unchanged.

---

## Paid Tier — Custom Query Builder ("The Terminal")

### Concept

A structured query interface where users define custom stat views without writing SQL. The UI presents dropdowns and filters that map to a constrained set of server-side computations.

### Query Structure

Users build a query by selecting:

```
SHOW:   [metric]           → dropdown of ~30-40 pre-defined derived stats
FOR:    [position]          → QB / RB / WR / TE / K / All
OVER:   [time range]        → 2025, Last 2 seasons, Last 4 weeks, Weeks 1-8, Career
WHERE:  [minimum qualifier] → Min 50 carries, Min 30 targets, Min 8 games, etc.
SORT:   [ascending/descending]
LIMIT:  [top N]             → Top 10, Top 25, Top 50
```

### Available Metrics

**Counting stats (raw):**
- Pass yards, Pass TDs, INTs, Rush yards, Rush TDs, Receptions, Rec yards, Rec TDs, Fantasy points (PPR), Fantasy points (standard)

**Rate stats (per-game):**
- PPR/game, Pass yards/game, Rush yards/game, Rec yards/game, Targets/game, TDs/game

**Efficiency stats (per-attempt):**
- Yards/carry, Yards/target, Yards/reception, Catch rate (%), Completion % (QB), TD/attempt rate

**Advanced stats:**
- EPA/play (passing or rushing), CPOE (QB), Target share %, Snap %, Air yards/game, Yards after catch/reception

**Trend stats:**
- PPR/game change vs. prior season, Target share change vs. prior season, Snap % change last 4 weeks vs. season average

### How It Works on the Backend

1. **Pre-computed derived stats table** (`player_derived_stats`): After each ingestion run, a post-processing step computes all ~40 metrics for every player for every season and stores them in a flat table. This avoids on-the-fly aggregation.

2. **Query endpoint:** `POST /api/analytics/query` accepts the structured query parameters and translates them into a filtered/sorted SELECT on the derived stats table. This is fast — it's just WHERE + ORDER BY on pre-computed values.

3. **Time range handling:**
   - Single season: read directly from the derived table
   - Multi-season: average across seasons (weighted by games played)
   - Partial season (e.g., "last 4 weeks"): computed from `player_weekly_stats` on the fly, but bounded (max ~600 rows per player per query, realistically much less)

4. **Rate limiting:** Paid tier queries are rate-limited (e.g., 60/minute) to prevent abuse. Each query is logged for usage analytics.

### Computational Cost

- The derived stats table has ~1 row per player per season (~2,500 players * 4 seasons = ~10,000 rows). Queries on this are trivially fast.
- Partial-season queries (weekly aggregation) touch at most ~17 weeks * 500 players = 8,500 rows. Also trivially fast.
- The expensive part is the **post-ingestion computation**, but this runs once per ingestion (weekly during season), not per user request.

### Custom Metric Saves & Caching Strategy

**What gets saved:** The *query definition* (the parameters the user selected), NOT the result data. A saved query is just a JSON object like:
```json
{
  "name": "My RB Efficiency View",
  "metric": "yards_per_carry",
  "position": "RB",
  "time_range": "2024-2025",
  "min_qualifier": "carries >= 100",
  "sort": "desc",
  "limit": 25
}
```

**Why save the query, not the results:**
- Results change after each weekly ingestion — that's a feature, not a bug. When a user opens their saved "Top RBs by yards/carry" view on Tuesday after Week 12, they expect to see updated numbers that include Week 11's games.
- If we froze the result data at save time, users would see stale numbers and not know it. Worse, they'd be making draft decisions on outdated stats.
- The query re-runs against the `player_derived_stats` table each time it's opened. Since that table is pre-computed and small (~10k rows), this is fast — a few milliseconds per query.

**Cross-user caching (do we need it?):**
- The total query space is bounded: ~40 metrics * 5 positions * ~10 time ranges * ~5 qualifiers = ~10,000 possible unique queries. That's a lot of combinations, but any single query runs in < 50ms against the derived stats table. There's no real need for a shared cache layer.
- If scale ever demands it, we could add a lightweight response cache (Redis or even in-memory TTL cache) keyed by query hash, invalidated after each ingestion. But this is premature optimization — the derived stats table IS effectively the cache.

**Summary:** Saved queries are just bookmarks to a parameterized API call. Data is always fresh because it reads from the pre-computed derived stats table, which updates once per ingestion cycle. No per-user result storage, no staleness risk.

---

## Implementation Order

### Phase 1 — Foundation
1. Add `player_derived_stats` table and post-ingestion computation step
2. Build API endpoint for position rankings with sortable metrics
3. Add analytics tab to draft page bottom panel

### Phase 2 — Free Tier Widgets
4. Position rankings table (sortable, filterable)
5. Boom/bust scatter chart
6. Snap % trend line (per-player, shown in player card)
7. Season-over-season sparklines (inline in player lists)

### Phase 3 — Advanced Free Tier
8. Player comparison radar chart
9. Target share vs. air yards quadrant chart
10. "Who should I draft?" position scarcity indicator (see dedicated section below)

### Phase 4 — Paid Tier
11. Custom query builder UI
12. Query API endpoint with derived stats table
13. Saved queries / custom views
14. Rate limiting and usage tracking

---

## Decisions

- [x] **Charting library:** Recharts — simple, React-native, covers all chart types we need (scatter, radar, line, sparkline)
- [x] **Sparklines:** Client-side rendering
- [x] **Multi-season weighting:** Weighted by games played (a 17-game season counts more than a 6-game injured season)
- [x] **Position scarcity indicator:** Use Value Over Replacement (VOR / VBD) — see "Who Should I Draft?" section above. Static v1 in `PositionOverviewView`; Tier 1/2/3 extension path defined for live drafts, hypothetical picks, and snake-draft simulation.
- [x] **Analytics page:** Standalone `/analytics` page first, then embed widgets into draft bottom panel later
