import { ApiError } from './api';

/** UI copy must not surface server messages, SQL errors, or validation JSON. */
export function friendlyError(cause: unknown, fallback = 'Không thể hoàn tất thao tác. Vui lòng thử lại.'): string {
  if (!(cause instanceof ApiError)) return cause instanceof TypeError ? 'Không thể kết nối đến máy chủ. Vui lòng thử lại.' : fallback;
  if (cause.status === 0 || cause.status === 408) return 'Không thể kết nối đến máy chủ. Vui lòng thử lại.';
  if (cause.status === 429) return 'Bạn đã thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.';
  if (cause.code === 'EMAIL_EXISTS') return 'Email này đã được sử dụng.';
  if (cause.code === 'STUDENT_ALREADY_ENROLLED' || cause.code === 'ALREADY_ENROLLED') return 'Sinh viên này đã thuộc lớp.';
  if (cause.code === 'ORAL_EXAMS_DISABLED') return 'Hình thức thi này đã ngừng hỗ trợ. Vui lòng dùng câu hỏi trắc nghiệm hoặc tự luận.';
  if (cause.code === 'INVALID_CREDENTIALS') return 'Email hoặc mật khẩu không chính xác.';
  if (cause.code === 'INVALID_RESET_TOKEN') return 'Mã đặt lại không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu mã mới.';
  if (['ACCOUNT_DISABLED', 'USER_INACTIVE', 'ACCOUNT_INACTIVE'].includes(cause.code ?? '')) return 'Tài khoản hiện không thể đăng nhập.';
  if (cause.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  if (cause.status === 403) return 'Bạn không có quyền thực hiện thao tác này.';
  if (cause.status === 422) return 'Thông tin chưa hợp lệ. Vui lòng kiểm tra các trường và thử lại.';
  return fallback;
}
