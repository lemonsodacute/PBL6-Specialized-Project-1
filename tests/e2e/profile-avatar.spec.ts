import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureUser, uiSession } from './ui-fixtures';

const reference1 = '22222222-2222-4222-8222-222222222222';
const reference2 = '33333333-3333-4333-8333-333333333333';
const previewId = '44444444-4444-4444-8444-444444444444';
const first = readFileSync(join(process.cwd(), 'tests/e2e/fixtures/avatar-first.jpg'));
const second = readFileSync(join(process.cwd(), 'tests/e2e/fixtures/avatar-second.jpg'));
function headers(route: Route) { return { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS', 'cache-control': 'no-store' }; }

async function avatarSession(page: Page, confirmed = false, viewer = 'student') {
  const session = await uiSession(page, viewer);
  const state = { user: { ...fixtureUser, student_code: '001IT123', identity_profile_status: 'VERIFIED', identity_profile_version: 3,
    student_card_status: confirmed ? 'VERIFIED' : 'NOT_SUBMITTED', avatar_url: confirmed ? `/api/v1/users/${fixtureUser.id}/avatar/${reference1}` : null,
    avatar_source: confirmed ? 'STUDENT_CARD' : null, avatar_reference_id: confirmed ? reference1 : null, avatar_updated_at: null as string | null,
  }, nextReference: reference1, avatarRequests: [] as { path: string; authorization?: string }[], version: 0, unavailable: false, profileUnavailable: false, reason: null as string | null, wasRevoked: false };
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: state.profileUnavailable ? 503 : 200, headers: headers(route), json: state.profileUnavailable ? { error: { code: 'SERVICE_UNAVAILABLE', message: 'Chưa cập nhật được avatar.' } } : { user: state.user } }));
  await page.route('**/api/v1/identity/profile-verification/status', route => route.fulfill({ headers: headers(route), json: { data: { identity_profile_status: 'VERIFIED', verification_request_status: 'COMPLETED' } } }));
  await page.route('**/api/v1/users/*/avatar/*', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: headers(route) });
    state.avatarRequests.push({ path: new URL(route.request().url()).pathname, authorization: route.request().headers().authorization });
    expect(route.request().url()).not.toContain('token');
    if (state.unavailable) return route.fulfill({ status: 503, headers: headers(route), json: { error: { message: 'Ảnh tạm thời không khả dụng.' } } });
    return route.fulfill({ headers: headers(route), contentType: 'image/jpeg', body: route.request().url().endsWith(reference2) ? second : first });
  });
  await page.route('**/api/v1/identity/student-card/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: headers(route) });
    if (path.includes('/previews/')) return route.fulfill({ headers: headers(route), contentType: 'image/jpeg', body: first });
    if (path.endsWith('/preview')) return route.fulfill({ headers: headers(route), json: { data: {
      preview_id: previewId, expires_at: new Date(Date.now() + 600_000).toISOString(),
      card_preview_url: `/api/v1/identity/student-card/previews/${previewId}/card`, face_preview_url: `/api/v1/identity/student-card/previews/${previewId}/face`,
      extracted: { full_name: fixtureUser.full_name, student_code: '001IT123' }, comparison: { name_match: true, name_match_type: 'EXACT', student_code_match: true }, can_confirm: true, blocking_errors: [], warnings: [],
    } } });
    if (path.endsWith('/confirm')) {
      expect(route.request().postDataJSON()).toEqual({ preview_id: previewId });
      Object.assign(state.user, { student_card_status: 'VERIFIED', avatar_url: `/api/v1/users/${fixtureUser.id}/avatar/${state.nextReference}`, avatar_source: 'STUDENT_CARD', avatar_reference_id: state.nextReference, avatar_updated_at: new Date().toISOString() });
      state.version++;
      state.reason = null; state.wasRevoked = false;
    }
    return route.fulfill({ headers: headers(route), json: { data: { identity_profile_status: 'VERIFIED', student_card_status: state.user.student_card_status, has_reference: !!state.user.avatar_reference_id, reference_version: state.user.avatar_reference_id, updated_at: state.user.avatar_updated_at, update_reason: state.reason, card_admin_version: state.version, was_revoked: state.wasRevoked, update_requested: !!state.reason && !state.wasRevoked } } });
  });
  return { state, session };
}
const photo = (page: Page) => page.getByRole('img', { name: `Ảnh hồ sơ của ${fixtureUser.full_name}`, exact: true });
async function uploadAndConfirm(page: Page) {
  await page.getByLabel('Ảnh thẻ sinh viên', { exact: true }).setInputFiles({ name: 'synthetic-card.jpg', mimeType: 'image/jpeg', buffer: first });
  await page.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true }).click();
  await expect(page.getByText('Ảnh định danh đã được xác nhận.')).toBeVisible();
}

