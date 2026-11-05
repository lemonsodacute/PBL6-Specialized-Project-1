import { ApiError } from './api';
import { aiErrorMessage, type AIProviderStatus } from './ai-provider';
import type { QuestionDifficulty, QuestionType } from '@/types';
import type { SelectionQuestion } from './question-selection';
import { nearDuplicateQuestion, type DraftQualityCheck, type DocumentQualitySummary } from './question-quality';

export type DocumentImage = { id: string; page: number | null; position: Record<string, unknown> | null;
  nearby_paragraph: string; nearest_section?: string; question_number: number | null; mime_type: string; byte_count: number; temp_url: string };

export type DocumentDraft = {
  id: string; content: string; type: QuestionType; difficulty: QuestionDifficulty | null;
  topic: string | null; default_points: number | string; options: string[]; answers: string[];
  explanation: string; source_page: number | null; source_section: string;
  source_chunk_id: string; source_excerpt: string; warnings: string[]; duplicate: boolean;
  images?: DocumentImage[]; warning_codes?: string[];
  quality_check?: DraftQualityCheck | null;
};
export type DocumentSession = {
  id: string; filename: string; expires_at: string; character_count: number; warnings: string[];
  sections?: { text: string; page: number | null; label: string }[];
  questions: DocumentDraft[]; batches: { index: number; count: number; complete: boolean; error?: { code: string; message: string } | null; generated_count?: number }[];
  config?: DocumentConfiguration | null; imported_count?: number | null;
  quality_summary?: DocumentQualitySummary;
  file_type?: string; page_count?: number | null; page_count_estimated?: boolean;
  image_count?: number; images?: DocumentImage[]; preview_text?: string;
  structured_question_count?: number | null; structure_parsed?: boolean;
};
export type DocumentConfiguration = {
  mode: 'import' | 'generate'; count: number; question_type: QuestionType;
  difficulty: QuestionDifficulty; topic: string | null;
};
export type DocumentCapabilities = { generation_available: boolean; provider_status?: AIProviderStatus; supports_text?: boolean; vision_available?: boolean; max_file_bytes: number; max_questions: number; formats: string[] };

export function draftSelectionQuestion(draft: DocumentDraft, bankId: string): SelectionQuestion {
  return { id: draft.id, question_bank_id: bankId, content: draft.content, type: draft.type,
    difficulty: draft.difficulty, topic: draft.topic, default_points: Number(draft.default_points), is_active: true,
    options_json: { options: draft.options }, correct_answer_json: draft.type === 'mcq_multi' ? { answers: draft.answers } : { answer: draft.answers[0] ?? '' },
    explanation: draft.explanation, images: draft.images?.map(image => ({ ...image, preview_url: image.temp_url })) };
}

export function updateDocumentDraft(original: DocumentDraft, edited: SelectionQuestion, documentImages: DocumentImage[] = []): DocumentDraft {
  const source = edited.options_json;
  const options = source && typeof source === 'object' && !Array.isArray(source) && Array.isArray(source.options)
    ? source.options.filter((option): option is string => typeof option === 'string') : [];
  const correct = edited.correct_answer_json;
  const answer = correct && typeof correct === 'object' && !Array.isArray(correct) ? correct.answer ?? correct.answers : null;
  return { ...original, content: edited.content, type: edited.type, difficulty: edited.difficulty,
    topic: edited.topic, default_points: edited.default_points, options: edited.type.startsWith('mcq_') ? options : [],
    answers: Array.isArray(answer) ? answer.map(String) : typeof answer === 'string' && answer ? [answer] : [],
    explanation: edited.explanation ?? '', warnings: [],
    duplicate: normalizeDraftContent(original.content) === normalizeDraftContent(edited.content) ? original.duplicate : false,
    quality_check: original.quality_check ? { ...original.quality_check, status: 'review', flags: ['EDITED_AFTER_CHECK'], grounded: null, assessed_difficulty: null } : undefined,
    images: edited.images?.map(image => [...documentImages, ...(original.images ?? [])].find(item => item.id === image.id))
      .filter((image): image is DocumentImage => !!image) ?? original.images };
}

export function draftProblems(draft: DocumentDraft): string[] {
  const problems: string[] = [];
  if (!draft.content.trim()) problems.push('Nội dung câu hỏi trống.');
  if (draft.content.length > 12000) problems.push('Nội dung câu hỏi không được vượt 12.000 ký tự.');
  if (!['mcq_single', 'mcq_multi', 'essay'].includes(draft.type)) problems.push('Loại câu hỏi không được hỗ trợ.');
  if (!Number.isFinite(Number(draft.default_points)) || Number(draft.default_points) <= 0 || Number(draft.default_points) > 9999.99)
    problems.push('Điểm mặc định cần lớn hơn 0 và không vượt 9999.99.');
  if (Math.abs(Number(draft.default_points) * 100 - Math.round(Number(draft.default_points) * 100)) > 1e-6)
    problems.push('Điểm mặc định chỉ dùng tối đa hai chữ số thập phân.');
  if ((draft.topic?.length ?? 0) > 255) problems.push('Chủ đề không được vượt 255 ký tự.');
  if (draft.explanation.length > 12000) problems.push('Giải thích không được vượt 12.000 ký tự.');
  if (draft.type.startsWith('mcq_')) {
    if (draft.options.length < 2 || draft.options.length > 12 || draft.options.some(option => !option.trim() || option.length > 4000)
      || new Set(draft.options.map(option => option.trim().toLocaleLowerCase())).size !== draft.options.length)
      problems.push('Cần từ 2 đến 12 phương án khác nhau, không để trống và không vượt 4.000 ký tự mỗi phương án.');
    if (!draft.answers.length || draft.answers.length > 12 || new Set(draft.answers).size !== draft.answers.length || draft.answers.some(answer => !draft.options.includes(answer))
      || (draft.type === 'mcq_single' && draft.answers.length !== 1)) problems.push('Chưa chọn đáp án đúng hợp lệ.');
  } else if (draft.answers.length !== 1 || !draft.answers[0]?.trim() || draft.answers[0].length > 12000) problems.push('Cần đáp án mẫu hoặc hướng dẫn trả lời không vượt 12.000 ký tự.');
  return problems;
}

