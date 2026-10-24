"""Add admin-authoritative student profiles; legacy enrollment is preserved."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0008_student_identity_profile'
down_revision = '0007_student_face_embeddings'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('student_code', sa.String(64)))
    op.add_column('users', sa.Column('identity_profile_status', sa.String(20), nullable=False, server_default=sa.text("'PENDING'")))
    op.add_column('users', sa.Column('identity_profile_version', sa.Integer(), nullable=False, server_default=sa.text('1')))
    op.add_column('users', sa.Column('identity_verified_at', sa.DateTime(timezone=True)))
    op.add_column('users', sa.Column('identity_verified_by', postgresql.UUID(as_uuid=True)))
    op.add_column('users', sa.Column('student_card_status', sa.String(24), nullable=False, server_default=sa.text("'NOT_SUBMITTED'")))
    op.create_foreign_key('fk_users_identity_verified_by', 'users', 'users', ['identity_verified_by'], ['id'], ondelete='SET NULL')
    op.create_unique_constraint('uq_users_student_code', 'users', ['student_code'])
    op.create_check_constraint('ck_users_student_code', 'users', "student_code IS NULL OR (student_code = upper(trim(student_code)) AND length(student_code) > 0 AND role = 'student')")
    op.create_check_constraint('ck_users_identity_profile_status', 'users', "identity_profile_status IN ('PENDING', 'VERIFIED')")
    op.create_check_constraint('ck_users_identity_profile_version', 'users', 'identity_profile_version >= 1')
    op.create_check_constraint('ck_users_verified_identity', 'users', "identity_profile_status != 'VERIFIED' OR (role = 'student' AND student_code IS NOT NULL AND length(trim(full_name)) > 0 AND identity_verified_at IS NOT NULL)")
    op.create_check_constraint('ck_users_student_card_status', 'users', "student_card_status IN ('NOT_SUBMITTED', 'PENDING_CONFIRMATION', 'VERIFIED', 'NEEDS_REUPLOAD')")


def downgrade() -> None:
    for name in ('ck_users_student_card_status', 'ck_users_verified_identity', 'ck_users_identity_profile_version', 'ck_users_identity_profile_status', 'ck_users_student_code'):
        op.drop_constraint(name, 'users', type_='check')
    op.drop_constraint('uq_users_student_code', 'users', type_='unique')
    op.drop_constraint('fk_users_identity_verified_by', 'users', type_='foreignkey')
    for name in ('student_card_status', 'identity_verified_by', 'identity_verified_at', 'identity_profile_version', 'identity_profile_status', 'student_code'):
        op.drop_column('users', name)
