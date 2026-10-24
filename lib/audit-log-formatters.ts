/** Presentation only. Keep raw audit data intact for the technical disclosure. */
export type AuditRow = {
  id: string; user_id?: string | null; action: string; entity_type: string | null;
  entity_id: string | null; metadata: unknown; ip_address?: string | null; created_at: string;
  user: { id?: string; full_name: string; email: string; role: string } | null;
  target?: { name: string; email?: string; role?: string; student_code?: string | null; description?: string; deleted?: boolean } | null;
};

const actions: Record<string, string> = {
  login_success: 'Đăng nhập thành công', login_failed: 'Đăng nhập thất bại',
  profile_updated: 'Cập nhật hồ sơ', student_phone_updated: 'Cập nhật số điện thoại',
  profile_updated_from_student_card: 'Cập nhật hồ sơ từ thẻ sinh viên',
  student_card_confirmed: 'Xác nhận thẻ sinh viên', card_verified: 'Xác thực thẻ sinh viên',
  card_update_requested: 'Yêu cầu cập nhật thẻ', card_revoked: 'Thu hồi xác thực thẻ', card_replaced: 'Thay thẻ sinh viên',
  notification_sent: 'Gửi thông báo', card_notification_sent: 'Gửi thông báo về thẻ sinh viên',
  exam_created: 'Tạo đề thi', exam_updated: 'Cập nhật đề thi', exam_published: 'Xuất bản đề thi', exam_closed: 'Đóng đề thi',
  user_created: 'Tạo tài khoản', user_updated: 'Cập nhật người dùng', user_disabled: 'Khóa tài khoản', user_deactivated: 'Vô hiệu hóa tài khoản',
  user_registered: 'Đăng ký tài khoản', user_password_reset: 'Đặt lại mật khẩu người dùng',
  password_reset_requested: 'Yêu cầu đặt lại mật khẩu', password_reset_completed: 'Hoàn tất đặt lại mật khẩu',
  student_identity_profile_verified: 'Xác minh hồ sơ sinh viên',
  system_settings_updated: 'Cập nhật cài đặt hệ thống', attempt_started: 'Bắt đầu làm bài',
  attempt_submitted: 'Nộp bài', attempt_auto_submitted: 'Tự động nộp bài', attempt_locked: 'Khóa bài làm do vi phạm',
  answer_graded: 'Chấm điểm câu trả lời', violation_recorded: 'Ghi nhận vi phạm',
  ai_question_generation_completed: 'AI tạo bản nháp câu hỏi', ai_question_imported: 'Nhập câu hỏi đã review',
  ai_support_escalated: 'Chuyển yêu cầu hỗ trợ đến Admin', support_article_created: 'Tạo bài hướng dẫn Support',
  support_article_updated: 'Cập nhật bài hướng dẫn Support', support_article_disabled: 'Ngừng dùng bài hướng dẫn Support',
};
const uppercaseActions = new Set(['profile_updated', 'profile_updated_from_student_card', 'student_card_confirmed', 'card_verified', 'card_update_requested', 'card_revoked', 'card_replaced', 'card_notification_sent', 'system_settings_updated']);
// Select the exact codes emitted by the backend. Display also accepts case variants.
export const auditActionOptions = Object.keys(actions).map(key => ({
  value: uppercaseActions.has(key) || key.startsWith('ai_') || key.startsWith('support_article_') ? key.toUpperCase() : key, label: actions[key],
}));

