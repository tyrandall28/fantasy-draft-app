"""Natural-language DB assistant — runs the tool-calling agentic loop.

The model routes a question to one of our typed query tools (see assistant_tools);
our code runs the deterministic SQL and feeds results back until the model produces
a final text answer. The model never invents stat values.
"""
import json
import logging

from anthropic import AsyncAnthropic
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services.assistant_tools import TOOL_FUNCS, TOOL_SCHEMAS, get_data_coverage

logger = logging.getLogger(__name__)

# Cap tool round-trips so a confused model can't loop forever.
MAX_ITERATIONS = 6

SYSTEM_PROMPT_TEMPLATE = """You are a fantasy-football data assistant for an NFL draft-prep app. \
You answer questions about NFL player statistics by calling the provided tools, which \
query a real database of historical stats.

Critical rules:
- ONLY state numbers and facts that come back from a tool call. Never estimate, guess, \
or use prior knowledge for a stat. If a tool returns no data, say so plainly.
- Always call a tool to answer a stats question — do not answer from memory.
- When a player name is ambiguous (the tool returns a note about other matches), tell \
the user which player you used and mention the alternatives.
- Map the user's everyday words to the right metric (e.g. "touchdowns" -> total_tds, \
"most points" -> fantasy_points_ppr, "most consistent" -> median_ppr).
- If a tool result includes a "note" field, honour it — it carries caveats about the \
data you must pass on to the user.

{coverage}

Style: be concise and conversational. Lead with the direct answer. Use a short list or \
a few bullet points for leaderboards/comparisons. Don't dump every field a tool returns \
— surface what's relevant to the question. Round sensibly."""


def _coverage_block(coverage: dict) -> str:
    """Render the data-coverage facts from the database.

    These were hardcoded in the prompt and went stale the moment the 2026 season
    kicked off — the prompt insisted there were no 2026 stats while the database
    held week 1. Anything the model states about coverage has to come from the
    data, same as the stats themselves.
    """
    seasons = coverage.get("seasons") or []
    if not seasons:
        return "Data coverage: the stats database is empty. Say so if asked for any statistic."

    lines = ["Data coverage (read this before answering any question about a season):"]
    years = [s["season"] for s in seasons]
    lines.append(f"- Seasons in the database: {min(years)} through {max(years)}.")

    latest_complete = coverage.get("latest_complete_season")
    if latest_complete:
        lines.append(f"- Most recent COMPLETED season: {latest_complete}.")

    in_progress = coverage.get("in_progress")
    if in_progress:
        lines.append(
            f"- The {in_progress['season']} season is IN PROGRESS: every team has played "
            f"only {in_progress['min_team_games']} game(s) so far. Data for it is real "
            f"but a small sample — always mention how many games it covers, and never "
            f"present it as a final season result."
        )
        # A refresh run mid-week leaves one week partly loaded. Say so, or the
        # assistant will quote a leaderboard where two teams have an extra game.
        if in_progress.get("partial_week"):
            lines.append(
                f"- Week {in_progress['partial_week']} of {in_progress['season']} is only "
                f"partly loaded: {in_progress['teams_played_in_partial_week']} of "
                f"{in_progress['total_teams']} teams have played it. Players on those "
                f"teams have one more game than everyone else, so season totals are not "
                f"comparable across teams right now — say so if it affects the answer."
            )
        lines.append(
            f"- There is no data for seasons after {in_progress['season']}. If asked, say so."
        )
    else:
        lines.append(f"- There is no data for seasons after {max(years)}. If asked, say so.")

    lines.append(
        "- Draft rankings for the upcoming season exist in the app but these tools do "
        "not cover them, so don't answer ranking or ADP questions from them."
    )
    return "\n".join(lines)


def _client() -> AsyncAnthropic:
    return AsyncAnthropic(api_key=settings.anthropic_api_key)


async def _run_tool(db: AsyncSession, name: str, args: dict) -> dict:
    func = TOOL_FUNCS.get(name)
    if not func:
        return {"error": f"Unknown tool '{name}'"}
    try:
        return await func(db, **args)
    except Exception as exc:  # surface failures to the model instead of 500ing
        logger.exception("Assistant tool '%s' failed", name)
        return {"error": f"Tool '{name}' failed: {exc}"}


