import { expect, test, type Page } from '@playwright/test';
import { uiSession, fixtureUser } from './ui-fixtures';
import type { AttemptLike } from '@/lib/studentExamStatus';

test.use({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
async function setup(page: Page) {
  const session = await uiSession(page, 'student');
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role: 'student' })).toString('base64url')}.fixture`, url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' }]);
  await page.routeWebSocket('**/api/v1/**', () => {});
  const now = Date.now();
  const common = { status: 'published', start_time: new Date(now - 3600000).toISOString(), end_time: new Date(now + 86400000).toISOString(),
    duration_minutes: 60, questions_count: 10, require_camera: true, require_mic: true, max_attempts: 1, attempt: null as AttemptLike | null,
    classes: [{ id: 'class-1', name: 'Lớp kiểm chứng giao diện' }] };
  const rows = [
    { ...common, id: 'working', title: 'Bài kiểm tra đang làm', attempt: { id: 'attempt-working', status: 'in_progress', exam_id: 'working', student_id: fixtureUser.id, server_deadline_at: common.end_time } },
    { ...common, id: 'open', title: 'Quá trình quản trị mạng' },
    { ...common, id: 'future-1', title: 'Đánh giá cuối chương Lập trình Web — tiêu đề dài để kiểm tra hiển thị', start_time: new Date(now + 3600000).toISOString() },
    { ...common, id: 'future-2', title: 'Đánh giá cuối chương Cơ sở dữ liệu', start_time: new Date(now + 7200000).toISOString(), require_camera: false, require_mic: false },
    { ...common, id: 'done', title: 'Bài đã nộp không thuộc danh sách cần làm', attempt: { id: 'done-attempt', status: 'submitted', exam_id: 'done', student_id: fixtureUser.id } },
  ];
  session.exams = rows;
  return { session, rows };
}
const paint = (el: Element) => {
  const s = getComputedStyle(el);
  return { color: s.backgroundColor, image: s.backgroundImage, size: s.backgroundSize, repeat: s.backgroundRepeat, position: s.backgroundPosition };
};
const card = (page: Page, title: string) => page.locator('.student-exam-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

for (const theme of ['light', 'dark'] as const) for (const width of [1440, 1024, 768, 390]) {
  test(`exam cards and exact Login canvas fit ${width}px ${theme}`, async ({ page }, info) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1100 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const { rows } = await setup(page);
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const loginCanvas = await page.locator('main').evaluate(paint);
    expect(loginCanvas.image).toContain('radial-gradient');
    expect(loginCanvas.size).toBe('26px 26px');
    if (width === 1440) await page.screenshot({ path: info.outputPath(`login-${theme}.png`) });
    await page.goto('/student/exams', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Làm kiểm tra', level: 1, exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.student-exam-card')).toHaveCount(4);
    expect(await page.locator('.app-shell').evaluate(paint)).toEqual(loginCanvas);
    await expect(page.locator('.workspace')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.locator('.workspace')).toHaveCSS('background-image', 'none');
    await expect(page.locator('.student-exams-page')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.locator('.sidebar')).toHaveCSS('background-image', 'none');
    await expect(page.locator('.student-exam-section h2')).toHaveText(['Đang làm', 'Đang diễn ra', 'Sắp diễn ra']);
    await expect(card(page, rows[4].title)).toHaveCount(0);
    for (const row of rows.slice(0, 4)) {
      const item = card(page, row.title);
      const shadow = await item.evaluate(el => getComputedStyle(el).boxShadow);
      if (row.id === 'working') {
        await expect(item).toHaveCSS('border-top-width', '3px');
        await expect(item).toHaveCSS('border-left-width', '3px');
        expect(shadow).toContain('5px 5px 0px');
      } else {
        await expect(item).toHaveCSS('border-top-width', '1px');
        await expect(item).toHaveCSS('border-left-width', '4px');
        expect(shadow).not.toContain('5px 5px 0px');
      }
      await expect(item.locator('time').first()).toHaveAttribute('datetime', row.start_time);
      await expect(item.locator('time').last()).toHaveAttribute('datetime', row.end_time);
      await expect(item).toContainText('60 phút');
      await expect(item).toContainText('10 câu');
      expect((await item.getByRole('button').boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await item.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await expect(item.getByText('Camera', { exact: true })).toHaveCount(row.require_camera ? 1 : 0);
      await expect(item.getByText('Microphone', { exact: true })).toHaveCount(row.require_mic ? 1 : 0);
      if (theme === 'light') await expect(item).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    }
    await expect(card(page, rows[0].title).getByRole('button', { name: 'Tiếp tục làm bài' })).toBeEnabled();
    await expect(card(page, rows[1].title).getByRole('button', { name: 'Bắt đầu làm bài' })).toBeEnabled();
    await expect(card(page, rows[2].title).getByRole('button', { name: 'Chưa đến giờ bắt đầu' })).toBeDisabled();
    expect(await page.locator('[data-exam-group="upcoming"] .student-exam-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(width >= 768 ? 2 : 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const action = card(page, rows[1].title).getByRole('button');
    await action.focus(); await expect(action).toHaveCSS('outline-style', 'solid'); await action.evaluate(el => (el as HTMLElement).blur());
    await page.evaluate(() => { window.scrollTo(0, 0); return document.fonts.ready; });
    await page.screenshot({ path: info.outputPath(`student-exams-${width}-${theme}.png`), animations: 'disabled' });
    if (width === 1440 || width === 390) {
      await page.locator('[data-exam-group="upcoming"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`upcoming-${width}-${theme}.png`), animations: 'disabled' });
    }
  });
}

test('filter, completion refresh and empty state retain exam behavior', async ({ page }) => {
  const { session, rows } = await setup(page);
  await page.goto('/student/exams?period=upcoming');
  await expect(page.locator('.student-exam-card')).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Trạng thái', exact: true }).selectOption('open');
  await expect(page.locator('.student-exam-card')).toHaveCount(1);
  await expect(card(page, rows[1].title)).toBeVisible();
  await page.goto('/student/exams');
  await expect(page.locator('.student-exam-card')).toHaveCount(4);
  rows[0].attempt!.status = 'submitted';
  await page.evaluate(studentId => window.dispatchEvent(new CustomEvent('student-exam-updated', { detail: { studentId, examId: 'working' } })), fixtureUser.id);
  await expect(card(page, rows[0].title)).toHaveCount(0);
  await expect(card(page, rows[1].title)).toBeVisible();
  session.exams = [];
  await page.reload();
  await expect(page.getByText('Hiện không có bài kiểm tra cần làm.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Xem điểm số / kết quả', exact: true })).toHaveAttribute('href', '/student/grades');
});
