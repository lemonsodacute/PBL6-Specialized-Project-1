import { expect, test, type Page, type Locator } from '@playwright/test';
import { classPagesSession } from './class-pages-design-fixture';
import { fixtureUser } from './ui-fixtures';

const roles = ['student', 'teacher', 'admin'] as const;
const routes = { student: '/student/live-classes', teacher: '/dashboard/classes', admin: '/admin/settings' };
const areas = { student: 'Khu vực sinh viên', teacher: 'Khu vực giảng dạy', admin: 'Khu vực quản trị' };
const dots = { student: 'rgb(8, 127, 140)', teacher: 'rgb(180, 83, 9)', admin: 'rgb(112, 80, 181)' };

async function setup(page: Page, role: typeof roles[number]) {
  await classPagesSession(page, role);
  await page.routeWebSocket('**/api/v1/**', () => {});
  const state = { count: 2, writes: 0 };
  await page.route('**/api/v1/notifications**', async route => {
    const request = route.request();
    const headers = { 'access-control-allow-origin': request.headers().origin ?? 'http://localhost:3000',
      'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,PATCH,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (request.method() === 'PATCH') { state.writes++; state.count = 0; }
    const json = request.url().includes('unread-count') ? { data: { count: state.count } } : { data: [1, 2].map(n => ({
      id: `notification-${n}`, type: 'exam_summary', title: `Thông báo ${n}`, message: 'Thông báo kiểm tra giao diện.',
      is_read: state.count === 0, created_at: '2026-10-29T01:00:00Z', severity: null,
      related_exam_id: null, related_attempt_id: null, related_student_id: null,
    })), meta: { total: 2, page: 1, limit: 8 } };
    return route.fulfill({ headers, json });
  });
  return state;
}
function luminance(color: string) {
  const c = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
}
async function checkContrast(locator: Locator) {
  const colors = await locator.evaluate(el => ({ ink: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
  const a = luminance(colors.ink), b = luminance(colors.bg);
  expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toBeGreaterThanOrEqual(4.5);
}
async function withinViewport(locator: Locator, width: number) {
  const box = (await locator.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  return box;
}

for (const role of roles) for (const theme of ['light', 'dark'] as const) for (const width of [1440, 1024, 768, 390]) {
  test(`${role} pastel topbar fits ${width}px ${theme}`, async ({ page }, info) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 950 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await setup(page, role);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(routes[role], { waitUntil: 'domcontentloaded' });
    const bar = page.locator('header.topbar'), badge = bar.locator('.topbar-title');
    const bell = bar.getByRole('button', { name: 'Thông báo, 2 chưa đọc', exact: true });
    const account = bar.getByRole('button', { name: `Tài khoản của ${fixtureUser.full_name}`, exact: true });
    await expect(bell).toBeVisible({ timeout: 30000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(badge).toHaveText(areas[role]);
    await expect(badge).toHaveCSS('background-color', 'rgb(201, 241, 228)');
    await expect(bell).toHaveCSS('background-color', 'rgb(255, 224, 138)');
    await expect(bell.locator('.notification-count')).toHaveText('2');
    await expect(bell.locator('.notification-count')).toHaveCSS('background-color', 'rgb(201, 43, 70)');
    expect(await badge.evaluate(el => getComputedStyle(el, '::before').backgroundColor)).toBe(dots[role]);
    for (const control of [badge, bell, account]) {
      await expect(control).toHaveCSS('border-top-width', '2px');
      await checkContrast(control);
    }
    await checkContrast(bell.locator('.notification-count'));
    await expect(account.locator('.topbar-avatar')).toHaveCSS('background-color', 'rgb(255, 201, 214)');
    await expect(account.locator('svg')).toBeVisible();
    await expect(account.locator('strong')).toHaveText(fixtureUser.full_name);
    await expect(account.locator('small')).toHaveText(fixtureUser.email);
    if (width >= 768) {
      await expect(account.locator('strong')).toBeVisible();
      await expect(account.locator('small')).toBeVisible();
    }
    const [roleBox, bellBox, profileBox] = await Promise.all([badge, bell, account].map(el => withinViewport(el, width)));
    expect(roleBox.x + roleBox.width + 8).toBeLessThanOrEqual(bellBox.x);
    expect(bellBox.x + bellBox.width + 8).toBeLessThanOrEqual(profileBox.x);
    expect(Math.abs(roleBox.y + roleBox.height / 2 - profileBox.y - profileBox.height / 2)).toBeLessThan(1);
    for (const box of [bellBox, profileBox]) { expect(box.height).toBeGreaterThanOrEqual(44); expect(box.width).toBeGreaterThanOrEqual(44); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await account.focus();
    await expect(account).toHaveCSS('outline-style', 'solid');
    await account.evaluate(el => (el as HTMLElement).blur());
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: info.outputPath(`${role}-${width}-${theme}.png`), animations: 'disabled' });
    expect(errors).toEqual([]);
  });
}

for (const role of roles) for (const width of [1440, 390]) {
  test(`${role} notification and account behavior at ${width}px`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 });
    const state = await setup(page, role);
    await page.goto(routes[role], { waitUntil: 'domcontentloaded' });
    const bell = page.locator('header .notification-bell');
    const account = page.getByRole('button', { name: `Tài khoản của ${fixtureUser.full_name}`, exact: true });
    await expect(bell).toHaveAttribute('aria-label', 'Thông báo, 2 chưa đọc', { timeout: 30000 });
    await bell.focus(); await page.keyboard.press('Enter');
    const panel = page.getByRole('region', { name: 'Thông báo', exact: true });
    await expect(panel.getByRole('heading')).toBeFocused();
    await withinViewport(panel, width);
    await expect(panel.getByRole('link', { name: 'Xem tất cả thông báo' })).toHaveAttribute('href', '/notifications');
    await panel.getByRole('button', { name: 'Đánh dấu tất cả đã đọc' }).click();
    await expect(bell).toHaveAttribute('aria-label', 'Thông báo');
    await expect(bell.locator('.notification-count')).toHaveCount(0);
    expect(state.writes).toBe(1);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0); await expect(bell).toBeFocused();
    await account.focus(); await page.keyboard.press('ArrowDown');
    const menu = page.getByRole('menu', { name: 'Tài khoản', exact: true });
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await withinViewport(menu.locator('..'), width);
    await expect(menu.locator('..')).toContainText(fixtureUser.full_name);
    await expect(menu.locator('..')).toContainText(fixtureUser.email);
    if (role !== 'admin') await expect(menu.getByRole('menuitem').first()).toHaveAttribute('href', `/${role}/profile`);
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitem', { name: 'Đăng xuất' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0); await expect(account).toBeFocused();
    await account.click(); await page.locator('.topbar-title').click();
    await expect(menu).toHaveCount(0);
    if (width < 1024) {
      await page.getByRole('button', { name: 'Mở menu', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: 'Menu điều hướng' });
      await expect(drawer).toBeVisible();
      await drawer.getByRole('button', { name: 'Đóng menu', exact: true }).click();
      await expect(drawer).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
