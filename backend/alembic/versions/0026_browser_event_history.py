"""Expose persisted historical browser logs through the existing review lifecycle.

No AI detections, scores, risk counters, original logs or notifications are generated.
Current browser ingestion already writes this envelope and its retry receipt.
"""
from alembic import op
import sqlalchemy as sa

revision = '0026_browser_event_history'
down_revision = '0025_class_recordings'
branch_labels = depends_on = None


def upgrade():
    missing=op.get_bind().scalar(sa.text("""SELECT count(*) FROM violation_logs v
        WHERE NOT EXISTS (SELECT 1 FROM proctoring_sessions s WHERE s.attempt_id=v.attempt_id)
          AND NOT EXISTS (SELECT 1 FROM proctor_event_receipts r WHERE r.attempt_id=v.attempt_id AND r.provider='browser_signals' AND r.external_id=v.id)"""))
    if missing:
        raise RuntimeError('Historical browser logs lack stored monitoring sessions. Reconcile their real session relationship before importing review envelopes.')
    op.execute("""
        INSERT INTO detection_events
          (id,attempt_id,proctoring_session_id,exam_id,student_id,event_type,source,provider,message,severity,
           confidence_score,max_confidence,occurred_at,received_at,first_seen,last_seen,
           duration_ms,occurrence_count,is_simulated,status,review_version,metadata_json)
        SELECT v.id,a.id,s.id,a.exam_id,a.student_id,
          CASE WHEN v.type::text='tab_switch' THEN 'tab_switched' ELSE v.type::text END,
          CASE WHEN v.type::text='tab_switch' THEN 'TAB_SWITCH' ELSE 'BROWSER' END,
          'browser_signals','Tín hiệu trình duyệt đã được lưu trong lịch sử',
          (CASE WHEN v.type::text IN ('network_offline','network_online') THEN 'info' ELSE 'low' END)::severity_level,
          NULL,NULL,v.occurred_at,v.created_at,v.occurred_at,v.occurred_at,0,1,false,'NEW',0,
          jsonb_build_object('browser_type',v.type::text,'browser_violation_id',v.id::text,'historical_browser_import',true)
        FROM violation_logs v JOIN exam_attempts a ON a.id=v.attempt_id
        JOIN LATERAL (SELECT p.id FROM proctoring_sessions p WHERE p.attempt_id=a.id ORDER BY p.started_at,p.id LIMIT 1) s ON true
        WHERE NOT EXISTS (SELECT 1 FROM detection_events d WHERE d.id=v.id)
          AND NOT EXISTS (SELECT 1 FROM proctor_event_receipts r
            WHERE r.attempt_id=v.attempt_id AND r.provider='browser_signals' AND r.external_id=v.id)
    """)
    op.execute("""
        INSERT INTO proctor_event_receipts(attempt_id,provider,external_id,event_id,created_at)
        SELECT d.attempt_id,'browser_signals',d.id,d.id,d.received_at
        FROM detection_events d WHERE d.provider='browser_signals'
          AND d.metadata_json->>'historical_browser_import'='true'
        ON CONFLICT DO NOTHING
    """)


def downgrade():
    connection=op.get_bind()
    scope="provider='browser_signals' AND metadata_json->>'historical_browser_import'='true'"
    if connection.scalar(sa.text(f"SELECT count(*) FROM detection_events WHERE {scope} AND (review_version>0 OR status<>'NEW')")):
        raise RuntimeError('Historical browser reviews exist. Preserve their review history before downgrading.')
    op.execute(f"DELETE FROM proctor_event_receipts WHERE event_id IN (SELECT id FROM detection_events WHERE {scope})")
    op.execute(f"DELETE FROM detection_events WHERE {scope}")
