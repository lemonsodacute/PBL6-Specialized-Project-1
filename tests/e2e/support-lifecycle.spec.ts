import { expect, test } from '@playwright/test';
import { uiSession } from './ui-fixtures';
import type { AssistantSession } from '../../lib/support-assistant';
import { fixtureUser } from './ui-fixtures';

test.use({ trace: 'off' });

for (const role of ['student', 'teacher'] as const) {
  test(`${role}: confirm new chat once, reset context, preserve closed history and restore on refresh`, async ({ page }, testInfo) => {
    await uiSession(page, role);
    await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.fixture`, url: test.info().project.use.baseURL! }]);
    await page.setViewportSize({ width: 375, height: 844 });
    const initialId = '11111111-1111-4111-8111-111111111111';
    const freshId = '22222222-2222-4222-8222-222222222222';
    const label = role === 'student' ? 'Thẻ sinh viên' : 'Giám sát';
    const now = new Date().toISOString();
    const old: AssistantSession = { id: initialId, status: 'AI_ACTIVE', phase: 'DETAIL', category: 'old-category',
      topic: 'old-topic', conversation_id: null, provider_configured: true, greeting: 'Xin chào! Bạn cần hỗ trợ vấn đề nào?',
      title: label + ' · Vấn đề cũ', created_at: now, updated_at: now,
      categories: [{ id: 'camera', label: 'Camera / Microphone' }, { id: 'other', label: 'Vấn đề khác' }], topics: [],
      messages: [{ id: 'old-message', user_text: 'Nội dung phiên trước', assistant_text: 'Hướng dẫn của phiên trước', sources: [], used_provider: false, created_at: now }] };
    const sessions = new Map([[initialId, old]]);
    let active = old, creations = 0;
    await page.routeWebSocket('**/api/v1/chat/ws', socket => socket.onMessage(() => socket.send(JSON.stringify({ type: 'ready' }))));
    await page.route('**/api/v1/chat/unread-count', route => route.fulfill({ json: { data: { count: 0 } } }));
    await page.route('**/api/v1/support-assistant/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (path.endsWith('/sessions')) {
        if (route.request().method() === 'GET') return route.fulfill({ headers, json: { data: [...sessions.values()].reverse(), meta: { next_cursor: null } } });
        const body = route.request().postDataJSON();
        if (body.new) {
          creations++;
          expect(body.client_id).toMatch(/^[0-9a-f-]{36}$/);
          await new Promise(resolve => setTimeout(resolve, 250));
          old.status = 'CLOSED'; old.closed_at = now;
          active = { ...old, id: freshId, status: 'AI_ACTIVE', title: 'Vấn đề khác', phase: 'CATEGORY', category: null, topic: null, closed_at: null, messages: [] };
          sessions.set(active.id, active);
        }
        return route.fulfill({ headers, json: { data: active } });
      }
      return route.fulfill({ headers, json: { data: sessions.get(path.split('/').at(-1)!) } });
    });
    await page.goto(role === 'student' ? '/student/help' : '/teacher/help');
    const open = () => page.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
    const menu = () => page.getByRole('button', { name: 'Tùy chọn cuộc trò chuyện', exact: true }).click();
    await open();
    await expect(page.getByRole('log')).toContainText('Hướng dẫn của phiên trước');
    await page.getByRole('button', { name: 'Đóng chat hỗ trợ', exact: true }).click();
    await open();
    await expect(page.getByRole('log')).toContainText('Hướng dẫn của phiên trước');
    expect(creations).toBe(0);
    await menu(); await page.getByRole('menuitem', { name: 'Cuộc trò chuyện mới', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Bắt đầu cuộc trò chuyện mới?', exact: true });
    await expect(confirm).toContainText('Nội dung hiện tại vẫn được lưu trong lịch sử.');
    await confirm.getByRole('button', { name: 'Hủy', exact: true }).click();
    expect(creations).toBe(0);
    await menu(); await page.getByRole('menuitem', { name: 'Cuộc trò chuyện mới', exact: true }).click();
    await confirm.getByRole('button', { name: 'Bắt đầu mới', exact: true }).dblclick();
    await expect(page.getByRole('button', { name: 'Camera / Microphone', exact: true })).toBeVisible();
    await expect(page.getByRole('log')).not.toContainText('Hướng dẫn của phiên trước');
    expect(creations).toBe(1); expect(active.category).toBeNull(); expect(active.topic).toBeNull();
    await page.reload(); await open();
    await expect(page.getByRole('button', { name: 'Camera / Microphone', exact: true })).toBeVisible();
    expect(creations).toBe(1);
    await menu(); await page.getByRole('menuitem', { name: 'Lịch sử trò chuyện', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(label + ' · Vấn đề cũ.*Đã kết thúc') }).click();
    await expect(page.getByRole('log')).toContainText('Hướng dẫn của phiên trước');
    await expect(page.getByRole('textbox', { name: 'Nhập vấn đề của bạn', exact: true })).toHaveCount(0);
    await menu(); await expect(page.getByRole('menuitem', { name: 'Kết thúc cuộc trò chuyện', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Tiếp tục cuộc trò chuyện hiện tại', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Camera / Microphone', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.screenshot({ path: testInfo.outputPath(`support-lifecycle-${role}-375.png`) });
  });
}

test('notification opens an archived thread and X/reopen resumes the current active session', async ({ page }) => {
  await uiSession(page, 'student');
  const oldId = '11111111-1111-4111-8111-111111111112', activeId = '22222222-2222-4222-8222-222222222222';
  const conversationId = '33333333-3333-4333-8333-333333333333', adminId = '44444444-4444-4444-8444-444444444444';
  const now = new Date().toISOString();
  const active: AssistantSession = { id: activeId, status: 'AI_ACTIVE', phase: 'CATEGORY', provider_configured: true,
    category: null, conversation_id: null, greeting: 'Xin chào! Bạn cần hỗ trợ vấn đề nào?', categories: [{ id: 'camera', label: 'Camera / Microphone' }], topics: [], messages: [] };
  const closed: AssistantSession = { ...active, id: oldId, status: 'CLOSED', conversation_id: conversationId, closed_by: adminId, closed_at: now };
  async function respond(route: import('@playwright/test').Route, data: unknown, meta?: unknown) {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    return route.fulfill({ headers, json: { data, ...(meta ? { meta } : {}) } });
  }
  await page.routeWebSocket('**/api/v1/chat/ws', socket => socket.onMessage(() => socket.send(JSON.stringify({ type: 'ready' }))));
  await page.route('**/api/v1/support-assistant/**', route => respond(route, route.request().url().endsWith(oldId) ? closed : active));
  await page.route('**/api/v1/chat/conversations/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/messages')) return respond(route, [{ id: 'archived-message', conversation_id: conversationId, sender_id: adminId, client_id: 'message-key',
      body: 'Phản hồi Admin trong lịch sử', kind: 'message', read_at: null, created_at: now }], { next_cursor: null });
    if (pathname.endsWith('/read')) return respond(route, { updated: 1 });
    return respond(route, { id: conversationId, owner: fixtureUser, created_at: now, last_message_at: now, last_message: null, unread_count: 1,
      support_case: { id: oldId, status: 'CLOSED', category: 'camera', closed_by: adminId, closed_at: now, summary: { category: 'Camera / Microphone' } } });
  });
  await page.goto(`/student/help?chat=${conversationId}`);
  await expect(page.getByRole('log')).toContainText('Phản hồi Admin trong lịch sử');
  await expect(page.getByRole('textbox', { name: 'Nhập tin nhắn', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/student\/help$/);
  await page.getByRole('button', { name: 'Đóng chat hỗ trợ', exact: true }).click();
  await page.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Camera / Microphone', exact: true })).toBeVisible();
  await expect(page.getByRole('log')).not.toContainText('Phản hồi Admin trong lịch sử');
});
