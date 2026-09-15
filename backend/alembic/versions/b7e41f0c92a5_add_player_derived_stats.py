"""add player_derived_stats

The derived-stats table was created directly against the dev database before the
migration discipline caught up, so `alembic upgrade head` on a fresh database was
missing it (breaking /api/analytics and the AI assistant). This backfills it.

Revision ID: b7e41f0c92a5
Revises: d5861c438c7e
Create Date: 2026-09-15 10:45:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7e41f0c92a5'
down_revision: Union[str, None] = 'd5861c438c7e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'player_derived_stats',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('player_id', sa.Integer(), nullable=False),
        sa.Column('season', sa.Integer(), nullable=False),
        sa.Column('position', sa.String(length=10), nullable=False),
        sa.Column('games_played', sa.Integer(), nullable=False),
        # Per-game rates
        sa.Column('ppr_per_game', sa.Float(), nullable=True),
        sa.Column('standard_per_game', sa.Float(), nullable=True),
        sa.Column('pass_yards_per_game', sa.Float(), nullable=True),
        sa.Column('rush_yards_per_game', sa.Float(), nullable=True),
        sa.Column('rec_yards_per_game', sa.Float(), nullable=True),
        sa.Column('targets_per_game', sa.Float(), nullable=True),
        sa.Column('receptions_per_game', sa.Float(), nullable=True),
        sa.Column('tds_per_game', sa.Float(), nullable=True),
        # Efficiency
        sa.Column('yards_per_carry', sa.Float(), nullable=True),
        sa.Column('yards_per_target', sa.Float(), nullable=True),
        sa.Column('yards_per_reception', sa.Float(), nullable=True),
        sa.Column('catch_rate', sa.Float(), nullable=True),
        sa.Column('completion_pct', sa.Float(), nullable=True),
        sa.Column('td_rate', sa.Float(), nullable=True),
        # Advanced
        sa.Column('pass_epa_per_game', sa.Float(), nullable=True),
        sa.Column('rush_epa_per_game', sa.Float(), nullable=True),
        sa.Column('cpoe', sa.Float(), nullable=True),
        sa.Column('target_share', sa.Float(), nullable=True),
        sa.Column('air_yards_per_game', sa.Float(), nullable=True),
        sa.Column('yac_per_reception', sa.Float(), nullable=True),
        sa.Column('snap_pct', sa.Float(), nullable=True),
        # Kicking
        sa.Column('fg_pct', sa.Float(), nullable=True),
        sa.Column('fg_made_per_game', sa.Float(), nullable=True),
        sa.Column('fg_long', sa.Integer(), nullable=True),
        sa.Column('xp_pct', sa.Float(), nullable=True),
        # Boom/bust
        sa.Column('median_ppr', sa.Float(), nullable=True),
        sa.Column('stdev_ppr', sa.Float(), nullable=True),
        # Totals
        sa.Column('total_tds', sa.Integer(), nullable=True),
        sa.Column('total_yards', sa.Integer(), nullable=True),
        sa.Column('fantasy_points_ppr', sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(['player_id'], ['players.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('player_id', 'season', name='uq_player_derived_season'),
    )
    op.create_index(
        op.f('ix_player_derived_stats_player_id'), 'player_derived_stats', ['player_id'], unique=False
    )
    op.create_index(
        op.f('ix_player_derived_stats_season'), 'player_derived_stats', ['season'], unique=False
    )
    op.create_index(
        op.f('ix_player_derived_stats_position'), 'player_derived_stats', ['position'], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_player_derived_stats_position'), table_name='player_derived_stats')
    op.drop_index(op.f('ix_player_derived_stats_season'), table_name='player_derived_stats')
    op.drop_index(op.f('ix_player_derived_stats_player_id'), table_name='player_derived_stats')
    op.drop_table('player_derived_stats')
