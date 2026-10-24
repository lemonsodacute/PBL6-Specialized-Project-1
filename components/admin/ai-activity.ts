import { ApiError } from '@/lib/api';
import { friendlyError } from '@/lib/uiErrors';

export type Rate = { numerator: number; denominator: number; rate: number | null };
export type Metrics = Record<string, number | boolean | null | Rate>;
export type Health = { provider: string; configured: boolean; question_model: string; support_model: string;
  last_success_at: string | null; last_error_at: string | null; last_error_code: string | null; provider_tier: string };
export type ActivityData = { question: Metrics; support: Metrics; rate_limit_errors: number; health: Health };
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';
export type Failure = { message: string; code: string | null; status: number | null };
export type DateWindow = { start: string; end: string };

export const day = (offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Ho_Chi_Minh', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(Date.now() - offset * 86400000));
export const count = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits:2 });
export const numberOf = (metrics: Metrics, key: string): number | null => typeof metrics[key] === 'number' && Number.isFinite(metrics[key]) ? metrics[key] as number : null;
export function rateOf(value: Metrics[string] | undefined): Rate | null {
  return value && typeof value === 'object' && Number.isFinite(value.numerator) && Number.isFinite(value.denominator) ? value : null;
}
export function divide(numerator: number | null, denominator: number | null): Rate | null {
  return numerator == null || denominator == null ? null : { numerator, denominator, rate:denominator > 0 ? numerator / denominator : null };
}
export function percent(rate: Rate): string | null {
  return rate.denominator > 0 && rate.rate != null && Number.isFinite(rate.rate) ? `${(rate.rate * 100).toLocaleString('vi-VN', { maximumFractionDigits:1 })}%` : null;
}
export function timestamp(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Chưa ghi nhận';
  return new Intl.DateTimeFormat('vi-VN', { timeZone:'Asia/Ho_Chi_Minh', hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit', year:'numeric' }).format(new Date(value));
}
export const codeOf = (value: string | null | undefined) => value && /^[A-Z][A-Z0-9_]{2,79}$/.test(value) ? value : null;
export const providerName = (value: string) => value === 'gemini-openai-compatible' ? 'Gemini' : value === 'openai_compatible' ? 'Dịch vụ AI tương thích OpenAI' : 'Dịch vụ AI';
export const configured = (value: string) => value === 'configured' ? 'Đã cấu hình' : value === 'missing' ? 'Chưa cấu hình' : 'Chưa xác định';
export const errorDescriptions: Record<string, string> = {
  AI_NOT_CONFIGURED:'Dịch vụ AI chưa được cấu hình trên máy chủ.',
  AI_AUTH_FAILED:'Dịch vụ AI không xác thực được. Cần kiểm tra cấu hình và quyền truy cập.',
  AI_RATE_LIMITED:'Dịch vụ AI đã chạm giới hạn yêu cầu tạm thời.',
  AI_INVALID_RESPONSE:'Dịch vụ AI trả về dữ liệu không đúng định dạng.',
  AI_PROVIDER_UNAVAILABLE:'Dịch vụ AI tạm thời không khả dụng.',
  AI_REQUEST_FAILED:'Yêu cầu AI thất bại. Cần kiểm tra cấu hình kết nối.',
  AI_MODEL_UNSUPPORTED:'Model chưa được cấp quyền hoặc không hỗ trợ tính năng yêu cầu.',
};
/** Configuration and historical events are not a live provider health probe. */
export function healthStatus(health: Health): { label: string; tone: Tone; note: string } {
  if (!health.configured) return { label:'Chưa cấu hình', tone:'warning', note:'Cấu hình dịch vụ AI chưa sẵn sàng.' };
  const success = health.last_success_at ? Date.parse(health.last_success_at) : NaN;
  const error = health.last_error_at ? Date.parse(health.last_error_at) : NaN;
  if (Number.isFinite(error) && (!Number.isFinite(success) || error >= success)) return {
    label:health.last_error_code === 'AI_PROVIDER_UNAVAILABLE' ? 'Lần gọi gần nhất không khả dụng' : 'Có sự cố gần nhất',
    tone:health.last_error_code === 'AI_RATE_LIMITED' ? 'warning' : 'danger', note:'Sự kiện lỗi mới hơn lần thành công được ghi nhận.',
  };
  if (Number.isFinite(success)) return { label:'Lần gọi gần nhất thành công', tone:'success', note:'Theo sự kiện gần nhất; không phải kiểm tra kết nối trực tiếp.' };
  return { label:'Chưa có hoạt động', tone:'neutral', note:'Đã cấu hình nhưng chưa ghi nhận sự kiện provider.' };
}
export function requestFailure(error: unknown, fallback: string): Failure {
  return { message:friendlyError(error, fallback), code:error instanceof ApiError ? codeOf(error.code) : null,
    status:error instanceof ApiError ? error.status : null };
}
