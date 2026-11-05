import type { ClassroomSession } from './classroom';

export type RecordingStatus = 'NOT_STARTED' | 'STARTING' | 'RECORDING' | 'PROCESSING' | 'READY' | 'FAILED' | 'PUBLISHED' | 'UNPUBLISHED' | 'DELETED';
export type RecordingState = { id: string | null; status: RecordingStatus; active: boolean; started_at: string | null; available: boolean; updated_at?: string | null };
export type ClassRecording = { id: string; live_class_id: string; status: RecordingStatus; started_at: string | null; stopped_at: string | null; duration_seconds: number | null; file_size_bytes: number | null; published_at: string | null; created_at: string; updated_at: string; expires_at: string; error_code: string | null };
export type RecordingDetail = ClassRecording & { session: ClassroomSession };
export type RecordingList = { recordings: ClassRecording[]; recorded: boolean; processing: boolean; available: boolean };
export function latestRecordingState(a?: RecordingState | null, b?: RecordingState | null) {
  return !a ? b : !b ? a : new Date(a.updated_at || 0).getTime() > new Date(b.updated_at || 0).getTime() ? a : b;
}
export const recordingLabels: Record<RecordingStatus, string> = { NOT_STARTED: 'Chưa ghi hình', STARTING: 'Đang bắt đầu ghi', RECORDING: 'Đang ghi hình', PROCESSING: 'Đang xử lý bản ghi…', READY: 'Sẵn sàng', FAILED: 'Không thể xử lý bản ghi.', PUBLISHED: 'Đã công khai cho sinh viên', UNPUBLISHED: 'Đã ẩn khỏi sinh viên', DELETED: 'Đã xóa' };
export function recordingDuration(value: number | null) {
  if (value === null) return '—';
  return [Math.floor(value / 3600), Math.floor(value / 60) % 60, Math.floor(value) % 60].map(part => String(part).padStart(2, '0')).join(':');
}