const fields: Record<string, string> = {
  phone: 'Số điện thoại', full_name: 'Họ và tên', student_code: 'MSSV', class_name: 'Lớp', email: 'Email', role: 'Vai trò',
  status: 'Trạng thái tài khoản', is_active: 'Trạng thái tài khoản', identity_profile_status: 'Trạng thái xác minh hồ sơ',
  student_card_status: 'Trạng thái thẻ sinh viên', identity_profile_version: 'Phiên bản hồ sơ xác minh',
  avatar: 'Ảnh đại diện', avatar_url: 'Ảnh đại diện', exam_duration_minutes: 'Thời gian làm bài (phút)',
  exam_require_camera: 'Yêu cầu camera', exam_require_mic: 'Yêu cầu micro', support_text: 'Thông tin hỗ trợ',
};
const roles: Record<string, string> = { student: 'Sinh viên', teacher: 'Giảng viên', admin: 'Quản trị viên' };
const entities: Record<string, string> = { user: 'Người dùng', student: 'Sinh viên', student_card: 'Thẻ sinh viên', exam: 'Đề thi', attempt: 'Lượt làm bài', answer: 'Câu trả lời', notification: 'Thông báo', conversation: 'Cuộc trò chuyện', system_settings: 'Cài đặt hệ thống', ai_activity: 'Hoạt động AI', support_article: 'Bài hướng dẫn Support', support_session: 'Phiên hỗ trợ', question_bank: 'Ngân hàng câu hỏi' };
const states: Record<string, string> = { PENDING: 'Chờ xác minh', VERIFIED: 'Đã xác minh', NOT_SUBMITTED: 'Chưa gửi', PENDING_CONFIRMATION: 'Chờ xác nhận', NEEDS_REUPLOAD: 'Cần tải lại', active: 'Đang hoạt động', inactive: 'Đã khóa', disabled: 'Đã khóa' };
const summaries: Record<string, string> = {
  login_success: 'Đăng nhập vào hệ thống', login_failed: 'Đăng nhập không thành công',
  student_card_confirmed: 'Thẻ sinh viên đã được xác nhận.', card_verified: 'Thẻ sinh viên đã được xác thực.',
  card_update_requested: 'Đã yêu cầu cập nhật thẻ sinh viên.', card_revoked: 'Đã thu hồi xác thực thẻ sinh viên.',
  card_replaced: 'Đã thay thẻ sinh viên.', notification_sent: 'Đã gửi thông báo.', card_notification_sent: 'Đã gửi thông báo về thẻ sinh viên.',
};
const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const textValue = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const humanText = (value: string) => value.replace(uuid, id => `${id.slice(0, 8)}…`);
const own = (map: Record<string, string>, key: string) => Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
export const formatAuditAction = (action: string) => own(actions, action.toLowerCase()) ?? 'Hoạt động khác';
export const formatAuditField = (field: string) => own(fields, field) ?? 'Thông tin khác';
export const formatAuditRole = (role?: string) => role ? own(roles, role.toLowerCase()) ?? 'Vai trò khác' : 'Chưa ghi nhận vai trò';
export function auditMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function formatAuditActor(row: AuditRow) {
  const metadata = auditMetadata(row.metadata);
  return {
    name: humanText(row.user?.full_name || textValue(metadata.actor_name) || (row.user_id ? 'Không tìm thấy người thực hiện' : 'Hệ thống / Ẩn danh')),
    email: row.user?.email,
    role: formatAuditRole(row.user?.role || textValue(metadata.actor_role)),
  };
}
export function formatAuditTarget(row: AuditRow) {
  const label = row.entity_type === 'user' && row.target?.role ? formatAuditRole(row.target.role) : own(entities, row.entity_type ?? '') ?? 'Đối tượng';
  if (row.target?.name) return {
    label, name: humanText(`${row.target.name}${row.target.deleted ? ' (đã xóa)' : ''}`),
    description: humanText([row.target.description, row.target.student_code ? `MSSV: ${row.target.student_code}` : null].filter(Boolean).join(' · ')),
  };
  return { label, name: row.entity_id ? `Chưa tìm thấy thông tin · ${row.entity_id.slice(0, 8)}…` : row.entity_type === 'system_settings' ? 'Cấu hình chung' : 'Không có thông tin đối tượng', description: '' };
}
export function formatAuditTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Chưa ghi nhận thời gian' : date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
function fieldValue(key: string, value: unknown): string | undefined {
  if (value === null) return 'Chưa có';
  if (typeof value === 'boolean') return key === 'is_active' ? value ? 'Đang hoạt động' : 'Đã khóa' : value ? 'Bật' : 'Tắt';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const text = textValue(value);
  if (!text) return undefined;
  if (key === 'role') return formatAuditRole(text);
  if (['status', 'identity_profile_status', 'student_card_status'].includes(key)) return own(states, text) ?? 'Trạng thái khác';
  return humanText(text);
}
export function formatAuditDetails(row: AuditRow) {
  const data = auditMetadata(row.metadata);
  const changes = auditMetadata(data.changes);
  const fieldKeys = [...new Set([
    ...(Array.isArray(data.fields) ? data.fields : []),
    ...(Array.isArray(data.fields_changed) ? data.fields_changed : []),
    ...Object.keys(changes),
  ].filter((key): key is string => typeof key === 'string'))];
  const changedFields = [...new Set(fieldKeys.map(formatAuditField))];
  const facts: { label: string; value: string }[] = [];
  const add = (label: string, value: unknown) => { const text = textValue(value); if (text) facts.push({ label, value: humanText(text) }); };
  if (typeof data.identity_profile_version === 'number' && Number.isInteger(data.identity_profile_version) && data.identity_profile_version > 0) add('Phiên bản hồ sơ xác minh', String(data.identity_profile_version));
  add('Lý do', data.reason);
  if (textValue(data.role)) add('Vai trò tài khoản', formatAuditRole(data.role as string));
  if (row.action.toLowerCase() === 'login_failed') add('Email đăng nhập', data.email);
  for (const [key, label] of [['score', 'Điểm bài làm'], ['points_awarded', 'Điểm được chấm'], ['violation_count', 'Số vi phạm']] as const) {
    const value = data[key];
    if ((typeof value === 'number' || typeof value === 'string') && String(value).trim() && Number.isFinite(Number(value))) add(label, String(value));
  }
  if (['notification_sent', 'card_notification_sent'].includes(row.action.toLowerCase())) add('Thông báo', 'Đã gửi thông báo');
  const beforeAfter = Object.entries(changes).flatMap(([key, raw]) => {
    if (!own(fields, key)) return [];
    const change = auditMetadata(raw);
    const before = fieldValue(key, change.old), after = fieldValue(key, change.new);
    return before !== undefined && after !== undefined ? [{ label: formatAuditField(key), before, after }] : [];
  });
  const summary = changedFields.length
    ? `Cập nhật: ${changedFields.slice(0, 2).join(', ')}${changedFields.length > 2 ? ` và ${changedFields.length - 2} mục khác` : ''}`
    : own(summaries, row.action.toLowerCase()) ?? (facts.length ? `${facts[0].label}: ${facts[0].value}` : formatAuditAction(row.action));
  return { summary, changedFields, facts, beforeAfter };
}
export function auditTechnicalIds(row: AuditRow) {
  const data = auditMetadata(row.metadata);
  const ids = [{ label: 'ID nhật ký', value: row.id }, { label: 'ID người thực hiện', value: row.user_id ?? row.user?.id }, { label: 'ID đối tượng', value: row.entity_id }];
  for (const [key, value] of Object.entries(data)) if (key.endsWith('_id') && textValue(value)) ids.push({ label: key, value: value as string });
  return ids.filter((entry): entry is { label: string; value: string } => Boolean(entry.value));
}
export function formatRawAuditMetadata(metadata: unknown): string {
  if (metadata === undefined) return 'null';
  try { return JSON.stringify(metadata, null, 2) ?? 'null'; } catch { return 'Không thể hiển thị dữ liệu kỹ thuật.'; }
}
