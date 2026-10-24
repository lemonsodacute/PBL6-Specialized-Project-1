import { ApiError } from './api';

export type Score = number | string | null;
export type ResultStatus = 'not_started' | 'in_progress' | 'submitted' | 'auto_submitted' | 'terminated';
export type AttemptResultRow = {
  student_id: string; student_code: string | null; full_name: string; attempt_id: string | null;
  attempt_number: number | null; status: ResultStatus; started_at: string | null; submitted_at: string | null;
  score: Score; max_score: Score; correct_count: number | null; total_questions: number;
  objective_question_count: number; pending_manual_count: number;
};
export type TeacherReport = {
  meta?:{total:number;page:number;limit:number}|null;
  exam: { id: string; title: string; max_score: Score; max_attempts: number; classes: { id: string; name: string }[] };
  summary: { student_count: number; submitted_count: number; in_progress_count: number; not_started_count: number };
  results: (AttemptResultRow & { attempts: AttemptResultRow[] })[];
};
export type ResultQuestion = {
  images?: import('@/types').QuestionImage[] | null;
  question_id: string; answer_id: string | null; type: string; content: string; options_json: unknown;
  student_answer: unknown; correct_answer: unknown; is_correct: boolean | null;
  points_awarded: Score; points: Score; explanation: string | null;
};
export type TeacherAttemptResult = {
  id: string; exam_id: string; exam_title: string; status: ResultStatus; attempt_number: number;
  student: { id: string; full_name: string; student_code: string | null } | null;
  score: Score; max_score: Score; started_at: string | null; submitted_at: string | null; questions: ResultQuestion[];
};
export const resultStatusLabels: Record<ResultStatus, string> = {
  not_started: 'Chưa làm', in_progress: 'Đang làm', submitted: 'Đã nộp',
  auto_submitted: 'Đã nộp tự động', terminated: 'Bị kết thúc',
};
export function isSubmitted(status: ResultStatus) { return ['submitted', 'auto_submitted', 'terminated'].includes(status); }
export function scoreText(value: Score) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(value));
}
export function resultDate(value: string | null) {
  return value && Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
}
export function resultError(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    if (cause.status === 403) return 'Bạn không có quyền xem kết quả đề thi này.';
    if (cause.status === 404) return 'Không tìm thấy đề thi hoặc bài làm.';
    if (cause.status === 409) return 'Bài làm chưa được nộp. Vui lòng tải lại kết quả sau khi sinh viên nộp bài.';
  }
  return 'Không tải được kết quả. Vui lòng thử lại.';
}

// Resolve stored option IDs to the actual option content; never calculate correctness or score here.
export function answerText(value: unknown, options: unknown): string {
  if (value === null || value === undefined) return 'Chưa trả lời';
  const wrapped = options && typeof options === 'object' && 'options' in options ? (options as { options: unknown }).options : options;
  const rows = Array.isArray(wrapped) ? wrapped : [];
  const label = (id: unknown): string => {
    const row = rows.find(option => option && typeof option === 'object' && String(option.id) === String(id));
    return row ? String(row.text ?? row.content ?? row.label ?? id) : String(id);
  };
  if (Array.isArray(value)) return value.length ? value.map(label).join('; ') : 'Chưa trả lời';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['selected_option_id', 'selected_option', 'correct_option_id', 'correct_option', 'selected_option_ids', 'selected_options', 'correct_option_ids', 'correct_options', 'answer', 'answers', 'text']) {
      if (key in record) return answerText(record[key], options);
    }
    return JSON.stringify(value);
  }
  return label(value);
}

export function exportResults(report: TeacherReport) {
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines: unknown[][] = [['MSSV', 'Họ tên', 'Trạng thái', 'Lần thi', 'Số câu đúng', 'Điểm', 'Điểm tối đa', 'Nộp lúc']];
  for (const row of report.results) {
    // Export all attempts rather than silently dropping previous submissions.
    for (const attempt of row.attempts.length ? row.attempts : [row]) lines.push([
      row.student_code, row.full_name, resultStatusLabels[attempt.status], attempt.attempt_number,
      attempt.correct_count, attempt.score, attempt.max_score, attempt.submitted_at,
    ]);
  }
  const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.map(line => line.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = `ket-qua-${report.exam.id}.csv`;
  document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
