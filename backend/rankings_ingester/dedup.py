"""One-time data cleanup: merge orphan Player rows (no external IDs) into
their canonical nflverse-linked counterparts.

Background: the rankings ingester used to match players by exact
name+position. When a ranking source spelled a name differently from
nflverse ("James Cook" vs "James Cook III"), two Player rows were
created — the rankings-side orphan has no external IDs, while the
nflverse-side canonical row has gsis_id/espn_id/etc. The analytics
panel reads from `player_seasons` (canonical), the draft picks from
`base_rankings` (orphan), and the live draft can't tell that James
Cook and James Cook III are the same person.

This script:
  1. Finds Player rows with NO external IDs and matching seasonal stats absent.
  2. For each, looks for a canonical Player by normalized-name + position.
  3. Re-points all FKs (base_rankings, user_ranking_entries, draft_picks)
     to the canonical row and deletes the orphan.
  4. Skips ambiguous or low-confidence matches and logs them for review.

Usage:
    python -m rankings_ingester.dedup            # dry-run summary
    python -m rankings_ingester.dedup --apply    # actually merge
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import re

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.draft import DraftPick
from app.models.player import BaseRanking, Player
from app.models.ranking import UserRankingEntry

logger = logging.getLogger(__name__)


_SUFFIXES = frozenset({"jr", "sr", "ii", "iii", "iv", "v"})
_TEAM_AMBIGUOUS = frozenset({"FA", "UNK", ""})


def normalize_name(name: str) -> str:
    """Lowercased, punctuation-stripped, suffix-stripped name for matching.

    "James Cook III" -> "james cook"
    "D.J. Moore"     -> "dj moore"
    "Ja'Marr Chase"  -> "jamarr chase"
    """
    if not name:
        return ""
    s = name.lower()
    s = re.sub(r"[^a-z0-9\s]", "", s)
    parts = [p for p in s.split() if p not in _SUFFIXES]
    return " ".join(parts).strip()


def _has_external_id(player: Player) -> bool:
    return any(
        getattr(player, f, None) is not None
        for f in ("gsis_id", "espn_id", "sleeper_id", "yahoo_id", "pfr_id")
    )


async def _find_canonical(
    db: AsyncSession,
    orphan: Player,
    candidate_index: dict[tuple[str, str], list[Player]],
) -> Player | None:
    """Return the canonical Player to merge `orphan` into, or None if
    no confident match exists.

    Uses a pre-built (normalized_name, position) -> [Player] index for
    O(1) lookup rather than scanning the whole table per orphan.
    """
    key = (normalize_name(orphan.full_name), orphan.position)
    candidates = [
        c for c in candidate_index.get(key, [])
        if c.id != orphan.id and _has_external_id(c)
    ]
    if not candidates:
        return None

    # Tier 1: exact team match
    same_team = [c for c in candidates if c.nfl_team == orphan.nfl_team]
    if len(same_team) == 1:
        return same_team[0]
    if len(same_team) > 1:
        logger.warning(
            f"  Ambiguous (multiple canonical rows with same team): "
            f"{orphan.full_name} ({orphan.position}, {orphan.nfl_team}) — skipping"
        )
        return None

    # Tier 2: one side has unknown/FA team — most likely the same player on a new team
    soft = [
        c for c in candidates
        if orphan.nfl_team in _TEAM_AMBIGUOUS or c.nfl_team in _TEAM_AMBIGUOUS
    ]
    if len(soft) == 1:
        return soft[0]
    if len(soft) > 1:
        logger.warning(
            f"  Ambiguous (multiple soft matches): {orphan.full_name} "
            f"({orphan.position}, {orphan.nfl_team}) — skipping"
        )
        return None

    # Different teams, neither ambiguous → almost certainly different players.
    logger.info(
        f"  Skipping {orphan.full_name} ({orphan.position}, {orphan.nfl_team}) — "
        f"all {len(candidates)} candidates on different teams"
    )
    return None


async def _merge_player(
    db: AsyncSession, orphan: Player, canonical: Player
) -> dict:
    """Re-point FKs from orphan -> canonical, then delete orphan.

    For user_ranking_entries we may create duplicate (ranking_id, player_id)
    pairs after the re-point — those are deleted, keeping the lower rank.
    """
    moves = {"base_rankings": 0, "user_ranking_entries": 0, "draft_picks": 0, "dropped_dup_entries": 0}

    # ── Conflict check FIRST (before any writes) ──
    # If the orphan and canonical were both drafted in the same league, we
    # have a real data conflict (same person picked twice in one draft —
    # the exact bug this dedup is fixing). Skip this merge entirely so the
    # user can resolve the affected league manually before re-running.
    conflict = await db.execute(
        select(DraftPick.league_id)
        .where(DraftPick.player_id == orphan.id)
        .intersect(
            select(DraftPick.league_id).where(DraftPick.player_id == canonical.id)
        )
    )
    conflicting_leagues = list(conflict.scalars())
    if conflicting_leagues:
        moves["conflict_leagues"] = [str(lid) for lid in conflicting_leagues]
        return moves  # caller will treat this as a skip; no writes issued

    # ── base_rankings ──
    # Possible conflict: orphan and canonical both have a row for the same
    # `source`. Delete the orphan's row; canonical wins (it's more likely
    # already the row a fresh ingest would target).
    conflict_sources = await db.execute(
        select(BaseRanking.source).where(BaseRanking.player_id == orphan.id)
    )
    orphan_sources = set(conflict_sources.scalars().all())
    if orphan_sources:
        existing_canonical_sources = await db.execute(
            select(BaseRanking.source).where(
                BaseRanking.player_id == canonical.id,
                BaseRanking.source.in_(orphan_sources),
            )
        )
        canonical_sources = set(existing_canonical_sources.scalars().all())
        # Drop orphan's rows that would duplicate canonical's.
        if canonical_sources:
            await db.execute(
                delete(BaseRanking).where(
                    BaseRanking.player_id == orphan.id,
                    BaseRanking.source.in_(canonical_sources),
                )
            )
        # Re-point the rest.
        res = await db.execute(
            update(BaseRanking)
            .where(BaseRanking.player_id == orphan.id)
            .values(player_id=canonical.id)
        )
        moves["base_rankings"] = res.rowcount or 0

    # ── user_ranking_entries ──
    # Possible conflict: the same user_ranking has entries for both rows.
    # Find duplicates, keep the better-ranked one, drop the rest. Resolving
    # in Python is simpler than a self-correlated SQL query and the row
    # counts are small.
    all_entries = (
        await db.execute(
            select(UserRankingEntry).where(
                UserRankingEntry.player_id.in_([orphan.id, canonical.id])
            )
        )
    ).scalars().all()
    by_ranking: dict = {}
    for e in all_entries:
        by_ranking.setdefault(e.ranking_id, []).append(e)
    drop_ids: list[int] = []
    for ranking_id, entries in by_ranking.items():
        if len(entries) <= 1:
            continue
        # Two or more entries in same list referencing what we now know is
        # the same player. Keep the best rank, drop the rest.
        entries.sort(key=lambda e: e.rank)
        drop_ids.extend(e.id for e in entries[1:])
    if drop_ids:
        await db.execute(
            delete(UserRankingEntry).where(UserRankingEntry.id.in_(drop_ids))
        )
        moves["dropped_dup_entries"] = len(drop_ids)
    # Re-point any remaining orphan rows.
    res = await db.execute(
        update(UserRankingEntry)
        .where(UserRankingEntry.player_id == orphan.id)
        .values(player_id=canonical.id)
    )
    moves["user_ranking_entries"] = res.rowcount or 0

    # ── draft_picks ── (conflict already ruled out above)
    res = await db.execute(
        update(DraftPick)
        .where(DraftPick.player_id == orphan.id)
        .values(player_id=canonical.id)
    )
    moves["draft_picks"] = res.rowcount or 0

    # Prefer the longer name on merge — usually carries the official suffix
    # ("Jr.", "III") that the shorter ingest dropped. The two names already
    # normalize to the same string, so this only ever restores info, never
    # confuses identity.
    if len(orphan.full_name) > len(canonical.full_name):
        logger.info(f"    Promoting name: '{canonical.full_name}' -> '{orphan.full_name}'")
        canonical.full_name = orphan.full_name

    # Backfill bye_week if canonical was missing it.
    if orphan.bye_week and not canonical.bye_week:
        canonical.bye_week = orphan.bye_week

    # Finally, delete the orphan
    await db.delete(orphan)
    await db.flush()
    return moves


async def dedup(apply: bool = False) -> dict:
    """Run the dedup pass. Returns a summary dict."""
    summary = {
        "scanned": 0,
        "orphans": 0,
        "merged": 0,
        "skipped_ambiguous": 0,
        "skipped_no_match": 0,
        "skipped_draft_conflict": 0,
        "conflict_leagues": set(),
        "fk_moves": {"base_rankings": 0, "user_ranking_entries": 0, "draft_picks": 0, "dropped_dup_entries": 0},
    }

    async with async_session() as db:
        all_players = (
            await db.execute(select(Player).order_by(Player.full_name))
        ).scalars().all()
        summary["scanned"] = len(all_players)

        # Build (normalized_name, position) -> [Player] index for fast lookup.
        index: dict[tuple[str, str], list[Player]] = {}
        for p in all_players:
            key = (normalize_name(p.full_name), p.position)
            index.setdefault(key, []).append(p)

        orphans = [p for p in all_players if not _has_external_id(p)]
        summary["orphans"] = len(orphans)
        logger.info(f"Scanning {len(all_players)} players, {len(orphans)} orphans without external IDs")

        for orphan in orphans:
            canonical = await _find_canonical(db, orphan, index)
            if canonical is None:
                # Either ambiguous or no match found
                summary["skipped_no_match"] += 1
                continue

            logger.info(
                f"  Merge: '{orphan.full_name}' ({orphan.position}, {orphan.nfl_team}, id={orphan.id}) "
                f"-> '{canonical.full_name}' (id={canonical.id})"
            )
            if not apply:
                summary["merged"] += 1
                continue

            moves = await _merge_player(db, orphan, canonical)
            if "conflict_leagues" in moves:
                summary["skipped_draft_conflict"] += 1
                summary["conflict_leagues"].update(moves["conflict_leagues"])
                logger.warning(
                    f"    Skipped — both orphan and canonical drafted in "
                    f"league(s) {moves['conflict_leagues']}. Resolve the "
                    f"affected draft manually then re-run dedup."
                )
                continue
            for k, v in moves.items():
                summary["fk_moves"][k] += v
            summary["merged"] += 1

        if apply:
            await db.commit()
            logger.info("Committed dedup changes")
        else:
            await db.rollback()
            logger.info("[DRY RUN] No changes written — pass --apply to commit")

    return summary


def _print_summary(s: dict) -> None:
    print()
    print("-- Dedup summary --------------------")
    print(f"  Scanned players:       {s['scanned']}")
    print(f"  Orphans (no ext IDs):  {s['orphans']}")
    print(f"  Merged into canonical: {s['merged']}")
    print(f"  Skipped (no/ambig):    {s['skipped_no_match']}")
    print(f"  Skipped (draft conflict): {s['skipped_draft_conflict']}")
    if s["conflict_leagues"]:
        print(f"    Affected league(s) — both rows drafted, resolve manually:")
        for lid in sorted(s["conflict_leagues"]):
            print(f"      {lid}")
    print(f"  FK rows moved:")
    for table, count in s["fk_moves"].items():
        print(f"    {table:25s} {count}")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually commit the merges (default is dry-run)")
    args = parser.parse_args()
    summary = asyncio.run(dedup(apply=args.apply))
    _print_summary(summary)


if __name__ == "__main__":
    main()
