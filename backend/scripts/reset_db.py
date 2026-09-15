"""Nuclear option — wipe ALL tables in the local dev database.

Use this for a clean slate during development. NEVER run against a real DB.

Usage:
    python -m scripts.reset_db            # confirmation prompt
    python -m scripts.reset_db --yes      # skip prompt
"""
import argparse
import asyncio

from sqlalchemy import text

from app.database import async_session


# Order matters when DBs don't honor CASCADE — children before parents.
# Postgres TRUNCATE ... CASCADE handles FKs in one go, but we list them
# explicitly so the script also works without CASCADE if that ever changes.
TABLES = [
    "draft_picks",
    "user_ranking_entries",
    "user_rankings",
    "base_rankings",
    "league_members",
    "leagues",
    "player_weekly_stats",
    "player_seasons",
    "player_bio",
    "players",
    "users",
]


async def reset(confirmed: bool) -> None:
    if not confirmed:
        print("This will DELETE every row from:")
        for t in TABLES:
            print(f"  - {t}")
        resp = input("Type 'yes' to confirm: ").strip().lower()
        if resp != "yes":
            print("Aborted.")
            return

    async with async_session() as db:
        # RESTART IDENTITY resets autoincrement counters so new Player IDs
        # start at 1 again. CASCADE handles any FK constraints we missed.
        joined = ", ".join(TABLES)
        await db.execute(text(f"TRUNCATE TABLE {joined} RESTART IDENTITY CASCADE"))
        await db.commit()
        print(f"Truncated {len(TABLES)} tables. DB is clean.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes", action="store_true", help="Skip the confirmation prompt")
    args = parser.parse_args()
    asyncio.run(reset(confirmed=args.yes))


if __name__ == "__main__":
    main()
