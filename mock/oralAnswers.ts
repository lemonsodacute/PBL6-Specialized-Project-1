import type { OralAnswer, OralGrading } from '@/types';

export const oralAnswers: OralAnswer[] = [
  { id: 'oral-answer-001', attempt_id: 'attempt-003', question_id: 'question-web-013', mode: 'async', video_url: '/mock/oral-answer-001.webm', duration_sec: 78, prep_time_used_sec: 18, status: 'processed', transcript_text: 'Semantic HTML giúp trình duyệt và công cụ hỗ trợ hiểu cấu trúc nội dung, từ đó cải thiện khả năng truy cập.', transcript_generated_at: '2026-09-09T08:47:00.000Z', recorded_at: '2026-09-09T08:45:00.000Z', deleted_at: null, created_at: '2026-09-09T08:45:00.000Z', updated_at: '2026-09-09T08:47:00.000Z' },
  { id: 'oral-answer-002', attempt_id: 'attempt-006', question_id: 'question-web-014', mode: 'async', video_url: '/mock/oral-answer-002.webm', duration_sec: 84, prep_time_used_sec: 20, status: 'processed', transcript_text: 'Event bubbling là cơ chế sự kiện lan truyền từ phần tử con lên các phần tử cha trong cây DOM.', transcript_generated_at: '2026-09-14T09:20:00.000Z', recorded_at: '2026-09-14T09:18:00.000Z', deleted_at: null, created_at: '2026-09-14T09:18:00.000Z', updated_at: '2026-09-14T09:20:00.000Z' },
];

export const oralGradings: OralGrading[] = [
  { id: 'oral-grading-001', oral_answer_id: 'oral-answer-001', grader_id: 'user-teacher-001', score: 2.5, rubric_json: { content: 3, presentation: 2, confidence: 2 }, comment: 'Nắm được ý chính và diễn đạt rõ.', graded_at: '2026-09-09T09:00:00.000Z' },
  { id: 'oral-grading-002', oral_answer_id: 'oral-answer-001', grader_id: 'user-teacher-002', score: 2.75, rubric_json: { content: 3, presentation: 3, confidence: 2 }, comment: 'Câu trả lời đúng trọng tâm.', graded_at: '2026-09-09T09:10:00.000Z' },
];
