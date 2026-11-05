/** Real QA PostgreSQL/API/worker/teacher WS. Prerecorded frames, NOT physical webcam proof.
 * Only the Student exam's device UI flags are overridden so identity enrollment is outside this test.
 * Warnings, violations, auth, persistence and Teacher UI responses are never mocked.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const enabled = process.env.STUDENT_WARNINGS_LIVE_QA === '1';
test.skip(!enabled, 'Requires fresh isolated proctor fixture, QA API on 8001, frontend on 3100 and real worker');
const api = 'http://localhost:8001/api/v1', front = 'http://localhost:3100';

test('real model and browser violations reach the Teacher console and Student warning panel', async ({ browser, request }) => {
  test.setTimeout(180000);
  const f = JSON.parse(fs.readFileSync('backend/private/release-qa/proctor-fixture.json', 'utf8'));
  const image = fs.readFileSync('artifacts/student-warnings/worker-input.jpg');
  const headers = (role: string) => ({ Authorization: `Bearer ${f.actors[role].access_token}` });
  async function signedIn(role: string) {
    const context = await browser.newContext();
    const { access_token, ...user } = f.actors[role];
    await context.addCookies([{ name: 'auth_token', value: access_token, url: front, httpOnly: true, sameSite: 'Lax' }]);
    await context.addInitScript(({ user, access_token }) => {
      sessionStorage.setItem('ai-proctoring-current-user', JSON.stringify(user));
      sessionStorage.setItem('ai-proctoring-access-token', access_token);
    }, { user, access_token });
    return context;
  }
  const teacher = await signedIn('teacher'), student = await signedIn('student');
  try {
    const teacherPage = await teacher.newPage(), studentPage = await student.newPage();
    const delivered = new Set<string>();
    teacherPage.on('websocket', socket => {
      if (socket.url().includes('/proctoring/ws')) socket.on('framereceived', ({ payload }) => {
        const message = JSON.parse(String(payload));
        if (message.type === 'proctor_event_created') delivered.add(message.data.id);
      });
    });
    await teacherPage.goto(`${front}/dashboard/monitor/${f.exam_id}`);
    await expect(teacherPage.getByText('Realtime đã kết nối', { exact: true })).toBeVisible({ timeout: 90000 });
    await studentPage.route(`**/api/v1/exams/${f.exam_id}`, async route => {
      const response = await route.fetch();
      const body = await response.json();
      body.data.require_camera = false; body.data.require_mic = false; body.data.require_fullscreen = false;
      await route.fulfill({ response, json: body });
    });
    await studentPage.goto(`${front}/student/attempts/${f.attempt_id}`);
    await expect(studentPage.getByRole('heading', { name: 'Proctor alerts · QA isolated' })).toBeVisible({ timeout: 60000 });
    const found = new Set<string>();
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline && !(found.has('object_phone') && found.has('face_not_detected'))) {
      const response = await request.post(`${api}/proctoring/sessions/${f.attempt_id}/frame`, {
        headers: headers('student'), multipart: { frame: { name: 'camera.jpg', mimeType: 'image/jpeg', buffer: image } },
      });
      expect(response.ok()).toBe(true);
      const warnings = await request.get(`${api}/proctoring/sessions/${f.attempt_id}/warnings`, { headers: headers('student') });
      for (const item of (await warnings.json()).data) found.add(item.event_type);
    }
    expect(found.has('object_phone')).toBe(true);
    expect(found.has('face_not_detected')).toBe(true);
    const warnings = studentPage.getByRole('alert', { name: 'Cảnh báo trong bài thi' });
    await expect(warnings).toContainText('Phát hiện điện thoại');
    await expect(warnings).toContainText('Không thấy khuôn mặt');
    for (const label of ['Phát hiện điện thoại', 'Không thấy khuôn mặt']) {
      const row = teacherPage.locator('[data-proctor-event]').filter({ hasText: label }).first();
      await expect(row).toBeVisible();
      const id = (await row.getAttribute('data-proctor-event'))!;
      await expect.poll(() => delivered.has(id)).toBe(true);
    }
    await studentPage.evaluate(() => document.dispatchEvent(new Event('copy')));
    await expect(warnings).toContainText('Sao chép');
    await expect(teacherPage.locator('[data-proctor-event]').filter({ hasText: 'Sao chép' }).first()).toBeVisible();
    await studentPage.screenshot({ path: 'artifacts/student-warnings/live-student.png', fullPage: true });
    await teacherPage.screenshot({ path: 'artifacts/student-warnings/live-teacher.png', fullPage: true });
    await teacherPage.reload();
    await expect(teacherPage.locator('[data-proctor-event]').filter({ hasText: 'Phát hiện điện thoại' }).first()).toBeVisible();
    await studentPage.reload();
    await expect(warnings).toContainText('Phát hiện điện thoại');
  } finally { await student.close(); await teacher.close(); }
});
