import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Fixtures stay in tests; the actual page always calls the existing backend APIs.
const student = {
  id: '11111111-1111-4111-8111-111111111111',
  full_name: 'Student 4', email: 'student4@example.com', role: 'student',
  phone: '0901234567', avatar_url: null as string | null,
  avatar_source: null as 'STUDENT_CARD' | null,
  avatar_reference_id: null as string | null,
  avatar_updated_at: null as string | null,
  is_active: true, created_at: '2026-01-02T00:00:00Z',
  student_code: null as string | null, identity_profile_status: 'PENDING', identity_profile_version: 1,
  student_card_status: 'NOT_SUBMITTED', identity_verified_at: null,
};

async function session(page: Page, overrides: Partial<typeof student> = {}) {
  const state = {
    user: { ...student, ...overrides },
    classes: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Kiểm thử phần mềm' }],
    profileError: false, classesError: false, profileGate: null as Promise<void> | null,
  };
  await page.addInitScript((user) => {
    if (!sessionStorage.getItem('profile-test-initialized')) {
      sessionStorage.setItem('ai-proctoring-current-user', JSON.stringify(user));
      sessionStorage.setItem('ai-proctoring-access-token', 'synthetic-test-token');
      sessionStorage.setItem('profile-test-initialized', 'true');
    }
  }, state.user);
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = {
      'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/api/v1/auth/me') {
      if (state.profileGate) await state.profileGate;
      return route.fulfill({ status: state.profileError ? 503 : 200, headers,
        json: state.profileError ? { error: { message: 'Synthetic outage' } } : { user: state.user } });
    }
    if (path === '/api/v1/auth/refresh') return route.fulfill({ headers, json: { access_token: 'synthetic-test-token' } });
    if (path === '/api/v1/classes') return route.fulfill({ status: state.classesError ? 503 : 200, headers,
      json: state.classesError ? { error: { message: 'Synthetic outage' } } : { data: state.classes } });
    return route.fulfill({ headers, json: { data: [] } });
  });
  return state;
}

const account = (page: Page) => page.getByRole('button', { name: /^Tài khoản của/ });
async function openProfile(page: Page) {
  await account(page).click();
  await page.getByRole('menuitem', { name: 'Hồ sơ sinh viên' }).click();
  await expect(page).toHaveURL(/\/student\/profile$/);
}

