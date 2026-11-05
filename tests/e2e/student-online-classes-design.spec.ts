import { expect, test, type Page } from '@playwright/test';
import { classPagesSession, liveDesignRows } from './class-pages-design-fixture';

test.use({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
const cards = (page: Page) => page.locator('[data-student-online-session]');
async function setup(page: Page) {
  const state = await classPagesSession(page, 'student');
  await page.routeWebSocket('**/api/v1/**', () => {});
  return state;
}
function luminance(color: string) {
  const values = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
}
function contrast(a: string, b: string) { return (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05); }

for (const [width, theme] of [[1440, 'light'], [1024, 'light'], [768, 'light'], [390, 'light'], [320, 'light'], [1440, 'dark'], [390, 'dark']] as const) {
  test(`student online classes fit ${width}px ${theme} with semantic cards and usable controls`, async ({ page }, info) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const state = await setup(page);
    await page.goto('/student/live-classes', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Lớp học trực tuyến', level: 1, exact: true })).toBeVisible({ timeout: 30000 });
    await expect(cards(page)).toHaveCount(4);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(cards(page).first()).toHaveAttribute('data-student-online-session', 'live-ongoing');
    const columns = await page.locator('.classroom-session-list').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(width >= 768 ? 2 : 1);
    const colors = await cards(page).evaluateAll(nodes => nodes.map(node => {
      const badge = node.querySelector('[data-status]')!, title = node.querySelector('h2')!;
      return { status: node.getAttribute('data-status'), bg: getComputedStyle(node).backgroundColor, ink: getComputedStyle(title).color,
        badgeBg: getComputedStyle(badge).backgroundColor, badgeInk: getComputedStyle(badge).color,
        overflow: node.scrollWidth > node.clientWidth + 1 };
    }));
    expect(new Set(colors.map(value => value.badgeBg)).size).toBe(4);
    for (const value of colors) {
      expect(contrast(value.ink, value.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(value.badgeInk, value.badgeBg)).toBeGreaterThanOrEqual(4.5);
      expect(value.overflow).toBe(false);
      expect(theme === 'light' ? luminance(value.bg) : 1 - luminance(value.bg)).toBeGreaterThan(.8);
    }
    for (const row of liveDesignRows) {
      const card = page.locator(`[data-student-online-session="${row.id}"]`);
      await expect(card.getByRole('heading', { name: row.title, exact: true })).toBeVisible();
      await expect(card).toContainText(row.class_name);
      await expect(card).toContainText(`Giảng viên: ${row.teacher_name}`);
      await expect(card).toContainText(row.description);
      await expect(card.locator('time').first()).toHaveAttribute('datetime', row.scheduled_start);
      await expect(card.locator('time').last()).toHaveAttribute('datetime', row.scheduled_end);
      await expect(card.getByRole('link')).toHaveAttribute('href', `/live-class/${row.id}`);
      expect((await card.getByRole('link').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator('[data-student-online-session="live-scheduled"] time').first()).toHaveText('18:00 28/10/26');
    const detail = page.locator('[data-student-online-session="live-scheduled"]').getByRole('link');
    await detail.hover();
    await page.waitForTimeout(250);
    const detailColors = await detail.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, ink: getComputedStyle(el).color }));
    expect(contrast(detailColors.bg, detailColors.ink)).toBeGreaterThanOrEqual(4.5);
    await page.mouse.move(0, 0);
    const search = page.getByRole('searchbox', { name: 'Tìm lớp hoặc buổi học...', exact: true });
    const status = page.getByRole('combobox', { name: 'Trạng thái', exact: true });
    const sort = page.getByRole('combobox', { name: 'Sắp xếp', exact: true });
    const refresh = page.getByRole('button', { name: 'Làm mới', exact: true });
    const refreshColors = await refresh.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, ink: getComputedStyle(el).color, panel: getComputedStyle(el.closest('.ui-card')!).backgroundColor }));
    expect(refreshColors.bg).not.toBe(refreshColors.panel);
    expect(contrast(refreshColors.bg, refreshColors.ink)).toBeGreaterThanOrEqual(4.5);
    await refresh.hover();
    await page.waitForTimeout(250);
    const hoverColors = await refresh.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, ink: getComputedStyle(el).color }));
    expect(contrast(hoverColors.bg, hoverColors.ink)).toBeGreaterThanOrEqual(4.5);
    await page.mouse.move(0, 0);
    const controls = await Promise.all([search, status, sort, refresh].map(control => control.boundingBox()));
    controls.forEach(box => expect(box!.height).toBeGreaterThanOrEqual(44));
    if (width >= 1024) expect(Math.max(...controls.map(box => box!.y)) - Math.min(...controls.map(box => box!.y))).toBeLessThanOrEqual(1);
    await search.focus();
    expect(await search.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
    if (width < 1024) {
      await page.getByRole('button', { name: 'Mở menu', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: 'Menu điều hướng', exact: true });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('link', { name: 'Lớp học trực tuyến', exact: true })).toHaveAttribute('aria-current', 'page');
      await drawer.getByRole('button', { name: 'Đóng menu', exact: true }).click();
      await expect(drawer).toHaveCount(0);
    } else {
      const active = page.locator('.sidebar a[aria-current="page"]');
      const activeColors = await active.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, ink: getComputedStyle(el).color }));
      expect(contrast(activeColors.bg, activeColors.ink)).toBeGreaterThanOrEqual(4.5);
      expect(activeColors.bg).not.toBe('rgb(255, 255, 255)');
    }
    const chat = page.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true });
    await expect(chat).toHaveCSS('position', 'fixed');
    const before = (await chat.boundingBox())!;
    await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }));
    expect(await chat.boundingBox()).toEqual(before);
    expect(await chat.evaluate(el => getComputedStyle(el).borderRadius)).toBe('50%');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(state.requests.filter(request => request.method !== 'GET')).toHaveLength(0);
    await search.evaluate(el => (el as HTMLElement).blur());
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: info.outputPath(`student-online-${width}-${theme}.png`), timeout: 60000 });
  });
}

