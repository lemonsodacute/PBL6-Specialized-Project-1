import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { uiSession } from './ui-fixtures';
import type { AssistantSession } from '../../lib/support-assistant';

test('teacher selects a real-data candidate and keeps data and documentation labels distinct', async ({ page }) => {
  await uiSession(page, 'teacher');
  const session: AssistantSession = { id: 'academic-session', status: 'AI_ACTIVE', phase: 'CATEGORY',
    provider_configured: true, category: null, conversation_id: null, greeting: 'Xin chào!', categories: [], topics: [], messages: [] };
  const questions: string[] = [];
  await page.route('**/api/v1/support-assistant/**', async route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().url().endsWith('/turns')) {
      const command = route.request().postDataJSON(); questions.push(command.text);
      session.phase = 'DATA';
      const message: AssistantSession['messages'][number] = { id: String(questions.length), user_text: command.text,
        assistant_text: '', used_provider: false, created_at: '2026-10-27T07:00:00Z',
        sources: [{ id: 'academic-data', kind: 'system_data', title: 'Dữ liệu hệ thống', route: '', steps: [] }] };
      if (questions.length === 1) {
        message.assistant_text = 'Tôi tìm thấy 2 sinh viên phù hợp. Bạn muốn xem sinh viên nào?';
        message.sources[0].choices = [
          { label: 'Nguyễn Châu Anh — 102220123 — Lập trình Web', value: 'MSSV 102220123' },
          { label: 'Trần Châu Anh — 102220184 — Cơ sở dữ liệu', value: 'MSSV 102220184' },
        ];
      } else if (questions.length === 2) {
        expect(command.text).toBe('MSSV 102220123');
        message.assistant_text = 'Nguyễn Châu Anh — MSSV 102220123\n• SQL giữa kỳ — lần 1: 8.0/10';
        message.sources[0].route = '/dashboard/reports/attempts/actual-attempt';
        message.sources[0].title = 'Xem chi tiết kết quả';
      } else {
        session.phase = 'FEEDBACK'; message.used_provider = true;
        message.assistant_text = 'Mở Báo cáo để xem kết quả đã lưu.';
        message.sources = [{ id: 'teacher-5', title: 'Xem điểm sinh viên', route: '/dashboard/reports', steps: [] }];
      }
      session.messages.push(message);
    }
    await route.fulfill({ headers, json: { data: session } });
  });
  await page.goto('/teacher/help');
  await page.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Nhập vấn đề của bạn', exact: true });
  await input.fill('cho tôi xem điểm của sinh viên châu anh');
  await page.getByRole('button', { name: 'Gửi', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Dữ liệu hệ thống');
  await expect(page.getByRole('log')).not.toContainText('Tài liệu hỗ trợ');
  await page.getByRole('button', { name: 'Nguyễn Châu Anh — 102220123 — Lập trình Web', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('8.0/10');
  await expect(page.getByRole('link', { name: 'Xem chi tiết kết quả' })).toHaveAttribute('href', '/dashboard/reports/attempts/actual-attempt');
  await expect(page.getByRole('button', { name: 'Vẫn gặp lỗi', exact: true })).toHaveCount(0);
  await input.fill('làm sao xem điểm sinh viên?');
  await page.getByRole('button', { name: 'Gửi', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Tài liệu hỗ trợ');
  await expect(page.getByRole('button', { name: 'Vẫn gặp lỗi', exact: true })).toBeVisible();
  expect(questions).toHaveLength(3);
});

test('student privacy denial stays a system-data response without result links', async ({ page }) => {
  await uiSession(page, 'student');
  await page.setViewportSize({ width: 390, height: 844 });
  const session: AssistantSession = { id: 'student-academic', status: 'AI_ACTIVE', phase: 'DATA', provider_configured: false,
    category: null, conversation_id: null, greeting: 'Xin chào!', categories: [], topics: [], messages: [{
      id: 'denied', user_text: 'điểm của người khác', assistant_text: 'Bạn chỉ có thể xem kết quả của chính mình.',
      used_provider: false, created_at: '2026-10-27T07:00:00Z',
      sources: [{ id: 'academic-data', kind: 'system_data', title: 'Dữ liệu hệ thống', route: '', steps: [] }],
    }] };
  await page.route('**/api/v1/support-assistant/**', async route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    await route.fulfill({ headers, status: route.request().method() === 'OPTIONS' ? 204 : 200, json: { data: session } });
  });
  await page.goto('/student/help');
  await page.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('chính mình');
  await expect(page.getByRole('log')).toContainText('Dữ liệu hệ thống');
  await expect(page.getByRole('log').getByRole('link')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('existing teacher asks the exact example through the real academic API', async ({ browser, request }, info) => {
  test.skip(process.env.SUPPORT_ACADEMIC_REAL !== '1', 'Requires the local PostgreSQL-backed API and private existing-account fixture.');
  test.setTimeout(90000);
  const fixture = JSON.parse(fs.readFileSync('backend/private/support-academic-validation.json', 'utf8'));
  const context = await browser.newContext();
  try {
    await context.addInitScript(({ user, token }) => {
      sessionStorage.setItem('ai-proctoring-current-user', JSON.stringify(user));
      sessionStorage.setItem('ai-proctoring-access-token', token);
    }, fixture);
    const page = await context.newPage();
    await page.goto('/teacher/help');
    await page.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Nhập vấn đề của bạn', exact: true });
    await input.fill('cho tôi xem điểm của sinh viên châu anh');
    const response = page.waitForResponse(r => r.url().includes('/support-assistant/sessions/') && r.url().endsWith('/turns') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Gửi', exact: true }).click();
    const data = (await (await response).json()).data;
    const last = data.messages.at(-1);
    expect(last.sources[0].kind).toBe('system_data');
    expect(last.sources[0].status).toBe(fixture.expected_status);
    expect(typeof last.used_provider).toBe('boolean');
    await expect(page.getByRole('log')).toContainText(last.assistant_text);
    await expect(page.getByRole('log')).toContainText('Dữ liệu hệ thống');
    await page.screenshot({ path: info.outputPath('existing-teacher-academic.png') });
    if (fixture.additional_query) {
      await input.fill(fixture.additional_query);
      await page.getByRole('button', { name: 'Gửi', exact: true }).click();
      await expect(page.getByRole('log')).toContainText(fixture.additional_answer);
      await page.screenshot({ path: info.outputPath('existing-authorized-scores.png') });
    }
    // Verify persisted values through the existing result API, not a mock.
    for (const result of fixture.results) {
      const actual = await request.get(`http://localhost:8000/api/v1/attempts/${result.attempt_id}/result`, { headers: { Authorization: `Bearer ${fixture.token}` } });
      expect(actual.ok()).toBe(true);
      expect(Number((await actual.json()).data.score)).toBe(Number(result.score));
    }
  } finally { await context.close(); }
});
