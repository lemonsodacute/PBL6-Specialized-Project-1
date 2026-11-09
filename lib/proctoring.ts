import { api, apiFetch, getSessionToken, setSessionToken } from './api';

export type ProctorSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type ProctorStatus = 'NEW' | 'REVIEWED' | 'DISMISSED' | 'CONFIRMED';
export type ProctorStudent = { id: string; full_name: string; student_code: string | null };
export type ProctorEvent = {
  id: string; exam_id: string; attempt_id: string; student_id: string; student: ProctorStudent;
  source: string; provider: string; event_type: string; severity: ProctorSeverity;
  confidence: number | null; max_confidence: number | null; occurred_at: string; received_at: string;
  first_seen: string; last_seen: string; duration_ms: number; occurrence_count: number;
  message: string; metadata: Record<string, unknown> | null;
  evidence: { kind: 'metadata'; timestamp?: string; bounding_boxes?: number[][] } | null;
  has_snapshot?: boolean;
  status: ProctorStatus; is_simulated: boolean; reviewed_at: string | null; reviewed_by: string | null;
  review_note: string | null; review_version: number;
};
export type ReviewHistory = { id: string; action: string; at: string; actor: string | null; actor_id: string | null; status: ProctorStatus | null; note: string | null };
export type ProctorDetail = ProctorEvent & { exam: { id: string; title: string }; history: ReviewHistory[] };
export type ProctorSummary = { total: number; new: number; reviewed: number; dismissed: number; confirmed: number; high_priority: number; total_students: number; taking: number; submitted: number };
export type ProctorExam = { id: string; title: string; status: string; start_time: string; end_time: string };
export type ProctorFeed = { data: ProctorEvent[]; meta: { total: number; page: number; limit: number; summary: ProctorSummary; exam: ProctorExam; event_types?: string[] } };
export type ProctorHealth = { modules: { provider: string; label: string; source: string; status: 'ACTIVE' | 'DEGRADED' | 'UNAVAILABLE' | 'DISABLED'; error_code?: string | null; last_seen?: string | null }[]; simulator_enabled: boolean; message: string | null };
export type ProctorAttemptSummary = { id: string; student: ProctorStudent; attempt_number: number; status: string; started_at: string | null; submitted_at: string | null; total: number; highest_severity: ProctorSeverity | null; new: number; reviewed: number; confirmed: number; dismissed: number };
export type ProctorReport = { exam_id: string; exam_title: string; is_simulated: boolean; summary: ProctorSummary; types: { event_type: string; count: number }[]; students_requiring_review: (ProctorStudent & { count: number })[];
  exam: ProctorExam & { duration_minutes: number; teacher_name: string | null; classes: { id: string; name: string }[] }; attempts: ProctorAttemptSummary[]; pagination: { total: number; page: number; limit: number }; participating_students: number; total_attempts: number; students_with_alerts: number };
export type StudentTimeline = { attempt_id: string; exam_id: string; student: ProctorStudent; status: string; started_at: string | null; submitted_at: string | null; recording_url: string | null; total_events: number; truncated: boolean;
  summary?: { total: number; new: number; reviewed: number; confirmed: number; dismissed: number; highest_severity: ProctorSeverity | null };
  entries: { id: string; kind: 'started' | 'submitted' | 'event' | 'review'; at: string; label?: string; event?: ProctorEvent; event_id?: string; status?: ProctorStatus; actor?: string | null; note?: string | null }[] };
export type EventFilters = { q?: string; status?: string; priority?: boolean; event_type?: string; attempt_id?: string; simulated?: boolean; page?: number; limit?: number; order?: string };
export type ProctorChange = { type: string; data?: { id?: string; exam_id?: string; attempt_id?: string; is_simulated?: boolean; provider?: string } };

