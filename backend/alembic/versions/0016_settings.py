"""Persist personal preferences and the system defaults consumed by new exams/help."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0016_settings'
down_revision = '0015_student_card_avatar'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('user_settings',
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('theme', sa.String(10), nullable=False, server_default='system'),
        sa.Column('notification_preferences', postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('exam_duration_minutes', sa.Integer()),
        sa.Column('exam_require_camera', sa.Boolean()),
        sa.Column('exam_require_mic', sa.Boolean()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("theme IN ('light', 'dark', 'system')", name='ck_user_settings_theme'),
        sa.CheckConstraint('exam_duration_minutes IS NULL OR exam_duration_minutes BETWEEN 1 AND 1440', name='ck_user_settings_duration'),
    )
    op.create_table('system_settings',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('exam_duration_minutes', sa.Integer(), nullable=False, server_default='60'),
        sa.Column('exam_require_camera', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('exam_require_mic', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('support_text', sa.String(2000), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint('id = 1', name='ck_system_settings_singleton'),
        sa.CheckConstraint('exam_duration_minutes BETWEEN 1 AND 1440', name='ck_system_settings_duration'),
    )
    table = sa.table('system_settings', sa.column('id', sa.Integer()), sa.column('support_text', sa.String()))
    op.bulk_insert(table, [{'id': 1, 'support_text': 'Liên hệ quản trị viên hệ thống để được hỗ trợ.'}])


def downgrade():
    op.drop_table('user_settings')
    op.drop_table('system_settings')
