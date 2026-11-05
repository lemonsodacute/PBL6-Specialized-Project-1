"""Persistent controls and admission for the existing LiveKit classroom."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0024_classroom_controls'
down_revision = '0023_proctor_alerts'
branch_labels = depends_on = None


def upgrade():
    op.execute("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'classroom_activity'")
    op.add_column('live_classes', sa.Column('controls_sync_pending', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('live_classes', sa.Column('classroom_state', JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")))


def downgrade():
    op.drop_column('live_classes', 'controls_sync_pending')
    op.drop_column('live_classes', 'classroom_state')
