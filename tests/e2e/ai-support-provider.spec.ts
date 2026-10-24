import { test, expect } from '@playwright/test';
import { uiSession } from './ui-fixtures';
import { aiErrorMessages } from '../../lib/ai-provider';
import type { AssistantSession } from '../../lib/support-assistant';

test.use({ trace: 'off' });
test('Support knowledge miss offers clarification without opening an admin case', async ({ page }) => {
  await uiSession(page, 'student');
  const session: AssistantSession = {
    id: '11111111-1111-4111-8111-111111111112', status: 'AI_ACTIVE', phase: 'ESCALATE',
    provider_configured: true, category: null, conversation_id: null, categories: [], topics: [],
    greeting: 'Xin chào! Bạn cần hỗ trợ vấn đề nào?',
    support_error: { code: 'SUPPORT_KNOWLEDGE_NOT_FOUND', message: 'Tôi chưa tìm thấy hướng dẫn phù hợp cho vấn đề này.' },
    messages: [{ id: 'missing-1', user_text: 'Vấn đề chưa có hướng dẫn',
      assistant_text: 'Tôi chưa tìm thấy hướng dẫn phù hợp cho vấn đề này.', used_provider: false,
      sources: [], created_at: '2026-10-17T05:00:00Z' }],
  };
  const commands: string[] = [];
  await page.route('**/api/v1/support-assistant/**', async route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().url().endsWith('/turns')) {
      const command = route.request().postDataJSON(); commands.push(command.action);
      if (command.action === 'clarify') { session.phase = 'DETAIL'; session.support_error = null; }
    }
    return route.fulfill({ headers, json: { data: session } });
  });
  await page.goto('/student/help');
  await page.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'ProctoOwl Support', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'ProctoOwl Support', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/proctoowl-redesign/brand-support.png' });
  await expect(page.getByRole('log')).toContainText('Tôi chưa tìm thấy hướng dẫn phù hợp cho vấn đề này.');
  await expect(page.getByRole('button', { name: 'Liên hệ System Admin', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Thử mô tả chi tiết hơn', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Liên hệ System Admin', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Nhập vấn đề của bạn', exact: true })).toBeEnabled();
  expect(commands).toEqual(['clarify']);
  expect(session.conversation_id).toBeNull();
});

for (const code of ['AI_MODEL_UNSUPPORTED', 'AI_AUTH_FAILED', 'AI_RATE_LIMITED', 'AI_INVALID_RESPONSE'] as const) {
test(`Support configured banner and provider failure ${code} reflect backend status`, async ({ page }) => {
  const errorMessage = aiErrorMessages[code];
  await uiSession(page, 'student');
  const session: AssistantSession = { id: '11111111-1111-4111-8111-111111111112', status: 'AI_ACTIVE', phase: 'CATEGORY', provider_configured: true,
    provider_error: null, category: null, conversation_id: null, greeting: 'Xin chào, tôi có thể hỗ trợ bạn về vấn đề nào?',
    categories: [{ id: 'camera', label: 'Camera / Micro' }], topics: [], messages: [] };
  const commands: string[] = [];
  await page.route('**/api/v1/support-assistant/**', async route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().url().endsWith('/turns')) {
      const command = route.request().postDataJSON(); commands.push(command.action);
      if (command.action === 'category') { session.category = 'camera'; session.phase = 'DETAIL'; }
      else if (command.action === 'message' && command.text === 'alo') {
        session.category = null; session.phase = 'CATEGORY';
        session.messages.push({ id: 'greeting-1', user_text: 'alo', assistant_text: 'Xin chào! Bạn cần hỗ trợ vấn đề nào?', used_provider: false, sources: [], created_at: '2026-10-17T05:00:00Z' });
      }
      else if (command.action === 'message') {
        session.phase = 'UNAVAILABLE'; session.ai_error = { code, message: errorMessage };
        session.messages.push({ id: 'message-1', user_text: command.text, assistant_text: errorMessage, used_provider: true, sources: [], created_at: '2026-10-16T05:00:00Z' });
      }
    }
    return route.fulfill({ headers, json: { data: session } });
  });
  await page.goto('/student/help');
  await page.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
  await expect(page.getByText(session.greeting)).toBeVisible();
  await expect(page.getByText('Trợ lý AI hiện chưa được cấu hình', { exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Nhập vấn đề của bạn', exact: true }).fill('alo');
  await page.getByRole('button', { name: 'Gửi', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Xin chào! Bạn cần hỗ trợ vấn đề nào?');
  await expect(page.getByRole('button', { name: 'Liên hệ System Admin', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Camera / Micro', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nhập vấn đề của bạn', exact: true }).fill('Tôi không cấp được quyền camera');
  await page.getByRole('button', { name: 'Gửi', exact: true }).click();
  await expect(page.getByRole('log')).toContainText(errorMessage);
  await expect(page.getByRole('button', { name: 'Thử lại trợ lý AI', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Liên hệ System Admin', exact: true })).toBeVisible();
  expect(commands).toEqual(['message', 'category', 'message']);
  await expect(page.getByText('Trợ lý AI hiện chưa được cấu hình', { exact: true })).toHaveCount(0);
});
}
