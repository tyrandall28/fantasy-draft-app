"""Fetch ESPN PPR Top 300 rankings via their public fantasy API."""
import json
import logging

import httpx

logger = logging.getLogger(__name__)

# ESPN fantasy API (public, no auth required)
BASE_URL = (
    "https://lm-api-reads.fantasy.espn.com"
    "/apis/v3/games/ffl/seasons/{year}/segments/0/leaguedefaults/1"
)

POSITION_MAP = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DST"}

# ESPN proTeamId -> abbreviation
TEAM_MAP = {
    0: "FA", 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE",
    6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN", 11: "IND",
    12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE",
    18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT",
    24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR",
    30: "JAX", 33: "BAL", 34: "HOU",
}


def _build_filter(limit: int = 300, scoring: str = "PPR") -> str:
    """Build the X-Fantasy-Filter header for sorted draft ranks."""
    return json.dumps({
        "players": {
            "limit": limit,
            "sortDraftRanks": {
                "sortPriority": 100,
                "sortAsc": True,
                "value": scoring,
            },
            "filterRanksForRankTypes": {"value": [scoring]},
            "filterSlotIds": {
                "value": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
                          12, 13, 14, 15, 16, 17, 18, 19, 23, 24],
            },
        }
    })


async def fetch_espn_ppr(year: int = 2025, limit: int = 300) -> list[dict]:
    """
    Fetch ESPN PPR draft rankings.

    Returns a list of dicts with keys:
        rank, full_name, position, nfl_team, bye_week, tier, espn_id
    """
    url = BASE_URL.format(year=year)
    headers = {
        "X-Fantasy-Filter": _build_filter(limit, "PPR"),
        "Accept": "application/json",
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, params={"view": "kona_player_info"}, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    players_raw = data.get("players", [])
    if not players_raw:
        logger.warning("ESPN API returned 0 players — possibly off-season or endpoint changed")
        return []

    results = []
    for entry in players_raw:
        p = entry.get("player", {})
        if not p:
            continue

        # Extract PPR rank
        draft_ranks = p.get("draftRanksByRankType", {})
        ppr_info = draft_ranks.get("PPR", {})
        rank = ppr_info.get("rank", 0)
        if rank == 0:
            continue

        pos_id = p.get("defaultPositionId", 0)
        position = POSITION_MAP.get(pos_id, "UNK")
        team_id = p.get("proTeamId", 0)
        nfl_team = TEAM_MAP.get(team_id, "UNK")

        # ESPN doesn't directly give bye_week in this endpoint —
        # we'll fill it from existing DB data or default to 0
        results.append({
            "rank": rank,
            "full_name": p.get("fullName", ""),
            "position": position,
            "nfl_team": nfl_team,
            "bye_week": 0,  # will be enriched by loader
            "espn_id": p.get("id"),
        })

    # Sort by rank (API should return sorted, but just in case)
    results.sort(key=lambda x: x["rank"])
    logger.info(f"Fetched {len(results)} players from ESPN PPR rankings")
    return results
