"""Actual classroom connection intervals and durable SFU closure retries."""
from alembic import op
import sqlalchemy as sa

revision = '0012_live_classroom'
down_revision = '0011_profile_requests'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    existing_live = {column['name'] for column in inspector.get_columns('live_classes')}
    existing_attendance = {column['name'] for column in inspector.get_columns('class_attendance')}
    if 'provider_close_pending' not in existing_live:
        op.add_column('live_classes', sa.Column('provider_close_pending', sa.Boolean(), nullable=False, server_default=sa.false()))
    for column in (sa.Column('active_since', sa.DateTime(timezone=True)),
                   sa.Column('participant_sid', sa.String(100)),
                   sa.Column('last_event_at', sa.DateTime(timezone=True))):
        if column.name not in existing_attendance:
            op.add_column('class_attendance', column)


def downgrade():
    for field in ('last_event_at', 'participant_sid', 'active_since'):
        op.drop_column('class_attendance', field)
    op.drop_column('live_classes', 'provider_close_pending')
