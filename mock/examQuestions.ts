import type { ExamQuestion } from '@/types';
import { questions } from './questions';
export const examQuestions: ExamQuestion[] = questions.slice(0, 10).map((question, index) => ({ id: `exam-question-001-${String(index + 1).padStart(2, '0')}`, exam_id: 'exam-web-001', question_id: question.id, draw_rule_id: null, order_index: index + 1, points: question.default_points, created_at: '2026-09-01T08:00:00.000Z' }));
export const ongoingExamQuestions: ExamQuestion[] = questions.slice(5, 15).map((question, index) => ({ id: `exam-question-002-${String(index + 1).padStart(2, '0')}`, exam_id: 'exam-web-002', question_id: question.id, draw_rule_id: null, order_index: index + 1, points: question.default_points, created_at: '2026-09-03T08:00:00.000Z' }));
export const allExamQuestions = [...examQuestions, ...ongoingExamQuestions];
