import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';
import { monitoringPage, monitoringPhase, readAllPages, type MonitoringExam } from '../../lib/teacher-monitor';

test.setTimeout(90_000);

const now = Date.parse('2026-10-14T05:00:00Z');
function exam(id: string, status = 'published', start = '2026-10-13T00:00:00Z', end = '2026-10-15T00:00:00Z'): MonitoringExam {
  return { id, title: `Đề thi ${id}`, status, start_time: start, end_time: end,
    classes: [{ id: 'class-1', name: 'AI Proctoring · Lập trình Web · Nhóm 1' }], attempt_count: 24, completed_attempt_count: 14 };
}

test('monitoring prioritizes active exams before pagination and respects time boundaries', () => {
  const ended = Array.from({ length: 25 }, (_, index) => exam(`ended-${index}`, 'published', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'));
  const active = exam('active');
  expect(monitoringPage([...ended, active], { page: 1, limit: 20 }, now).data[0].id).toBe('active');
  expect(monitoringPhase(active, Date.parse(active.start_time))).toBe('open');
  expect(monitoringPhase(active, Date.parse(active.end_time))).toBe('ended');
  expect(monitoringPhase({ ...active, status: 'closed' }, now)).toBe('ended');
  expect(monitoringPhase({ ...active, start_time: '' }, now)).toBe('unknown');
  expect(monitoringPage([exam('draft', 'draft'), active], {}, now).meta.total).toBe(1);
});

test('monitoring reads all API pages before sorting, including active exams beyond the first page', async () => {
  const rows = [...Array.from({ length: 100 }, (_, index) => exam(`old-${index}`, 'closed')), exam('active')];
  const calls: number[] = [];
  const loaded = await readAllPages<MonitoringExam>(async params => {
    const page = Number(params.page), limit = Number(params.limit); calls.push(page);
    return { data: rows.slice((page - 1) * limit, page * limit), meta: { total: rows.length } };
  });
  expect(calls).toEqual([1, 2]);
  expect(monitoringPage(loaded, { page: 1, limit: 20 }, now).data[0].id).toBe('active');
});

async function monitoringAPI(page: Page, many = false, missing = false) {
  await uiSession(page, 'teacher');
  const runtimeNow = Date.now();
  const date = (offset: number) => new Date(runtimeNow + offset).toISOString();
  const rows = [exam('upcoming', 'published', date(86_400_000), date(172_800_000)),
    exam('ended', 'closed', date(-172_800_000), date(-86_400_000)),
    ...Array.from({ length: many ? 22 : 3 }, (_, index) => exam(`active-${index}`, 'published', date(-86_400_000), date(3_600_000 + index * 1000)))];
  const headers = { 'access-control-allow-origin': process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true' };
  await page.route('**/api/v1/exams?**', route => {
    const params = new URL(route.request().url()).searchParams;
    const filtered = rows.filter(row => row.status === params.get('status')
      && (!params.get('q') || row.title.includes(params.get('q')!))
      && (!params.get('class_id') || row.classes.some(cls => cls.id === params.get('class_id'))));
    const number = Number(params.get('page')), limit = Number(params.get('limit'));
    return route.fulfill({ headers, json: { data: filtered.slice((number - 1) * limit, number * limit), meta: { total: filtered.length, page: number, limit } } });
  });
  await page.route('**/api/v1/attempts?**', route => route.fulfill({ headers, json: { data: [], meta: { total: 24, page: 1, limit: 1,
    ...(missing ? {} : { summary: { working: 6, submitted: 14, not_started: 4, violations: 2 } }) } } }));
}

for (const width of [375, 768, 1440]) test(`monitor collection layout, metrics and actions at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await monitoringAPI(page);
  await page.goto('/dashboard/monitor', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Hiển thị 1–5 trên 5 kết quả')).toBeVisible({ timeout: 30_000 });
  const sections = page.locator('main section[aria-labelledby^="monitor-"]');
  await expect(sections).toHaveCount(3);
  await expect(sections.first().getByRole('heading', { level: 2 })).toHaveText('Đang diễn ra');
  const active = sections.first();
  await expect(active.getByText('Lượt đang thi')).toHaveCount(3);
  await expect(active.locator('dd').first()).toHaveText('6');
  await expect(active.getByRole('link', { name: 'Mở giám sát: Đề thi active-0', exact: true })).toHaveAttribute('href', '/dashboard/monitor/active-0');
  await expect(page.getByRole('link', { name: 'Xem báo cáo: Đề thi ended', exact: true })).toHaveAttribute('href', '/dashboard/monitor/ended');
  await expect(page.getByRole('navigation', { name: 'Phân trang', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Số kết quả mỗi trang' })).toHaveCount(0);
  await expect(page.getByText('Đã xuất bản', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const cards = active.locator('.ui-card');
  const boxes = await cards.evaluateAll(nodes => nodes.map(node => ({ x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })));
  if (width === 1440) expect(new Set(boxes.map(box => box.y)).size).toBe(1);
  if (width === 375) expect(new Set(boxes.map(box => box.x)).size).toBe(1);
  if (width === 1440) {
    const toolbar = page.getByRole('search', { name: 'Tìm kiếm và lọc đề thi giám sát' });
    expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(56);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    expect(await page.getByRole('link', { name: 'Xem báo cáo: Đề thi ended', exact: true }).evaluate(node => {
      const box = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(box.right - 8, box.top + box.height / 2));
    })).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page.screenshot({ path: info.outputPath(`monitor-collection-${width}.png`), fullPage: true });
  await page.getByRole('combobox', { name: 'Trạng thái', exact: true }).selectOption('upcoming');
  await expect(sections).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Xem chi tiết: Đề thi upcoming', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/period=upcoming/);
});

test('monitor pagination retains filters and missing summary never creates zero metrics', async ({ page }) => {
  await monitoringAPI(page, true, true);
  await page.goto('/dashboard/monitor', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Hiển thị 1–20 trên 24 kết quả')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Lượt đang thi', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Lượt có cảnh báo', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Lượt đã nộp', { exact: true })).toHaveCount(20);
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
  await expect(page.getByText('Hiển thị 21–24 trên 24 kết quả')).toBeVisible();
  await page.getByRole('combobox', { name: 'Trạng thái', exact: true }).selectOption('ended');
  await expect(page.getByText('Hiển thị 1–1 trên 1 kết quả')).toBeVisible();
  await expect(page).not.toHaveURL(/page=2/);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Trạng thái', exact: true })).toHaveValue('ended');
  await expect(page.getByRole('link', { name: 'Xem báo cáo: Đề thi ended', exact: true })).toBeVisible();
});
