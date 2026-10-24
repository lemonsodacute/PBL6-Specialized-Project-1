import { expect, test, type Page, type Route } from '@playwright/test';
import { fixtureUser, uiSession } from './ui-fixtures';

function headers(route: Route) {
  return { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3100', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };
}
async function studentSession(page: Page, requestStatus = 'NOT_REQUESTED') {
  const session = await uiSession(page);
  const state = { profile: 'PENDING', requestStatus, reason: 'MSSV chưa chính xác.', posts: 0, fail: false, gate: null as Promise<void> | null };
  await page.route('**/api/v1/identity/student-card/status', route => route.fulfill({ headers: headers(route), json: { data: { identity_profile_status: state.profile, student_card_status: 'NOT_SUBMITTED', has_reference: false, reference_version: null, updated_at: null } } }));
  await page.route('**/api/v1/identity/profile-verification/**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: headers(route) });
    if (route.request().method() === 'POST') {
      state.posts++;
      expect(route.request().postDataJSON()).toEqual({});
      if (state.gate) await state.gate;
      if (state.fail) return route.fulfill({ status: 503, headers: headers(route), json: { error: { code: 'REQUEST_SAVE_FAILED', message: 'Chưa gửi được yêu cầu. Vui lòng thử lại.' } } });
      state.requestStatus = 'PENDING';
    }
    return route.fulfill({ headers: headers(route), json: { data: { identity_profile_status: state.profile, verification_request_status: state.requestStatus,
      verification_requested_at: state.requestStatus === 'NOT_REQUESTED' ? null : '2026-10-09T01:00:00Z', verification_rejection_reason: state.requestStatus === 'REJECTED' ? state.reason : null } } });
  });
  return { state, session };
}

