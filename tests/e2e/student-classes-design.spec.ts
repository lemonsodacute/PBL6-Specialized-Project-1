import { expect, test } from '@playwright/test';
import { classDesignRows, classPagesSession } from './class-pages-design-fixture';

test.use({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
for (const [width, theme] of [[320, 'light'], [390, 'light'], [768, 'light'], [1024, 'light'], [1440, 'light'], [390, 'dark'], [1440, 'dark']] as const) {
  test(`student class collection shares teacher presentation at ${width}px ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const state = await classPagesSession(page, 'student');
    await page.goto('/student/classes');
    await expect(page.getByRole('heading', { level: 2, name: 'Danh sách học phần', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Lớp học phần', exact: true })).toHaveCount(0);
    await expect(page.locator('main dl')).toHaveCount(0);
    const cards = page.locator('[data-student-class]');
    await expect(cards).toHaveCount(4);
    await expect(page.locator('.student-course-card')).toHaveCount(4);
    for (const row of classDesignRows) {
      const card = cards.filter({ has: page.getByRole('heading', { name: row.name, exact: true }) });
      await expect(card).toContainText(`${row.students_count} sinh viên`);
      await expect(card).toContainText(row.teacher.full_name);
      const open = card.getByRole('link', { name: `Mở lớp ${row.name}`, exact: true });
      await expect(open).toHaveAttribute('href', `/student/classes/${row.id}`);
      expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const image = card.locator('img');
      await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
    }
    expect(new Set(await cards.locator('img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src))).size).toBe(4);
    await expect(page.locator('main a[href^="/dashboard/"], main a[href^="/admin/"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Tạo lớp|Xóa lớp|Sửa lớp/ })).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (theme === 'light') await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(0, 109, 119)');
    const search = page.getByRole('searchbox', { name: 'Tìm học phần', exact: true });
    expect((await search.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(state.requests.filter(request => request.method !== 'GET')).toHaveLength(0);
  });
}

test('student search, sorting, empty state and course links keep their existing API and routes', async ({ page }) => {
  test.setTimeout(120_000);
  const state = await classPagesSession(page, 'student');
  await page.goto('/student/classes');
  await page.getByRole('searchbox', { name: 'Tìm học phần', exact: true }).fill('JavaScript');
  await expect(page.locator('[data-student-class]')).toHaveCount(1);
  await expect(page.getByText('1 / 1 học phần · 7 lượt sinh viên', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Sắp xếp', exact: true }).selectOption('name');
  await expect.poll(() => state.requests.some(request => { const q = new URL(request.url).searchParams; return q.get('q') === 'JavaScript' && q.get('sort') === 'name'; })).toBe(true);
  await expect(page).toHaveURL(/q=JavaScript.*sort=name/);
  await page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click();
  await expect(page.locator('[data-student-class]')).toHaveCount(4);
  await page.getByRole('searchbox', { name: 'Tìm học phần', exact: true }).fill('missing-course');
  await expect(page.getByText('Không tìm thấy kết quả phù hợp.', { exact: true })).toBeVisible();
  await expect(page.locator('[data-student-class]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).first().click();
  await page.getByRole('link', { name: `Mở lớp ${classDesignRows[0].name}`, exact: true }).click();
  await expect(page).toHaveURL(`/student/classes/${classDesignRows[0].id}`, { timeout: 45_000 });
});

test('student access notice, server error and retry retain student-only behavior', async ({ page }) => {
  test.setTimeout(120_000);
  const state = await classPagesSession(page, 'student');
  await page.goto('/student/classes?error=class_access');
  await expect(page.getByRole('heading', { name: 'Danh sách học phần', level: 2, exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Bạn không có quyền xem lớp học này.');
  state.status = 503;
  await page.goto('/student/classes');
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
  await expect(page.locator('[data-student-class]')).toHaveCount(0);
  state.status = 200;
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page.locator('[data-student-class]')).toHaveCount(4);
  expect(state.requests.filter(request => request.method !== 'GET')).toHaveLength(0);
});

test('student pagination uses server totals and labels partial statistics accurately', async ({ page }) => {
  await classPagesSession(page, 'student');
  const rows = Array.from({ length: 25 }, (_, index) => ({ ...classDesignRows[0], id: `course-${index + 1}`, name: `Học phần ${index + 1}`, students_count: 5 }));
  const requests: URLSearchParams[] = [];
  await page.route('**/api/v1/classes?**', route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const params = new URL(route.request().url()).searchParams; requests.push(params);
    const current = Number(params.get('page') || 1), limit = Number(params.get('limit') || 20);
    return route.fulfill({ headers, json: { data: rows.slice((current - 1) * limit, current * limit), meta: { total: rows.length, page: current, limit } } });
  });
  await page.goto('/student/classes');
  await expect(page.locator('[data-student-class]')).toHaveCount(20);
  await expect(page.getByText('20 / 25 học phần · 100 lượt sinh viên trên trang', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
  await expect(page.locator('[data-student-class]')).toHaveCount(5);
  await expect(page.getByText('5 / 25 học phần · 25 lượt sinh viên trên trang', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/page=2/);
  expect(requests.some(params => params.get('page') === '2')).toBe(true);
});

test('admin retains the existing management table and admin routes', async ({ page }) => {
  test.setTimeout(90_000);
  await classPagesSession(page, 'admin');
  await page.goto('/admin/classes');
  await expect(page.getByRole('region', { name: 'Danh sách lớp học', exact: true }).getByRole('table')).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(4);
  await expect(page.getByRole('link', { name: '+ Tạo lớp học', exact: true })).toHaveAttribute('href', '/admin/classes/new');
  await expect(page.getByRole('link', { name: 'Xem / Sửa', exact: true }).first()).toHaveAttribute('href', `/admin/classes/${classDesignRows[0].id}`);
  await expect(page.locator('[data-student-class], [data-teaching-class]')).toHaveCount(0);
});