test('name and avatar open one account menu; outside click closes it', async ({ page }) => {
  await session(page);
  await page.goto('/student');
  await account(page).getByText('Student 4', { exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Đăng xuất' })).toHaveCount(1);
  await expect(page.locator('header .logout-button')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await account(page).locator('.topbar-avatar').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('heading', { name: 'Lịch học và lịch thi' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('account menu supports Enter, Space, arrows, Escape and Tab', async ({ page }) => {
  await session(page);
  await page.goto('/student');
  await account(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Hồ sơ sinh viên' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Đăng xuất' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('menuitem', { name: 'Hồ sơ sinh viên' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(account(page)).toBeFocused();
  await expect(account(page)).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Space');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('profile navigation renders actual API fields and class links', async ({ page }) => {
  await session(page);
  await page.goto('/student');
  await openProfile(page);
  const main = page.getByRole('main');
  await expect(main.locator('h1')).toHaveCount(0);await expect(main.getByRole('heading',{name:'Student 4',exact:true})).toBeVisible();
  await expect(main.locator('dd').filter({ hasText: /^Student 4$/ })).toBeVisible();
  await expect(main.getByText('student4@example.com', { exact: true })).toBeVisible();
  await expect(main.getByText('0901234567')).toBeVisible();
  await expect(main.getByText('Đang hoạt động')).toBeVisible();
  await expect(main.getByRole('link', { name: /Kiểm thử phần mềm/ })).toHaveAttribute('href', /\/student\/classes\//);
  await expect(main.getByText('Chưa có ảnh hồ sơ', { exact: true })).toBeVisible();
  await expect(main).not.toContainText('Đăng ký lại khuôn mặt');
  await expect(main).toContainText('Mã sinh viên');
  await expect(main).toContainText('Hồ sơ sinh viên của bạn đang chờ xác nhận.');
  await expect(main.locator('input[type="file"]')).toHaveCount(0);
  await expect(main).not.toContainText('Dữ liệu nhận diện');
});

test('missing optional fields and classes show clear placeholders', async ({ page }) => {
  const state = await session(page, { phone: undefined, avatar_url: null });
  state.classes = [];
  await page.goto('/student/profile');
  const main = page.getByRole('main');
  await expect(main.getByText('Chưa cập nhật', { exact: true })).toHaveCount(3);
  await expect(main.getByRole('img', { name: 'Chưa có ảnh hồ sơ', exact: true })).toHaveText('S4');
  await expect(main.getByText('Bạn chưa tham gia lớp học phần nào.')).toBeVisible();
  await expect(main).not.toContainText('undefined');
  await expect(main).not.toContainText('null');
});

test('profile photo uses protected card avatar_url; a failed image falls back to initials', async ({ page }) => {
  const reference = '33333333-3333-4333-8333-333333333333';
  const avatar = `/api/v1/users/${student.id}/avatar/${reference}`;
  await session(page, { avatar_url: avatar, avatar_source: 'STUDENT_CARD', avatar_reference_id: reference,
    identity_profile_status: 'VERIFIED', student_card_status: 'VERIFIED', student_code: '001IT123' });
  let broken = false;
  await page.route(`**${avatar}`, route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,OPTIONS', 'cache-control': 'no-store' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return broken ? route.fulfill({ status: 404, headers, body: '' }) : route.fulfill({ headers, contentType: 'image/jpeg', body: readFileSync(join(process.cwd(), 'tests/e2e/fixtures/avatar-first.jpg')) });
  });
  await page.goto('/student/profile');
  const image = page.getByRole('img', { name: 'Ảnh hồ sơ của Student 4', exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  broken = true;
  await page.reload();
  await expect(page.getByRole('img', { name: 'Chưa có ảnh hồ sơ', exact: true })).toHaveText('S4');
});

test('profile loading state is visible until the API responds', async ({ page }) => {
  const state = await session(page);
  await page.goto('/student');
  await expect(account(page)).toBeVisible();
  let release!: () => void;
  state.profileGate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await openProfile(page);
    await expect(page.getByRole('main').getByLabel('Đang tải')).toBeVisible();
  } finally {
    release();
    state.profileGate = null;
  }
  await expect(page.getByRole('main').getByText('0901234567')).toBeVisible();
});

test('profile API error can be retried without crashing the page', async ({ page }) => {
  const state = await session(page);
  await page.goto('/student');
  await expect(account(page)).toBeVisible();
  state.profileError = true;
  await openProfile(page);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Không tải được hồ sơ');
  state.profileError = false;
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page.getByRole('main').getByText('0901234567')).toBeVisible();
});

test('class API failure leaves account details available and supports retry', async ({ page }) => {
  const state = await session(page);
  state.classesError = true;
  await page.goto('/student/profile');
  await expect(page.getByRole('main').getByText('0901234567')).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Không tải được danh sách lớp học phần.');
  state.classesError = false;
  await page.getByRole('button', { name: 'Tải lại lớp học phần' }).click();
  await expect(page.getByRole('main').getByRole('link', { name: /Kiểm thử phần mềm/ })).toBeVisible();
});

test('logout preserves the existing per-tab session behavior', async ({ page }) => {
  await session(page);
  await page.goto('/student/profile');
  await account(page).click();
  await page.getByRole('menuitem', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => sessionStorage.getItem('ai-proctoring-current-user'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('ai-proctoring-access-token'))).toBeNull();
  await page.reload();
  await expect(account(page)).toHaveCount(0);
});

test('student navigation keeps existing routes and does not duplicate profile', async ({ page }) => {
  await session(page);
  await page.goto('/student/profile');
  const navigation = page.getByRole('navigation', { name: 'Điều hướng sinh viên' });
  await expect(navigation.getByRole('link', { name: 'Trang chủ' })).toHaveAttribute('href', '/student');
  await expect(navigation.getByRole('link', { name: 'Lớp học phần' })).toHaveAttribute('href', '/student/classes');
  await navigation.getByRole('button', { name: 'Bài kiểm tra' }).click();
  await expect(navigation.getByRole('link', { name: 'Thử nhận diện' })).toHaveCount(0);
  await expect(navigation.getByRole('link', { name: /Hồ sơ/ })).toHaveCount(0);
});

test('mobile and tablet layouts keep long account details and menu in viewport', async ({ page }) => {
  await session(page, { full_name: 'Sinh viên có họ và tên dài để kiểm tra giao diện', email: `${'student'.repeat(12)}@example.test` });
  await page.goto('/student/profile');
  await expect(page.getByRole('heading', { name: 'Thông tin tài khoản' })).toBeVisible();
  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await account(page).click();
    const bounds = await page.getByRole('menu').boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
  }
});
