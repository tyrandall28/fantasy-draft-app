"""Seed players and base rankings from JSON data files."""
import asyncio
import json
from pathlib import Path

from sqlalchemy import select

from app.database import async_session, engine
from app.models import Base, Player, BaseRanking

DATA_DIR = Path(__file__).parent / "data"


async def seed_source(filename: str, source: str) -> None:
    filepath = DATA_DIR / filename
    if not filepath.exists():
        print(f"Skipping {filename} — file not found")
        return

    with open(filepath) as f:
        entries = json.load(f)

    async with async_session() as db:
        # Check if source already seeded
        result = await db.execute(select(BaseRanking).where(BaseRanking.source == source).limit(1))
        if result.scalar_one_or_none():
            print(f"Source '{source}' already seeded, skipping")
            return

        for entry in entries:
            # Find or create player
            stmt = select(Player).where(
                Player.full_name == entry["full_name"],
                Player.position == entry["position"],
            )
            result = await db.execute(stmt)
            player = result.scalar_one_or_none()

            if not player:
                player = Player(
                    full_name=entry["full_name"],
                    position=entry["position"],
                    nfl_team=entry["nfl_team"],
                    bye_week=entry["bye_week"],
                )
                db.add(player)
                await db.flush()

            db.add(
                BaseRanking(
                    source=source,
                    player_id=player.id,
                    rank=entry["rank"],
                    tier=entry.get("tier", 1),
                )
            )

        await db.commit()
        print(f"Seeded {len(entries)} entries for source '{source}'")


async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    await seed_source("espn_top300_2025.json", "espn_ppr")
    print("Seeding complete!")


if __name__ == "__main__":
    asyncio.run(main())
