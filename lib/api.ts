import { listQuery, type ListParams } from './collection-query';
import { isCompletedAttempt } from './studentExamStatus';
/** Typed-ish API boundary for the FastAPI service described in IMPLEMENTATION_SPEC.md. */
import type { EntryIdentityResult, IdentityResult, IdentityStatus } from './identity';
import type { UserProfile } from './profile';
import type { CardStatus } from './student-card';
import { parseCardPreview } from './student-card';
import { readPersonalSettings } from './settings';
import type { ProfileRequest, ProfileRequestStatus } from './profile-requests';
import type { DocumentCapabilities, DocumentConfiguration, DocumentDraft, DocumentSession } from './question-documents';
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const API_PREFIX = `${API_URL}/api/v1`;
export async function downloadAPIFile(path:string,filename:string) {
  const token=getSessionToken();
  const response=await fetch(API_PREFIX+path,{credentials:'include',cache:'no-store',headers:token?{Authorization:`Bearer ${token}`}:{}});
  if(!response.ok) throw new ApiError('Download failed',response.status);
  if(!response.headers.get('content-type')?.startsWith('text/csv'))throw new Error('Invalid export response');
  const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export async function fetchProtectedImage(path: string, signal: AbortSignal): Promise<Blob> {
  if (!path.startsWith('/question-images/') && !/^\/question-banks\/[^/]+\/documents\/[^/]+\/images\//.test(path))
    throw new Error('Invalid protected image');
  const token = getSessionToken();
  const response = await fetch(`${API_PREFIX}${path}`, { signal, credentials: 'include', cache: 'no-store',
    headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png')) throw new Error('Image unavailable');
  return response.blob();
}

/**
 * Quan ly access token trong sessionStorage (moi tab doc lap).
 *
 * Ly do dung sessionStorage thay localStorage:
 * - sessionStorage tach biet theo tab: tab A va tab B co sessionStorage rieng
 *   nen dang nhap tai khoan khac o tab B khong ghi de token cua tab A.
 * - localStorage dung chung toan trinh duyet theo origin: tab sau dang nhap
 *   ghi de token tab truoc lam tab truoc goi API bi 401 roi bi dang xuat.
 *
 * @security sessionStorage de bi XSS doc trom hon cookie httpOnly.
 * Cookie httpOnly van duoc gui song song (credentials: 'include') de ho tro
 * luong 1-tab thong thuong va lam lop bao ve du phong khi khong co token.
 * Truoc khi deploy production hay danh gia muc do rui ro XSS cua ung dung.
 */
const SESSION_TOKEN_KEY = 'ai-proctoring-access-token';

export function getSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(SESSION_TOKEN_KEY);
}

export function setSessionToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
}

export function clearSessionToken(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function validationMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const error = 'error' in payload ? (payload as { error?: unknown }).error : undefined;
  if (!error || typeof error !== 'object' || !('details' in error) || !Array.isArray((error as { details?: unknown }).details)) return undefined;
  const details = (error as { details: unknown[] }).details;
  const messages = details.map((item) => {
    if (!item || typeof item !== 'object') return '';
    const row = item as { loc?: unknown[]; msg?: unknown };
    const location = Array.isArray(row.loc) ? row.loc.filter(Boolean).join('.') : '';
    return location && row.msg ? `${location}: ${String(row.msg)}` : row.msg ? String(row.msg) : '';
  }).filter(Boolean);
  return messages.length ? messages.join('; ') : undefined;
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown; timeoutMs?: number };

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  // Tang timeout mac dinh len 30s; backend dev co the xu ly WebSocket nang song song.
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');

  // Uu tien Bearer token tu sessionStorage (per-tab) thay vi phu thuoc cookie chung.
  // Cookie van duoc gui qua credentials:'include' lam lop du phong cho 1-tab thuong.
  const sessionToken = getSessionToken();
  if (sessionToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${sessionToken}`);
  }

  try {
    const response = await fetch(`${API_PREFIX}${path}`, {
      ...options,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'include',
      headers,
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('json') ? await response.json() : await response.text();
    if (process.env.NODE_ENV === 'development' && path.includes('/submit')) console.debug('[API submit]', { status: response.status });
    if (!response.ok) {
      const nestedError = typeof payload === 'object' && payload && 'error' in payload ? (payload as { error?: unknown }).error : undefined;
      const message = validationMessage(payload) ?? (typeof nestedError === 'object' && nestedError && 'message' in nestedError ? String(nestedError.message) : typeof payload === 'object' && payload && 'message' in payload ? String(payload.message) : `API request failed (${response.status})`);
      const code = typeof nestedError === 'object' && nestedError && 'code' in nestedError ? String(nestedError.code) : typeof payload === 'object' && payload && 'error_code' in payload ? String(payload.error_code) : undefined;
      throw new ApiError(message, response.status, code, payload);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.warn('[API timeout]', { path: path.split('?')[0], timeoutMs: options.timeoutMs ?? 30_000 });
      throw new ApiError('Yêu cầu API quá thời gian chờ. Vui lòng kiểm tra kết nối mạng và thử lại.', 408);
    }
    if (error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch')) {
      console.error('[API network error]', { path: path.split('?')[0] });
      throw new ApiError('Không thể kết nối đến máy chủ. Kiểm tra mạng hoặc cấu hình CORS.', 0);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  const sessionToken = getSessionToken();
  if (sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60_000);
  try {
  const response = await fetch(`${API_PREFIX}${path}`, { method: 'POST', credentials: 'include', headers, body: form, signal: controller.signal });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = typeof payload === 'object' && payload && 'error' in payload ? payload.error : payload;
    const message = validationMessage(payload) ?? (error && typeof error === 'object' && 'message' in error ? String(error.message) : `API request failed (${response.status})`);
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
    throw new ApiError(message, response.status, code, payload);
  }
  if (typeof payload === 'object' && payload && 'data' in payload) return (payload as { data: T }).data;
  return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new ApiError('Yêu cầu quá thời gian chờ. Vui lòng kiểm tra kết nối và thử lại.', 408);
    if (error instanceof TypeError) throw new ApiError('Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại.', 0);
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const api = {
  settings: {
    me: async () => readPersonalSettings((await apiFetch<{ data: import('./settings').PersonalSettings }>('/settings/me', { cache: 'no-store' })).data),
    updateMe: async (body: import('./settings').PersonalSettingsPatch) => readPersonalSettings((await apiFetch<{ data: import('./settings').PersonalSettings }>('/settings/me', { method: 'PATCH', body })).data),
    system: async () => (await apiFetch<{ data: import('./settings').SystemSettings }>('/admin/settings', { cache: 'no-store' })).data,
    updateSystem: async (body: Partial<import('./settings').SystemSettings>) => (await apiFetch<{ data: import('./settings').SystemSettings }>('/admin/settings', { method: 'PATCH', body })).data,
    support: async () => (await apiFetch<{ data: { support_text: string } }>('/settings/support', { cache: 'no-store' })).data,
  },
  teacherResults: {
    report: async (examId: string, params:ListParams={}) => (await apiFetch<{ data: import('./teacher-results').TeacherReport }>(`/exams/${encodeURIComponent(examId)}/report${listQuery(params)?'?'+listQuery(params):''}`, { cache: 'no-store' })).data,
    attempt: async (attemptId: string) => (await apiFetch<{ data: import('./teacher-results').TeacherAttemptResult }>(`/attempts/${encodeURIComponent(attemptId)}/result`, { cache: 'no-store' })).data,
  },
  teacherReports: {
    overview: async (examId = '',params:ListParams={}) => (await apiFetch<{ data: import('./teacher-reports').ReportsOverview }>(`/teacher/reports${listQuery({...params,exam_id:examId||undefined})?'?'+listQuery({...params,exam_id:examId||undefined}):''}`, { cache: 'no-store' })).data,
    attempt: async (attemptId: string,params:ListParams={}) => (await apiFetch<{ data: import('./teacher-reports').AttemptReport }>(`/reports/attempts/${encodeURIComponent(attemptId)}${listQuery(params)?'?'+listQuery(params):''}`, { cache: 'no-store' })).data,
    exportCSV: (examId='',params:ListParams={}) => downloadAPIFile('/teacher/reports?'+listQuery({...params,exam_id:examId||undefined,format:'csv',page:undefined,limit:undefined}),`bao-cao-${examId||'tat-ca'}.csv`),
  },
  profileRequests: {
    status: async () => (await apiFetch<{ data: ProfileRequestStatus }>('/identity/profile-verification/status', { cache: 'no-store' })).data,
    send: async () => (await apiFetch<{ data: ProfileRequestStatus }>('/identity/profile-verification/request', { method: 'POST', body: {} })).data,
    list: (page: number, studentId?: string) => apiFetch<{ data: ProfileRequest[]; meta: { total: number } }>(`/users/profile-verification/requests?page=${page}&limit=20${studentId ? `&student_id=${encodeURIComponent(studentId)}` : ''}`, { cache: 'no-store' }),
    reject: (id: string, version: number, reason: string) => apiFetch(`/users/profile-verification/requests/${id}/reject`, { method: 'POST', body: { identity_profile_version: version, rejection_reason: reason } }),
  },
  studentCard: {
    status: async () => (await apiFetch<{ data: CardStatus }>('/identity/student-card/status', { cache: 'no-store' })).data,
    preview: async (image: File) => { const form = new FormData(); form.append('image', image); return parseCardPreview(await apiUpload<unknown>('/identity/student-card/preview', form)); },
    confirm: async (preview_id: string) => (await apiFetch<{ data: CardStatus }>('/identity/student-card/confirm', { method: 'POST', body: { preview_id }, timeoutMs: 60_000 })).data,
    image: async (path: string, signal: AbortSignal) => {
      if (!/^\/api\/v1\/identity\/student-card\/previews\/[0-9a-f-]+\/(card|face)$/.test(path)) throw new Error('Đường dẫn ảnh không hợp lệ.');
      const token = getSessionToken();
      const response = await fetch(`${API_URL}${path}`, { signal, cache: 'no-store', credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error('Ảnh xem trước không còn khả dụng. Vui lòng tải lại ảnh thẻ.');
      return response.blob();
    },
  },
  auth: {
    updatePhone: (phone: string | null) => apiFetch<{ user: UserProfile }>('/auth/me', { method: 'PATCH', body: { phone } }),
    updateProfile: (profile: { full_name: string; phone: string | null }) => apiFetch<{ user: UserProfile }>('/auth/me', { method: 'PATCH', body: profile }),
    updateAvatar: (avatar: File, profile: { full_name: string; phone: string | null }) => {
      const form = new FormData(); form.append('avatar', avatar); form.append('profile', JSON.stringify(profile));
      return apiUpload<{ user: UserProfile }>('/auth/me/avatar', form);
    },
    // login va register tra them access_token trong body de frontend luu vao sessionStorage.
    login: (email: string, password: string) => apiFetch<{ user: unknown; access_token: string }>('/auth/login', { method: 'POST', body: { email, password } }),
    register: (full_name: string, email: string, password: string) => apiFetch<{ user: unknown; access_token: string }>('/auth/register', { method: 'POST', body: { full_name, email, password } }),
    forgotPassword: (email: string) => apiFetch<{ message: string; reset_token?: string }>('/auth/forgot-password', { method: 'POST', body: { email } }),
    resetPassword: (token: string, password: string) => apiFetch<{ message: string }>('/auth/reset-password', { method: 'POST', body: { token, password } }),
    refresh: () => apiFetch<{ user?: unknown; access_token?: string }>('/auth/refresh', { method: 'POST' }),
    logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
    me: () => apiFetch<{ user: UserProfile }>('/auth/me'),
  },
  users: {
    get: (id: string) => apiFetch<{ data: unknown }>(`/users/${encodeURIComponent(id)}`, { cache: 'no-store' }),
    list: (params: ListParams = {}) => apiFetch<{ data: unknown[]; total: number; page: number; limit: number }>('/users?' + new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]))),
    create: (body: unknown) => apiFetch<unknown>('/users', { method: 'POST', body }),
    update: (id: string, body: unknown) => apiFetch<unknown>(`/users/${id}`, { method: 'PUT', body }),
    resetPassword: (id: string, password: string) => apiFetch<unknown>(`/users/${id}/reset-password`, { method: 'POST', body: { password } }),
    deactivate: (id: string) => apiFetch<unknown>(`/users/${id}`, { method: 'DELETE' }),
    verifyIdentityProfile: (id: string, version: number) => apiFetch<unknown>(`/users/${id}/identity-profile/verify`, { method: 'POST', body: { identity_profile_version: version } }),
  },
  exams: {
    list: (params: ListParams = {}) => apiFetch<unknown[]>('/exams?' + new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]))),
    get: (id: string) => apiFetch<unknown>(`/exams/${id}`),
    create: (body: unknown) => apiFetch<unknown>('/exams', { method: 'POST', body }),
    update: (id: string, body: unknown) => apiFetch<unknown>(`/exams/${id}`, { method: 'PATCH', body }),
    delete: (id: string) => apiFetch<void>(`/exams/${id}`, { method: 'DELETE' }),
    addQuestion: (id: string, body: unknown) => apiFetch<unknown>(`/exams/${id}/questions`, { method: 'POST', body }),
    replaceQuestions: (id: string, question_ids: string[]) => apiFetch<unknown>(`/exams/${id}/questions`, { method: 'PUT', body: { question_ids } }),
    addRandomQuestions: (id: string, body: unknown) => apiFetch<unknown>(`/exams/${id}/questions/random`, { method: 'POST', body }),
    report: (id: string) => apiFetch<unknown>(`/exams/${id}/report`),
    exportReport: (id: string, format: 'csv' | 'xlsx' = 'xlsx') => apiFetch<unknown>(`/exams/${id}/report/export?format=${format}`, { method: 'POST' }),
    // Backend chưa có endpoint duplicate riêng; UI nhân bản bằng get/create và copy dữ liệu liên quan.
  },
  dashboard: {
    stats: () => apiFetch<unknown>('/dashboard/stats'),
  },
  auditLogs: {
    list: (params: ListParams = {}) => apiFetch<unknown>('/audit-logs?' + new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]))),
  },
  questionBanks: {
    documentCapabilities: async (id: string) => (await apiFetch<{ data: DocumentCapabilities }>(`/question-banks/${id}/document-capabilities`, { cache: 'no-store' })).data,
    uploadDocument: (id: string, document: File) => { const form = new FormData(); form.append('document', document); return apiUpload<DocumentSession>(`/question-banks/${id}/documents`, form); },
    document: async (id: string, documentId: string) => (await apiFetch<{ data: DocumentSession }>(`/question-banks/${id}/documents/${documentId}`, { cache: 'no-store' })).data,
    discardDocument: (id: string, documentId: string) => apiFetch(`/question-banks/${id}/documents/${documentId}`, { method: 'DELETE' }),
    prepareDocumentDrafts: async (id: string, documentId: string, body: DocumentConfiguration) => (await apiFetch<{ data: DocumentSession }>(`/question-banks/${id}/documents/${documentId}/drafts`, { method: 'POST', body })).data,
    generateDocumentBatch: async (id: string, documentId: string, batch: number) => (await apiFetch<{ data: DocumentSession }>(`/question-banks/${id}/documents/${documentId}/batches/${batch}`, { method: 'POST', body: {}, timeoutMs: 195_000 })).data,
    checkDocumentQuality: async (id: string, documentId: string, questions: DocumentDraft[]) => (await apiFetch<{ data: DocumentSession }>(`/question-banks/${id}/documents/${documentId}/quality`, { method: 'POST', body: { questions }, timeoutMs: 195_000 })).data,
    regenerateDocumentDraft: async (id: string, documentId: string, draftId: string) => (await apiFetch<{ data: DocumentDraft }>(`/question-banks/${id}/documents/${documentId}/drafts/${draftId}/regenerate`, { method: 'POST', body: {}, timeoutMs: 195_000 })).data,
    importDocumentDrafts: async (id: string, documentId: string, questions: DocumentDraft[]) => (await apiFetch<{ data: { imported_count: number; question_ids: string[] } }>(`/question-banks/${id}/documents/${documentId}/import`, { method: 'POST', body: { questions }, timeoutMs: 60_000 })).data,
    list: (params: ListParams={}) => apiFetch<unknown>(`/question-banks${listQuery(params)?'?'+listQuery(params):''}`),
    get: (id: string, params:ListParams={}) => apiFetch<unknown>(`/question-banks/${id}${listQuery(params)?'?'+listQuery(params):''}`),
    create: (body: unknown) => apiFetch<unknown>('/question-banks', { method: 'POST', body }),
    update: (id: string, body: unknown) => apiFetch<unknown>(`/question-banks/${id}`, { method: 'PATCH', body }),
    delete: (id: string) => apiFetch<void>(`/question-banks/${id}`, { method: 'DELETE' }),
    questions: (id: string, params: ListParams = {}) => apiFetch<unknown[]>(`/question-banks/${id}/questions?` + new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]))),
    randomSelect: (id: string, body: unknown) => apiFetch<unknown>(`/question-banks/${id}/random-select`, { method: 'POST', body }),
    createQuestion: (id: string, body: unknown) => apiFetch<unknown>(`/question-banks/${id}/questions`, { method: 'POST', body }),
    updateQuestion: (id: string, body: unknown) => apiFetch<unknown>(`/question-banks/questions/${id}`, { method: 'PATCH', body }),
    deleteQuestion: (id: string) => apiFetch<void>(`/question-banks/questions/${id}`, { method: 'DELETE' }),
  },
  classes: {
    list: (params:ListParams={}) => apiFetch<unknown>(`/classes${listQuery(params)?'?'+listQuery(params):''}`),
    get: (id: string, params:ListParams={}) => apiFetch<unknown>(`/classes/${id}${listQuery(params)?'?'+listQuery(params):''}`),
    create: (body: unknown) => apiFetch<unknown>('/classes', { method: 'POST', body }),
    update: (id: string, body: unknown) => apiFetch<unknown>(`/classes/${id}`, { method: 'PATCH', body }),
    delete: (id: string) => apiFetch<void>(`/classes/${id}`, { method: 'DELETE' }),
    enrollments: (id: string, params:ListParams={}) => apiFetch<unknown[]>(`/classes/${id}/enrollments${listQuery(params)?'?'+listQuery(params):''}`),
    availableStudents: (id: string,params:ListParams={}) => apiFetch<unknown>(`/classes/${id}/enrollments/available${listQuery(params)?'?'+listQuery(params):''}`),
    enroll: (id: string, body: unknown) => apiFetch<unknown>(`/classes/${id}/enrollments`, { method: 'POST', body }),
    unenroll: (id: string, studentId: string) => apiFetch<void>(`/classes/${id}/enrollments/${studentId}`, { method: 'DELETE' }),
  },
  liveClasses: {
    recordings: (id: string) => apiFetch<{ data: import('./class-recordings').RecordingList }>(`/live-classes/${id}/recordings`),
    startRecording: (id: string) => apiFetch<{ data: import('./class-recordings').ClassRecording }>(`/live-classes/${id}/recording/start`, { method: 'POST' }),
    stopRecording: (id: string) => apiFetch<{ data: import('./class-recordings').ClassRecording | null }>(`/live-classes/${id}/recording/stop`, { method: 'POST' }),
    admission: (id: string) => apiFetch<{ data: { status: string } }>(`/live-classes/${id}/admission`, { method: 'POST' }),
    cancelAdmission: (id: string) => apiFetch<unknown>(`/live-classes/${id}/admission`, { method: 'DELETE', keepalive: true }),
    policy: (id: string, body: Partial<import('./classroom').ClassroomPolicy>) => apiFetch<{ data: import('./classroom').ClassroomSession }>(`/live-classes/${id}/policy`, { method: 'POST', body }),
    action: (id: string, action: string, participant_id?: string) => apiFetch<{ data: import('./classroom').ClassroomSession }>(`/live-classes/${id}/actions`, { method: 'POST', body: { action, participant_id } }),
    hand: (id: string, raised: boolean) => apiFetch<unknown>(`/live-classes/${id}/hand`, { method: 'POST', body: { raised } }),
    chat: (id: string, text: string) => apiFetch<{ data: import('./classroom').ClassroomChat }>(`/live-classes/${id}/chat`, { method: 'POST', body: { text } }),
    list: (params:ListParams={}) => apiFetch<unknown>(`/live-classes${listQuery(params)?'?'+listQuery(params):''}`),
    get: (id: string) => apiFetch<unknown>(`/live-classes/${id}`),
    create: (body: unknown) => apiFetch<unknown>('/live-classes', { method: 'POST', body }),
    start: (id: string) => apiFetch<unknown>(`/live-classes/${id}/start`, { method: 'POST' }),
    end: (id: string) => apiFetch<unknown>(`/live-classes/${id}/end`, { method: 'POST' }),
    token: (id: string) => apiFetch<{ data: import('./classroom').RoomToken }>(`/live-classes/${id}/token`, { method: 'POST' }),
    join: (id: string, sid: string) => apiFetch<unknown>(`/live-classes/${id}/join`, { method: 'POST', body: { participant_sid: sid } }),
    leave: (id: string, sid: string) => apiFetch<unknown>(`/live-classes/${id}/leave`, { method: 'POST', body: { participant_sid: sid }, keepalive: true }),
    attendance: (id: string) => apiFetch<{ data: import('./classroom').AttendanceRow[] }>(`/live-classes/${id}/attendance`),
  },
  recordings: {
    get: (id: string) => apiFetch<{ data: import('./class-recordings').RecordingDetail }>(`/recordings/${id}`),
    playback: async (id: string) => {
      const result = await apiFetch<{ data: { media_path: string; expires_at: string } }>(`/recordings/${id}/playback`);
      if (!result.data.media_path.startsWith(`/recordings/${id}/media?`)) throw new Error('Invalid playback reference');
      return { url: API_PREFIX + result.data.media_path, expires_at: result.data.expires_at };
    },
    publish: (id: string) => apiFetch<{ data: import('./class-recordings').ClassRecording }>(`/recordings/${id}/publish`, { method: 'POST' }),
    unpublish: (id: string) => apiFetch<{ data: import('./class-recordings').ClassRecording }>(`/recordings/${id}/unpublish`, { method: 'POST' }),
    delete: (id: string) => apiFetch<{ data: { deleted: boolean; cleanup_pending: boolean } }>(`/recordings/${id}`, { method: 'DELETE' }),
  },
  examAssignments: {
    list: (params: ListParams & {examId?:string;classId?:string}={}) => apiFetch<unknown>('/exam-assignments?'+listQuery({...params,exam_id:params.examId,class_id:params.classId,examId:undefined,classId:undefined})),
    create: (examId: string, body: unknown) => apiFetch<unknown>('/exam-assignments?exam_id=' + encodeURIComponent(examId), { method: 'POST', body }),
    delete: (id: string) => apiFetch<void>(`/exam-assignments/${id}`, { method: 'DELETE' }),
  },
  attempts: {
    start: (examId: string, entryVerificationId?: string, resumeAttemptId?: string) => apiFetch<unknown>('/attempts', { method: 'POST', body: { exam_id: examId, entry_verification_id: entryVerificationId, resume_attempt_id: resumeAttemptId } }),
    // Backend endpoint for the current student's attempts; used to avoid one request per exam.
    mine: (params: ListParams & {examId?:string} = {}) => apiFetch<unknown>(`/attempts/mine?${listQuery({...params,exam_id:params.examId??params.exam_id,examId:undefined})}`),
    list: (examId: string, params: ListParams = {}) => apiFetch<unknown[]>(`/attempts?exam_id=${encodeURIComponent(examId)}&` + listQuery(params)),
    get: (attemptId: string) => apiFetch<unknown>(`/attempts/${attemptId}`),
    result: (attemptId: string) => apiFetch<unknown>(`/attempts/${attemptId}/result`),
    questions: (attemptId: string) => apiFetch<unknown[]>(`/attempts/${attemptId}/questions`),
    saveAnswer: (attemptId: string, body: unknown) => apiFetch<unknown>(`/attempts/${attemptId}/answers`, { method: 'PUT', body }),
    submit: async (attemptId: string) => {
      const response=await apiFetch<unknown>(`/attempts/${attemptId}/submit`,{method:'POST'});
      const row=response&&typeof response==='object'&&'data' in response?response.data:response;
      if(row&&typeof row==='object'&&'status' in row&&isCompletedAttempt(String(row.status))&&'exam_id' in row&&typeof row.exam_id==='string'){
        window.dispatchEvent(new CustomEvent('student-exam-updated',{detail:{examId:row.exam_id,attemptId,
          studentId:'student_id' in row&&typeof row.student_id==='string'?row.student_id:undefined}}));
      }
      return response;
    },
    timeline: (attemptId: string) => apiFetch<unknown[]>(`/attempts/${attemptId}/timeline`),
    gradeAnswer: (answerId: string, body: unknown) => apiFetch<unknown>(`/answers/${answerId}/grade`, { method: 'PATCH', body }),
    violations: (attemptId: string, body: unknown) => apiFetch<unknown>(`/attempts/${attemptId}/violations`, { method: 'POST', body }),
    startProctoring: (attemptId: string, body: unknown = {}) => apiFetch<unknown>(`/proctoring/sessions/${attemptId}`, { method: 'POST', body }),
    uploadRecording: async (attemptId: string, recording: Blob) => {
      const form = new FormData(); form.append('recording', recording, `${attemptId}.webm`);
      const uploadHeaders = new Headers({ Accept: 'application/json' });
      const sessionToken = getSessionToken();
      if (sessionToken) uploadHeaders.set('Authorization', `Bearer ${sessionToken}`);
      const response = await fetch(`${API_PREFIX}/proctoring/sessions/${attemptId}/recording`, { method: 'POST', credentials: 'include', headers: uploadHeaders, body: form });
      const payload = await response.json();
      if (!response.ok) throw new ApiError(payload?.error?.message ?? 'Không lưu được video giám sát.', response.status, payload?.error?.code);
      return payload;
    },
    detectionEvent: (body: unknown) => apiFetch<unknown>('/proctoring/detection-events', { method: 'POST', body }),
  },
  identity: {
    verifyEntry: (examId: string, image: Blob, consent: boolean) => { const form = new FormData(); form.append('image', image, 'entry-verification.jpg'); form.append('consent', String(consent)); return apiUpload<EntryIdentityResult>(`/identity/exams/${examId}/verify-entry`, form); },
    status: async () => (await apiFetch<{ data: IdentityStatus }>('/identity/status')).data,
    enroll: (images: Blob[], consent: boolean) => { const form = new FormData(); images.forEach((image, index) => form.append(['front', 'left', 'right'][index], image, `identity-${index}.jpg`)); form.append('consent', String(consent)); return apiUpload<IdentityStatus>('/identity/enroll', form); },
    delete: () => apiFetch<void>('/identity', { method: 'DELETE' }),
    check: (image: Blob, consent: boolean) => { const form = new FormData(); form.append('image', image, 'check.jpg'); form.append('consent', String(consent)); return apiUpload<IdentityResult>('/identity/check', form); },
    verify: (examId: string, image: Blob, consent: boolean) => { const form = new FormData(); form.append('image', image, 'verification.jpg'); form.append('consent', String(consent)); return apiUpload<IdentityResult>(`/identity/exams/${examId}/verify`, form); },
    examStatus: async (examId: string) => (await apiFetch<{ data: { verified: boolean; status: string } }>(`/identity/exams/${examId}/status`)).data,
  },

};

export function getMonitorWebSocketUrl(examId: string) {
  const url = new URL(`${API_PREFIX}/ws/monitor/${examId}`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
