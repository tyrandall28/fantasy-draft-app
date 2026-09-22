"""unique draft picks per league

Two players, one slot -- or one player on two rosters -- was possible. The
draft room reads the taken players, checks the pick against that list, and
inserts, with awaits in between and the auto-pick timer running on the same
event loop. A human pick landing as the clock expires could interleave with
its own auto-pick. Nothing in the schema refused the result.

These constraints settle it in the database, which is the only participant
that can. If an existing database already holds duplicates this migration
will fail to apply -- that is the intended outcome, since the rows need a
decision, not a silent drop.

Revision ID: 9dfa74bbe207
Revises: c4a92f1db730
Create Date: 2026-09-21 21:17:00.265225
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9dfa74bbe207'
down_revision: Union[str, None] = 'c4a92f1db730'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_unique_constraint(
        'uq_draft_picks_league_player', 'draft_picks', ['league_id', 'player_id']
    )
    op.create_unique_constraint(
        'uq_draft_picks_league_slot', 'draft_picks', ['league_id', 'overall_pick']
    )


def downgrade() -> None:
    op.drop_constraint('uq_draft_picks_league_slot', 'draft_picks', type_='unique')
    op.drop_constraint('uq_draft_picks_league_player', 'draft_picks', type_='unique')
