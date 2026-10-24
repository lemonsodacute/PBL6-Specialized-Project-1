import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { uiSession } from './ui-fixtures';

test.setTimeout(90_000);
const avatarBytes = readFileSync(join(process.cwd(), 'tests/e2e/fixtures/avatar-first.jpg'));
const imageId = '22222222-2222-4222-8222-222222222222';

async function teacherSession(page: Page) {
  const session = await uiSession(page, 'teacher');
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role: 'teacher' })).toString('base64url')}.signature`, url: 'http://localhost:3000' }]);
  const state = { user: { ...session.user, avatar_source: null as string | null, avatar_updated_at: null as string | null, avatar_url: null as string | null },
    fail: false, writes: [] as Record<string, unknown>[], uploads: 0, avatarHeaders: [] as (string | undefined)[], gate: null as Promise<void> | null };
  const headers = { 'access-control-allow-origin': 'http://localhost:3000', 'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };
  await page.route('**/api/v1/auth/me', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().method() === 'PATCH') {
      state.writes.push(route.request().postDataJSON());
      if (state.gate) await state.gate;
      if (state.fail) return route.fulfill({ status: 503, headers, json: { error: { message: 'PRIVATE_SQL_ERROR' } } });
      Object.assign(state.user, route.request().postDataJSON());
    }
    return route.fulfill({ headers, json: { user: state.user } });
  });
  await page.route('**/api/v1/auth/me/avatar', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    state.uploads++;
    if (state.fail) return route.fulfill({ status: 503, headers, json: { error: { message: 'PRIVATE_SQL_ERROR' } } });
    const body = route.request().postDataBuffer()!.toString('utf8');
    const profile = JSON.parse(body.match(/name="profile"\r\n\r\n([\s\S]*?)\r\n--/)![1]);
    expect(Object.keys(profile).sort()).toEqual(['full_name', 'phone']);
    Object.assign(state.user, profile, { avatar_url: `/api/v1/teachers/${state.user.id}/avatar/${imageId}`, avatar_source: 'TEACHER_UPLOAD', avatar_updated_at: '2026-10-14T10:00:00Z' });
    return route.fulfill({ headers, json: { user: state.user } });
  });
  await page.route('**/api/v1/teachers/*/avatar/*', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    state.avatarHeaders.push(route.request().headers().authorization);
    return route.fulfill({ headers, contentType: 'image/jpeg', body: avatarBytes });
  });
  await page.goto('/teacher/profile', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true })).toBeVisible({ timeout: 30_000 });
  return state;
}

for (const width of [375, 768, 1440]) test(`teacher edits own name and phone; shared header and reload update at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 960 });
  const state = await teacherSession(page);
  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true }).click();
  const save = page.getByRole('button', { name: 'Lưu thay đổi', exact: true });
  await expect(save).toBeDisabled();
  await expect(page.getByLabel('Họ và tên', { exact: true })).toBeFocused();
  await expect(page.locator('main input[type=email]')).toHaveCount(0);
  await expect(page.locator('main select')).toHaveCount(0);
  await page.getByLabel('Họ và tên', { exact: true }).fill('  Giảng viên cập nhật  ');
  await page.locator('#teacher-phone').fill(' 0012345678 ');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: info.outputPath(`teacher-edit-${width}.png`), fullPage: true });
  let release!: () => void; state.gate = new Promise(resolve => { release = resolve; });
  await save.click();
  await expect(page.getByRole('button', { name: 'Đang lưu...', exact: true })).toBeDisabled();
  release(); state.gate = null;
  await expect(page.getByText('Cập nhật hồ sơ thành công.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tài khoản của Giảng viên cập nhật', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true })).toBeFocused();
  expect(state.writes).toEqual([{ full_name: 'Giảng viên cập nhật', phone: '0012345678' }]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Giảng viên cập nhật', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('0012345678', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`teacher-profile-${width}.png`), fullPage: true });
});

