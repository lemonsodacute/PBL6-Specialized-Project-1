"""Independent teacher quality ratings and optional reason notes."""
from alembic import op
import sqlalchemy as sa

revision = '0021_draft_quality_rating'
down_revision = '0020_ai_evaluation'
branch_labels = depends_on = None


def upgrade():
    op.add_column('ai_draft_reviews', sa.Column('quality_rating', sa.Integer(), nullable=True))
    op.add_column('ai_draft_reviews', sa.Column('reason_note', sa.String(2000), nullable=True))
    op.create_check_constraint('ck_ai_draft_review_quality_rating', 'ai_draft_reviews', 'quality_rating BETWEEN 1 AND 5')


def downgrade():
    op.drop_constraint('ck_ai_draft_review_quality_rating', 'ai_draft_reviews', type_='check')
    op.drop_column('ai_draft_reviews', 'reason_note')
    op.drop_column('ai_draft_reviews', 'quality_rating')
