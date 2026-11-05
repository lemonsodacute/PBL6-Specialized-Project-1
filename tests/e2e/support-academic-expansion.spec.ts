import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { uiSession } from './ui-fixtures';
import type { AssistantSession } from '../../lib/support-assistant';

test('compact academic summaries preserve percentages, human-review wording and attempt links on mobile', async ({ page }, info) => {
  await uiSession(page, 'teacher');
  await page.setViewportSize({ width: 390, height: 844 });
  const session: AssistantSession = {
    id: 'academic-expansion', status: 'AI_ACTIVE', phase: 'DATA', category: null, conversation_id: null,
    provider_configured: true, greeting: 'Xin chào!', categories: [], topics: [], messages: [{
      id: 'summary', user_text: 'Ai dưới 50%?', created_at: '2026-10-28T00:00:00Z', used_provider: true,
      assistant_text: 'SQL giữa kỳ\nCó 1 sinh viên dưới 50%.\n• Sinh viên fixture — MSSV TEST01 · 8/20 — 40%',
      sources: [{ id: 'academic-data', kind: 'system_data', title: 'Xem kết quả', route: '/dashboard/exams/fixture-exam/report', steps: [] }],
    }, {
      id: 'alerts', user_text: 'Cảnh báo giám sát?', created_at: '2026-10-28T00:01:00Z', used_provider: false,
      assistant_text: 'Sinh viên fixture có 3 cảnh báo giám sát · Cao nhất: Cao.\nCảnh báo là sự kiện cần xem xét; giảng viên là người đánh giá cuối cùng.',
      sources: [{ id: 'academic-data', kind: 'system_data', title: 'Xem báo cáo giám sát', route: '/dashboard/monitor/fixture-exam', steps: [],
        links: [{ label: 'Giám sát Sinh viên fixture · SQL giữa kỳ — lần 1', route: '/dashboard/monitor/fixture-exam/fixture-attempt' }] }],
    }],
  };
  await page.route('**/api/v1/support-assistant/**', route => route.fulfill({
    status: route.request().method() === 'OPTIONS' ? 204 : 200,
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000',
      'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS' }, json: { data: session },
  }));
  await page.goto('/teacher/help');
  await page.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
  const log = page.getByRole('log');
  await expect(log).toContainText('8/20 — 40%');
  await expect(log).toContainText('Dữ liệu hệ thống');
  await expect(log).not.toContainText('Tài liệu hỗ trợ');
  await expect(log).not.toContainText('gian lận');
  await expect(log).toContainText('giảng viên là người đánh giá cuối cùng');
  await expect(page.getByRole('link', { name: 'Xem báo cáo giám sát' })).toHaveAttribute('href', '/dashboard/monitor/fixture-exam');
  await expect(page.getByRole('link', { name: 'Giám sát Sinh viên fixture · SQL giữa kỳ — lần 1' })).toHaveAttribute('href', '/dashboard/monitor/fixture-exam/fixture-attempt');
  await expect(page.getByRole('button', { name: 'Vẫn gặp lỗi', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('academic-mobile.png') });
});

test('exam clarification submits the exact authorized choice and permits a follow-up', async ({ page }) => {
  await uiSession(page, 'teacher');
  const session: AssistantSession = { id: 'exam-choice', status: 'AI_ACTIVE', phase: 'DATA',
    provider_configured: true, category: null, conversation_id: null, greeting: 'Xin chào!', categories: [], topics: [], messages: [{
      id: 'choice', user_text: 'Ai chưa thi?', assistant_text: 'Bạn muốn kiểm tra đề thi nào?', used_provider: false,
      created_at: '2026-10-28T00:00:00Z', sources: [{ id: 'academic-data', kind: 'system_data', title: 'Dữ liệu hệ thống', route: '', steps: [],
        choices: [{ label: 'SQL giữa kỳ — Nhóm 1', value: 'Kỳ thi 11111111-1111-4111-8111-111111111111' }] }],
    }] };
  const questions: string[] = [];
  await page.route('**/api/v1/support-assistant/**', async route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000',
      'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().url().endsWith('/turns')) {
      const command = route.request().postDataJSON(); questions.push(command.text);
      session.messages.push({ id: String(questions.length), user_text: command.text, used_provider: false,
        assistant_text: 'SQL giữa kỳ\nKhông có sinh viên nào chưa nộp bài trong đề này.', created_at: '2026-10-28T00:00:00Z',
        sources: [{ id: 'academic-data', kind: 'system_data', title: 'Xem kết quả', route: '/dashboard/exams/11111111-1111-4111-8111-111111111111/report', steps: [] }] });
    }
    return route.fulfill({ headers, json: { data: session } });
  });
  await page.goto('/teacher/help');
  await page.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
  await page.getByRole('button', { name: 'SQL giữa kỳ — Nhóm 1', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Không có sinh viên nào');
  await expect(page.getByRole('button', { name: 'SQL giữa kỳ — Nhóm 1', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Nhập vấn đề của bạn', exact: true }).fill('Còn bao nhiêu sinh viên chưa nộp?');
  await page.getByRole('button', { name: 'Gửi', exact: true }).click();
  await expect.poll(() => questions.length).toBe(2);
  expect(questions).toEqual(['Kỳ thi 11111111-1111-4111-8111-111111111111', 'Còn bao nhiêu sinh viên chưa nộp?']);
});

test('existing teacher queries expanded academic data through the real API', async ({ browser }, info) => {
  test.skip(process.env.SUPPORT_ACADEMIC_EXPANSION_REAL !== '1', 'Requires existing-account private fixture and local PostgreSQL API.');
  test.setTimeout(180000);
  const fixture = JSON.parse(fs.readFileSync('backend/private/support-academic-expansion-validation.json', 'utf8'));
  const context = await browser.newContext();
  try {
    await context.addInitScript(({ user, token }) => {
      sessionStorage.setItem('ai-proctoring-current-user', JSON.stringify(user));
      sessionStorage.setItem('ai-proctoring-access-token', token);
    }, fixture);
    const page = await context.newPage();
    await page.goto('/teacher/help');
    await page.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
    for (const item of fixture.cases) {
      await page.getByRole('textbox', { name: 'Nhập vấn đề của bạn', exact: true }).fill(item.question);
      const response = page.waitForResponse(r => r.url().includes('/support-assistant/sessions/') && r.url().endsWith('/turns') && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Gửi', exact: true }).click();
      const result = await response;
      expect(result.ok()).toBe(true);
      const last = (await result.json()).data.messages.at(-1);
      expect(last.sources[0].kind).toBe('system_data');
      expect(last.sources[0].status).toBe(item.status);
      // The LLM may arrange trusted fact blocks but cannot change or omit one.
      expect(last.assistant_text.split('\n').filter(Boolean).sort()).toEqual(item.answer.split('\n').filter(Boolean).sort());
      await expect(page.getByRole('log')).toContainText(last.assistant_text);
      if (item.sources[0].route) {
        await expect(page.getByRole('log').locator(`a[href="${item.sources[0].route}"]`).last()).toBeVisible();
      }
    }
    await page.screenshot({ path: info.outputPath('existing-teacher-expanded-data.png') });
  } finally { await context.close(); }
});
