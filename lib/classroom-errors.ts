import { ApiError } from './api';

export const classroomErrors = {
  ROOM_NOT_LIVE: 'Buổi học chưa bắt đầu.',
  SESSION_ENDED: 'Buổi học đã kết thúc.',
  SESSION_NOT_FOUND: 'Không tìm thấy buổi học hoặc bạn không có quyền truy cập.',
  UNAUTHORIZED: 'Bạn không có quyền vào phòng hoặc phiên đăng nhập đã hết hạn.',
  TOKEN_REQUEST_FAILED: 'Không tạo được quyền truy cập phòng học.',
  REALTIME_CONFIG_MISSING: 'Dịch vụ lớp học trực tuyến chưa được cấu hình.',
  REALTIME_CONNECTION_FAILED: 'Không kết nối được máy chủ lớp học trực tuyến.',
  NETWORK_ERROR: 'Không kết nối được API. Kiểm tra mạng rồi thử lại.',
  DEVICE_PERMISSION_ERROR: 'Không thể truy cập camera hoặc microphone. Bạn vẫn có thể ở trong phòng với thiết bị tắt.',
} as const;
export type ClassroomErrorCode = keyof typeof classroomErrors;
export class ClassroomError extends Error {
  constructor(public code: ClassroomErrorCode) { super(classroomErrors[code]); }
}

export function classroomError(cause: unknown, stage: 'session' | 'token' | 'connection' | 'device'): ClassroomError {
  if (cause instanceof ClassroomError) return cause;
  if (stage === 'device') return new ClassroomError('DEVICE_PERMISSION_ERROR');
  if (cause instanceof ApiError) {
    if (cause.status === 401 || cause.status === 403) return new ClassroomError('UNAUTHORIZED');
    if (cause.status === 404) return new ClassroomError('SESSION_NOT_FOUND');
    if (cause.code && Object.hasOwn(classroomErrors, cause.code)) return new ClassroomError(cause.code as ClassroomErrorCode);
    // Accept old API nodes while backend/frontend are being rolled out.
    if (cause.code === 'CLASSROOM_NOT_CONFIGURED') return new ClassroomError('REALTIME_CONFIG_MISSING');
    if (cause.code === 'CLASSROOM_PROVIDER_UNAVAILABLE') return new ClassroomError('REALTIME_CONNECTION_FAILED');
    if (cause.code === 'LIVE_CLASS_NOT_ONGOING') return new ClassroomError('ROOM_NOT_LIVE');
    if (cause.status === 0 || cause.status === 408) return new ClassroomError('NETWORK_ERROR');
  }
  if (stage !== 'connection' && cause instanceof TypeError) return new ClassroomError('NETWORK_ERROR');
  return new ClassroomError(stage === 'connection' ? 'REALTIME_CONNECTION_FAILED' : 'TOKEN_REQUEST_FAILED');
}

/** Deliberately excludes arbitrary objects, URLs, tokens and SDK errors. */
export function traceClassroom(step: string, fields: {
  session_id: string; session_status?: string; provider?: string;
  token_request_status?: number | 'pending'; server_url_configured?: boolean;
  room_name?: string; connection_state?: string; safe_error_code?: ClassroomErrorCode;
}) {
  if (process.env.NODE_ENV !== 'production') console.info('[classroom]', step, JSON.stringify(fields));
}

export function validateClassroomUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new ClassroomError('REALTIME_CONFIG_MISSING'); }
  const loopback = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || (window.location.protocol === 'https:' && url.protocol !== 'wss:')
    || (!loopback(window.location.hostname) && loopback(url.hostname))) {
    throw new ClassroomError('REALTIME_CONFIG_MISSING');
  }
}
