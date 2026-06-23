# AI Natural-Language Query Feature — Design & Plan

> Status: **Planning / not yet started.** This is a design doc capturing a brainstorm so we can pick it back up later. No code has been written for this feature yet.
> Last updated: 2026-06-22.

## 1. The Goal

Let users get information out of the database by asking in plain English, instead of
clicking through fixed analytics widgets. Examples we want to support:

- *"Who led in touchdowns scored in 2024 for wide receivers?"*
- *"How does Josh Jacobs compare to Kenneth Walker?"*

The long-term vision (from the original concept doc's "future items" and the analytics
plan): a stats chatbot / Bloomberg-terminal-style insight engine. The **ultimate**
version is "ask anything about the data and the AI delivers a strong, custom insight."

We start simple — get good data out via NL queries to **prove the usefulness and see how
far it can go** — then build up.

## 2. Why This Is Feasible (and well-suited to our app)

- **Our data is already clean and pre-aggregated.** `PlayerDerivedStats`, `PlayerSeason`,
  and `PlayerWeeklyStat` mean most questions are a single indexed query, not a complex join.
- **Both example questions already map to code we have.** "Leaders" ≈ the existing
  `/api/analytics/position-rankings` endpoint; "compare" ≈ the existing compare/radar logic.
  The NL layer is mostly *routing*, not new analytics.
- **Greenfield on the AI side.** There is currently **no LLM integration** in the app — no
  Anthropic SDK, no API key in config. We add the `anthropic` Python SDK, a key, and one
  new endpoint. Nothing to retrofit.

## 3. The Core Design Decision: How NL Becomes a Query

| Approach | How it works | Accuracy | Safety | Flexibility | Verdict |
|---|---|---|---|---|---|
| **A. Tool / function calling** ⭐ | Claude picks from a fixed set of typed query functions and fills in structured args. **Our code runs the SQL.** | **High** — numbers come from real deterministic queries, never the LLM | **High** — no arbitrary SQL, params validated | Bounded to defined tools (~80–90% of real questions) | **Chosen for MVP** |
| **B. Text-to-SQL** | Claude generates raw SQL from the schema; we execute it. | Medium — risk of hallucinated columns/joins | Lower — needs read-only role, statement timeout, row caps, injection guards | Unlimited | **Phase 3 ("ultimate")** |
| ~~C. RAG / vector search~~ | — | Wrong tool: our data is structured numbers, not documents. | | | **Dismissed** |

### Why tool calling for the MVP
The deciding factor is **accuracy**, which matters more than anything for this app (the
project has always insisted player data cannot be wrong; this session was spent fixing
data-integrity bugs). With tool calling, **the LLM never produces a number** — it only
decides *which query to run and with what parameters*. Every stat in the answer comes
straight from the DB. That's the difference between a guaranteed-correct "Josh Jacobs had
12 TDs" and a plausibly-hallucinated one.

Text-to-SQL is the better *eventual* answer for arbitrary power-user questions, and it maps
cleanly onto the "paid tier custom query builder" idea already in the analytics plan — so
it's Phase 3, not the MVP.

## 4. Recommended Architecture (tool-calling)

```
User types question  ─▶  POST /api/assistant/query (FastAPI)
                              │
                              ▼
                    Claude (anthropic SDK) with 3–4 tool definitions
                              │  picks tool + structured args
                              ▼
              Our code runs a parameterized SQLAlchemy query
              (reusing the existing analytics service layer)
                              │  returns JSON rows
                              ▼
              Claude composes the natural-language answer
                              │
                              ▼
        Backend returns { answer_text, structured_data }  ─▶  Frontend
              (render the prose AND reuse existing Recharts widgets)
```

- Use the Anthropic Python SDK's **tool runner** (`@beta_tool` + `client.beta.messages.tool_runner`)
  — it handles the call → execute function → feed result back → repeat loop automatically.
  We write the query functions; it orchestrates.
- Because each tool returns **structured rows** that we also pass to the frontend, answers
  can be **prose + a real chart/table** using analytics components we've already built —
  not just a wall of text.

### Starter toolset (3 tools cover both example questions on day one)
- `get_stat_leaders(position, metric, season, limit, min_games)` → "who led in TDs 2024 WR" (wraps `position-rankings`)
- `compare_players(player_names[], metrics[], seasons[])` → "Josh Jacobs vs Kenneth Walker"
- `get_player_profile(player_name, seasons[])` → single-player deep dives

## 5. What It Takes — the 3 real sub-problems

