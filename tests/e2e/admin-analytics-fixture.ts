import type { Page } from '@playwright/test';

export async function adminDashboardAPI(page: Page) {
  const state = { roles: { student: 26, teacher: 3, admin: 1 } as Record<string,number>, cardsTotal: 2, missingTotals: false, failedRoles: false, requests: [] as string[] };
  const headers = { 'access-control-allow-origin': process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,OPTIONS' };
  await page.route('**/api/v1/users?**', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const url = new URL(route.request().url()); state.requests.push(url.pathname + url.search);
    return state.failedRoles ? route.fulfill({ status: 500, headers, json: { error: { message: 'PRIVATE_SQL_ERROR' } } })
      : route.fulfill({ headers, json: { data: [], meta: { page: 1, limit: 1, ...(state.missingTotals ? {} : { total: state.roles[url.searchParams.get('role') ?? ''] }) } } });
  });
  await page.route('**/api/v1/exams?**', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const url = new URL(route.request().url()); state.requests.push(url.pathname + url.search);
    return route.fulfill({ headers, json: { data: [{ id: 'exam-1', title: 'Cơ sở dữ liệu', status: 'published', duration_minutes: 60 }, { id: 'exam-2', title: 'Lập trình Web', status: 'draft', duration_minutes: 45 }], meta: { page: 1, limit: 5, ...(state.missingTotals ? {} : { total: 2 }) } } });
  });
  await page.route('**/api/v1/admin/student-cards?**', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const url = new URL(route.request().url()); state.requests.push(url.pathname + url.search);
    return route.fulfill({ headers, json: { data: state.cardsTotal ? [{ student_id: 'student-1', full_name: 'Nguyễn An', student_code: 'SV001', email: 'an@example.test', management_status: 'PENDING_CONFIRMATION' }, { student_id: 'student-2', full_name: 'Trần Minh', student_code: 'SV002', email: 'minh@example.test', management_status: 'PENDING_CONFIRMATION' }] : [], meta: { page: 1, limit: 3, ...(state.missingTotals ? {} : { total: state.cardsTotal }) } } });
  });
  await page.route('**/api/v1/audit-logs?**', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const url = new URL(route.request().url()); state.requests.push(url.pathname + url.search);
    return route.fulfill({ headers, json: { data: [{ id: 'audit-1', action: 'exam_created', entity_type: 'exam', entity_id: 'exam-1', metadata: {}, created_at: '2026-10-23T02:00:00Z', user: { full_name: 'Nguyễn Quản Trị', email: 'admin@example.test', role: 'admin' } }], meta: { total: 1, page: 1, limit: 4 } } });
  });
  return state;
}