export const severityLabels: Record<ProctorSeverity, string> = { info: 'Thông tin', low: 'Thấp', medium: 'Trung bình', high: 'Cao', critical: 'Nghiêm trọng' };
export const statusLabels: Record<ProctorStatus, string> = { NEW: 'Chưa xem', REVIEWED: 'Đã xem', DISMISSED: 'Đã bỏ qua', CONFIRMED: 'Đã xác nhận' };
export const eventLabels: Record<string, string> = { person_in_background: 'Có thêm người trong khung hình', object_prohibited: 'Vật dụng cần xem xét', object_book: 'Phát hiện sách', multiple_faces: 'Nhiều khuôn mặt', face_not_detected: 'Không thấy khuôn mặt', gaze_away: 'Nhìn ra ngoài', head_turned: 'Quay đầu', person_left_frame: 'Rời khung hình', object_phone: 'Phát hiện điện thoại',
  object_headphone: 'Phát hiện tai nghe', tab_switched: 'Chuyển thẻ trình duyệt', audio_voice_detected: 'Âm thanh cần xem xét', browser_signal: 'Tín hiệu trình duyệt', window_blur: 'Cửa sổ mất tiêu điểm', copy: 'Sao chép', paste: 'Dán nội dung', fullscreen_exit: 'Thoát toàn màn hình', network_offline: 'Mất kết nối mạng', network_online: 'Kết nối mạng trở lại' };
