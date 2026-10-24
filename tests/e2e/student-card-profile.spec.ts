import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { uiSession } from './ui-fixtures';

const previewId = '22222222-2222-4222-8222-222222222222';
const referenceId = '33333333-3333-4333-8333-333333333333';
const image = readFileSync(join(process.cwd(), 'tests/e2e/fixtures/avatar-first.jpg'));

async function setup(page: Page, code: string | null = null, className: string | null = null) {
  const session = await uiSession(page);
  const profile = { ...session.user, full_name: 'Lê Nguyễn Châu Anh', student_code: code,
    class_name: className, identity_profile_status: 'VERIFIED', identity_profile_version: 1,
    student_card_status: 'NOT_SUBMITTED', avatar_url: null as string | null,
    avatar_source: null as string | null, avatar_reference_id: null as string | null, avatar_updated_at: null as string | null };
  Object.assign(session.user, profile);
  const state = { profile, ocrCode: '102230057', ocrClass: '22T1' as string | null, confirmed: false,
    confirmCalls: 0, confirmFailure: false, confirmGate: null as Promise<void> | null, avatarRequests: 0 };
  const headersFor = (origin?: string) => ({ 'access-control-allow-origin': origin ?? process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' });
  await page.route('**/api/v1/users/**/avatar/**', route => {
    const headers = headersFor(route.request().headers().origin);
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    state.avatarRequests++;
    return route.fulfill({ headers, contentType: 'image/jpeg', body: image });
  });
  await page.route('**/api/v1/identity/student-card/**', async route => {
    const headers = headersFor(route.request().headers().origin), path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path.includes('/previews/')) return route.fulfill({ headers, contentType: 'image/jpeg', body: image });
    if (path.endsWith('/preview')) return route.fulfill({ headers, json: { data: {
      preview_id: previewId, expires_at: new Date(Date.now()+600_000).toISOString(),
      card_preview_url: `/api/v1/identity/student-card/previews/${previewId}/card`, face_preview_url: `/api/v1/identity/student-card/previews/${previewId}/face`,
      extracted: { full_name: profile.full_name, student_code: state.ocrCode, class_name: state.ocrClass,
        class_confidence: state.ocrClass ? .98 : null, class_status: state.ocrClass ? 'READABLE' : 'CLASS_UNREADABLE', major: 'Công nghệ thông tin' },
      comparison: { name_match: true, name_match_type: 'EXACT', student_code_match: !profile.student_code || profile.student_code === state.ocrCode,
        student_code_will_update: !profile.student_code },
      can_confirm: !profile.student_code || profile.student_code === state.ocrCode,
      blocking_errors: profile.student_code && profile.student_code !== state.ocrCode ? ['STUDENT_CODE_MISMATCH'] : [], warnings: [],
    } } });
    if (path.endsWith('/confirm')) {
      state.confirmCalls++;
      expect(route.request().postDataJSON()).toEqual({ preview_id: previewId });
      if (state.confirmGate) await state.confirmGate;
      if (state.confirmFailure) return route.fulfill({ status: 503, headers, json: { error: { code: 'REFERENCE_SAVE_FAILED' } } });
      if (!profile.student_code) { profile.student_code = state.ocrCode; profile.identity_profile_version++; }
      if (state.ocrClass) profile.class_name = state.ocrClass;
      state.confirmed = true; profile.student_card_status = 'VERIFIED';
      profile.avatar_source = 'STUDENT_CARD'; profile.avatar_reference_id = referenceId;
      profile.avatar_url = `/api/v1/users/${profile.id}/avatar/${referenceId}`;
      profile.avatar_updated_at = new Date().toISOString();
      Object.assign(session.user, profile);
    }
    return route.fulfill({ headers, json: { data: { identity_profile_status: 'VERIFIED', student_card_status: profile.student_card_status,
      has_reference: state.confirmed, reference_version: state.confirmed ? referenceId : null, card_admin_version: state.confirmed ? 1 : 0,
      updated_at: state.confirmed ? new Date().toISOString() : null } } });
  });
  return state;
}

const summary = (page: Page) => page.getByRole('region', { name: 'Thông tin sinh viên', exact: true });
async function upload(page: Page) {
  await expect(page.getByRole('button', { name: /^(Tải thẻ sinh viên|Cập nhật thẻ sinh viên)$/ })).toBeEnabled();
  await page.getByLabel('Ảnh thẻ sinh viên', { exact: true }).setInputFiles({ name: 'synthetic-card.jpg', mimeType: 'image/jpeg', buffer: image });
  await expect(page.getByRole('img', { name: 'Khuôn mặt được phát hiện' })).toBeVisible();
}

for (const width of [375, 1440]) test(`confirmed card updates profile metadata and avatar without F5 at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 950 });
  const state = await setup(page); await page.goto('/student/profile');
  await expect(summary(page).getByText('Chưa cập nhật', { exact: true })).toHaveCount(2);
  await upload(page);
  await expect(page.getByText('MSSV sẽ được lưu vào hồ sơ khi xác nhận thẻ.')).toBeVisible();
  await expect(summary(page).getByText('Chưa cập nhật', { exact: true })).toHaveCount(2);
  expect(state.profile.student_code).toBeNull(); expect(state.profile.class_name).toBeNull();
  await page.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true }).click();
  await expect(summary(page).getByText('102230057', { exact: true })).toBeVisible();
  await expect(summary(page).getByText('22T1', { exact: true })).toBeVisible();
  await expect(summary(page).getByText('Đã xác minh', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Ảnh hồ sơ của Lê Nguyễn Châu Anh', exact: true })).toBeVisible();
  await expect.poll(() => state.avatarRequests).toBeGreaterThan(0);
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').map(entry => (entry as PerformanceNavigationTiming).type))).toEqual(['navigate']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: test.info().outputPath(`confirmed-profile-${width}.png`), fullPage: true });
  await page.reload();
  await expect(summary(page).getByText('102230057', { exact: true })).toBeVisible();
  await expect(summary(page).getByText('22T1', { exact: true })).toBeVisible();
  expect(state.confirmCalls).toBe(1);
});

test('a failed confirm keeps profile untouched and retry persists it', async ({ page }) => {
  const state = await setup(page); state.confirmFailure = true;
  await page.goto('/student/profile'); await upload(page);
  await page.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Xác minh danh tính', exact: true }).getByRole('alert')).toContainText('Chưa lưu được ảnh định danh');
  await expect(summary(page).getByText('Chưa cập nhật', { exact: true })).toHaveCount(2);
  expect(state.profile.student_code).toBeNull(); expect(state.profile.class_name).toBeNull();
  state.confirmFailure = false;
  await page.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true }).click();
  await expect(summary(page).getByText('22T1', { exact: true })).toBeVisible();
});

test('MSSV mismatch directs the student to admin and never offers confirmation', async ({ page }) => {
  const state = await setup(page, '999999999', '20T1');
  await page.goto('/student/profile'); await upload(page);
  await expect(page.getByText('✕ MSSV trên thẻ không khớp với hồ sơ. Vui lòng liên hệ quản trị viên.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true })).toBeDisabled();
  await expect(summary(page).getByText('999999999', { exact: true })).toBeVisible();
  await expect(summary(page).getByText('20T1', { exact: true })).toBeVisible();
  expect(state.confirmCalls).toBe(0);
});

test('unreadable class leaves the existing administrative class after confirm', async ({ page }) => {
  const state = await setup(page, '102230057', '20T1'); state.ocrClass = null;
  await page.goto('/student/profile'); await upload(page);
  await expect(page.getByText('Không đọc được', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true }).click();
  await expect(page.getByText('Ảnh định danh đã được xác nhận.')).toBeVisible();
  await expect(summary(page).getByText('20T1', { exact: true })).toBeVisible();
  expect(state.profile.student_code).toBe('102230057');
});

test('a replacement verified card updates administrative class while preserving MSSV and course membership', async ({ page }) => {
  const state = await setup(page, '102230057', '22T1');
  state.profile.student_card_status = 'NEEDS_REUPLOAD'; state.ocrClass = '22T2';
  await page.goto('/student/profile'); await upload(page);
  await expect(summary(page).getByText('22T1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true }).click();
  await expect(summary(page).getByText('22T2', { exact: true })).toBeVisible();
  await expect(summary(page).getByText('102230057', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Kiểm thử phần mềm/ })).toHaveCount(1);
  await expect(page.getByRole('link', { name: /22T2/ })).toHaveCount(0);
});

test('a delayed pre-confirm user response cannot restore old profile metadata', async ({ page }) => {
  await setup(page); await page.goto('/student/profile'); await upload(page);
  await expect(page.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true })).toBeEnabled();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let captured!: () => void;
  const started = new Promise<void>(resolve => { captured = resolve; });
  let hold = true;
  const stale = { full_name: 'Lê Nguyễn Châu Anh', id: '11111111-1111-4111-8111-111111111111',
    email: 'student@example.com', role: 'student', student_code: null, class_name: null, avatar_url: null, is_active: true,
    identity_profile_status: 'VERIFIED', student_card_status: 'NOT_SUBMITTED' };
  await page.route('**/api/v1/auth/me', async route => {
    if (route.request().method() !== 'GET' || !hold) return route.fallback();
    hold = false; captured(); await gate;
    return route.fulfill({ headers: { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3002',
      'access-control-allow-credentials': 'true' }, json: { user: stale } });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await started;
  await page.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true }).click();
  await expect(summary(page).getByText('22T1', { exact: true })).toBeVisible();
  const staleResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/me' && response.request().method() === 'GET');
  release();
  await (await staleResponse).finished();
  await expect(summary(page).getByText('22T1', { exact: true })).toBeVisible();
  await expect(summary(page).getByText('102230057', { exact: true })).toBeVisible();
});

test('admin user detail reads class and card status from the profile API', async ({ page }) => {
  await uiSession(page, 'admin');
  const student = { id: '22222222-2222-4222-8222-222222222222', full_name: 'Hồ sơ kiểm thử', email: 'profile@example.test',
    role: 'student', is_active: true, student_code: '102230057', class_name: '22T1', student_card_status: 'VERIFIED',
    identity_profile_status: 'VERIFIED', identity_profile_version: 2 };
  await page.route('**/api/v1/users**', route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3002',
      'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ headers, json: path.includes('/profile-verification/') ? { data: [], meta: { total: 0 } }
      : { data: path.endsWith(student.id) ? student : [student], meta: { total: 1 } } });
  });
  await page.goto('/dashboard/users');
  await expect(page.getByRole('row').filter({ hasText: student.email })).toContainText('Lớp: 22T1');
  await page.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('22T1', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Đã xác thực', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Mã sinh viên', { exact: true })).toHaveValue('102230057');
});
