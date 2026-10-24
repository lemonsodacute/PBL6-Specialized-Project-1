import { test, expect as baseExpect, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const expect = baseExpect.configure({ timeout: 15000 });
const api = process.env.SUPPORT_CHAT_API_URL ?? 'http://localhost:8000/api/v1';
const python = path.resolve('backend/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const fixtureScript = path.resolve('backend/scripts/support_chat_e2e_fixture.py');
const fixtureArgs = process.env.SUPPORT_CHAT_RELEASE_QA === '1'
  ? ['scripts/release_qa_runtime.py', 'run', '--', 'python', fixtureScript]
  : [fixtureScript];
type Actor = { id: string; email: string; full_name: string; password: string };
let actors: Record<'admin' | 'student' | 'teacher', Actor>;
// Tailwind's dev watcher scans trace files and would rebuild while recording.
test.use({ trace: 'off', actionTimeout: 20000 });

async function signIn(context: BrowserContext, actor: Actor) {
  const response = await context.request.post(`${api}/auth/login`, { data: { email: actor.email, password: actor.password } });
  expect(response.ok(), await response.text()).toBeTruthy(); const session = await response.json();
  await context.addInitScript(({ user, access_token }) => {
    if (sessionStorage.getItem('support-e2e-initialized')) return;
    sessionStorage.setItem('support-e2e-initialized', '1');
    sessionStorage.setItem('ai-proctoring-current-user', JSON.stringify(user));
    sessionStorage.setItem('ai-proctoring-access-token', access_token);
  }, session);
  return { Authorization: `Bearer ${session.access_token}` };
}
async function send(page: Page, body: string) {
  await page.getByRole('textbox', { name: 'Nhập tin nhắn', exact: true }).fill(body);
  await page.getByRole('button', { name: 'Gửi', exact: true }).click();
  await expect(page.getByRole('log').getByText(body, { exact: true })).toBeVisible();
}

test.describe('Support chat with real PostgreSQL, REST and WebSockets', () => {
  test.skip(process.env.SUPPORT_CHAT_LIVE_E2E !== '1', 'Opt-in: start real backend/frontend and apply migrations.');
  test.beforeAll(() => {
    actors = JSON.parse(execFileSync(python, fixtureArgs, { cwd: path.resolve('backend'), env: { ...process.env, PYTHONPATH: '.' }, encoding: 'utf8', timeout: 30000 }));
  });
  test.afterAll(() => {
    if (actors) execFileSync(python, [...fixtureArgs, '--cleanup'], { cwd: path.resolve('backend'), env: { ...process.env, PYTHONPATH: '.' }, input: JSON.stringify(Object.values(actors).map(actor => actor.id)), encoding: 'utf8', timeout: 30000 });
  });

  test('three browser sessions: realtime, unread/read, isolation, retry, history, refresh and mobile', async ({ browser }) => {
    test.setTimeout(360000);
    const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
    const [adminContext, studentContext, teacherContext] = contexts;
    try {
      const [adminHeaders, studentHeaders, teacherHeaders] = await Promise.all([signIn(adminContext, actors.admin), signIn(studentContext, actors.student), signIn(teacherContext, actors.teacher)]);
      const [admin, student, teacher] = await Promise.all(contexts.map(context => context.newPage()));
      await Promise.all([admin.goto('/admin/messages'), student.goto('/student/help'), teacher.goto('/teacher/help')]);
      await expect(admin.getByRole('heading', { name: 'Tin nhắn hỗ trợ' })).toBeVisible();
      await student.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
      const initialSession = (await (await studentContext.request.post(`${api}/support-assistant/sessions`, { headers: studentHeaders, data: {} })).json()).data;
      await expect(student.getByRole('button', { name: 'Liên hệ System Admin', exact: true })).toHaveCount(initialSession.provider_configured ? 0 : 1);
      if (!initialSession.provider_configured) await expect(student.getByText('Trợ lý AI hiện chưa được cấu hình', { exact: true })).toBeVisible();
      await student.getByRole('button', { name: 'Thẻ sinh viên', exact: true }).click();
      await student.getByRole('button', { name: 'Sai Lớp', exact: true }).click();
      await expect(student.getByRole('log')).toContainText('JPG/PNG');
      await student.getByRole('button', { name: 'Đóng chat hỗ trợ', exact: true }).click();
      await student.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
      await expect(student.getByRole('log')).toContainText('JPG/PNG');
      expect((await (await studentContext.request.post(`${api}/support-assistant/sessions`, { headers: studentHeaders, data: {} })).json()).data.id).toBe(initialSession.id);
      await student.getByRole('button', { name: 'Tùy chọn cuộc trò chuyện', exact: true }).click();
      await student.getByRole('menuitem', { name: 'Kết thúc cuộc trò chuyện', exact: true }).click();
      const endDialog = student.getByRole('dialog', { name: 'Kết thúc cuộc trò chuyện?', exact: true });
      await endDialog.getByRole('button', { name: 'Hủy', exact: true }).click();
      await expect(student.getByRole('textbox', { name: 'Nhập vấn đề của bạn', exact: true })).toBeEnabled();
      await student.getByRole('button', { name: 'Tùy chọn cuộc trò chuyện', exact: true }).click();
      await student.getByRole('menuitem', { name: 'Kết thúc cuộc trò chuyện', exact: true }).click();
      await endDialog.getByRole('button', { name: 'Kết thúc', exact: true }).click();
      await expect(student.getByRole('log')).toContainText('Cuộc trò chuyện đã kết thúc.');
      await expect(student.getByRole('textbox', { name: 'Nhập vấn đề của bạn', exact: true })).toHaveCount(0);
      const deniedClosed = await studentContext.request.post(`${api}/support-assistant/sessions/${initialSession.id}/turns`, { headers: studentHeaders, data: { action: 'message', text: 'Closed session', client_id: crypto.randomUUID() } });
      expect(deniedClosed.status()).toBe(409); expect((await deniedClosed.json()).error.code).toBe('SUPPORT_SESSION_CLOSED');
      await student.getByRole('button', { name: 'Bắt đầu cuộc trò chuyện mới', exact: true }).click();
      await expect(student.getByRole('log')).not.toContainText('JPG/PNG');
      const freshSession = (await (await studentContext.request.post(`${api}/support-assistant/sessions`, { headers: studentHeaders, data: {} })).json()).data;
      expect(freshSession.id).not.toBe(initialSession.id); expect(freshSession.category).toBeNull(); expect(freshSession.messages).toEqual([]);
      await student.getByRole('button', { name: 'Tùy chọn cuộc trò chuyện', exact: true }).click();
      await student.getByRole('menuitem', { name: 'Lịch sử trò chuyện', exact: true }).click();
      await student.getByRole('button', { name: /Thẻ sinh viên · Sai Lớp.*Đã kết thúc/ }).click();
      await expect(student.getByRole('log')).toContainText('JPG/PNG');
      await expect(student.getByRole('textbox', { name: 'Nhập vấn đề của bạn', exact: true })).toHaveCount(0);
      await student.getByRole('button', { name: 'Tùy chọn cuộc trò chuyện', exact: true }).click();
      await student.getByRole('menuitem', { name: 'Tiếp tục cuộc trò chuyện hiện tại', exact: true }).click();
      await student.reload(); await student.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
      expect((await (await studentContext.request.post(`${api}/support-assistant/sessions`, { headers: studentHeaders, data: {} })).json()).data.id).toBe(freshSession.id);
      await student.getByRole('button', { name: 'Thẻ sinh viên', exact: true }).click();
      await student.getByRole('button', { name: 'Sai Lớp', exact: true }).click();
      expect((await studentContext.request.post(`${api}/chat/support`, { headers: studentHeaders })).status()).toBe(409);
      await student.getByRole('button', { name: 'Đã giải quyết', exact: true }).click();
      await expect(admin.getByRole('button').filter({ hasText: actors.student.full_name })).toHaveCount(0);
      await student.getByRole('button', { name: 'Bắt đầu câu hỏi mới', exact: true }).click();
      await student.getByRole('button', { name: 'Thẻ sinh viên', exact: true }).click();
      await student.getByRole('button', { name: 'Sai Lớp', exact: true }).click();
      await expect(student.getByRole('button', { name: 'Vẫn gặp lỗi', exact: true })).toBeVisible();
      await student.screenshot({ path: 'artifacts/support-assistant-guidance.png' });
      await student.getByRole('button', { name: 'Vẫn gặp lỗi', exact: true }).click();
      await student.getByRole('button', { name: 'Liên hệ System Admin', exact: true }).click();
      await expect(student.getByRole('textbox', { name: 'Nhập tin nhắn', exact: true })).toBeEnabled();
      await send(student, 'Em không xác minh được thẻ sinh viên.');
      const studentThread = (await (await studentContext.request.post(`${api}/chat/support`, { headers: studentHeaders })).json()).data.id;
      const studentItem = admin.getByRole('button').filter({ hasText: actors.student.full_name });
      await expect(studentItem).toBeVisible();
      await expect(studentItem.getByLabel('2 chưa đọc', { exact: true })).toBeVisible();
      const secondAdmin = await adminContext.newPage(); await secondAdmin.goto('/admin/messages');
      await expect(secondAdmin.getByRole('button').filter({ hasText: actors.student.full_name }).getByLabel('2 chưa đọc', { exact: true })).toBeVisible();
      await studentItem.click();
      await admin.getByText('Tóm tắt từ AI', { exact: true }).click();
      await expect(admin.locator('details[open]')).toContainText('Sai Lớp');
      await expect(admin.locator('details[open]')).toContainText('Người dùng xác nhận vẫn gặp lỗi');
      await expect(admin.getByRole('log').getByText('Em không xác minh được thẻ sinh viên.', { exact: true })).toBeVisible();
      await expect(secondAdmin.getByRole('button').filter({ hasText: actors.student.full_name }).getByLabel('2 chưa đọc', { exact: true })).toHaveCount(0);
      await student.getByRole('button', { name: 'Đóng chat hỗ trợ', exact: true }).click();
      await send(admin, 'Bạn thử tải lại ảnh rõ hơn giúp mình.');
      await expect(student.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).getByLabel('1 tin nhắn chưa đọc', { exact: true })).toBeVisible();
      await student.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
      await expect(student.getByRole('log').getByText('Bạn thử tải lại ảnh rõ hơn giúp mình.', { exact: true })).toBeVisible();
      await expect.poll(async () => (await (await studentContext.request.get(`${api}/chat/unread-count`, { headers: studentHeaders })).json()).data.count).toBe(0);
      await teacher.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
      await teacher.getByRole('button', { name: 'Giám sát', exact: true }).click();
      await teacher.getByRole('button', { name: 'Không thấy sinh viên', exact: true }).click();
      await teacher.getByRole('button', { name: 'Vẫn gặp lỗi', exact: true }).click();
      await teacher.getByRole('button', { name: 'Liên hệ System Admin', exact: true }).click();
      await send(teacher, 'Tôi không thấy điểm của sinh viên.');
      const teacherThread = (await (await teacherContext.request.post(`${api}/chat/support`, { headers: teacherHeaders })).json()).data.id;
      expect(teacherThread).not.toBe(studentThread);
      const teacherItem = admin.getByRole('button').filter({ hasText: actors.teacher.full_name });
      await expect(teacherItem).toBeVisible(); await teacherItem.click();
      await send(admin, 'Tôi sẽ kiểm tra tài khoản giảng viên.');
      await expect(teacher.getByRole('log').getByText('Tôi sẽ kiểm tra tài khoản giảng viên.', { exact: true })).toBeVisible();
      for (const [context, headers, denied] of [[studentContext, studentHeaders, teacherThread], [teacherContext, teacherHeaders, studentThread]] as const) {
        for (const suffix of ['', '/messages']) expect((await context.request.get(`${api}/chat/conversations/${denied}${suffix}`, { headers })).status()).toBe(404);
        expect((await context.request.post(`${api}/chat/conversations/${denied}/messages`, { headers, data: { body: 'Unauthorized', client_id: crypto.randomUUID() } })).status()).toBe(404);
      }
      await admin.getByRole('searchbox', { name: 'Tìm cuộc trò chuyện' }).fill(actors.student.email.toUpperCase());
      await expect(admin.getByRole('button').filter({ hasText: actors.student.full_name })).toBeVisible();
      await expect(admin.getByRole('button').filter({ hasText: actors.teacher.full_name })).toHaveCount(0);
      await admin.getByRole('searchbox', { name: 'Tìm cuộc trò chuyện' }).fill('');
      await student.reload(); await student.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
      await expect(student.getByRole('log').getByText('Em không xác minh được thẻ sinh viên.', { exact: true })).toBeVisible();
      // Simulate a lost POST response after the server has persisted the message.
      await student.route('**/chat/conversations/*/messages', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        await route.fetch(); await route.abort('failed');
      });
      await student.getByRole('textbox', { name: 'Nhập tin nhắn', exact: true }).fill('Tin nhắn thử lại an toàn');
      await student.getByRole('button', { name: 'Gửi', exact: true }).click();
      await expect(student.getByRole('alert').filter({ hasText: 'Không gửi được tin nhắn.' })).toBeVisible();
      await student.unroute('**/chat/conversations/*/messages');
      await student.getByRole('button', { name: 'Thử lại', exact: true }).click();
      await expect(student.getByRole('textbox', { name: 'Nhập tin nhắn', exact: true })).toHaveValue('');
      const history = (await (await studentContext.request.get(`${api}/chat/conversations/${studentThread}/messages`, { headers: studentHeaders })).json()).data;
      expect(history.filter((message: { body: string }) => message.body === 'Tin nhắn thử lại an toàn')).toHaveLength(1);
      await send(student, '<img src=x onerror=alert(1)>');
      await expect(student.getByRole('log').locator('img')).toHaveCount(0);
      await student.screenshot({ path: 'artifacts/support-chat-student-desktop.png' });
      await admin.screenshot({ path: 'artifacts/support-chat-admin-desktop.png' });
      await student.getByRole('button', { name: 'Đóng chat hỗ trợ', exact: true }).click();
      await student.setViewportSize({ width: 390, height: 844 });
      await student.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
      const drawer = await student.getByRole('dialog', { name: 'ProctoOwl Support' }).boundingBox();
      expect(drawer?.width).toBe(390);
      await student.screenshot({ path: 'artifacts/support-chat-student-mobile.png' });
      await admin.setViewportSize({ width: 390, height: 844 });
      await expect(admin.getByRole('button', { name: 'Quay lại danh sách' })).toBeVisible();
      await admin.getByRole('button', { name: 'Quay lại danh sách' }).click();
      await expect(admin.getByRole('searchbox', { name: 'Tìm cuộc trò chuyện' })).toBeVisible();
      await admin.getByRole('button').filter({ hasText: actors.student.full_name }).click();
      await expect(admin.getByRole('log').getByText('Em không xác minh được thẻ sinh viên.', { exact: true })).toBeVisible();
      await admin.screenshot({ path: 'artifacts/support-chat-admin-mobile.png' });
      await student.getByRole('button', { name: 'Đóng chat hỗ trợ', exact: true }).click();
      await student.getByRole('button', { name: `Tài khoản của ${actors.student.full_name}`, exact: true }).click();
      await student.getByRole('menuitem', { name: 'Đăng xuất' }).click();
      await expect(student).toHaveURL(/\/login/, { timeout: 60000 });
      await student.getByLabel('Email', { exact: true }).fill(actors.student.email);
      await student.getByLabel('Mật khẩu', { exact: true }).fill(actors.student.password);
      await student.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
      await expect(student.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true })).toBeVisible();
      await student.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
      await expect(student.getByRole('log').getByText('Em không xác minh được thẻ sinh viên.', { exact: true })).toBeVisible();
      expect((await (await studentContext.request.post(`${api}/chat/support`, { headers: studentHeaders })).json()).data.id).toBe(studentThread);
      await admin.getByRole('button', { name: 'Đánh dấu đã giải quyết', exact: true }).click();
      await expect(student.getByRole('log')).toContainText('Quản trị viên đã đánh dấu yêu cầu hỗ trợ là đã giải quyết.');
      await expect(student.getByRole('textbox', { name: 'Nhập tin nhắn', exact: true })).toHaveCount(0);
      await admin.getByRole('button', { name: 'Quay lại danh sách', exact: true }).click();
      await admin.getByRole('button', { name: 'Đã đóng', exact: true }).click();
      await expect(admin.getByRole('button').filter({ hasText: actors.student.full_name })).toBeVisible();
      await expect(student.getByRole('button', { name: 'Vẫn còn vấn đề', exact: true })).toBeVisible();
      await student.getByRole('button', { name: 'Vẫn còn vấn đề', exact: true }).click();
      await expect(student.getByRole('button', { name: 'Thẻ sinh viên', exact: true })).toBeVisible();
      await student.getByRole('button', { name: 'Thẻ sinh viên', exact: true }).click();
      await student.getByRole('button', { name: 'Sai Lớp', exact: true }).click();
      await student.getByRole('button', { name: 'Vẫn gặp lỗi', exact: true }).click();
      await student.getByRole('button', { name: 'Liên hệ System Admin', exact: true }).click();
      await send(student, 'Tin nhắn đầu phiên mới');
      const newThread = (await (await studentContext.request.post(`${api}/chat/support`, { headers: studentHeaders })).json()).data.id;
      expect(newThread).not.toBe(studentThread);
      await expect(student.getByRole('log')).not.toContainText('Em không xác minh được thẻ sinh viên.');
      await student.getByRole('button', { name: 'Đóng chat hỗ trợ', exact: true }).click();
      await Promise.all([admin.close(), secondAdmin.close(), teacher.close()]);
      for (let index = 0; index < 43; index++) {
        const result = await adminContext.request.post(`${api}/chat/conversations/${newThread}/messages`, { headers: adminHeaders,
          data: { body: `Lịch sử hỗ trợ ${index}: ${'Nội dung lưu trữ. '.repeat(6)}`, client_id: crypto.randomUUID() } });
        expect(result.status()).toBe(200);
      }
      await student.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
      await expect(student.getByRole('button', { name: 'Tải tin nhắn cũ hơn' })).toBeAttached();
      const log = student.getByRole('log');
      await expect(log).toHaveAttribute('aria-busy', 'false');
      await expect.poll(() => log.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      const olderLoaded = student.waitForResponse(response => response.url().includes(`/chat/conversations/${newThread}/messages?before=`));
      await log.hover(); await student.mouse.wheel(0, -100000);
      expect((await olderLoaded).status()).toBe(200);
      await expect(log.getByText('Tin nhắn đầu phiên mới', { exact: true })).toBeAttached();
      await student.goto('/student/attempts/00000000-0000-4000-8000-000000000001');
      await expect(student.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true })).toHaveCount(0);
    } finally { await Promise.all(contexts.map(context => context.close())); }
  });
});
