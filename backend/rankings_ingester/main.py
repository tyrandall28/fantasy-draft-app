"""
Rankings Ingester — fetch fresh player rankings from external sources and load into DB.

Usage:
    cd backend
    python -m rankings_ingester.main                  # fetch ESPN PPR + load
    python -m rankings_ingester.main --dry-run        # fetch + validate only, no DB writes
    python -m rankings_ingester.main --source espn    # specific source only
    python -m rankings_ingester.main --year 2025      # specific season
"""
import argparse
import asyncio
import logging
import sys
from datetime import datetime, timezone

from app.database import async_session
from rankings_ingester.sources.espn import fetch_espn_ppr
from rankings_ingester.sources.sleeper import fetch_sleeper_ppr
from rankings_ingester.loader import load_rankings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("rankings_ingester")

# Registry of available sources
SOURCES = {
    "espn_ppr": {
        "fetch": fetch_espn_ppr,
        "db_source": "espn_ppr",
        "description": "ESPN PPR Top 300",
    },
    "sleeper_ppr": {
        "fetch": fetch_sleeper_ppr,
        "db_source": "sleeper_ppr",
        "description": "Sleeper PPR ADP Top 300",
    },
}


async def run_ingestion(
    sources: list[str] | None = None,
    year: int = 2025,
    dry_run: bool = False,
):
    """Run the full ingestion pipeline for the specified sources."""
    start = datetime.now(timezone.utc)
    logger.info(f"=== Rankings Ingestion Started at {start.isoformat()} ===")

    if sources is None:
        sources = list(SOURCES.keys())

    results = {}

    for source_key in sources:
        if source_key not in SOURCES:
            logger.error(f"Unknown source: {source_key}")
            continue

        source_config = SOURCES[source_key]
        logger.info(f"--- Fetching: {source_config['description']} ---")

        try:
            # Fetch from external API
            entries = await source_config["fetch"](year=year)

            if not entries:
                logger.warning(f"No data returned from {source_key} — skipping load")
                results[source_key] = {"status": "empty", "count": 0}
                continue

            # Validate data quality
            issues = _validate_entries(entries)
            if issues:
                for issue in issues:
                    logger.warning(f"  Validation: {issue}")

            # Load into DB
            async with async_session() as db:
                stats = await load_rankings(
                    db,
                    source_config["db_source"],
                    entries,
                    dry_run=dry_run,
                )
                results[source_key] = {"status": "ok", **stats}

        except Exception:
            logger.exception(f"Failed to ingest {source_key}")
            results[source_key] = {"status": "error"}

    elapsed = (datetime.now(timezone.utc) - start).total_seconds()
    logger.info(f"=== Ingestion Complete in {elapsed:.1f}s ===")
    for key, result in results.items():
        logger.info(f"  {key}: {result}")

    return results


def _validate_entries(entries: list[dict]) -> list[str]:
    """Basic data quality checks."""
    issues = []

    if len(entries) < 100:
        issues.append(f"Only {len(entries)} entries — expected ~300")

    # Check for duplicate names
    names = [e["full_name"] for e in entries]
    dupes = [n for n in set(names) if names.count(n) > 1]
    if dupes:
        issues.append(f"Duplicate player names: {dupes[:5]}")

    # Check for missing fields
    for i, e in enumerate(entries[:10]):
        if not e.get("full_name"):
            issues.append(f"Entry {i} missing full_name")
        if e.get("position") == "UNK":
            issues.append(f"Entry {i} ({e.get('full_name', '?')}) has unknown position")

    # Check rank continuity
    ranks = sorted(e["rank"] for e in entries)
    if ranks and ranks[0] != 1:
        issues.append(f"Rankings don't start at 1 (starts at {ranks[0]})")

    return issues


def main():
    parser = argparse.ArgumentParser(description="Fetch and load player rankings")
    parser.add_argument(
        "--source",
        choices=list(SOURCES.keys()),
        help="Specific source to ingest (default: all)",
    )
    parser.add_argument(
        "--year",
        type=int,
        default=2025,
        help="NFL season year (default: 2025)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and validate only — don't write to DB",
    )
    args = parser.parse_args()

    sources = [args.source] if args.source else None
    results = asyncio.run(run_ingestion(sources=sources, year=args.year, dry_run=args.dry_run))

    # Exit with error code if any source failed
    if any(r.get("status") == "error" for r in results.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()
