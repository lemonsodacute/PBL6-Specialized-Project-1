import { expect, test, type Page, type Route } from '@playwright/test';
import { uiSession } from './ui-fixtures';

async function respond(route: Route, json: unknown, status = 200) {
  const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3100', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  return route.fulfill({ status, headers, json });
}

async function verification(page: Page, camera = true, enrolled = true) {
  await uiSession(page);
  await page.route('**/api/v1/exams/exam-1', route => respond(route, { data: { title: 'Kiểm thử phần mềm', require_camera: camera, require_mic: false } }));
  await page.route('**/api/v1/identity/student-card/status', route => respond(route, { data: { identity_profile_status: 'VERIFIED', has_reference: enrolled, reference_version: enrolled ? 'synthetic-reference' : null, student_card_status: enrolled ? 'VERIFIED' : 'NOT_SUBMITTED', updated_at: null } }));
}

for (const width of [375, 768, 1024, 1440]) {
  test(`verification camera and instructions fit ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await verification(page);
    await page.goto('/student/exams/exam-1/verify');
    await expect(page.getByRole('heading', { name: 'Xác minh danh tính', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Bài thi yêu cầu camera. Hãy chuẩn bị nơi đủ sáng và chỉ một người trước camera.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kiểm tra thiết bị', exact: true })).toBeVisible();
    const camera = await page.locator('.identity-camera').boundingBox();
    const guide = await page.locator('.verify-guide').boundingBox();
    expect(camera!.width).toBeGreaterThan(200);
    if (width > 768) expect(guide!.x).toBeGreaterThan(camera!.x + camera!.width);
    else expect(guide!.y).toBeGreaterThan(camera!.y + camera!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`verification-${width}.png`), fullPage: true });
  });

  test(`notification panel supports keyboard and stays inside ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 }); await uiSession(page, 'teacher');
    await page.goto('/dashboard');
    const trigger = page.getByRole('button', { name: 'Thông báo', exact: true });
    await trigger.focus(); await page.keyboard.press('Enter');
    const panel = page.getByRole('region', { name: 'Thông báo', exact: true });
    await expect(panel.getByRole('heading', { name: 'Thông báo', exact: true })).toBeFocused();
    await expect(panel).toContainText('Chưa có thông báo');
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape'); await expect(trigger).toBeFocused(); await expect(panel).toHaveCount(0);
    await trigger.click(); await page.keyboard.press('Tab');
    await expect(panel.getByRole('link',{name:'Xem tất cả thông báo'})).toBeFocused();
    await page.keyboard.press('Tab');await expect(panel).toHaveCount(0);
  });
}

test('dashboard displays server metrics and retries errors without fabricated totals', async ({ page }) => {
  const state = await uiSession(page, 'teacher');
  state.exams = [{ id: 'exam-1', title: 'Đề thi từ máy chủ', duration_minutes: 45, status: 'ongoing' }];
  let fail = true;
  await page.route('**/api/v1/dashboard/stats', route => respond(route, fail ? { error: { message: 'Synthetic outage' } } : { data: { ongoing_exams: 2, active_attempts: 17, classes: 6, recent_violations: 3, recent_window_minutes: 5, as_of: '2026-10-03T01:00:00Z' } }, fail ? 503 : 200));
  await page.goto('/dashboard');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Không tải được tổng quan');
  await expect(page.locator('.overview-kpi')).toHaveCount(0);
  fail = false; await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page.locator('.overview-kpi strong')).toHaveText(['2', '17', '6', '3']);
  await expect(page.getByRole('link', { name: /Đề thi từ máy chủ/ })).toHaveCount(1);
  await expect(page.getByRole('main')).not.toContainText('Sức khoẻ hệ thống');
});