test('student sends once with loading state and reload retains pending', async ({ page }) => {
  const { state } = await studentSession(page);
  let release!: () => void;
  state.gate = new Promise<void>(resolve => { release = resolve; });
  await page.goto('/student/profile');
  const send = page.getByRole('button', { name: 'Gửi yêu cầu xác minh', exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByRole('button', { name: 'Đang gửi yêu cầu...' })).toBeDisabled();
  release();
  await expect(page.getByRole('button', { name: 'Đã gửi yêu cầu', exact: true })).toBeDisabled();
  await expect(page.getByText('Đã gửi yêu cầu xác minh')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Đã gửi yêu cầu', exact: true })).toBeDisabled();
  expect(state.posts).toBe(1);
});

test('rejected student sees reason, can resend, and cannot edit MSSV', async ({ page }) => {
  await studentSession(page, 'REJECTED');
  await page.goto('/student/profile');
  await expect(page.getByText('Lý do: MSSV chưa chính xác.')).toBeVisible();
  await expect(page.getByRole('main').getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Gửi lại yêu cầu' }).click();
  await expect(page.getByRole('button', { name: 'Đã gửi yêu cầu', exact: true })).toBeDisabled();
  await expect(page.getByText('Lý do: MSSV chưa chính xác.')).toHaveCount(0);
});

test('failed send shows inline retry and keeps request available', async ({ page }) => {
  const { state } = await studentSession(page);
  state.fail = true;
  await page.goto('/student/profile');
  await page.getByRole('button', { name: 'Gửi yêu cầu xác minh', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Chưa gửi được yêu cầu');
  state.fail = false;
  await page.getByRole('button', { name: 'Gửi yêu cầu xác minh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đã gửi yêu cầu', exact: true })).toBeDisabled();
});

test('approval observed on focus switches pending request to existing card UI', async ({ page }) => {
  const { state } = await studentSession(page, 'PENDING');
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Đã gửi yêu cầu', exact: true })).toBeDisabled();
  state.profile = 'VERIFIED';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Hồ sơ sinh viên đã được xác nhận')).toBeVisible();
  await expect(page.getByText('Chưa xác thực thẻ sinh viên')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đã gửi yêu cầu', exact: true })).toHaveCount(0);
});

async function adminSession(page: Page) {
  await uiSession(page, 'admin');
  const student = { ...fixtureUser, student_code: '001IT123', identity_profile_status: 'PENDING', identity_profile_version: 3 };
  const state = { pending: true, student, stale: false, calls: [] as { path: string; body: Record<string, unknown> }[] };
  await page.route('**/api/v1/users**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: headers(route) });
    if (request.method() === 'GET') return route.fulfill({ headers: headers(route), json: path.includes('/profile-verification/') ? {
      data: state.pending ? [{ id: '22222222-2222-4222-8222-222222222222', status: 'PENDING', student, requested_at: '2026-10-09T01:00:00Z' }] : [], meta: { total: state.pending ? 1 : 0 },
    } : { data: [student] } });
    state.calls.push({ path, body: request.postDataJSON() });
    if (state.stale) return route.fulfill({ status: 409, headers: headers(route), json: { error: { code: 'PROFILE_CHANGED', message: 'Hồ sơ đã thay đổi. Vui lòng xem lại trước khi xử lý.' } } });
    state.pending = false;
    if (path.endsWith('/identity-profile/verify')) student.identity_profile_status = 'VERIFIED';
    return route.fulfill({ headers: headers(route), json: { data: student } });
  });
  return state;
}

test('admin inspects full profile and approves through existing versioned endpoint', async ({ page }) => {
  const state = await adminSession(page);
  await page.goto('/dashboard/users');
  await page.getByRole('button', { name: 'Xem hồ sơ', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('001IT123', { exact: true })).toBeVisible();
  await expect(dialog.getByText(fixtureUser.email, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByText('Không có yêu cầu chờ xác minh')).toBeVisible();
  expect(state.calls).toEqual([{ path: `/api/v1/users/${fixtureUser.id}/identity-profile/verify`, body: { identity_profile_version: 3 } }]);
});

test('admin must enter rejection reason and rejection leaves profile pending', async ({ page }) => {
  const state = await adminSession(page);
  await page.goto('/dashboard/users');
  await page.getByRole('button', { name: 'Xem hồ sơ', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Từ chối', exact: true })).toBeDisabled();
  await dialog.getByLabel('Lý do từ chối').fill(' Họ tên chưa khớp hồ sơ. ');
  await dialog.getByRole('button', { name: 'Từ chối', exact: true }).click();await page.getByRole('dialog',{name:'Từ chối yêu cầu?'}).getByRole('button',{name:'Từ chối',exact:true}).click();
  await expect(page.getByText('Không có yêu cầu chờ xác minh')).toBeVisible();
  expect(state.calls[0].body).toEqual({ identity_profile_version: 3, rejection_reason: 'Họ tên chưa khớp hồ sơ.' });
  expect(state.student.identity_profile_status).toBe('PENDING');
});

test('stale admin review displays conflict and requires reloading profile', async ({ page }) => {
  const state = await adminSession(page);
  state.stale = true;
  await page.goto('/dashboard/users');
  await page.getByRole('button', { name: 'Xem hồ sơ', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Hồ sơ đã thay đổi');
  await dialog.getByRole('button', { name: 'Tải lại yêu cầu' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.pending).toBe(true);
});

for (const role of ['student', 'admin']) test(`${role} notification links to profile request flow`, async ({ page }) => {
  if (role === 'student') await studentSession(page, 'REJECTED'); else await adminSession(page);
  await page.route('**/api/v1/notifications**', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: headers(route) });
    const notice = { id: 'notice-1', recipient_user_id: fixtureUser.id, type: role === 'student' ? 'profile_verification_result' : 'profile_verification_request', title: 'Kết quả hồ sơ kiểm thử', message: 'Xem hồ sơ', is_read: false, related_student_id: fixtureUser.id, created_at: '2026-10-09T01:00:00Z', severity: null };
    return route.fulfill({ headers: headers(route), json: { data: route.request().url().includes('unread-count') ? { count: 1 } : [notice] } });
  });
  await page.goto(role === 'student' ? '/student/profile' : '/dashboard/users');
  await page.getByRole('button', { name: 'Thông báo, 1 chưa đọc', exact: true }).click();
  await page.getByRole('button', { name: /Kết quả hồ sơ kiểm thử/ }).click();
  await expect(page).toHaveURL(role === 'student' ? /\/student\/profile$/ : /\/dashboard\/users\?student_id=/);
});
