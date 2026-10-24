"""Persistent profile verification requests using the existing notifications."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0011_profile_requests'
down_revision = '0010_student_card_references'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'profile_verification_request'")
    op.execute("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'profile_verification_result'")
    op.add_column('notifications', sa.Column('related_student_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL', name='fk_notification_student')))
    op.create_table('profile_verification_requests',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('student_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('requested_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('reviewed_at', sa.DateTime(timezone=True)),
        sa.Column('reviewed_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('rejection_reason', sa.String(500)),
        sa.CheckConstraint("status IN ('PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED')", name='ck_profile_request_status'),
        sa.CheckConstraint("(status = 'PENDING' AND reviewed_at IS NULL AND reviewed_by IS NULL AND rejection_reason IS NULL) OR (status <> 'PENDING' AND reviewed_at IS NOT NULL)", name='ck_profile_request_review'),
        sa.CheckConstraint("(status = 'REJECTED' AND rejection_reason IS NOT NULL AND length(trim(rejection_reason)) > 0) OR (status <> 'REJECTED' AND rejection_reason IS NULL)", name='ck_profile_request_reason'))
    op.create_index('uq_profile_request_pending', 'profile_verification_requests', ['student_id'], unique=True, postgresql_where=sa.text("status = 'PENDING'"))
    op.create_index('idx_profile_request_queue', 'profile_verification_requests', ['status', 'requested_at'])
    op.create_index('idx_profile_request_student', 'profile_verification_requests', ['student_id', 'requested_at'])


def downgrade():
    op.drop_table('profile_verification_requests')
    op.drop_column('notifications', 'related_student_id')
    # Only this feature's notifications are removed; prior notification data stays.
    op.execute("DELETE FROM notifications WHERE type::text IN ('profile_verification_request', 'profile_verification_result')")
    # Later migrations intentionally retain enum labels on downgrade. Preserve
    # those labels and their existing notifications when rolling through 0011.
    retained = list(op.get_bind().execute(sa.text(
        "SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid=enumtypid "
        "WHERE typname='notification_type' AND enumlabel NOT IN "
        "('profile_verification_request','profile_verification_result') ORDER BY enumsortorder"
    )).scalars())
    op.execute('ALTER TYPE notification_type RENAME TO notification_type_with_profiles')
    postgresql.ENUM(*retained, name='notification_type').create(op.get_bind(), checkfirst=False)
    op.execute('ALTER TABLE notifications ALTER COLUMN type TYPE notification_type USING type::text::notification_type')
    op.execute('DROP TYPE notification_type_with_profiles')
