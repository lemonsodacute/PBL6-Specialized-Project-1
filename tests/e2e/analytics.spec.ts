import { expect, test, type Page } from '@playwright/test';
import { activitySession } from './ai-activity-fixture';
import { submissionTrend, attemptDistribution } from '../../lib/analytics';
import type { ReportsOverview } from '../../lib/teacher-reports';
import { adminDashboardAPI } from './admin-analytics-fixture';

function reportSample(): ReportsOverview {
  return {
    meta: { total: 120, page: 1, limit: 20 }, exam_id: null, exams: [], completed_statuses: ['submitted', 'auto_submitted', 'terminated'],
    summary: { completed_attempts: 110, scored_attempts: 100, percentage_attempts: 100, average_percentage: '74.5', average_score: null,
      max_score: null, total_violations: 30, browser_violation_count: 18, detection_count: 12, average_risk_score: '24', risk_scored_attempts: 80, attempt_count: 120 },
    results: Array.from({ length: 8 }, (_, index) => ({ attempt_id: `analytics-${index}`, exam_id: 'exam-1', exam_title: 'Bài thi phân tích dữ liệu', student_id: `student-${index}`,
      student_code: `AN-${index}`, full_name: `Sinh viên ${index}`, attempt_number: 1, status: 'submitted', score: '7', max_score: '10', percentage: '70',
      started_at: '2026-10-16T02:00:00Z', submitted_at: `2026-10-${16 + index % 4}T03:00:00Z`, violation_count: 1, browser_violation_count: 1, detection_count: 0, risk_score: '24' })),
  };
}

async function reportsAPI(page: Page, data = reportSample()) {
  const state = { data, status: 200 };
  await page.route('**/api/v1/teacher/reports**', route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return route.fulfill({ status: state.status, headers, json: state.status === 200 ? { data: state.data } : { error: { message: 'PRIVATE_DATABASE_ERROR' } } });
  });
  return state;
}

test('analytics groups only observed submissions in Vietnam time and never expands a page into totals', () => {
  const data = reportSample();
  data.results[0].submitted_at = '2026-10-15T18:00:00Z';
  data.results[1].submitted_at = null;
  data.results[2].submitted_at = 'not-a-date';
  data.results[3].status = 'in_progress';
  const points = submissionTrend(data);
  expect(points[0]).toEqual({ date: '2026-10-16', label: '16/10', value: 2 });
  expect(points.reduce((sum, point) => sum + point.value, 0)).toBe(5);
  expect(attemptDistribution(data).reduce((sum, item) => sum + item.value, 0)).toBe(8);
  expect(data.summary.completed_attempts).toBe(110);
});

for (const width of [390, 768, 1440]) for (const theme of ['light', 'dark'] as const) {
  test(`analytics uses API data with readable charts at ${width}px ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await activitySession(page);
    await adminDashboardAPI(page);
    await reportsAPI(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/same key|unique.*key/i.test(message.text())) errors.push(message.text()); });
    for (const path of ['/admin', '/dashboard/reports', '/admin/ai-support/activity']) {
      await page.goto(path);
      if (path === '/admin/ai-support/activity') {
        const question = page.getByRole('region', { name: 'Kết quả tạo câu hỏi', exact: true });
        await expect(question.getByRole('img', { name: /Thành công: 5/ })).toBeVisible();
        await expect(question).toContainText('83,3%');
        await expect(page.getByRole('region', { name: 'Xu hướng hoạt động AI' })).toContainText('Chưa có đủ dữ liệu');
        await expect(page.getByRole('list', { name: 'Kết quả hỗ trợ trong kỳ' })).toContainText('Chuyển quản trị viên');
      } else {
        const trend = page.getByRole('region', { name: 'Nhịp độ nộp bài', exact: true });
        await expect(trend.getByRole('group', { name: 'Bài đã nộp', exact: true })).toBeVisible();
        await expect(trend).toContainText('8 bài làm trên trang 1 / 120 kết quả phù hợp');
        const point = trend.getByRole('img', { name: '16/10: 2 Bài đã nộp', exact: true });
        await point.focus();
        await expect(trend.getByRole('status')).toContainText('Bài đã nộp: 2');
        await page.keyboard.press('Tab');
        await expect(trend.getByRole('status')).toContainText('2026-10-17');
        if (path === '/admin') {
          await expect(page.getByRole('region', { name: 'Phân bố người dùng', exact: true })).toContainText('26');
          await expect(page.getByLabel('Chỉ số tổng quan')).toContainText('Tổng người dùng');
        } else {
          await expect(page.getByRole('region', { name: 'Phân bố điểm', exact: true })).toContainText('8 bài có điểm phần trăm hợp lệ');
          await expect(page.getByRole('img', { name: '60–<80%: 8 bài', exact: true })).toBeVisible();
        }
      }
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim().toLowerCase())).toBe('#006d77');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
      await page.screenshot({ path: `artifacts/analytics/${path.replaceAll('/', '_')}-${width}-${theme}.png`, fullPage: true, animations: 'disabled', style: 'nextjs-portal{display:none!important}' });
    }
    expect(errors).toEqual([]);
  });
}

test('missing history and zero observations render honest empty states; report failure stays isolated', async ({ page }) => {
  await activitySession(page);
  await adminDashboardAPI(page);
  const data = reportSample();
  data.results = [];
  Object.assign(data.summary, { completed_attempts: 0, total_violations: 0, browser_violation_count: 0, detection_count: 0 });
  const state = await reportsAPI(page, data);
  await page.goto('/dashboard/reports');
  await expect(page.getByRole('region', { name: 'Nhịp độ nộp bài' })).toContainText('Chưa có đủ dữ liệu');
  await expect(page.getByRole('region', { name: 'Phân bố điểm' })).toContainText('Chưa có đủ dữ liệu');
  await expect(page.getByRole('group', { name: 'Bài đã nộp', exact: true })).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(/NaN|Infinity/);
  state.status = 500;
  await page.goto('/admin');
  const analysis = page.getByRole('region', { name: 'Hoạt động hệ thống' });
  await expect(analysis.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Chỉ số tổng quan')).toContainText('Lớp học');
  await expect(analysis).not.toContainText('PRIVATE_DATABASE_ERROR');
  state.status = 200;
  await analysis.getByRole('button', { name: 'Tải lại phân tích' }).click();
  await expect(analysis.getByRole('alert')).toHaveCount(0);
  await expect(analysis).toContainText('Chưa có đủ dữ liệu theo ngày');
});
