"""Managed support knowledge and metadata-only AI evaluation."""
import json
from pathlib import Path
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '0020_ai_evaluation'
down_revision = '0019_support_assistant'
branch_labels = depends_on = None


def upgrade():
    articles = op.create_table('support_articles',
        sa.Column('id', sa.String(80), primary_key=True), sa.Column('title', sa.String(200), nullable=False),
        sa.Column('role', sa.String(10), nullable=False), sa.Column('category', sa.String(40), nullable=False),
        sa.Column('content', sa.Text(), nullable=False), sa.Column('keywords', sa.JSON(), nullable=False),
        sa.Column('route', sa.String(160), nullable=False), sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('requires_admin', sa.Boolean(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_by', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL')))
    source = Path(__file__).resolve().parents[2] / 'app' / 'support' / 'knowledge.json'
    op.bulk_insert(articles, [dict(id=a['id'], title=a['title'], role=a['role'], category=a['category'],
        content='\n'.join(a['steps']), keywords=a['keywords'], route=a['route'], is_active=a['is_active'],
        requires_admin=a['requires_admin']) for a in json.loads(source.read_text(encoding='utf-8'))['articles']])
    op.create_table('ai_activities',
        sa.Column('id', UUID(as_uuid=True), primary_key=True), sa.Column('feature', sa.String(12), nullable=False),
        sa.Column('actor_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('document_id', UUID(as_uuid=True)),
        sa.Column('session_id', UUID(as_uuid=True), sa.ForeignKey('support_sessions.id', ondelete='CASCADE')),
        sa.Column('role', sa.String(10), nullable=False), sa.Column('category', sa.String(40)),
        sa.Column('metrics', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index('ix_ai_activities_feature', 'ai_activities', ['feature'])
    op.create_index('ix_ai_activities_created_at', 'ai_activities', ['created_at'])
    op.create_table('ai_draft_reviews',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('activity_id', UUID(as_uuid=True), sa.ForeignKey('ai_activities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('document_id', UUID(as_uuid=True), nullable=False), sa.Column('draft_id', UUID(as_uuid=True), nullable=False),
        sa.Column('reviewer_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('decision', sa.String(10)), sa.Column('reason', sa.String(32)),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    for field in ('activity_id', 'document_id', 'draft_id'):
        op.create_index('ix_ai_draft_reviews_' + field, 'ai_draft_reviews', [field])


def downgrade():
    op.drop_table('ai_draft_reviews')
    op.drop_table('ai_activities')
    op.drop_table('support_articles')
