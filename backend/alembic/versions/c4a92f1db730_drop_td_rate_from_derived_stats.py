"""drop td_rate from derived stats

td_rate was computed as div(total_tds, gp) -- identical to tds_per_game in
every row -- while its name promised a rate per opportunity. It was reachable
as an analytics sort field and as an AI assistant metric ("touchdown rate"),
so both answered with touchdowns per game. Dropped rather than redefined: a
real rate needs a position-dependent denominator and is its own feature.

Revision ID: c4a92f1db730
Revises: 0259b2438168
Create Date: 2026-09-19 10:32:18.441907
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4a92f1db730'
down_revision: Union[str, None] = '0259b2438168'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('player_derived_stats', 'td_rate')


def downgrade() -> None:
    # Comes back empty. The value was a duplicate of tds_per_game, so a
    # backfill would only restore the duplication; re-run the derived-stats
    # ingest against the older code if the column is ever needed populated.
    op.add_column('player_derived_stats', sa.Column('td_rate', sa.Float(), nullable=True))
