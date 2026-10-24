/** Opt-in real PostgreSQL + two-worker API flow; credentials stay in private QA state. */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const enabled = process.env.PROCTOR_LIVE_QA === '1';
test.skip(!enabled, 'Requires isolated QA API on 8001, QA frontend on 3100 and explicit PROCTOR_LIVE_QA=1');
const fixture = enabled ? JSON.parse(fs.readFileSync(path.resolve('backend/private/release-qa/proctor-fixture.json'), 'utf8')) : null;
const api = 'http://localhost:8001/api/v1';
const base = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3100';
async function login(page: Page, actor = 'teacher') {
  const { access_token, ...user } = fixture.actors[actor];
  await page.context().addCookies([{ name: 'auth_token', value: access_token, url: base, httpOnly: true, sameSite: 'Lax' }]);
  await page.addInitScript(({ user, token }) => {
    sessionStorage.setItem('ai-proctoring-current-user', JSON.stringify(user));
    sessionStorage.setItem('ai-proctoring-access-token', token);
  }, { user, token: access_token });
}
const headers = () => ({ Authorization: `Bearer ${fixture.actors.teacher.access_token}` });
const monitor = () => `/dashboard/monitor/${fixture.exam_id}?simulation=1`;

test('real DEV simulator → DB → committed WebSocket → feed/toast → review → refresh → report', async ({ page, request }, info) => {
  await login(page); const messages: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => { if (socket.url().includes('/proctoring/ws')) socket.on('framereceived', frame => messages.push(String(frame.payload))); });
  await page.goto(monitor());
  await expect(page.getByRole('heading', { name: 'Luồng cảnh báo' })).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('Realtime đã kết nối', { exact: true })).toBeVisible();
  const external_id = randomUUID();
  const emit = () => request.post(`${api}/proctoring/dev/simulate`, { headers: headers(), data: { attempt_id: fixture.attempt_id, event_type: 'multiple_faces', external_id } });
  const created = await emit(); expect(created.status()).toBe(200);
  const event = (await created.json()).data.event;
  const row = page.locator(`[data-proctor-event="${event.id}"]`);
  await expect(row).toBeVisible(); await expect(row).toContainText('Mô phỏng'); await expect(row).toContainText('Chưa xem');
  await expect(page.getByRole('status', { name: 'Cảnh báo mới', exact: true })).toBeVisible();
  await expect.poll(() => messages.some(message => message.includes('proctor_event_created') && message.includes(event.id))).toBe(true);
  const retry = (await (await emit()).json()).data; expect(retry.duplicate).toBe(true); expect(retry.event.occurrence_count).toBe(event.occurrence_count);
  await page.getByRole('button', { name: 'Đóng thông báo cảnh báo' }).click();
  const merge = await request.post(`${api}/proctoring/dev/simulate`, { headers: headers(), data: { attempt_id: fixture.attempt_id, event_type: 'multiple_faces' } });
  expect((await merge.json()).data.created).toBe(false);
  await expect.poll(() => messages.some(message => message.includes('proctor_event_updated') && message.includes(event.id))).toBe(true);
  await expect(page.getByRole('status', { name: 'Cảnh báo mới', exact: true })).toHaveCount(0);
  await row.getByRole('button', { name: 'Xem', exact: true }).click();
  const detail = page.getByRole('dialog', { name: 'Chi tiết cảnh báo', exact: true });
  await expect(detail).toBeVisible(); await expect(detail).toContainText('Đã xem');
  await detail.getByLabel(/Ghi chú giám thị/).fill('QA human review: no automated score change.');
  await detail.getByRole('button', { name: 'Bỏ qua', exact: true }).click(); await expect(detail.getByRole('button', { name: 'Bỏ qua', exact: true })).toBeDisabled();
  await detail.getByRole('button', { name: 'Xác nhận', exact: true }).click(); await expect(detail.getByRole('button', { name: 'Xác nhận', exact: true })).toBeDisabled();
  await detail.getByRole('button', { name: 'Đóng', exact: true }).click();
  await page.reload(); await expect(page.locator(`[data-proctor-event="${event.id}"]`)).toContainText('Đã xác nhận', { timeout: 45000 });
  const saved = (await (await request.get(`${api}/proctoring/events/${event.id}`, { headers: headers() })).json()).data;
  expect(saved.status).toBe('CONFIRMED'); expect(saved.reviewed_by).toBe(fixture.actors.teacher.id); expect(saved.history.map((item: { status: string }) => item.status)).toContain('DISMISSED');
  const real = (await (await request.get(`${api}/proctoring/exams/${fixture.exam_id}/events`, { headers: headers() })).json());
  expect(real.meta.summary.total).toBe(0); expect(real.data).toEqual([]);
  await page.goto(`/dashboard/exams/${fixture.exam_id}/report`);
  await expect(page.getByRole('heading', { name: 'Tổng hợp cảnh báo giám sát' })).toBeVisible();
  await page.getByRole('button', { name: 'Mô phỏng', exact: true }).click();
  await expect(page.getByText('Báo cáo kiểm thử riêng', { exact: false })).toBeVisible();
  await expect(page.getByText('Đã xác nhận', { exact: true })).toBeVisible();
  const report = (await (await request.get(`${api}/proctoring/exams/${fixture.exam_id}/report?simulated=true`, { headers: headers() })).json()).data;
  expect(report.summary.confirmed).toBeGreaterThan(0); expect(report.types.some((item: { event_type: string }) => item.event_type === 'multiple_faces')).toBe(true);
  fs.mkdirSync('artifacts/proctoring', { recursive: true });
  await page.screenshot({ path: 'artifacts/proctoring/report-simulated.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('concurrent retry is exactly once across workers and unauthorized users cannot read/subscribe', async ({ request }) => {
  const data = { attempt_id: fixture.attempt_id, event_type: 'gaze_away', external_id: randomUUID() };
  const requests = await Promise.all([
    ...Array.from({ length: 8 }, () => request.post(`${api}/proctoring/dev/simulate`, { headers: headers(), data })),
    ...Array.from({ length: 4 }, () => request.get(`${api}/attempts?exam_id=${fixture.exam_id}`, { headers: headers() })),
  ]);
  requests.slice(8).forEach(response => expect(response.status()).toBe(200));
  const responses = requests.slice(0, 8);
  const results = await Promise.all(responses.map(async response => { expect(response.status()).toBe(200); return (await response.json()).data; }));
  expect(new Set(results.map(result => result.event.id)).size).toBe(1);
  expect(results.filter(result => !result.duplicate)).toHaveLength(1);
  const id = results[0].event.id;
  for (const actor of ['other', 'student']) {
    const response = await request.get(`${api}/proctoring/events/${id}`, { headers: { Authorization: `Bearer ${fixture.actors[actor].access_token}` } });
    expect(response.status()).toBe(403);
  }
  expect((await request.post(`${api}/proctoring/events`, { headers: { Authorization: `Bearer ${fixture.actors.student.access_token}` }, data: { severity: 'critical' } })).status()).toBe(401);
});

