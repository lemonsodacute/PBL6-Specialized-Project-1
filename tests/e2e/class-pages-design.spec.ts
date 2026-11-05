import { expect, test } from '@playwright/test';
import { classDesignRows, classPagesSession } from './class-pages-design-fixture';

test.use({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });

for (const width of [320, 390, 768, 1024, 1440]) for (const theme of ['light', 'dark'] as const) {
  test(`teaching collections ${width}px ${theme}: data, illustrations, actions and responsive layout`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await classPagesSession(page);
    await page.goto('/dashboard/classes');
    const classes = page.locator('[data-teaching-class]');
    await expect(classes).toHaveCount(4);
    await expect(page.locator('dl dd')).toHaveText(['4', '39', '1']);
    for (const row of classDesignRows) await expect(page.getByRole('link', { name: `Mở lớp ${row.name}`, exact: true })).toHaveAttribute('href', `/dashboard/classes/${row.id}`);
    for (const image of await classes.locator('img').all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    }
    expect(new Set(await classes.locator('img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src))).size).toBe(4);
    expect((await page.getByRole('link', { name: `Mở lớp ${classDesignRows[0].name}`, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await classes.first().evaluate(card => Math.max(...getComputedStyle(card).transitionDuration.split(',').map(parseFloat)))).toBeLessThanOrEqual(0.001);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.goto('/dashboard/live-classes');
    await expect(page.locator('[data-live-session]')).toHaveCount(4);
    await expect(page.locator('dl dd')).toHaveText(['4', '1', '3']);
    await expect(page.getByRole('button', { name: 'Bắt đầu', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Tham gia', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Điểm danh / Lịch sử', exact: true })).toHaveCount(1);
    await expect(page.locator('[data-live-session="live-cancelled"]')).toContainText('Đã huỷ');
    for (const button of await page.locator('[data-live-session] .ui-button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // The existing form remains usable on both narrow mobile widths.
    if (width <= 390) {
      await page.getByRole('button', { name: '+ Tạo buổi học', exact: true }).click();
      const modal = page.getByRole('dialog', { name: 'Tạo buổi học trực tuyến', exact: true });
      await expect(modal).toBeVisible();
      const box = (await modal.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await modal.getByRole('button', { name: 'Huỷ', exact: true }).click();
      await expect(modal).not.toBeVisible();
    }
  });
}

test('class search and sort preserve query parameters, empty results and dynamic counts', async ({ page }) => {
  const state = await classPagesSession(page);
  await page.goto('/dashboard/classes');
  await expect(page.locator('[data-teaching-class]')).toHaveCount(4);
  await page.getByRole('searchbox', { name: 'Tìm lớp học', exact: true }).fill('JavaScript');
  await expect(page.locator('[data-teaching-class]')).toHaveCount(1);
  await expect(page.locator('dl dd')).toHaveText(['1', '7', '1']);
  await page.getByRole('combobox', { name: 'Sắp xếp', exact: true }).selectOption('name');
  await expect.poll(() => state.requests.some(request => { const p = new URL(request.url).searchParams; return p.get('q') === 'JavaScript' && p.get('sort') === 'name'; })).toBe(true);
  await page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click();
  await expect(page.locator('[data-teaching-class]')).toHaveCount(4);
  await page.getByRole('searchbox', { name: 'Tìm lớp học', exact: true }).fill('missing-class');
  await expect(page.getByText('Không tìm thấy kết quả phù hợp.', { exact: true })).toBeVisible();
  await expect(page.locator('dl dd')).toHaveText(['0', '0', '0']);
});

test('live search, status, class and sort use the existing server filters', async ({ page }) => {
  const state = await classPagesSession(page);
  await page.goto('/dashboard/live-classes');
  await expect(page.locator('[data-live-session]')).toHaveCount(4);
  await page.getByRole('searchbox', { name: 'Tìm buổi học', exact: true }).fill('Web');
  await page.getByRole('combobox', { name: 'Trạng thái', exact: true }).selectOption('ongoing');
  await page.getByRole('combobox', { name: 'Lớp học', exact: true }).selectOption('class-web');
  await page.getByRole('combobox', { name: 'Sắp xếp', exact: true }).selectOption('oldest');
  await expect(page.locator('[data-live-session]')).toHaveCount(1);
  await expect(page.locator('dl dd')).toHaveText(['1', '0', '1']);
  await expect.poll(() => state.requests.some(request => { const p = new URL(request.url).searchParams; return p.get('q') === 'Web' && p.get('status') === 'ongoing' && p.get('class_id') === 'class-web' && p.get('sort') === 'oldest'; })).toBe(true);
  await page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click();
  await expect(page.locator('[data-live-session]')).toHaveCount(4);
});

test('start/end actions keep endpoint, confirmation, cancel and error handling', async ({ page }) => {
  const state = await classPagesSession(page);
  await page.goto('/dashboard/live-classes');
  const card = page.locator('[data-live-session="live-scheduled"]');
  await card.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Tham gia', exact: true })).toBeVisible();
  expect(state.requests.filter(request => request.method === 'POST' && request.url.endsWith('/live-scheduled/start'))).toHaveLength(1);
  await card.getByRole('button', { name: 'Kết thúc', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Kết thúc buổi học?', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Hủy|Huỷ/ }).click();
  expect(state.requests.filter(request => request.method === 'POST' && request.url.endsWith('/end'))).toHaveLength(0);
  await card.getByRole('button', { name: 'Kết thúc', exact: true }).click();
  state.actionStatus = 500;
  await dialog.getByRole('button', { name: 'Kết thúc buổi học', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Kết thúc buổi học', exact: true })).toBeEnabled();
  state.actionStatus = 200;
  await dialog.getByRole('button', { name: 'Kết thúc buổi học', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(card.getByRole('button', { name: 'Điểm danh / Lịch sử', exact: true })).toBeVisible();
});

test('create session keeps existing validation and API payload', async ({ page }) => {
  const state = await classPagesSession(page);
  await page.goto('/dashboard/live-classes');
  await page.getByRole('button', { name: '+ Tạo buổi học', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Tạo buổi học trực tuyến', exact: true });
  await dialog.getByRole('button', { name: 'Lưu buổi học', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Vui lòng nhập tiêu đề');
  await dialog.getByLabel('Tiêu đề *', { exact: true }).fill('  Buổi học kiểm thử  ');
  await dialog.getByLabel('Bắt đầu dự kiến *', { exact: true }).fill('2026-11-01T10:00');
  await dialog.getByLabel('Kết thúc dự kiến *', { exact: true }).fill('2026-11-01T09:00');
  await dialog.getByRole('button', { name: 'Lưu buổi học', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Thời gian kết thúc phải sau');
  expect(state.requests.filter(request => request.method === 'POST')).toHaveLength(0);
  await dialog.getByLabel('Kết thúc dự kiến *', { exact: true }).fill('2026-11-01T11:00');
  await dialog.getByRole('button', { name: 'Lưu buổi học', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('[data-live-session="live-created"]')).toContainText('Buổi học kiểm thử');
  expect(state.requests.find(request => request.method === 'POST')?.body).toEqual({ class_id: 'class-software', title: 'Buổi học kiểm thử', description: null, scheduled_start: '2026-11-01T03:00:00.000Z', scheduled_end: '2026-11-01T04:00:00.000Z' });
});

test('collection errors show retry and do not present failed data as zero', async ({ page }) => {
  const state = await classPagesSession(page);
  state.status = 500;
  for (const path of ['/dashboard/classes', '/dashboard/live-classes']) {
    state.status = 500;
    await page.goto(path);
    const listError = page.getByRole('main').getByRole('alert').filter({ hasText: 'Không tải được danh sách.' });
    await expect(listError).toBeVisible();
    await expect(page.locator('dl dd')).toHaveText(['—', '—', '—']);
    state.status = 200;
    await listError.getByRole('button', { name: 'Thử lại', exact: true }).click();
    await expect(page.locator('dl dd').first()).toHaveText('4');
  }
});