export const eventLabel = (event: ProctorEvent) => eventLabels[event.event_type] ?? event.message ?? event.event_type;
export function eventTime(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date) : 'Chưa rõ giờ'; }
export function eventDate(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('vi-VN') : 'Chưa rõ thời gian'; }
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function query(values: Record<string, unknown>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') search.set(key, String(value));
  return search.toString();
}
function validEvent(event: ProctorEvent) {
  return !!event && typeof event.id === 'string' && typeof event.attempt_id === 'string' && !!event.student
    && event.severity in severityLabels && event.status in statusLabels && Number.isInteger(event.review_version)
    && typeof event.is_simulated === 'boolean';
}
export const proctorApi = {
  legacyEvidence: async (id: string, signal: AbortSignal) => {
    const root = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
    const token = getSessionToken();
    const response = await fetch(`${root}/api/v1/proctoring/events/${encodeURIComponent(id)}/evidence`, { signal, credentials: 'include', cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(response.headers.get('content-type')?.split(';')[0] ?? '')) throw new Error('Evidence unavailable');
    const blob = await response.blob();
    if (blob.size > 5 * 1024 * 1024) throw new Error('Evidence too large');
    return blob;
  },
  feed: async (examId: string, filters: EventFilters = {}) => {
    const result = await apiFetch<ProctorFeed>(`/proctoring/exams/${encodeURIComponent(examId)}/events?${query(filters)}`);
    if (!Array.isArray(result.data) || result.data.some(event => !validEvent(event) || event.exam_id !== examId || event.is_simulated !== Boolean(filters.simulated)) || !result.meta?.summary || result.meta.exam?.id !== examId) throw new Error('Invalid monitoring response');
    return result;
  },
  detail: async (id: string) => {
    const result = (await apiFetch<{ data: ProctorDetail }>(`/proctoring/events/${encodeURIComponent(id)}`)).data;
    if (!validEvent(result) || !Array.isArray(result.history)) throw new Error('Invalid monitoring event');
    return result;
  },
  review: async (event: ProctorEvent, status: Exclude<ProctorStatus, 'NEW'>, note?: string) =>
    (await apiFetch<{ data: ProctorDetail }>(`/proctoring/events/${encodeURIComponent(event.id)}/review`, { method: 'PATCH', body: { status, expected_version: event.review_version, note: note || null } })).data,
  health: async (examId: string) => {
    const result = (await apiFetch<{ data: ProctorHealth }>(`/proctoring/exams/${encodeURIComponent(examId)}/health`)).data;
    if (!result || !Array.isArray(result.modules) || typeof result.simulator_enabled !== 'boolean' || result.modules.some(module => !['ACTIVE', 'DEGRADED', 'UNAVAILABLE', 'DISABLED'].includes(module.status))) throw new Error('Invalid module health');
    return result;
  },
  report: async (examId: string, simulated = false, filters: { q?: string; page?: number; limit?: number; alert_filter?: string; severity?: string } = {}) => {
    const result = (await apiFetch<{ data: ProctorReport }>(`/proctoring/exams/${encodeURIComponent(examId)}/report?${query({ simulated, ...filters })}`)).data;
    if (!result || result.exam_id !== examId || result.is_simulated !== simulated || !result.summary || !Array.isArray(result.types) || !Array.isArray(result.students_requiring_review)) throw new Error('Invalid monitoring report');
    return result;
  },
  timeline: async (attemptId: string, simulated = false, examId?: string, page = 1) => {
    const result = (await apiFetch<{ data: StudentTimeline }>(`/proctoring/attempts/${encodeURIComponent(attemptId)}/timeline?${query({ simulated, exam_id: examId, page })}`)).data;
    if (!result || result.attempt_id !== attemptId || (examId && result.exam_id !== examId) || !result.student || !Array.isArray(result.entries) || result.entries.some(item => item.event && (!validEvent(item.event) || item.event.is_simulated !== simulated || item.event.attempt_id !== attemptId))) throw new Error('Invalid monitoring timeline');
    return result;
  },
};

export function proctorSocketUrl(examId?: string) {
  const root = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
  const url = new URL(`${root}/api/v1/${examId ? `ws/monitor/${encodeURIComponent(examId)}` : 'proctoring/ws'}`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/** Shared socket transport; bounded reconnection with a fresh REST snapshot on ready/resync. */
export function connectProctorSocket(userId: string, handlers: { change: (message: ProctorChange) => void; state: (connected: boolean) => void }, examId?: string) {
  let disposed = false, socket: WebSocket | null = null, failures = 0, refreshed = false;
  let reconnect: ReturnType<typeof setTimeout>, watchdog: ReturnType<typeof setTimeout>;
  const connect = () => {
    if (disposed) return;
    const current = new WebSocket(proctorSocketUrl(examId)); socket = current;
    const watch = (ms: number) => { clearTimeout(watchdog); watchdog = setTimeout(() => current.close(), ms); };
    watch(8000);
    current.onopen = () => current.send(JSON.stringify({ type: 'auth', token: getSessionToken() }));
    current.onmessage = event => {
      if (disposed || socket !== current) return;
      if (typeof event.data !== 'string' || event.data.length > 32768) { current.close(1009); return; }
      let message: ProctorChange;
      try { message = JSON.parse(event.data); } catch { return; }
      watch(60000);
      if (message.type === 'ping') { current.send('pong'); return; }
      if (message.type === 'ready') { failures = 0; refreshed = false; handlers.state(true); }
      if (['ready', 'resync', 'proctor_event_created', 'proctor_event_updated', 'proctor_event_reviewed', 'proctor_module_health', 'attempt_update', 'attempt_started', 'attempt_submitted', 'violation'].includes(message.type)) handlers.change(message);
    };
    current.onerror = () => current.close();
    current.onclose = async event => {
      clearTimeout(watchdog);
      if (disposed || socket !== current) return;
      handlers.state(false); failures++;
      if (event.code === 1008 && !examId) {
        if (refreshed) return; refreshed = true;
        try {
          const result = await api.auth.refresh();
          if (disposed || (result.user as { id?: string })?.id !== userId || !result.access_token) return;
          setSessionToken(result.access_token);
        } catch { return; }
      }
      if (event.code === 1008 && examId) return;
      if (!disposed) reconnect = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(failures, 5)));
    };
  };
  connect();
  return () => { disposed = true; clearTimeout(reconnect); clearTimeout(watchdog); socket?.close(); };
}