test('search/status/sort/refresh keep server params, stable accents and empty state', async ({ page }) => {
  test.setTimeout(90000);
  const state = await setup(page);
  await page.goto('/student/live-classes');
  await expect(cards(page)).toHaveCount(4);
  const iconColor = await page.locator('[data-student-online-session="live-ongoing"] [data-accent]').evaluate(el => getComputedStyle(el).backgroundColor);
  await page.getByRole('searchbox', { name: 'Tìm lớp hoặc buổi học...', exact: true }).fill('Web');
  await page.getByRole('combobox', { name: 'Trạng thái', exact: true }).selectOption('ongoing');
  await page.getByRole('combobox', { name: 'Sắp xếp', exact: true }).selectOption('oldest');
  await expect(cards(page)).toHaveCount(1);
  await expect.poll(() => state.requests.some(request => { const p = new URL(request.url).searchParams; return p.get('q') === 'Web' && p.get('status') === 'ongoing' && p.get('sort') === 'oldest'; })).toBe(true);
  expect(await page.locator('[data-student-online-session="live-ongoing"] [data-accent]').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(iconColor);
  const requestCount = state.requests.length;
  await page.getByRole('button', { name: 'Làm mới', exact: true }).click();
  await expect.poll(() => state.requests.length).toBeGreaterThan(requestCount);
  await expect(cards(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).first().click();
  await expect(cards(page)).toHaveCount(4);
  await page.getByRole('searchbox', { name: 'Tìm lớp hoặc buổi học...', exact: true }).fill('no-matching-session');
  await expect(page.getByText('Không tìm thấy kết quả phù hợp.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).first().click();
  await expect(cards(page)).toHaveCount(4);
  expect(state.requests.filter(request => request.method !== 'GET')).toHaveLength(0);
});

test('recording/detail/join links, notices and error refresh preserve existing behavior', async ({ page }) => {
  test.setTimeout(90000);
  const state = await setup(page);
  Object.assign(state.sessions.find(row => row.status === 'ended')!, { has_published_recording: true, published_recording_id: 'recording-1' });
  await page.goto('/student/live-classes?notice=removed');
  await expect(page.getByRole('main').getByRole('status').filter({ hasText: 'Bạn đã được giảng viên đưa ra khỏi lớp.' })).toBeVisible();
  await expect(page.locator('[data-student-online-session="live-ended"]').getByRole('link', { name: 'Xem lại buổi học', exact: true })).toHaveAttribute('href', '/live-class/live-ended/recordings/recording-1');
  await expect(page.locator('[data-student-online-session="live-ongoing"]').getByRole('link', { name: 'Tham gia', exact: true })).toHaveAttribute('href', '/live-class/live-ongoing');
  await expect(page.locator('[data-student-online-session="live-scheduled"]').getByRole('link', { name: 'Xem chi tiết', exact: true })).toHaveAttribute('href', '/live-class/live-scheduled');
  state.status = 503;
  await page.getByRole('button', { name: 'Làm mới', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
  state.status = 200;
  await page.getByRole('button', { name: 'Làm mới', exact: true }).click();
  await expect(cards(page)).toHaveCount(4);
  expect(state.requests.filter(request => request.method !== 'GET')).toHaveLength(0);
});

test('page decoration releases on client navigation to another Student page', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await setup(page);
  await page.goto('/student/live-classes');
  await expect(cards(page)).toHaveCount(4);
  await page.locator('.sidebar').getByRole('link', { name: 'Lớp học phần', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Danh sách học phần', level: 2, exact: true })).toBeVisible();
  await expect(page.locator('[data-student-online-classes]')).toHaveCount(0);
  await expect(page.locator('.sidebar a[aria-current="page"]')).toHaveCSS('background-color', 'rgb(255, 224, 138)');
  await expect(page.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true })).toHaveCSS('width', '50px');
  // The shared pastel topbar now stays consistent across Student routes.
  await expect(page.locator('.topbar-title')).toHaveCSS('background-color', 'rgb(201, 241, 228)');
});
