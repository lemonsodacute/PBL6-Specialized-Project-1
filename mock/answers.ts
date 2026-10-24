import type { Answer, JsonValue } from '@/types';

const date = '2026-09-09T08:45:00.000Z';
const answer = (id: string, attempt_id: string, question_id: string, answer_content: JsonValue, is_correct: boolean | null, points_awarded: number | null): Answer => ({ id, attempt_id, question_id, answer_content, is_correct, points_awarded, graded_by: points_awarded === null ? null : 'user-teacher-001', graded_at: points_awarded === null ? null : date, answered_at: date, updated_at: date });

export const answers: Answer[] = [
  answer('answer-003-01', 'attempt-003', 'question-web-006', ['Cookie'], true, 1),
  answer('answer-003-02', 'attempt-003', 'question-web-007', ['justify-content'], true, 1),
  answer('answer-003-03', 'attempt-003', 'question-web-008', ['React', 'Vue', 'Angular'], true, 1.5),
  answer('answer-003-04', 'attempt-003', 'question-web-009', ['Đổi object thành chuỗi JSON'], true, 1),
  answer('answer-003-05', 'attempt-003', 'question-web-010', ['padding'], true, 1),
  answer('answer-003-06', 'attempt-003', 'question-web-011', 'localStorage tồn tại lâu hơn sessionStorage và có thể dùng lại sau khi đóng tab.', null, null),
  answer('answer-003-07', 'attempt-003', 'question-web-012', 'Trình duyệt phân giải DNS, gửi request, nhận response rồi parse HTML/CSS để render.', null, null),
  answer('answer-003-08', 'attempt-003', 'question-web-013', 'Semantic HTML giúp trình đọc màn hình hiểu cấu trúc và vai trò của nội dung.', true, 2.5),
  answer('answer-003-09', 'attempt-003', 'question-web-014', 'Event bubbling lan truyền event từ phần tử con lên các phần tử cha.', true, 2.5),
  answer('answer-003-10', 'attempt-003', 'question-web-015', 'Responsive thay đổi linh hoạt theo viewport, adaptive dùng các layout breakpoint định trước.', true, 2),
  answer('answer-004-01', 'attempt-004', 'question-web-006', ['Cookie'], true, 1),
  answer('answer-004-02', 'attempt-004', 'question-web-007', ['align-items'], false, 0),
  answer('answer-004-03', 'attempt-004', 'question-web-008', ['React', 'Vue'], false, 0),
  answer('answer-004-04', 'attempt-004', 'question-web-009', ['Đổi object thành chuỗi JSON'], true, 1),
  answer('answer-004-05', 'attempt-004', 'question-web-010', ['padding'], true, 1),
  answer('answer-006-01', 'attempt-006', 'question-web-001', ['<a>'], true, 1),
  answer('answer-006-02', 'attempt-006', 'question-web-002', ['200'], true, 1),
  answer('answer-006-03', 'attempt-006', 'question-web-003', ['string', 'number', 'boolean'], true, 1.5),
  answer('answer-006-04', 'attempt-006', 'question-web-004', ['color'], true, 1),
  answer('answer-006-05', 'attempt-006', 'question-web-005', ['GET', 'POST'], false, 0),
  answer('answer-006-06', 'attempt-006', 'question-web-006', ['Cookie'], true, 1),
  answer('answer-006-07', 'attempt-006', 'question-web-007', ['justify-content'], true, 1),
  answer('answer-006-08', 'attempt-006', 'question-web-008', ['React', 'Vue', 'Angular'], true, 1.5),
  answer('answer-006-09', 'attempt-006', 'question-web-009', ['Đổi object thành chuỗi JSON'], true, 1),
  answer('answer-006-10', 'attempt-006', 'question-web-010', ['padding'], true, 1),
];
