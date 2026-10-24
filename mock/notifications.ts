import type { Notification } from '@/types';

export const notifications: Notification[] = [
  { id: 'notification-001', recipient_user_id: 'user-teacher-001', type: 'attempt_terminated', title: 'Bài thi bị khoá do vi phạm', message: 'Sinh viên Phạm Minh Anh đã bị khoá bài thi sau 3 lần vi phạm.', related_exam_id: 'exam-web-002', related_attempt_id: 'attempt-001', severity: 'critical', is_read: false, created_at: new Date(Date.now() - 5 * 60_000).toISOString(), email_sent_at: null },
  { id: 'notification-002', recipient_user_id: 'user-teacher-001', type: 'exam_summary', title: 'Đề thi đã kết thúc', message: 'Tổng số sinh viên: 8; số bài có vi phạm: 2; top 3 risk_score đã được cập nhật.', related_exam_id: 'exam-web-002', related_attempt_id: null, severity: null, is_read: false, created_at: new Date(Date.now() - 42 * 60_000).toISOString(), email_sent_at: null },
  { id: 'notification-003', recipient_user_id: 'user-teacher-001', type: 'violation_alert', title: 'Phát hiện vi phạm mới', message: 'Có vi phạm chuyển tab trong một lượt làm bài cần theo dõi.', related_exam_id: 'exam-web-002', related_attempt_id: 'attempt-002', severity: 'high', is_read: true, created_at: new Date(Date.now() - 3 * 60 * 60_000).toISOString(), email_sent_at: null },
];