for (const role of ['teacher', 'admin']) {
  test(`${role} legacy overview uses the same real dashboard`, async ({ page, context, baseURL }) => {
    await uiSession(page, role);
    // Existing middleware uses the payload role; API requests remain isolated fixtures.
    await context.addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.fixture`, url: baseURL! }]);
    await page.goto(`/${role}`);
    await expect(page.locator('main h1')).toHaveCount(0);
    await expect(page.locator('.overview-kpi strong')).toHaveText(['0', '0', '1', '0']);
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 960 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  });
}

test('student recent activity uses actual attempts and links to resume or results', async ({ page }) => {
  const state = await uiSession(page);
  state.exams = [{ id: 'exam-1', title: 'Đề thi gần đây', start_time: '2026-09-01T00:00:00Z', end_time: '2026-09-01T01:00:00Z' }];
  state.attempts = [
    { id: 'attempt-1', exam_id: 'exam-1', started_at: '2026-09-01T00:00:00Z', status: 'in_progress', score: null },
    { id: 'attempt-2', exam_id: 'exam-1', started_at: '2026-08-01T00:00:00Z', submitted_at: '2026-08-01T01:00:00Z', status: 'submitted', score: 8, max_score: 10 },
  ];
  await page.goto('/student');
  const activity = page.locator('.recent-activity-card');
  await expect(activity.getByRole('link', { name: /Đang làm bài/ })).toHaveAttribute('href', '/student/attempts/attempt-1');
  await expect(activity.getByRole('link', { name: /Đã nộp/ })).toHaveAttribute('href', '/student/attempts/attempt-2/result');
  await expect(activity).toContainText('8 / 10');
  await expect(activity.getByText('Đề thi gần đây', { exact: true })).toHaveCount(2);
});

test('card reference prerequisite links to profile and no-camera exam can continue', async ({ page }) => {
  await verification(page, true, false); await page.goto('/student/exams/exam-1/verify');
  await expect(page.getByRole('link', { name: 'Đi đến Hồ sơ' })).toHaveAttribute('href', '/student/profile');
  await expect(page.getByRole('button', { name: 'Bắt đầu làm bài', exact: true })).toHaveCount(0);
  await page.route('**/api/v1/exams/exam-1', route => respond(route, { data: { title: 'Không cần camera', require_camera: false, require_mic: false } }));
  await page.reload(); await expect(page.locator('.identity-camera')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Bắt đầu làm bài', exact: true })).toBeEnabled();
});

test('camera capture still requires consent and successful verification before starting', async ({ page }) => {
  await verification(page);
  await page.addInitScript(() => {
    // Synthetic video source: exercises video binding/capture without using a person's camera.
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext('2d')!;
      const paint = () => { context.fillStyle = '#83c5be'; context.fillRect(0, 0, 640, 480); requestAnimationFrame(paint); }; paint();
      return canvas.captureStream(10);
    } });
  });
  let verified = false; let requests = 0;
  await page.route('**/api/v1/identity/exams/exam-1/verify', async route => {
    if (route.request().method() !== 'OPTIONS') requests++;
    await respond(route, { data: { verified, status: verified ? 'verified' : 'rejected', message: 'Ảnh chưa khớp. Vui lòng thử lại.' } });
  });
  await page.goto('/student/exams/exam-1/verify');
  await page.getByRole('button', { name: 'Kiểm tra thiết bị', exact: true }).click();
  const capture = page.getByRole('button', { name: 'Chụp ảnh', exact: true });
  await expect(capture).toBeEnabled(); await capture.click();
  await expect(page.getByRole('img', { name: 'Ảnh khuôn mặt để xác minh trước bài thi' })).toBeVisible();
  const verify = page.getByRole('button', { name: 'Xác minh khuôn mặt', exact: true });
  await expect(verify).toBeDisabled(); expect(requests).toBe(0);
  await page.getByRole('checkbox').check(); await verify.click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Ảnh chưa khớp');
  await expect(page.getByRole('button', { name: 'Bắt đầu làm bài', exact: true })).toHaveCount(0);
  verified = true; await verify.click();
  await expect(page.getByRole('button', { name: 'Bắt đầu làm bài', exact: true })).toBeEnabled();
  expect(requests).toBe(2);
  await expect(page.locator('.identity-camera')).toHaveCount(0);
});