1. **Entity resolution** — "josh jacobs" → `player_id`. Reuse `normalize_name()` from
   `rankings_ingester/dedup.py`. **The hard case is the name-collision bug we hit this
   session** (two Steve Smiths, three Mike Williamses). Strategy: resolve to candidates;
   if ambiguous, return them to Claude to disambiguate by team/recency or ask the user.
   Bounded problem, not a blocker.
2. **Metric / synonym mapping** — "touchdowns" / "scores" / "TDs" → `total_tds`. The LLM
   handles synonyms naturally, but **constrain the `metric` arg to an enum** of real columns
   (we already have `VALID_SORT_FIELDS` in `app/api/analytics.py`) so it can never request a
   nonexistent column.
3. **Plumbing** — new endpoint; API key in config; chat UI box; optional streaming; rate
   limiting + per-user cost guard. A tight system prompt: *"only state values returned by
   tools; if a tool returns nothing, say so — never estimate."*

## 6. Pros / Cons

**Pros:** major UX differentiator; leverages rich data already ingested; aligns with the
roadmap (stats chatbot was "future item #1"); accuracy stays deterministic with tool calling.

**Cons / things to budget for:**
- **Cost & latency** — each question = 1–3 LLM round trips, ~2–5s, a few cents. Wire in
  **prompt caching** on the (stable) tool definitions + system prompt early (~90% input cost
  cut). Streaming hides latency.
- **Trust** — even with correct numbers, prose can over-claim. Mitigate with the strict
  system prompt above + a small eval set (~20 known Q&A pairs).
- **Model choice is a real cost lever** (see §8).

## 7. Phasing (agreed)

- **Phase 1 — Plain NL queries (the immediate goal).** 3 tools, one endpoint, text answer.
  Handles both example questions. Purpose: prove usefulness and explore how far it can go.
- **Phase 1B — Draft-aware ("holy grail" of phase 1).** Same NL interface, but the assistant
  knows draft state — who's been picked, your roster needs — enabling questions like
  *"who's the best WR still on the board for my team?"* Adds context-plumbing from the live
  draft into the prompt/tools. Deferred slightly so Phase 1 can ship and be evaluated first.
- **Phase 2 — Richer UX.** Streaming responses; render structured widgets (reuse Recharts)
  instead of plain text; more tools (weekly trends, boom/bust, etc.).
- **Phase 3 — The "ultimate" feature.** Guarded read-only **text-to-SQL** so users can ask
  about *anything* and the AI gives it a strong go at custom insights. This is the paid /
  power-user "custom query builder" tier. Requires: read-only DB role, statement timeout,
  row caps, and injection guards.

## 8. Tech Notes (accurate as of 2026-06)

- **SDK:** `anthropic` Python SDK. Use the beta tool runner (`@beta_tool`,
  `client.beta.messages.tool_runner`).
- **Models (default + cost levers):**
  - `claude-opus-4-8` — most capable; the recommended default to prototype on for quality.
  - `claude-sonnet-4-6` — strong, cheaper.
  - `claude-haiku-4-5` — fastest/cheapest; often plenty for structured tool-routing.
  - Decision: prototype on Opus 4.8 for quality, then **benchmark Haiku/Sonnet** to see if
    they hold up for routing. Downgrading for cost is a deliberate product decision.
- **Hosting:** We have GCP credits. Claude is available on **Vertex AI**, which supports
  **Claude API + tool use** (what we need). Note: Vertex AI does *not* support Managed Agents
  or server-side tools — irrelevant for this design.
- **Prompt caching:** Put stable content (system prompt, tool definitions) first and cache it;
  keep the volatile user question last. Verify with `usage.cache_read_input_tokens`.
- **Thinking (Opus 4.8):** adaptive only — `thinking={"type": "adaptive"}`; `budget_tokens`
  and `temperature`/`top_p`/`top_k` are removed (400 if sent).

## 9. Open Decisions (to settle when we start building)

1. **v1 surface** — dedicated chat page vs. embedded in the existing bottom analytics panel.
2. **Conversational vs one-shot** — support follow-ups ("…and in 2023?"), which means keeping
   conversation history, or treat each question independently.
3. **Cost posture** — confirmed: prototype on Opus 4.8, then benchmark cheaper models.
4. **Auth / rate limiting / cost caps** — per-user quotas before this is exposed broadly.

## 10. Relevant Existing Code to Reuse

- `app/api/analytics.py` — `position-rankings` endpoint + `VALID_SORT_FIELDS` (metric enum source).
- `app/models/player.py` — `PlayerDerivedStats`, `PlayerSeason`, `PlayerWeeklyStat`, `Player`.
- `rankings_ingester/dedup.py` — `normalize_name()` for entity resolution.
- `frontend/src/components/analytics/*` — existing Recharts widgets to render structured results.
