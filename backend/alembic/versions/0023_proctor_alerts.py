"""Extend existing detections with normalized, reviewed proctor alerts."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = '0023_proctor_alerts'
down_revision = '0022_support_session_lifecycle'
branch_labels = depends_on = None


def upgrade():
    op.execute("ALTER TYPE severity_level ADD VALUE IF NOT EXISTS 'info'")
    op.alter_column('detection_events', 'event_type', type_=sa.String(64), postgresql_using='event_type::text')
    columns = [
        sa.Column('exam_id', UUID(as_uuid=True)), sa.Column('student_id', UUID(as_uuid=True)),
        sa.Column('source', sa.String(64), nullable=False, server_default='LEGACY'),
        sa.Column('provider', sa.String(64), nullable=False, server_default='legacy'),
        sa.Column('message', sa.String(500), nullable=False, server_default=''),
        sa.Column('evidence_json', JSONB()),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('first_seen', sa.DateTime(timezone=True)), sa.Column('last_seen', sa.DateTime(timezone=True)),
        sa.Column('duration_ms', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('occurrence_count', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('max_confidence', sa.Numeric(4, 3)),
        sa.Column('is_simulated', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('status', sa.String(16), nullable=False, server_default='NEW'),
        sa.Column('reviewed_at', sa.DateTime(timezone=True)), sa.Column('reviewed_by', UUID(as_uuid=True)),
        sa.Column('review_note', sa.String(1000)),
        sa.Column('review_version', sa.Integer(), nullable=False, server_default='0'),
    ]
    for column in columns:
        op.add_column('detection_events', column)
    for column, target in [('exam_id', 'exams'), ('student_id', 'users'), ('reviewed_by', 'users')]:
        op.create_foreign_key('fk_proctor_' + column, 'detection_events', target, [column], ['id'], ondelete='SET NULL' if column == 'reviewed_by' else 'CASCADE')
    op.execute('''UPDATE detection_events e SET exam_id=a.exam_id,student_id=a.student_id,
        first_seen=e.occurred_at,last_seen=e.occurred_at,received_at=e.occurred_at,max_confidence=e.confidence_score
        FROM exam_attempts a WHERE e.attempt_id=a.id''')
    # Existing data is retained. Fail clearly rather than silently rewriting invalid historical confidence.
    op.create_check_constraint('ck_proctor_confidence', 'detection_events', 'confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)')
    op.create_check_constraint('ck_proctor_max_confidence', 'detection_events', 'max_confidence IS NULL OR (max_confidence >= 0 AND max_confidence <= 1)')
    op.create_check_constraint('ck_proctor_status', 'detection_events', "status IN ('NEW','REVIEWED','DISMISSED','CONFIRMED')")
    op.create_check_constraint('ck_proctor_aggregation', 'detection_events', 'occurrence_count>=1 AND duration_ms>=0 AND review_version>=0')
    op.create_index('idx_proctor_events_feed', 'detection_events', ['exam_id', 'is_simulated', 'occurred_at'])
    op.create_index('idx_proctor_events_review', 'detection_events', ['exam_id', 'is_simulated', 'status', 'severity'])
    op.create_table('proctor_event_receipts',
        sa.Column('attempt_id', UUID(as_uuid=True), sa.ForeignKey('exam_attempts.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('provider', sa.String(64), primary_key=True),
        sa.Column('external_id', UUID(as_uuid=True), primary_key=True),
        sa.Column('event_id', UUID(as_uuid=True), sa.ForeignKey('detection_events.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_table('proctor_model_health',
        sa.Column('provider', sa.String(64), primary_key=True), sa.Column('status', sa.String(16), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False), sa.Column('error_code', sa.String(32)))
    op.add_column('notifications', sa.Column('related_proctor_event_id', UUID(as_uuid=True)))
    op.add_column('notifications', sa.Column('proctor_event_simulated', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_foreign_key('fk_notification_proctor_event', 'notifications', 'detection_events', ['related_proctor_event_id'], ['id'], ondelete='SET NULL')


def downgrade():
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT count(*) FROM detection_events WHERE source <> 'LEGACY' OR status <> 'NEW' OR review_version > 0 OR reviewed_by IS NOT NULL OR review_note IS NOT NULL")):
        raise RuntimeError('Reviewed proctor alerts exist. Archive explicitly before downgrading to avoid losing review history.')
    op.drop_constraint('fk_notification_proctor_event', 'notifications', type_='foreignkey')
    op.drop_column('notifications', 'related_proctor_event_id')
    op.drop_column('notifications', 'proctor_event_simulated')
    op.drop_table('proctor_model_health'); op.drop_table('proctor_event_receipts')
    for name in ('idx_proctor_events_feed', 'idx_proctor_events_review'):
        op.drop_index(name, table_name='detection_events')
    for name in ('ck_proctor_confidence', 'ck_proctor_max_confidence', 'ck_proctor_status', 'ck_proctor_aggregation'):
        op.drop_constraint(name, 'detection_events', type_='check')
    for column in ('exam_id', 'student_id', 'reviewed_by'):
        op.drop_constraint('fk_proctor_' + column, 'detection_events', type_='foreignkey')
    for column in ('exam_id','student_id','source','provider','message','evidence_json','received_at','first_seen','last_seen','duration_ms','occurrence_count','max_confidence','is_simulated','status','reviewed_at','reviewed_by','review_note','review_version'):
        op.drop_column('detection_events', column)
    op.execute('ALTER TABLE detection_events ALTER COLUMN event_type TYPE detection_event_type USING event_type::detection_event_type')
    # PostgreSQL cannot safely remove an enum value in place; the unused info value remains.
