"""Card management metadata. Historical actors remain unknown."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0014_card_admin'
down_revision = '0013_question_images'
branch_labels = None
depends_on = None


def upgrade():
    for value in ('student_card_update', 'student_card_notice'):
        op.execute(f"ALTER TYPE notification_type ADD VALUE IF NOT EXISTS '{value}'")
    op.add_column('users', sa.Column('card_admin_version', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('card_update_reason', sa.String(1000)))
    op.add_column('users', sa.Column('card_last_action', sa.String(32)))
    op.add_column('student_card_previews', sa.Column('card_admin_version', sa.Integer(), nullable=False, server_default='0'))
    for name in ('verified_by_user_id', 'revoked_by'):
        op.add_column('student_card_references', sa.Column(name, postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL', name=f'fk_card_{name}')))
    op.add_column('student_card_references', sa.Column('revoked_at', sa.DateTime(timezone=True)))
    for name, size in (('verified_by_role', 20), ('verification_source', 32), ('revoke_reason', 1000), ('ocr_model_version', 128), ('parser_version', 64), ('matching_version', 64), ('face_model_name', 64), ('face_model_version', 64), ('face_preprocessing_version', 128)):
        op.add_column('student_card_references', sa.Column(name, sa.String(size), nullable=name != 'verification_source', server_default=sa.text("'SYSTEM_MIGRATION'") if name == 'verification_source' else None))
    op.create_check_constraint('ck_card_verification_source', 'student_card_references', "verification_source IN ('STUDENT_SELF_CONFIRM', 'ADMIN_CONFIRM', 'SYSTEM_MIGRATION')")
    # Copy only metadata whose existing embedding explicitly points to this reference.
    # Never infer an actor from profile approval or create historical audit events.
    op.execute('''UPDATE student_card_references r SET face_model_name=e.model_name,
        face_model_version=e.model_version, face_preprocessing_version=e.preprocessing_version
        FROM student_face_embeddings e WHERE e.reference_version=r.id AND e.student_id=r.student_id''')
    op.create_index('idx_card_reference_student_created', 'student_card_references', ['student_id', 'created_at'])
    op.create_index('idx_card_audit_entity_time', 'audit_logs', ['entity_type', 'entity_id', 'created_at'])


def downgrade():
    op.drop_index('idx_card_audit_entity_time', table_name='audit_logs')
    op.drop_index('idx_card_reference_student_created', table_name='student_card_references')
    op.drop_constraint('ck_card_verification_source', 'student_card_references', type_='check')
    for name in ('verified_by_user_id', 'verified_by_role', 'verification_source', 'revoked_at', 'revoked_by', 'revoke_reason', 'ocr_model_version', 'parser_version', 'matching_version', 'face_model_name', 'face_model_version', 'face_preprocessing_version'):
        op.drop_column('student_card_references', name)
    op.drop_column('student_card_previews', 'card_admin_version')
    for name in ('card_admin_version', 'card_update_reason', 'card_last_action'):
        op.drop_column('users', name)
    # Keep enum labels and notification history; PostgreSQL cannot remove enum values safely.
