import { expect, test, type Page } from '@playwright/test';
import { uiSession, fixtureUser } from './ui-fixtures';

const session = {
  id: 'shell-session', class_id: 'class-1', teacher_id: fixtureUser.id,
  class_name: 'AI Proctoring Demo Class', teacher_name: 'Teacher 1',
  title: 'Ôn tập Web API trước kỳ thi', description: 'Cùng ôn tập nội dung Web API.',
  status: 'ended', scheduled_start: '2026-09-25T03:40:00Z', scheduled_end: '2026-09-25T05:40:00Z',
  actual_start: '2026-10-21T05:00:00Z', actual_end: '2026-10-21T06:37:00Z',
  policy: { chat: true, screen_share: false, unmute: true, waiting_room: false, locked: false }, waiting: [],
};

async function fixture(page: Page, { role = 'student', status = 'ended', waiting = false } = {}) {
  await uiSession(page, role);
  const calls: string[] = [], providers: string[] = [];
  let media = 0;
  await page.exposeFunction('recordClassroomMedia', () => { media++; });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      await (window as unknown as { recordClassroomMedia: () => Promise<void> }).recordClassroomMedia();
      throw new DOMException('Test device denied', 'NotAllowedError');
    };
  });
  page.on('websocket', socket => { if (socket.url().includes(':7880') || socket.url().includes('/rtc')) providers.push(socket.url()); });
  await page.route('**/api/v1/live-classes**', async route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { 'access-control-allow-origin': route.request().headers().origin || 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    calls.push(`${route.request().method()} ${path}`);
    const data = { ...session, status, actual_end: status === 'ended' ? session.actual_end : null, admission: waiting ? 'waiting' : undefined, policy: { ...session.policy, waiting_room: waiting } };
    return route.fulfill({ headers, json: path.endsWith('/recordings') ? { data: { recordings: [], recorded: false, processing: false, available: false } }
      : path.endsWith('/live-classes') ? { data: [data], total: 1 }
      : path.endsWith('/attendance') ? { data: [] }
      : path.endsWith('/admission') ? { data: { status: 'waiting' } } : { data } });
  });
  return { calls, providers, media: () => media };
}

async function studentShell(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-role', 'student');
  await expect(page.locator('.app-shell')).toHaveCount(1);
  await expect(page.locator('.student-topbar')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Lớp học trực tuyến' })).toBeVisible();
  const online = page.locator('.student-sidebar a[href="/student/live-classes"]');
  await expect(online).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('a[href="/student"][aria-current="page"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Tài khoản của ${fixtureUser.full_name}` })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}

for (const width of [1440, 1024, 390]) for (const theme of ['light', 'dark'] as const) {
  test(`Student ended class belongs to the portal at ${width}px ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ colorScheme: theme });
    const audit = await fixture(page);
    await page.goto('/live-class/shell-session');
    await studentShell(page);
    const summary = page.locator('.classroom-session-summary');
    await expect(summary.getByRole('heading', { name: 'Buổi học đã kết thúc' })).toBeVisible();
    await expect(summary).toContainText('10:40 25/09/2026');
    await expect(summary).toContainText('12:40 25/09/2026');
    await expect(summary).toContainText('13:37 21/10/2026');
    await expect(summary.locator('dt')).toHaveText(['Lớp', 'Giảng viên', 'Thời gian dự kiến', 'Kết thúc thực tế']);
    await expect(summary.getByRole('link', { name: 'Quay lại lớp học', exact: true })).toHaveAttribute('href', '/student/classes/class-1');
    await expect(page.getByRole('navigation', { name: 'Đường dẫn lớp học' })).toContainText(session.class_name);
    await expect(page.locator('.classroom-device-card, .classroom-meeting-page')).toHaveCount(0);
    expect(audit.media()).toBe(0);
    expect(audit.providers).toEqual([]);
    expect(audit.calls.some(call => /^POST .*\/(token|join|admission)$/.test(call))).toBe(false);
    await page.getByRole('button', { name: 'Thông báo', exact: true }).click();
    await page.keyboard.press('Escape');
    if (width === 390) {
      await page.getByRole('button', { name: 'Mở menu', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Menu điều hướng' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Lớp học trực tuyến', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Mở menu', exact: true })).toBeFocused();
    }
    await page.screenshot({ path: info.outputPath('ended.png'), fullPage: true });
    await summary.getByRole('button', { name: 'Quay lại lớp học trực tuyến', exact: true }).click();
    await expect(page).toHaveURL(/\/student\/live-classes$/);
    await studentShell(page);
  });
}

test('Student list opens an upcoming detail in the same shell without acquiring devices', async ({ page }) => {
  const audit = await fixture(page, { status: 'scheduled' });
  await page.goto('/student/live-classes');
  await page.getByRole('link', { name: 'Xem chi tiết', exact: true }).click();
  await expect(page).toHaveURL(/\/live-class\/shell-session$/);
  await studentShell(page);
  await expect(page.getByRole('heading', { name: 'Buổi học sắp diễn ra', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vào phòng', exact: true })).toHaveCount(0);
  expect(audit.media()).toBe(0);
  expect(audit.calls.some(call => /^POST .*\/(token|join|admission)$/.test(call))).toBe(false);
});

test('Student admission waiting stays in the shell and never requests a room token', async ({ page }, info) => {
  const audit = await fixture(page, { status: 'ongoing', waiting: true });
  await page.goto('/live-class/shell-session');
  await studentShell(page);
  await page.getByRole('button', { name: 'Vào phòng', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Đang chờ giảng viên cho vào lớp', exact: true })).toBeVisible();
  await studentShell(page);
  await expect(page.getByRole('status').filter({ hasText: 'Camera và microphone được tắt' })).toBeVisible();
  expect(audit.calls.some(call => call.endsWith('/token'))).toBe(false);
  expect(audit.providers).toEqual([]);
  await page.screenshot({ path: info.outputPath('waiting.png'), fullPage: true });
  await page.getByRole('button', { name: 'Quay lại lớp học trực tuyến', exact: true }).click();
  await expect(page).toHaveURL(/\/student\/live-classes$/);
  expect(audit.calls).toContain('DELETE /api/v1/live-classes/shell-session/admission');
});

for (const role of ['teacher', 'admin']) test(`${role} detail keeps its authenticated role shell`, async ({ page }) => {
  const audit = await fixture(page, { role });
  await page.goto('/live-class/shell-session');
  await expect(page.getByRole('heading', { name: 'Buổi học đã kết thúc', exact: true })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-role', role);
  await expect(page.locator('.student-sidebar, .student-topbar')).toHaveCount(0);
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Điểm danh buổi học' })).toBeVisible();
  if (role === 'teacher') await expect(page.locator('.sidebar a[href="/dashboard/live-classes"]')).toHaveAttribute('aria-current', 'page');
  expect(audit.media()).toBe(0);
});