for (const width of [1440, 1024, 390]) test(`console/timeline remains usable at ${width}px with no horizontal overflow`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await login(page); await page.goto(monitor());
  await expect(page.getByRole('heading', { name: 'Luồng cảnh báo' })).toBeVisible({ timeout: 90000 });
  await expect(page.locator('[data-proctor-event]').first()).toBeVisible();
  if (width === 390) {
    const sessions = page.getByText('Phiên làm bài', { exact: false }).locator('..');
    expect(await sessions.evaluate(node => (node as HTMLDetailsElement).open)).toBe(false);
    await sessions.locator('summary').click();
  }
  await page.getByRole('button', { name: /Proctor QA student/ }).click();
  const timeline = page.getByRole('dialog', { name: 'Dòng thời gian sinh viên', exact: true });
  await expect(timeline).toBeVisible(); await expect(timeline.getByText('Bắt đầu bài thi', { exact: true })).toBeVisible();
  await expect(timeline.getByRole('button', { name: 'Xem camera realtime' })).toBeVisible();
  const box = (await timeline.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  await page.keyboard.press('Escape'); await expect(timeline).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if (width === 390) await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  fs.mkdirSync('artifacts/proctoring', { recursive: true });
  await page.screenshot({ path: `artifacts/proctoring/console-${width}${width === 390 ? '-dark' : ''}.png`, fullPage: true });
});

test('global bell outside monitoring links to the exact simulated event', async ({ page, request }) => {
  let socketReady = false;
  const delivered: string[] = [];
  page.on('websocket', socket => { if (socket.url().includes('/proctoring/ws')) socket.on('framereceived', frame => {
    const message = JSON.parse(String(frame.payload));
    if (message.type === 'ready') socketReady = true;
    if (message.type === 'proctor_event_created') delivered.push(message.data.id);
  }); });
  await login(page); await page.goto('/teacher/settings');
  await expect(page.getByRole('heading', { name: 'Cài đặt cá nhân', exact: true })).toBeVisible({ timeout: 90000 });
  await expect.poll(() => socketReady).toBe(true);
  const initialCount = (await (await request.get(`${api}/notifications/unread-count`, { headers: headers() })).json()).data.count;
  const response = await request.post(`${api}/proctoring/dev/simulate`, { headers: headers(), data: { attempt_id: fixture.attempt_id, event_type: 'multiple_faces' } });
  expect(response.status()).toBe(200); const result = (await response.json()).data; expect(result.created).toBe(true); const event = result.event;
  await expect.poll(() => delivered.includes(event.id)).toBe(true);
  expect((await (await request.get(`${api}/notifications/unread-count`, { headers: headers() })).json()).data.count).toBe(initialCount + 1);
  await expect(page.getByRole('button', { name: `Thông báo, ${initialCount + 1} chưa đọc`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Thông báo/ }).click();
  const inbox = page.getByRole('region', { name: 'Thông báo', exact: true });
  await expect(inbox.getByRole('button', { name: /Mô phỏng.*Nhiều khuôn mặt/ }).first()).toBeVisible();
  await inbox.getByRole('button', { name: /Mô phỏng.*Nhiều khuôn mặt/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`event=${event.id}&simulation=1`), { timeout: 45000 });
  await expect(page.getByRole('dialog', { name: 'Chi tiết cảnh báo', exact: true })).toBeVisible();
});

test('no connected model shows honest empty real feed and student has no proctor subscription', async ({ page }) => {
  await login(page); await page.goto(`/dashboard/monitor/${fixture.exam_id}`);
  await expect(page.getByText('Chưa có cảnh báo.', { exact: true })).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('Chưa kết nối module AI giám sát.', { exact: true })).toBeVisible();
  await expect(page.locator('[data-proctor-event]')).toHaveCount(0);
  const student = await page.context().browser()!.newContext(); const studentPage = await student.newPage();
  try {
    await login(studentPage, 'student'); const subscriptions: string[] = [];
    studentPage.on('websocket', socket => { if (socket.url().includes('/proctoring/ws') || socket.url().includes('/ws/monitor/')) subscriptions.push(socket.url()); });
    await studentPage.goto(base + '/student/settings'); await expect(studentPage.getByRole('heading', { name: 'Cài đặt', exact: true })).toBeVisible();
    expect(subscriptions).toEqual([]);
  } finally { await student.close(); }
});
