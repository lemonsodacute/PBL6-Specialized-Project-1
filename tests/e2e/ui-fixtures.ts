import type { Page } from '@playwright/test';

export const fixtureUser = {
  id: '11111111-1111-4111-8111-111111111111', full_name: 'Nguyễn Minh Anh', email: 'student@example.com', role: 'student',
  phone: '0901234567', avatar_url: null, is_active: true, created_at: '2026-01-02T00:00:00Z',
};

export async function uiSession(page: Page, role = 'student', signedIn = true) {
  const user = { ...fixtureUser, role };
  const state = {
    user, requests: [] as { path: string; body: Record<string, unknown> }[],
    authStatus: 200, authCode: '', gate: null as Promise<void> | null,
    resetToken: '',
    classes: [{ id: 'class-1', name: 'Kiểm thử phần mềm', description: 'Lớp học phần học kỳ I', students_count: 32, teacher: { full_name: 'Trần Thị Mai' } }],
    exams: [] as Record<string, unknown>[], attempts: [] as Record<string, unknown>[],
  };
  if (signedIn) await page.addInitScript(value => {
    if (sessionStorage.getItem('ui-fixture-ready')) return;
    sessionStorage.setItem('ui-fixture-ready', 'yes');
    sessionStorage.setItem('ai-proctoring-current-user', JSON.stringify(value));
    sessionStorage.setItem('ai-proctoring-access-token', 'synthetic-token');
  }, user);
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().method() === 'POST') {
      state.requests.push({ path, body: route.request().postDataJSON() ?? {} });
      if (state.gate && path !== '/auth/refresh') await state.gate;
      if (state.authStatus !== 200 && path.startsWith('/auth/') && path !== '/auth/refresh') return route.fulfill({ status: state.authStatus, headers, json: { error: { code: state.authCode, message: 'SQL internal detail must never be shown' } } });
    }
    let json: unknown = { data: [] };
    if (path === '/auth/me' || path === '/auth/refresh' || path === '/auth/login' || path === '/auth/register') json = { user: state.user, access_token: 'synthetic-token' };
    else if (path === '/settings/me') json = { data: { theme: 'system', notification_preferences: {}, notification_options: [], updated_at: null,
      exam_defaults: role === 'student' ? null : { exam_duration_minutes: 60, exam_require_camera: true, exam_require_mic: true },
      exam_overrides: role === 'teacher' ? { exam_duration_minutes: null, exam_require_camera: null, exam_require_mic: null } : null } };
    else if (path === '/settings/support') json = { data: { support_text: 'Liên hệ quản trị viên hệ thống để được hỗ trợ.' } };
    else if (path === '/admin/settings') json = { data: { exam_duration_minutes: 60, exam_require_camera: true, exam_require_mic: true, support_text: 'Liên hệ quản trị viên hệ thống để được hỗ trợ.', updated_at: '2026-10-12T00:00:00Z' } };
    else if (path === '/auth/forgot-password') json = { message: 'Request created', ...(state.resetToken ? { reset_token: state.resetToken } : {}) };
    else if (path === '/auth/reset-password') json = { message: 'Password reset successfully' };
    else if (path === '/classes') json = { data: state.classes };
    else if (path === '/exams') json = { data: state.exams };
    else if (path === '/attempts/mine') json = { data: state.attempts };
    else if (path === '/dashboard/stats') json = { data: { ongoing_exams: 0, active_attempts: 0, classes: state.classes.length, recent_violations: 0, recent_window_minutes: 5, as_of: '2026-10-03T01:00:00Z' } };
    else if (path === '/identity/profile-verification/status') json = { data: { identity_profile_status: 'PENDING', verification_request_status: 'NOT_REQUESTED', verification_requested_at: null, verification_rejection_reason: null } };
    else if (path.includes('identity') && path.includes('status')) json = { data: { enrolled: false, status: 'not_enrolled', updated_at: null } };
    else if (path.includes('unread-count')) json = { data: { count: 0 } };
    return route.fulfill({ headers, json });
  });
  return state;
}
