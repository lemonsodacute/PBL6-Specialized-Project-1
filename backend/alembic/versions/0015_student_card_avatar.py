"""Private avatar pointer; the existing trusted face remains the source of truth."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0015_student_card_avatar'
down_revision = '0014_card_admin'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('avatar_source', sa.String(32)))
    op.add_column('users', sa.Column('avatar_reference_id', postgresql.UUID(as_uuid=True)))
    op.add_column('users', sa.Column('avatar_updated_at', sa.DateTime(timezone=True)))
    op.create_foreign_key('fk_user_card_avatar_reference', 'users', 'student_card_references', ['avatar_reference_id'], ['id'], ondelete='SET NULL')
    # Only existing confirmed, current references with a private sanitized face.
    # Pending previews, raw cards, webcam images and untrusted versions are excluded.
    op.execute("""UPDATE users u SET avatar_source='STUDENT_CARD', avatar_reference_id=r.id,
        avatar_updated_at=r.created_at,
        avatar_url='/api/v1/users/' || u.id::text || '/avatar/' || r.id::text
        FROM student_card_references r JOIN student_face_embeddings e
          ON e.reference_version=r.id AND e.student_id=r.student_id
        WHERE u.id=r.student_id AND u.role='student' AND u.is_active
          AND u.identity_profile_status='VERIFIED' AND u.student_card_status='VERIFIED'
          AND u.identity_profile_version=r.identity_profile_version AND r.status='ACTIVE'
          AND r.sanitized_face IS NOT NULL AND octet_length(r.sanitized_face)>0""")


def downgrade():
    op.execute("UPDATE users SET avatar_url=NULL WHERE avatar_source='STUDENT_CARD'")
    op.drop_constraint('fk_user_card_avatar_reference', 'users', type_='foreignkey')
    for name in ('avatar_updated_at', 'avatar_reference_id', 'avatar_source'):
        op.drop_column('users', name)