test('preview keeps initials; confirm immediately updates profile, sidebar and account avatars', async ({ page }) => {
  const { state } = await avatarSession(page);
  await page.goto('/student/profile');
  await expect(page.getByRole('img', { name: 'Chưa có ảnh hồ sơ', exact: true })).toBeVisible();
  await page.getByLabel('Ảnh thẻ sinh viên', { exact: true }).setInputFiles({ name: 'synthetic-card.jpg', mimeType: 'image/jpeg', buffer: first });
  await expect(page.getByRole('img', { name: 'Khuôn mặt được phát hiện' })).toBeVisible();
  await expect(photo(page)).toHaveCount(0); expect(state.avatarRequests).toHaveLength(0);
  await page.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true }).click();
  await expect(photo(page)).toBeVisible(); await expect(page.locator('img.topbar-avatar')).toHaveCount(1); await expect(page.locator('img.student-avatar')).toHaveCount(1);
  expect(state.avatarRequests.every(request => request.authorization === 'Bearer synthetic-token')).toBe(true);
  await expect(page.getByRole('button', { name: /Upload avatar|Xóa avatar|Thay ảnh hồ sơ/ })).toHaveCount(0);
  await expect(photo(page)).toHaveAttribute('src', /^blob:/);
});

test('new confirmed card replaces every avatar and uses a new protected reference URL', async ({ page }) => {
  const { state } = await avatarSession(page, true); await page.goto('/student/profile'); await expect(photo(page)).toBeVisible();
  const previous = await photo(page).getAttribute('src'); state.nextReference = reference2;
  await expect(page.getByLabel('Ảnh thẻ sinh viên', { exact: true })).toHaveCount(0);
  Object.assign(state.user, { student_card_status: 'NEEDS_REUPLOAD', avatar_source: null, avatar_reference_id: null, avatar_url: null });
  state.reason = 'Quản trị viên yêu cầu cập nhật thẻ.'; state.version++;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Cập nhật thẻ sinh viên', exact: true })).toBeEnabled();
  await uploadAndConfirm(page); await expect(photo(page)).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => photo(page).getAttribute('src')).not.toBe(previous);
  expect(state.avatarRequests.some(request => request.path.endsWith(reference2))).toBe(true);
  expect(state.user.avatar_reference_id).toBe(reference2);
});

test('admin invalidation observed on focus removes avatar and new confirmation restores it', async ({ page }) => {
  const { state } = await avatarSession(page, true); await page.goto('/student/profile'); await expect(photo(page)).toBeVisible();
  Object.assign(state.user, { student_card_status: 'NEEDS_REUPLOAD', avatar_source: null, avatar_reference_id: null, avatar_url: null });
  state.reason = 'Thẻ đã được thu hồi.'; state.wasRevoked = true; state.version++;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(photo(page)).toHaveCount(0); await expect(page.locator('img.topbar-avatar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên mới', exact: true })).toBeEnabled();
  state.nextReference = reference2; state.reason = null;
  await uploadAndConfirm(page); await expect(photo(page)).toBeVisible();
});

test('protected image failure uses fallback while identity remains confirmed', async ({ page }) => {
  const { state } = await avatarSession(page, true); state.unavailable = true;
  await page.goto('/student/profile'); await expect(page.getByText('Ảnh định danh đã được xác nhận.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Chưa có ảnh hồ sơ', exact: true })).toBeVisible();
  await expect(photo(page)).toHaveCount(0); expect(state.user.student_card_status).toBe('VERIFIED');
  state.unavailable = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(photo(page)).toBeVisible();
});

test('avatar profile refetch failure keeps successful identity confirmation and fallback', async ({ page }) => {
  const { state } = await avatarSession(page); await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên' })).toBeEnabled();
  state.profileUnavailable = true;
  await uploadAndConfirm(page);
  await expect(page.getByRole('button', { name: 'Thay đổi ảnh' })).toHaveCount(0);
  await expect(page.getByLabel('Ảnh thẻ sinh viên', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Chưa có ảnh hồ sơ', exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('admin sees the same protected student avatar in card details', async ({ page }) => {
  const { state } = await avatarSession(page, true, 'admin');
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role: 'admin' })).toString('base64url')}.signature`, url: test.info().project.use.baseURL ?? 'http://localhost:3000' }]);
  // Override current account only; the selected student's avatar keeps its source URL.
  await page.route('**/api/v1/auth/me', route => route.fulfill({ headers: headers(route), json: { user: { ...fixtureUser, role: 'admin' } } }));
  const student = { ...state.user, student_id: fixtureUser.id, card_admin_version: 2, management_status: 'VERIFIED', update_reason: null, face_preview_url: null,
    reference: { id: reference1, status: 'ACTIVE', verified_at: '2026-10-11T13:00:00Z', identity_profile_version: 3, verification_source: 'STUDENT_SELF_CONFIRM' } };
  await page.route('**/api/v1/admin/student-cards**', route => route.fulfill({ headers: headers(route), json: route.request().url().includes('/history') ? { data: [], meta: { total: 0 } } : new URL(route.request().url()).pathname.endsWith('student-cards') ? { data: [student], meta: { total: 1 } } : { data: student } }));
  await page.goto('/admin/student-cards'); await page.getByRole('button', { name: 'Xem', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('img', { name: `Ảnh hồ sơ của ${fixtureUser.full_name}` })).toBeVisible();
  expect(state.avatarRequests.some(request => request.path === state.user.avatar_url)).toBe(true);
});