export const normalizeDraftContent = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** Review feedback is optional analytics. Import still validates every selected draft. */
export function documentImportReview(drafts: DocumentDraft[], selectedIds: string[], existingContents: string[], documentImages: DocumentImage[] = []) {
  const selected = new Set(selectedIds);
  const selection = drafts.filter(draft => selected.has(draft.id));
  const existing = new Set(existingContents.map(normalizeDraftContent));
  const counts = new Map<string, number>();
  selection.forEach(draft => {
    const content = normalizeDraftContent(draft.content);
    counts.set(content, (counts.get(content) ?? 0) + 1);
  });
  const imageIds = new Set(documentImages.map(image => image.id));
  const problems = new Map(drafts.map(draft => {
    const issues = draftProblems(draft);
    const content = normalizeDraftContent(draft.content);
    if (existing.has(content)) issues.push('Câu hỏi này có thể đã tồn tại trong ngân hàng. Vui lòng sửa hoặc bỏ chọn câu trùng.');
    else if (existingContents.some(old => nearDuplicateQuestion(draft.content, old))) issues.push('Câu hỏi gần trùng hoặc diễn đạt lại nội dung đã có trong ngân hàng.');
    if (draft.quality_check?.flags.includes('POTENTIAL_DUPLICATE')) issues.push('Câu hỏi có thể trùng nội dung. Vui lòng sửa hoặc bỏ chọn.');
    if (selected.has(draft.id) && selection.some(other => other.id !== draft.id && nearDuplicateQuestion(draft.content, other.content)))
      issues.push('Câu hỏi gần trùng với câu khác đang chọn. Vui lòng chỉ chọn một câu.');
    if (selected.has(draft.id) && (counts.get(content) ?? 0) > 1) issues.push('Nội dung trùng với câu khác đang chọn. Vui lòng chỉ chọn một câu hoặc sửa nội dung.');
    const images = draft.images ?? [];
    if (images.some(image => !imageIds.has(image.id)) || new Set(images.map(image => image.id)).size !== images.length)
      issues.push('Hình ảnh nguồn chưa khớp với tài liệu. Vui lòng tải lại phiên tài liệu.');
    return [draft.id, issues] as const;
  }));
  const invalidCount = selection.filter(draft => problems.get(draft.id)!.length > 0).length;
  return { selection, problems, invalidCount, readyCount: selection.length - invalidCount };
}

const publicCodes = new Set(['UNSUPPORTED_DOCUMENT', 'DOCUMENT_TOO_LARGE', 'DOCUMENT_TOO_LONG', 'ENCRYPTED_DOCUMENT',
  'CORRUPT_DOCUMENT', 'DOCUMENT_HAS_NO_TEXT', 'DOCUMENT_HAS_TOO_LITTLE_TEXT', 'DOCUMENT_PARSE_TIMEOUT', 'DOCUMENT_BUSY', 'DOCUMENT_NOT_FOUND',
  'DOCUMENT_EXPIRED', 'NO_IMPORTABLE_QUESTIONS', 'TOO_MANY_DRAFTS', 'GENERATION_NOT_CONFIGURED',
  'GENERATION_TIMEOUT', 'GENERATION_UNAVAILABLE', 'INVALID_GENERATION', 'UNGROUNDED_GENERATION',
  'DOCUMENT_ALREADY_IMPORTED', 'DUPLICATE_QUESTIONS', 'IMPORT_FAILED', 'DOCUMENT_STORAGE_ERROR', 'INVALID_DRAFT', 'INVALID_BATCH',
  'IMAGE_REQUIRES_VISION', 'UNSUPPORTED_DOCUMENT_IMAGE']);
export function documentError(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError && aiErrorMessage(cause.code)) return aiErrorMessage(cause.code)!;
  if (cause instanceof ApiError && publicCodes.has(cause.code ?? '')) return cause.message;
  if (cause instanceof ApiError && cause.status === 429) return aiErrorMessage('AI_RATE_LIMITED')!;
  if (cause instanceof ApiError && [0, 408, 502, 503, 504].includes(cause.status)) return aiErrorMessage('AI_PROVIDER_UNAVAILABLE')!;
  if (cause instanceof ApiError && cause.status >= 500) return 'Máy chủ gặp lỗi khi tạo bản nháp. Vui lòng thử lại; quản trị viên có thể kiểm tra nhật ký AI.';
  if (cause instanceof SyntaxError) return aiErrorMessage('AI_INVALID_RESPONSE')!;
  if (cause instanceof ApiError && cause.status === 422) return 'Một câu hỏi chưa hợp lệ. Vui lòng kiểm tra nội dung, phương án, đáp án và điểm trước khi thêm.';
  return fallback;
}
