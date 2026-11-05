"""Private, opt-in LiveKit classroom recordings; independent of class status."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '0025_class_recordings'
down_revision = '0024_classroom_controls'
branch_labels = depends_on = None


def upgrade():
    op.create_table('class_recordings',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('live_class_id', UUID(as_uuid=True), sa.ForeignKey('live_classes.id', ondelete='CASCADE'), nullable=False),
        sa.Column('started_by', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('started_at', sa.DateTime(timezone=True)), sa.Column('stopped_at', sa.DateTime(timezone=True)),
        sa.Column('stop_requested_at', sa.DateTime(timezone=True)),
        sa.Column('provider_recording_id', sa.String(100), unique=True),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('storage_key', sa.String(100), nullable=False, unique=True),
        sa.Column('duration_seconds', sa.Integer()), sa.Column('file_size_bytes', sa.BigInteger()),
        sa.Column('error_code', sa.String(80)),
        sa.Column('published_at', sa.DateTime(timezone=True)),
        sa.Column('published_by', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('access_version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('delete_pending', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('STARTING','RECORDING','PROCESSING','READY','FAILED','PUBLISHED','UNPUBLISHED','DELETED')", name='ck_class_recording_status'))
    op.create_index('idx_recording_session_time', 'class_recordings', ['live_class_id', 'created_at'])
    op.create_index('uq_class_recording_active', 'class_recordings', ['live_class_id'], unique=True, postgresql_where=sa.text("status IN ('STARTING','RECORDING')"))


def downgrade():
    op.drop_table('class_recordings')
