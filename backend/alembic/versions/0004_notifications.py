"""Add teacher notifications without changing the original schema."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0004_notifications'
down_revision = '0003_exam_require_mic'
branch_labels = None
depends_on = None

notification_type = postgresql.ENUM('violation_alert', 'exam_summary', 'attempt_terminated', name='notification_type', create_type=False)

def upgrade() -> None:
    notification_type.create(op.get_bind(), checkfirst=True)
    op.create_table('notifications',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('recipient_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('type', notification_type, nullable=False), sa.Column('title', sa.String(255), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('related_exam_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('exams.id', ondelete='CASCADE')),
        sa.Column('related_attempt_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('exam_attempts.id', ondelete='SET NULL')),
        sa.Column('severity', sa.String(20)), sa.Column('is_read', sa.Boolean(), nullable=False, server_default=sa.text('FALSE')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('email_sent_at', sa.DateTime(timezone=True)),
    )
    op.create_index('idx_notifications_recipient_read_created', 'notifications', ['recipient_user_id', 'is_read', 'created_at'])

def downgrade() -> None:
    op.drop_index('idx_notifications_recipient_read_created', table_name='notifications')
    op.drop_table('notifications')
    notification_type.drop(op.get_bind(), checkfirst=True)
