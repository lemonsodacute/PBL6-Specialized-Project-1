export type CardStatus = {
  identity_profile_status: 'PENDING' | 'VERIFIED';
  student_card_status: string;
  has_reference: boolean;
  reference_version: string | null;
  updated_at: string | null;
  update_reason?: string | null;
  card_admin_version?: number;
  was_revoked?: boolean;
  reference_status?: 'ACTIVE' | 'SUPERSEDED' | 'INVALIDATED' | 'REVOKED' | null;
  update_requested?: boolean;
};

export function cardProfileState(status: CardStatus | null): 'verified' | 'update' | 'invalid' | 'not_submitted' | 'unavailable' {
  if (!status) return 'unavailable';
  if (status.identity_profile_status === 'VERIFIED' && status.student_card_status === 'VERIFIED' && status.has_reference
    && (!status.reference_status || status.reference_status === 'ACTIVE') && !status.was_revoked) return 'verified';
  if (status.student_card_status === 'NOT_SUBMITTED') return 'not_submitted';
  if (status.was_revoked || status.student_card_status === 'REVOKED' || status.reference_status === 'REVOKED') return 'invalid';
  if (status.update_requested || ['REQUIRES_UPDATE', 'NEEDS_REUPLOAD'].includes(status.student_card_status)) return 'update';
  if (status.student_card_status === 'INVALIDATED' || status.reference_status === 'INVALIDATED') return 'invalid';
  if (['NOT_SUBMITTED', 'PENDING_CONFIRMATION'].includes(status.student_card_status)) return 'not_submitted';
  return 'unavailable';
}

export type CardPreview = {
  preview_id: string;
  expires_at: string;
  card_preview_url: string;
  face_preview_url: string;
  extracted: { full_name: string | null; ocr_display_name?: string | null; student_code: string | null; class_name?: string | null; class_confidence?: number | null; class_status?: 'READABLE' | 'CLASS_UNREADABLE'; major?: string | null };
  comparison: { name_match: boolean; name_match_type?: 'EXACT' | 'NORMALIZED' | 'MISMATCH' | 'UNREADABLE'; student_code_match: boolean; student_code_will_update?: boolean };
  can_confirm: boolean;
  blocking_errors: string[];
  warnings: string[];
};

export const cardErrorMessages: Record<string, string> = {
  NO_FACE_DETECTED: 'Không phát hiện khuôn mặt trên thẻ. Vui lòng chọn ảnh rõ nét hơn.',
  MULTIPLE_FACES_DETECTED: 'Phát hiện nhiều hơn một khuôn mặt. Vui lòng chọn ảnh thẻ chỉ có một khuôn mặt.',
  FACE_TOO_SMALL: 'Khuôn mặt trên thẻ quá nhỏ. Vui lòng chọn ảnh thẻ chụp gần hơn.',
  FACE_TOO_BLURRY: 'Khuôn mặt trên thẻ bị mờ. Vui lòng chọn ảnh rõ nét hơn.',
  FACE_TOO_DARK: 'Khuôn mặt trên thẻ quá tối. Vui lòng chọn ảnh đủ ánh sáng.',
  NAME_UNREADABLE: '⚠ Chưa đọc rõ họ tên.',
  NAME_LOW_CONFIDENCE: '⚠ Đã đọc được họ tên nhưng độ tin cậy chưa đủ. Vui lòng tải ảnh rõ nét hơn.',
  NAME_MISMATCH: '✕ Họ tên trên thẻ chưa phù hợp với hồ sơ.',
  STUDENT_CODE_UNREADABLE: '⚠ Chưa đọc rõ mã sinh viên.',
  STUDENT_CODE_MISMATCH: '✕ MSSV trên thẻ không khớp với hồ sơ. Vui lòng liên hệ quản trị viên.',
  STUDENT_CODE_EXISTS: 'MSSV trên thẻ đã thuộc hồ sơ khác. Vui lòng liên hệ quản trị viên.',
  PROFILE_MISMATCH: 'Thông tin trên thẻ không khớp hồ sơ.',
  OCR_FAILED: 'Thông tin chưa đủ rõ. Vui lòng chọn ảnh thẻ rõ nét hơn.',
  INVALID_IMAGE: 'Vui lòng chọn ảnh JPG hoặc PNG hợp lệ.',
  INVALID_IMAGE_TYPE: 'Vui lòng chọn ảnh JPG hoặc PNG hợp lệ.',
  IMAGE_TOO_LARGE: 'Ảnh thẻ không được vượt quá 8 MB.',
  MODEL_ERROR: 'Máy chủ chưa sẵn sàng đọc thẻ sinh viên. Vui lòng thử lại sau.',
  PROFILE_NOT_VERIFIED: 'Hồ sơ sinh viên chưa được xác nhận. Vui lòng kiểm tra lại hồ sơ.',
  PROFILE_CHANGED: 'Hồ sơ hoặc yêu cầu cập nhật thẻ đã thay đổi. Vui lòng tải lại ảnh thẻ.',
  PREVIEW_EXPIRED: 'Bản xem trước đã hết hạn. Vui lòng chọn lại ảnh thẻ.',
  PREVIEW_NOT_FOUND: 'Bản xem trước không còn khả dụng. Vui lòng chọn lại ảnh thẻ.',
  PREVIEW_SUPERSEDED: 'Bản xem trước đã được thay thế. Vui lòng chọn lại ảnh thẻ.',
  REFERENCE_SAVE_FAILED: 'Chưa lưu được ảnh định danh. Vui lòng thử xác nhận lại.',
};

// Validate the existing backend contract before it can reach JSX. Keep all fields,
// including partial OCR and can_confirm=false, rather than dropping the preview.
export function parseCardPreview(payload: unknown): CardPreview {
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
  const nullableText = (value: unknown) => value === null || typeof value === 'string';
  if (!object(payload) || typeof payload.preview_id !== 'string' || typeof payload.expires_at !== 'string'
    || !Number.isFinite(Date.parse(payload.expires_at)) || typeof payload.card_preview_url !== 'string' || typeof payload.face_preview_url !== 'string'
    || !object(payload.extracted) || !nullableText(payload.extracted.full_name) || !nullableText(payload.extracted.student_code)
    || (payload.extracted.class_name !== undefined && !nullableText(payload.extracted.class_name))
    || (payload.extracted.class_status !== undefined && !['READABLE', 'CLASS_UNREADABLE'].includes(String(payload.extracted.class_status)))
    || (payload.extracted.class_confidence !== undefined && payload.extracted.class_confidence !== null
      && (typeof payload.extracted.class_confidence !== 'number' || !Number.isFinite(payload.extracted.class_confidence)
        || payload.extracted.class_confidence < 0 || payload.extracted.class_confidence > 1))
    || !object(payload.comparison) || typeof payload.comparison.name_match !== 'boolean' || typeof payload.comparison.student_code_match !== 'boolean'
    || typeof payload.can_confirm !== 'boolean' || !strings(payload.blocking_errors) || !strings(payload.warnings)) {
    throw new Error('Máy chủ trả về bản xem trước không hợp lệ. Vui lòng thử lại.');
  }
  return payload as CardPreview;
}
