"""Fetch Sleeper ADP-based PPR rankings via their public API."""
import logging

import httpx

logger = logging.getLogger(__name__)

# Sleeper projections endpoint (includes ADP data) — no auth required
PROJECTIONS_URL = "https://api.sleeper.app/projections/nfl/{year}"

# Sleeper uses standard NFL team abbreviations, but some edge cases
TEAM_NORMALIZE = {
    "JAC": "JAX",
}

# Positions we care about for fantasy
FANTASY_POSITIONS = {"QB", "RB", "WR", "TE", "K", "DEF"}

# Map Sleeper's "DEF" to our "DST"
POS_MAP = {"DEF": "DST"}


async def fetch_sleeper_ppr(year: int = 2025, limit: int = 300) -> list[dict]:
    """
    Fetch Sleeper PPR rankings derived from ADP data.

    Returns a list of dicts with keys:
        rank, full_name, position, nfl_team, bye_week, sleeper_id, adp, pts_ppr
    """
    url = PROJECTIONS_URL.format(year=year)

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, params={"season_type": "regular"})
        resp.raise_for_status()
        data = resp.json()

    if not data:
        logger.warning("Sleeper API returned empty response — possibly off-season")
        return []

    # Filter to fantasy-relevant players with valid ADP
    candidates = []
    for entry in data:
        stats = entry.get("stats") or {}
        adp = stats.get("adp_ppr")
        if adp is None or adp >= 999:
            continue

        player = entry.get("player") or {}
        position = player.get("position", "")
        if position not in FANTASY_POSITIONS:
            continue

        team = player.get("team") or "FA"
        team = TEAM_NORMALIZE.get(team, team)
        mapped_pos = POS_MAP.get(position, position)

        # Build full name — for DEF, Sleeper uses names like "Jacksonville Jaguars"
        first = player.get("first_name", "")
        last = player.get("last_name", "")
        if mapped_pos == "DST":
            full_name = f"{last} D/ST" if last else f"{team} D/ST"
        else:
            full_name = f"{first} {last}".strip()

        if not full_name:
            continue

        candidates.append({
            "full_name": full_name,
            "position": mapped_pos,
            "nfl_team": team,
            "bye_week": 0,
            "adp": adp,
            "pts_ppr": stats.get("pts_ppr", 0),
            "sleeper_id": entry.get("player_id"),
        })

    # Sort by ADP ascending (lower = drafted earlier = higher rank)
    candidates.sort(key=lambda x: x["adp"])

    # Take top N and assign ranks
    results = []
    for i, player in enumerate(candidates[:limit], start=1):
        player["rank"] = i
        results.append(player)

    logger.info(f"Fetched {len(results)} players from Sleeper PPR ADP rankings")
    return results
