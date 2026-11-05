export const qualityReasons = {
  UNSUPPORTED: 'Thiếu nguồn hỗ trợ rõ ràng cho đáp án',
  AMBIGUOUS: 'Đáp án có thể chưa rõ hoặc chưa khớp nguồn',
  WEAK_DISTRACTORS: 'Phương án nhiễu cần thuyết phục hơn',
  DIFFICULTY_MISMATCH: 'Mức độ tư duy chưa khớp độ khó đã chọn',
  INCOMPLETE: 'Câu hỏi hoặc hướng dẫn trả lời chưa đầy đủ',
  POTENTIAL_DUPLICATE: 'Câu hỏi có thể trùng nội dung',
  REVIEW_UNAVAILABLE: 'Chưa hoàn tất kiểm tra tự động',
  EDITED_AFTER_CHECK: 'Đã sửa nội dung; cần kiểm tra lại',
  IMAGE_NOT_VERIFIED: 'Cần kiểm tra thêm hình ảnh nguồn',
} as const;
export type QualityFlag = keyof typeof qualityReasons;
export type DraftQualityCheck = { status: 'pass' | 'review'; flags: QualityFlag[]; grounded: boolean | null;
  assessed_difficulty: 'easy' | 'medium' | 'hard' | null; fingerprint: string };
export type DocumentQualitySummary = { generated: number; valid: number; needs_review: number; rejected: number;
  duplicate: number; unsupported: number; ambiguous: number; source_ids_used: string[]; source_ids_planned: string[] };

function canonicalQuestion(value: string) {
  const stop = new Set(['the', 'a', 'an', 'of', 'is', 'are', 'hay', 'cho', 'biet', 've', 'mot', 'cua', 'trong', 'nao', 'gi', 'la']);
  return value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/\b(restful|rest-api)\b/g, 'rest api')
    .replace(/\b(what is|what are|definition of|define|khai niem|dinh nghia|la gi|the nao la)\b/g, ' ')
    .match(/[a-z0-9]+/g)?.filter(word => !stop.has(word)).join(' ') ?? '';
}
export function nearDuplicateQuestion(left: string, right: string) {
  const a = canonicalQuestion(left), b = canonicalQuestion(right);
  if (!a || !b) return false;
  const guards = (text: string) => text.split(' ').filter(word => ['not', 'no', 'except', 'without', 'khong', 'ngoai', 'sai'].includes(word) || /^\d+$/.test(word)).sort().join(' ');
  if (guards(a) !== guards(b)) return false;
  if (a === b && a.length >= 4) return true;
  const x = new Set(a.split(' ')), y = new Set(b.split(' '));
  const intersection = [...x].filter(word => y.has(word)).length;
  // The backend also checks character similarity. This conservative client hint
  // catches substantial lexical overlap; the server remains authoritative.
  return Math.min(x.size, y.size) >= 4 && intersection / new Set([...x, ...y]).size >= .9;
}
