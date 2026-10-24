import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';

test.use({ timezoneId: 'Asia/Ho_Chi_Minh' });

async function setup(page: Page, empty = false) {
  await page.clock.setFixedTime(new Date('2026-10-13T08:00:00+07:00'));
  const state = await uiSession(page);
  state.attempts = empty ? [] : Array.from({ length: 5 }, (_, index) => ({
    id: `attempt-${index}`, exam_id: `old-exam-${index}`, exam_title: `Bài thi đã nộp ${index + 1}`,
    status: 'submitted', started_at: '2026-10-10T01:00:00Z', submitted_at: '2026-10-10T02:00:00Z',
    score: index === 0 ? 0 : null, max_score: 10,
  }));
  const exams = empty ? [] : Array.from({ length: 5 }, (_, index) => ({
    id: `exam-${index}`, title: `Kiểm tra kiến thức nền tảng ${index + 1} — tên bài thi dài để kiểm tra màn hình nhỏ`,
    start_time: `2026-10-${12 + index}T09:00:00+07:00`, end_time: `2026-10-${12 + index}T10:00:00+07:00`,
  }));
  let fail = false;
  const windows: string[] = [];
  for (const endpoint of ['exams', 'live-classes']) await page.route(`**/api/v1/${endpoint}?**`, async route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const query = new URL(route.request().url()).searchParams;
    const from = query.get('from_time')!, to = query.get('to_time')!;
    windows.push(from);
    const data = endpoint === 'exams' ? exams.filter(item => new Date(item.end_time) >= new Date(from) && new Date(item.start_time) < new Date(to))
      : empty ? [] : [{ id: 'session-1', title: 'Buổi học trực tuyến từ lịch lớp', scheduled_start: '2026-10-13T11:00:00+07:00', scheduled_end: '2026-10-13T12:00:00+07:00' }];
    return route.fulfill({ status: fail ? 503 : 200, headers, json: fail ? { error: { message: 'Unavailable' } } : { data } });
  });
  return { windows, setFailure(value: boolean) { fail = value; } };
}

