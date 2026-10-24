import type { DetectionEvent } from '@/types';
export const detectionEvents: DetectionEvent[] = [
  { id: 'detection-001', proctoring_session_id: 'proctoring-001', attempt_id: 'attempt-001', event_type: 'gaze_away', confidence_score: .82, severity: 'low', snapshot_url: null, metadata_json: { duration_sec: 4 }, occurred_at: '2026-09-09T07:51:00.000Z' },
  { id: 'detection-002', proctoring_session_id: 'proctoring-001', attempt_id: 'attempt-001', event_type: 'face_not_detected', confidence_score: .91, severity: 'medium', snapshot_url: '/mock/snapshot-001.jpg', metadata_json: { duration_sec: 7 }, occurred_at: '2026-09-09T08:01:00.000Z' },
  { id: 'detection-003', proctoring_session_id: 'proctoring-002', attempt_id: 'attempt-002', event_type: 'multiple_faces', confidence_score: .96, severity: 'critical', snapshot_url: '/mock/snapshot-002.jpg', metadata_json: { face_count: 2 }, occurred_at: '2026-09-09T07:50:00.000Z' },
  { id: 'detection-004', proctoring_session_id: 'proctoring-002', attempt_id: 'attempt-002', event_type: 'object_phone', confidence_score: .88, severity: 'high', snapshot_url: '/mock/snapshot-003.jpg', metadata_json: { object: 'mobile_phone' }, occurred_at: '2026-09-09T08:03:00.000Z' },
  { id: 'detection-005', proctoring_session_id: 'proctoring-002', attempt_id: 'attempt-002', event_type: 'gaze_away', confidence_score: .79, severity: 'medium', snapshot_url: null, metadata_json: { duration_sec: 12 }, occurred_at: '2026-09-09T08:11:00.000Z' },
];
