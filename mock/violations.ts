import type { ViolationLog } from '@/types';
const v = (id: string, attempt_id: string, type: ViolationLog['type'], severity: ViolationLog['severity'], occurred_at: string, metadata_json: Record<string, string | number | boolean>): ViolationLog => ({ id, attempt_id, type, severity, metadata_json, occurred_at, created_at: occurred_at });
export const violations: ViolationLog[] = [
  v('violation-001', 'attempt-001', 'tab_switch', 'low', '2026-09-09T07:55:00.000Z', { duration_sec: 3 }),
  v('violation-002', 'attempt-002', 'window_blur', 'medium', '2026-09-09T07:48:00.000Z', { duration_sec: 11 }),
  v('violation-003', 'attempt-002', 'copy', 'high', '2026-09-09T07:52:00.000Z', { source: 'question-content' }),
  v('violation-004', 'attempt-002', 'paste', 'high', '2026-09-09T08:05:00.000Z', { character_count: 184 }),
  v('violation-005', 'attempt-004', 'fullscreen_exit', 'medium', '2026-09-09T07:44:00.000Z', { duration_sec: 18 }),
  v('violation-006', 'attempt-004', 'right_click', 'low', '2026-09-09T07:59:00.000Z', { target: 'exam-page' }),
  v('violation-007', 'attempt-004', 'devtools_open', 'critical', '2026-09-09T08:06:00.000Z', { detection: 'keyboard-shortcut' }),
  v('violation-008', 'attempt-006', 'network_offline', 'medium', '2026-09-14T08:21:00.000Z', { duration_sec: 8 }),
  v('violation-009', 'attempt-006', 'network_online', 'low', '2026-09-14T08:21:08.000Z', { recovered: true }),
];