def _summarize_result(name: str, result: dict) -> str:
    """One-line summary of a tool result for logs and the debug trace."""
    if not isinstance(result, dict):
        return str(result)[:200]
    if "error" in result:
        return f"error: {result['error']}"
    if name == "get_stat_leaders":
        leaders = result.get("leaders", [])
        top = leaders[0]["player"] if leaders else "—"
        return f"{len(leaders)} row(s), season {result.get('season')}, top={top}"
    if name == "compare_players":
        players = ", ".join(p.get("player", "?") for p in result.get("players", []))
        return f"compared: {players or '—'}"
    if name == "get_player_profile":
        seasons = result.get("seasons")
        n = len(seasons) if isinstance(seasons, list) else 0
        return f"{result.get('player', '?')}: {n} season(s)"
    return "ok"


def _thinking_text(content) -> str:
    """Concatenate any thinking blocks from an assistant turn (empty if none)."""
    parts = [getattr(b, "thinking", "") for b in content if b.type == "thinking"]
    return "\n".join(p for p in parts if p).strip()


async def answer_question(db: AsyncSession, history: list[dict]) -> tuple[str, list[dict]]:
    """Run the agentic loop for the latest user turn.

    `history` is the visible conversation as [{role, content(str)}, ...] with the
    new user question last. Returns (final answer, trace), where `trace` is a list
    of per-iteration steps (the model's thinking, the tools it chose with their
    exact args, and a result summary) for debugging / testing the assistant.
    """
    client = _client()
    # Coverage is read from the DB rather than hardcoded, so it stays true as
    # seasons progress. It only changes when new weeks land (about weekly during
    # the season), so it's still stable enough to sit inside the cached prefix.
    coverage = await get_data_coverage(db)
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(coverage=_coverage_block(coverage))
    # Cache the (stable) system prompt + tool definitions; the volatile question
    # is last in `messages` so it sits after the cache breakpoint.
    system = [{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}]
    messages: list[dict] = [{"role": m["role"], "content": m["content"]} for m in history]
    trace: list[dict] = []

    last_user = next((m["content"] for m in reversed(history) if m["role"] == "user"), "")
    logger.info("[assistant] Q: %s", last_user[:200])

    for i in range(1, MAX_ITERATIONS + 1):
        resp = await client.messages.create(
            model=settings.assistant_model,
            max_tokens=4096,
            thinking={"type": "adaptive"},
            system=system,
            tools=TOOL_SCHEMAS,
            messages=messages,
        )

        thinking = _thinking_text(resp.content)
        usage = resp.usage
        step: dict = {
            "iteration": i,
            "model": resp.model,
            "thinking": thinking or None,
            "tool_calls": [],
            "stop_reason": resp.stop_reason,
            "input_tokens": usage.input_tokens,
            "output_tokens": usage.output_tokens,
        }
        if thinking:
            logger.info("[assistant] iter %d thinking: %s", i, thinking[:300])

        if resp.stop_reason != "tool_use":
            trace.append(step)
            answer = "".join(b.text for b in resp.content if b.type == "text").strip()
            logger.info(
                "[assistant] done in %d iter(s), tokens in=%d out=%d",
                i, usage.input_tokens, usage.output_tokens,
            )
            return answer, trace

        # Preserve the full assistant turn (incl. thinking + tool_use blocks).
        messages.append({"role": "assistant", "content": resp.content})

        tool_results = []
        for block in resp.content:
            if block.type == "tool_use":
                args = dict(block.input)
                result = await _run_tool(db, block.name, args)
                summary = _summarize_result(block.name, result)
                arg_str = ", ".join(f"{k}={v}" for k, v in args.items())
                logger.info("[assistant] iter %d call: %s(%s) -> %s", i, block.name, arg_str, summary)
                step["tool_calls"].append({
                    "tool": block.name,
                    "input": args,
                    "result_summary": summary,
                })
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(result, default=str),
                })
        trace.append(step)
        messages.append({"role": "user", "content": tool_results})

    logger.warning("[assistant] hit MAX_ITERATIONS (%d) without finishing", MAX_ITERATIONS)
    answer = ("I wasn't able to finish answering that — the request needed too many steps. "
              "Try asking something more specific.")
    return answer, trace
