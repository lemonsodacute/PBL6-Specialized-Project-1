import { ApiError } from './api';
import { resultStatusLabels, type ResultStatus, type Score } from './teacher-results';

export type ReportAttempt = {
  attempt_id: string; exam_id: string; exam_title: string; student_id: string;
  student_code: string | null; full_name: string | null; attempt_number: number;
  status: ResultStatus; score: Score; max_score: Score; percentage: Score;
  started_at: string | null; submitted_at: string | null;
  violation_count: number; browser_violation_count: number; detection_count: number; risk_score: Score;
};
export type ReportsOverview = {
  meta?:{total:number;page:number;limit:number};
  exams: { id: string; title: string; classes: { id: string; name: string }[] }[];
  exam_id: string | null; completed_statuses: ResultStatus[];
  summary: { completed_attempts: number; scored_attempts: number; percentage_attempts: number;
    average_percentage: Score; average_score: Score; max_score: Score; total_violations: number;
    browser_violation_count: number; detection_count: number; average_risk_score: Score;
    risk_scored_attempts: number; attempt_count: number };
  results: ReportAttempt[];
};
export type AttemptReport = ReportAttempt & { meta?:{total:number;page:number;limit:number};events: { id: string; source: 'browser' | 'detector';
  type: string; severity: string; occurred_at: string; confidence: Score }[] };
export function reportError(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    if (cause.status === 403) return 'Bạn không có quyền xem báo cáo này.';
    if (cause.status === 404) return 'Không tìm thấy đề thi hoặc bài làm.';
  }
  return 'Không thể tải báo cáo. Vui lòng thử lại.';
}
export function readOverview(data: ReportsOverview, examId: string) {
  if (!data || (data.exam_id ?? '') !== examId || !Array.isArray(data.exams) || !Array.isArray(data.results)
      || !Array.isArray(data.completed_statuses) || !data.summary
      || !Number.isInteger(data.summary.completed_attempts) || !Number.isInteger(data.summary.total_violations)) throw new Error('Invalid report response');
  return data;
}
export function exportReportCSV(data: ReportsOverview) {
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines: unknown[][] = [['Exam', 'MSSV', 'Student Name', 'Status', 'Attempt Number', 'Score', 'Max Score', 'Percentage', 'Submitted At', 'Violation Count', 'Risk Score']];
  data.results.forEach(row => lines.push([row.exam_title, row.student_code, row.full_name, row.status,
    row.attempt_number, row.score, row.max_score, row.percentage, row.submitted_at, row.violation_count, row.risk_score]));
  const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.map(line => line.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = `bao-cao-${data.exam_id ?? 'tat-ca'}.csv`;
  document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const eventLabels: Record<string, string> = {
  tab_switch: 'Chuyển tab', window_blur: 'Rời cửa sổ', copy: 'Sao chép', paste: 'Dán nội dung',
  fullscreen_exit: 'Thoát toàn màn hình', right_click: 'Nhấp chuột phải', devtools_open: 'Mở công cụ trình duyệt',
  network_offline: 'Mất kết nối', network_online: 'Kết nối lại', multi_monitor: 'Nhiều màn hình', other: 'Sự kiện khác',
  face_not_detected: 'Không thấy khuôn mặt', multiple_faces: 'Nhiều khuôn mặt', face_mismatch: 'Khuôn mặt không khớp',
  gaze_away: 'Nhìn ra ngoài', object_phone: 'Phát hiện điện thoại', object_book: 'Phát hiện sách',
  object_paper: 'Phát hiện giấy', person_in_background: 'Có người phía sau',
  audio_voice_detected: 'Phát hiện giọng nói', audio_noise_abnormal: 'Âm thanh bất thường',
};
export const completedDescription = (data: ReportsOverview) => data.completed_statuses.map(status => resultStatusLabels[status]).join(', ');
