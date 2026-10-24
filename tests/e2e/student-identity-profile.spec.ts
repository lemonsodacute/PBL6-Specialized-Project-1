import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';

async function adminSession(page: Page) {
  await uiSession(page, 'admin');
  const student = { id: '22222222-2222-4222-8222-222222222222', full_name: 'Nguyễn Văn Thiện', email: 'identity@example.test', role: 'student', is_active: true, student_code: null as string | null, identity_profile_status: 'PENDING', identity_profile_version: 1 };
  const state = { student, calls: [] as { method: string; body: Record<string, unknown> }[], rejectVerification: false };
  await page.route('**/api/v1/users**', async route => {
    const request = route.request();
    const headers = { 'access-control-allow-origin': request.headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (request.url().includes('/profile-verification/requests')) return route.fulfill({ headers, json: { data: [], meta: { total: 0 } } });
    if (request.method() === 'GET') return route.fulfill({ headers, json: { data: [student] } });
    state.calls.push({ method: request.method(), body: request.postDataJSON() });
    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      student.full_name = body.full_name;
      student.student_code = body.student_code?.trim().toUpperCase() ?? null;
      student.identity_profile_version++;
      student.identity_profile_status = 'PENDING';
    } else if (request.url().endsWith('/identity-profile/verify')) {
      if (state.rejectVerification) return route.fulfill({ status: 409, headers, json: { error: { code: 'PROFILE_CHANGED', message: 'Hồ sơ đã thay đổi. Vui lòng tải lại trước khi xác nhận.' } } });
      student.identity_profile_status = 'VERIFIED';
    }
    return route.fulfill({ headers, json: { data: student } });
  });
  return state;
}

test('admin assigns MSSV then explicitly verifies the displayed profile version', async ({ page }) => {
  const state = await adminSession(page);
  await page.goto('/dashboard/users');
  await page.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
  await page.getByLabel('Mã sinh viên', { exact: true }).fill('001it123');
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByRole('cell', { name: /^001IT123 Lớp:/ })).toBeVisible();
  await page.getByRole('button', { name: `Thao tác tài khoản ${state.student.full_name}` }).click();
  await page.getByRole('menuitem', { name: 'Xác nhận hồ sơ sinh viên' }).click();
  await expect(page.getByRole('main').getByText('Đã xác nhận hồ sơ sinh viên Nguyễn Văn Thiện.', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Đã xác nhận', exact: true })).toBeVisible();
  expect(state.calls.map(call => call.method)).toEqual(['PUT', 'POST']);
  expect(state.calls[0].body.student_code).toBe('001it123');
  expect(state.calls[1].body).toEqual({ identity_profile_version: 2 });
});

test('admin can approve the name before a confirmed card supplies the MSSV', async ({ page }) => {
  const state = await adminSession(page);
  await page.goto('/dashboard/users');
  await page.getByRole('button', { name: `Thao tác tài khoản ${state.student.full_name}` }).click();
  await page.getByRole('menuitem', { name: 'Xác nhận hồ sơ sinh viên' }).click();
  await expect(page.getByRole('cell', { name: 'Đã xác nhận', exact: true })).toBeVisible();
  expect(state.student.student_code).toBeNull();
  expect(state.calls).toEqual([{ method: 'POST', body: { identity_profile_version: 1 } }]);
});

test('stale admin confirmation keeps the profile pending and displays a retry', async ({ page }) => {
  const state = await adminSession(page);
  state.student.student_code = '21IT123';
  state.rejectVerification = true;
  await page.goto('/dashboard/users');
  await page.getByRole('button', { name: `Thao tác tài khoản ${state.student.full_name}` }).click();
  await page.getByRole('menuitem', { name: 'Xác nhận hồ sơ sinh viên' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Chờ xác nhận', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tải lại danh sách' })).toBeVisible();
});

test('student sees verified authoritative identity without an editable MSSV', async ({ page }) => {
  const state = await uiSession(page);
  Object.assign(state.user, { student_code: '001IT123', identity_profile_status: 'VERIFIED', identity_profile_version: 2 });
  await page.route('**/api/v1/identity/student-card/status', route => route.fulfill({
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true' },
    json: { data: { identity_profile_status: 'VERIFIED', student_card_status: 'NOT_SUBMITTED', has_reference: false, reference_version: null } },
  }));
  await page.goto('/student/profile');
  const main = page.getByRole('main');
  await expect(main.getByText('001IT123', { exact: true })).toBeVisible();
  await expect(main.getByText('Hồ sơ sinh viên đã được xác nhận')).toBeVisible();
  await expect(main.getByText('Chưa xác thực thẻ sinh viên', { exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Tải thẻ sinh viên', exact: true })).toBeEnabled();
  await expect(main.getByRole('textbox')).toHaveCount(0);
});

test('refresh from another account never replaces the tab token', async ({ page }) => {
  await uiSession(page);
  await page.route('**/api/v1/auth/refresh', route => route.fulfill({
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true' },
    json: { user: { id: 'another-account' }, access_token: 'wrong-account-token' },
  }));
  await page.goto('/student/profile');
  await expect(page.getByRole('main').getByText('Hồ sơ sinh viên của bạn đang chờ xác nhận.')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('ai-proctoring-access-token'))).toBe('synthetic-token');
});