test('teacher previews avatar locally and saves photo plus fields together; header uses protected image', async ({ page }) => {
  const state = await teacherSession(page);
  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true }).click();
  await page.getByLabel('Họ và tên', { exact: true }).fill('Giảng viên có ảnh');
  await page.getByLabel('Ảnh đại diện', { exact: true }).setInputFiles({ name: 'avatar.jpg', mimeType: 'image/jpeg', buffer: avatarBytes });
  await expect(page.getByRole('img', { name: 'Xem trước ảnh đại diện', exact: true })).toBeVisible();
  expect(state.uploads).toBe(0);
  await expect(page.locator('header img.topbar-avatar')).toHaveCount(0);
  state.fail = true;
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Không thể cập nhật hồ sơ');
  await expect(page.getByLabel('Họ và tên', { exact: true })).toHaveValue('Giảng viên có ảnh');
  await expect(page.getByRole('img', { name: 'Xem trước ảnh đại diện', exact: true })).toBeVisible();
  state.fail = false;
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  await expect(page.getByText('Cập nhật hồ sơ thành công.', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Ảnh hồ sơ của Giảng viên có ảnh', exact: true })).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('header img.topbar-avatar')).toHaveAttribute('src', /^blob:/);
  expect(state.avatarHeaders.every(value => value === 'Bearer synthetic-token')).toBe(true);
  expect(state.writes).toHaveLength(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('img', { name: 'Ảnh hồ sơ của Giảng viên có ảnh', exact: true })).toBeVisible({ timeout: 30_000 });
});

test('invalid fields and upload are blocked; failed save preserves inputs; cancel writes nothing', async ({ page }) => {
  const state = await teacherSession(page);
  const edit = page.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true });
  await edit.click();
  await page.getByLabel('Họ và tên', { exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Họ và tên cần từ 2 đến 255 ký tự');
  expect(state.writes).toHaveLength(0);
  await page.getByLabel('Họ và tên', { exact: true }).fill('Tên mới');
  await page.locator('#teacher-phone').fill('abc');
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Số điện thoại cần 8–15 chữ số');
  await page.locator('#teacher-phone').fill('');
  state.fail = true;
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Không thể cập nhật hồ sơ');
  await expect(page.getByLabel('Họ và tên', { exact: true })).toHaveValue('Tên mới');
  await expect(page.getByText('PRIVATE_SQL_ERROR')).toHaveCount(0);
  await page.getByLabel('Ảnh đại diện', { exact: true }).setInputFiles({ name: 'invalid.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Không đọc được ảnh');
  await expect(page.getByRole('button', { name: 'Lưu thay đổi', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(edit).toBeFocused();
  await edit.click();
  await expect(page.getByLabel('Họ và tên', { exact: true })).toHaveValue(state.user.full_name);
  await expect(page.getByRole('button', { name: 'Lưu thay đổi', exact: true })).toBeDisabled();
  expect(state.writes).toHaveLength(1); expect(state.uploads).toBe(0);
});

test('admin user management displays the updated teacher name, phone and protected avatar', async ({ page }) => {
  const session = await uiSession(page, 'admin');
  const teacher = { ...session.user, id: imageId, role: 'teacher', full_name: 'Giảng viên mới', phone: '0012345678',
    avatar_url: `/api/v1/teachers/${imageId}/avatar/${imageId}`, avatar_source: 'TEACHER_UPLOAD' };
  const headers = { 'access-control-allow-origin': 'http://localhost:3000', 'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,OPTIONS' };
  await page.route('**/api/v1/users?**', route => route.fulfill({ headers, json: { data: [teacher], meta: { total: 1, page: 1, limit: 20 } } }));
  await page.route('**/api/v1/teachers/*/avatar/*', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    expect(route.request().headers().authorization).toBe('Bearer synthetic-token');
    return route.fulfill({ headers, contentType: 'image/jpeg', body: avatarBytes });
  });
  await page.goto('/dashboard/users', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Chỉnh sửa', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('0012345678', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Chỉnh sửa tài khoản', exact: true });
  await expect(dialog.getByLabel('Họ và tên', { exact: true })).toHaveValue('Giảng viên mới');
  await expect(dialog.getByRole('img', { name: 'Ảnh hồ sơ của Giảng viên mới', exact: true })).toHaveAttribute('src', /^blob:/);
});
