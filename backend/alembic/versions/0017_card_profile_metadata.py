"""Persist administrative card class separately from course enrollment."""
from alembic import op
import sqlalchemy as sa

revision = '0017_card_profile_metadata'
down_revision = '0016_settings'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('class_name', sa.String(30), nullable=True))
    # Admin approval of the student's name remains required. A missing ID may
    # be learned only from a subsequently confirmed card, never from preview.
    op.drop_constraint('ck_users_verified_identity', 'users', type_='check')
    op.create_check_constraint('ck_users_verified_identity', 'users',
        "identity_profile_status != 'VERIFIED' OR (role = 'student' AND length(trim(full_name)) > 0 AND identity_verified_at IS NOT NULL)")


def downgrade():
    # Refuse an incompatible downgrade instead of deleting verification data.
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT count(*) FROM users WHERE identity_profile_status='VERIFIED' AND student_code IS NULL")):
        raise RuntimeError('Confirmed profiles without a student code must be completed before downgrading')
    op.drop_constraint('ck_users_verified_identity', 'users', type_='check')
    op.create_check_constraint('ck_users_verified_identity', 'users',
        "identity_profile_status != 'VERIFIED' OR (role = 'student' AND student_code IS NOT NULL AND length(trim(full_name)) > 0 AND identity_verified_at IS NOT NULL)")
    op.drop_column('users', 'class_name')
