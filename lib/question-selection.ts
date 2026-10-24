import type { Question, QuestionDifficulty, SupportedQuestionType } from '@/types';

export type Bank = { id: string; name: string; subject?: string | null; description?: string | null; questions_count: number; created_at?: string; updated_at?: string };
export type SelectionQuestion = Pick<Question, 'id' | 'question_bank_id' | 'content' | 'type' | 'difficulty' | 'topic' | 'is_active' | 'default_points'> & Partial<Question> & { points?: number };
export type Filters = { query: string; type: string; difficulty: string; topic: string; status: string };
export const emptyFilters: Filters = { query: '', type: '', difficulty: '', topic: '', status: '' };
export const typeLabels: Record<SupportedQuestionType, string> = { mcq_single: 'Trắc nghiệm · Một đáp án', mcq_multi: 'Trắc nghiệm · Nhiều đáp án', essay: 'Tự luận' };
export const isSupportedQuestionType = (type: string): type is SupportedQuestionType => Object.hasOwn(typeLabels, type);
export const questionTypeLabel = (type: string) => isSupportedQuestionType(type) ? typeLabels[type] : 'Hình thức đã ngừng hỗ trợ';
export const difficultyLabels: Record<QuestionDifficulty, string> = { easy: 'Dễ', medium: 'Trung bình', hard: 'Khó' };
export function unwrap<T>(response: unknown): T { return ((response as { data?: T }).data ?? response) as T; }
export function normalizeQuestions(response: unknown): SelectionQuestion[] {
  return unwrap<SelectionQuestion[]>(response).map(q => ({ ...q, default_points: Number(q.default_points), is_active: q.is_active !== false, points: q.points === undefined ? undefined : Number(q.points) }));
}
export function searchText(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase(); }
export function filteredQuestions(questions: SelectionQuestion[], filters: Filters) {
  return questions.filter(q => isSupportedQuestionType(q.type) && (!filters.query || searchText(q.content).includes(searchText(filters.query.trim())))
    && (!filters.type || q.type === filters.type) && (!filters.topic || q.topic === filters.topic)
    && (!filters.difficulty || q.difficulty === filters.difficulty)
    && (!filters.status || q.is_active === (filters.status === 'active')));
}
export type RandomRule = { question_type?: string; topic?: string; difficulty?: string; difficulty_counts?: Record<string, number>; topic_counts?: Record<string, number> };
export type SelectionDraft = { bank_id: string; question_ids: string[] };
export const selectionDraftKey = (userId: string) => `ai-procto-exam-selection:${userId}`;