for (const width of [375, 768, 1440]) test(`student dashboard prioritizes the schedule and stays compact at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const state = await setup(page);
  await page.goto('/student');
  const calendar = page.getByRole('region', { name: 'Lịch học và lịch thi', exact: true });
  await expect(calendar.getByRole('combobox', { name: 'Chế độ xem lịch' })).toHaveValue('month');
  await expect(page.locator('main h2')).toHaveText(['Kiểm tra kiến thức nền tảng 2 — tên bài thi dài để kiểm tra màn hình nhỏ', 'Lịch học và lịch thi', 'Sắp diễn ra', 'Hoạt động gần đây']);
  const featured=page.getByRole('region',{name:'Kỳ thi ưu tiên'});
  await expect(featured.getByRole('link',{name:'Chuẩn bị',exact:true})).toHaveAttribute('href','/student/exams/exam-1/verify');
  await expect(calendar.locator('.loading-skeleton')).toHaveCount(0);
  const welcome = page.getByRole('heading', { level:1, name:'Hôm nay bạn có gì?' });
  await expect(welcome).toBeVisible();
  const learning = page.getByRole('navigation', { name:'Không gian học tập' });
  expect((await learning.boundingBox())!.y).toBeGreaterThan((await welcome.boundingBox())!.y);
  expect((await learning.boundingBox())!.y).toBeGreaterThan((await featured.boundingBox())!.y);
  expect((await calendar.boundingBox())!.y).toBeGreaterThan((await learning.boundingBox())!.y);
  await expect(page.getByText('Bài thi còn trong lịch', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Buổi học trong lịch', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Lịch hôm nay', { exact: true })).toHaveCount(0);
  await expect(calendar.getByRole('button', { name: /Buổi học trực tuyến từ lịch lớp/ })).toBeVisible();
  if (width < 768 || (await calendar.locator('.calendar-card').boundingBox())!.width < 482) {
    await expect(calendar.locator('.calendar-grid')).toBeHidden();
    await expect(calendar.getByRole('heading', { name: /Hôm nay/ })).toBeVisible();
  } else {
    await expect(calendar.locator('.calendar-grid.month')).toBeVisible();
    await expect(calendar.locator('.calendar-day')).toHaveCount(35);
    const calendarHeight = (await calendar.locator('.calendar-grid.month').boundingBox())!.height;
    expect(calendarHeight).toBeGreaterThan(300);
    expect(calendarHeight).toBeLessThan(540);
  }
  const upcoming = page.getByRole('region', { name: 'Sắp diễn ra', exact: true });
  await expect(upcoming.getByRole('link', { name: /^Xem (Thi|Lớp):/ })).toHaveCount(3);
  await expect(upcoming.getByRole('link', { name: /^Xem (Thi|Lớp):/ }).first()).toHaveAttribute('href', '/student/exams/exam-1/verify');
  await expect(upcoming.getByRole('link', { name: 'Xem toàn bộ lịch' })).toHaveAttribute('href', '#student-calendar');
  const activity = page.getByRole('region', { name: 'Hoạt động gần đây' });
  await expect(activity.locator('.activity-row')).toHaveCount(3);
  await expect(activity.getByText('Bài thi đã nộp 1', { exact: true })).toBeVisible();
  await expect(activity.getByText('0 / 10', { exact: true })).toBeVisible();
  await expect(activity.getByRole('link', { name: 'Xem lịch sử' })).toHaveAttribute('href', '/student/history');
  const quickLinks = page.getByRole('navigation', { name: 'Liên kết nhanh' });
  await expect(quickLinks.getByRole('link')).toHaveText(['Bài kiểm tra', 'Lớp học phần', 'Kết quả']);
  expect((await quickLinks.boundingBox())!.y).toBeGreaterThan((await activity.boundingBox())!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: test.info().outputPath(`student-dashboard-${width}.png`), fullPage: true });
  await calendar.getByRole('button', { name: 'Lịch tiếp theo' }).click();
  await expect.poll(() => state.windows.some(value => value.startsWith('2026-10-25T17:00'))).toBe(true);
  await calendar.getByRole('button', { name: 'Hôm nay', exact: true }).click();
  await calendar.getByRole('combobox').selectOption('day');
  await expect(calendar.getByRole('button', { name: /Buổi học trực tuyến từ lịch lớp/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test('empty schedule and activity use empty states without invented events or scores', async ({ page }) => {
  await setup(page, true); await page.goto('/student');
  await page.getByRole('combobox', { name: 'Chế độ xem lịch' }).selectOption('agenda');
  await expect(page.getByText('Chưa có lịch học hoặc lịch thi', { exact: true })).toBeVisible();
  await expect(page.getByText('Không có sự kiện sắp tới trong khoảng lịch đang xem.', { exact: true })).toBeVisible();
  await expect(page.getByText('Chưa có hoạt động làm bài', { exact: true })).toBeVisible();
  await expect(page.locator('.activity-row, .calendar-event')).toHaveCount(0);
});

test('calendar failure can be retried while recent activity stays available', async ({ page }) => {
  const state = await setup(page); state.setFailure(true); await page.goto('/student');
  const calendar = page.getByRole('region', { name: 'Lịch học và lịch thi', exact: true });
  await expect(calendar.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Hoạt động gần đây' }).locator('.activity-row')).toHaveCount(3);
  state.setFailure(false); await calendar.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(calendar.getByRole('alert')).toHaveCount(0);
  await expect(calendar.getByRole('button', { name: /Buổi học trực tuyến từ lịch lớp/ })).toBeVisible();
});

test('month navigation handles the 31st and renders only the weeks needed by each month', async ({ page }) => {
  await setup(page, true);
  await page.clock.setFixedTime(new Date('2026-08-31T08:00:00+07:00'));
  await page.goto('/student');
  const calendar = page.getByRole('region', { name: 'Lịch học và lịch thi', exact: true });
  await expect(calendar.locator('.calendar-day')).toHaveCount(42);
  await calendar.getByRole('button', { name: 'Lịch tiếp theo' }).click();
  await expect(calendar.locator('.calendar-toolbar strong')).toHaveText(/tháng 9.*2026/);
  await expect(calendar.locator('.calendar-day')).toHaveCount(35);
  await calendar.getByRole('button', { name: 'Lịch trước' }).click();
  await expect(calendar.locator('.calendar-toolbar strong')).toHaveText(/tháng 8.*2026/);
  await expect(calendar.locator('.calendar-day')).toHaveCount(42);
  await page.clock.setFixedTime(new Date('2027-02-15T08:00:00+07:00'));
  await calendar.getByRole('button', { name: 'Hôm nay', exact: true }).click();
  await expect(calendar.locator('.calendar-day')).toHaveCount(28);
  await expect(calendar.locator('.calendar-day.outside')).toHaveCount(0);
});
