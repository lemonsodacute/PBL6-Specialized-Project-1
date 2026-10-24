export type AIErrorCode = 'AI_NOT_CONFIGURED' | 'AI_AUTH_FAILED' | 'AI_RATE_LIMITED' | 'AI_INVALID_RESPONSE' | 'AI_PROVIDER_UNAVAILABLE' | 'AI_REQUEST_FAILED' | 'AI_MODEL_UNSUPPORTED';
export type AIError = { code: AIErrorCode; message: string };
export type AIProviderStatus = { configured: boolean; error: AIError | null };

export const aiErrorMessages: Record<AIErrorCode, string> = {
  AI_NOT_CONFIGURED: 'Dịch vụ AI chưa được cấu hình trên máy chủ.',
  AI_AUTH_FAILED: 'Cấu hình AI không hợp lệ. Quản trị viên cần kiểm tra API key và quyền truy cập.',
  AI_RATE_LIMITED: 'Đã đạt giới hạn AI tạm thời. Vui lòng thử lại sau.',
  AI_INVALID_RESPONSE: 'AI trả dữ liệu không đúng định dạng. Vui lòng thử lại.',
  AI_PROVIDER_UNAVAILABLE: 'Dịch vụ AI đang tạm thời không khả dụng.',
  AI_REQUEST_FAILED: 'Yêu cầu AI thất bại. Quản trị viên cần kiểm tra API key, quyền truy cập và cấu hình kết nối.',
  AI_MODEL_UNSUPPORTED: 'Model AI không tồn tại, chưa được cấp quyền hoặc không hỗ trợ tính năng yêu cầu. Quản trị viên cần kiểm tra model.',
};
export function aiErrorMessage(code?: string): string | undefined {
  return code && Object.prototype.hasOwnProperty.call(aiErrorMessages, code) ? aiErrorMessages[code as AIErrorCode] : undefined;
}
