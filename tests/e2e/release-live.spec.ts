import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

type Demo = { actors: Record<string, { email: string; password: string }>; completed_attempt_id: string; class_id: string };
let demo: Demo;
test.use({ trace: 'off' });
const liveExpect = expect.configure({ timeout: 15000 });
test.describe('Release acceptance against real PostgreSQL and FastAPI', () => {
  test.skip(process.env.RELEASE_REAL_E2E !== '1', 'Explicit isolated QA database only; no API interception.');
  test.beforeAll(() => { demo = JSON.parse(fs.readFileSync(path.resolve('backend/private/release-qa/demo-accounts.json'), 'utf8')); });
  for (const [role, home] of [['student', '/student'], ['teacher', '/dashboard'], ['admin', '/admin']]) {
    test(`${role}: real login, refresh, role boundary and logout/back`, async ({ page }) => {
      await page.goto('/login');
      await page.getByLabel('Email', { exact: true }).fill(demo.actors[role].email);
      await page.getByLabel('Mật khẩu', { exact: true }).fill(demo.actors[role].password);
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
      await liveExpect(page).toHaveURL(new RegExp(home + '$'));
      await page.reload();
      await expect(page.getByRole('heading').first()).toBeVisible();
      await expect(page).toHaveURL(new RegExp(home + '$'));
      if (role !== 'admin') {
        await page.goto('/admin/student-cards');
        await expect(page).toHaveURL(new RegExp(home + '$'));
      }
      if (role === 'student') {
        await page.goto('/dashboard/question-banks');
        await expect(page).toHaveURL(/\/student$/);
        await page.goto('/student/attempts/' + demo.completed_attempt_id + '/result');
        await expect(page.getByText('3.5', { exact: false }).first()).toBeVisible();
      }
      await page.getByRole('button', { name: /Tài khoản của/ }).click();
      const loggedOut = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/logout'));
      await page.getByRole('menuitem', { name: 'Đăng xuất', exact: true }).click();
      expect((await loggedOut).status()).toBe(200);
      await liveExpect(page).toHaveURL(/\/login(?:\?|$)/);
      await page.goBack();
      await liveExpect(page).toHaveURL(/\/login(?:\?|$)/);
      const unauthorized = await page.request.get('http://localhost:8000/api/v1/auth/me');
      expect(unauthorized.status()).toBe(401);
    });
  }
  test('real Student answer survives refresh, submits and agrees with Teacher result', async ({ page, request }) => {
    test.setTimeout(150_000);
    const origin = 'http://localhost:8000/api/v1';
    const signedIn = await request.post(origin + '/auth/login', { data: { email: demo.actors.teacher.email, password: demo.actors.teacher.password } });
    expect(signedIn.status()).toBe(200);
    const teacher = await signedIn.json();
    const headers = { Authorization: `Bearer ${teacher.access_token}` };
    const post = async (route: string, data: unknown) => {
      const response = await request.post(origin + route, { headers, data });
      expect(response.status()).toBe(200);
      return (await response.json()).data;
    };
    const bank = await post('/question-banks', { name: 'QA: Real browser answer ' + Date.now() });
    const question = await post(`/question-banks/${bank.id}/questions`, { question_bank_id: bank.id, type: 'mcq_single',
      content: 'QA: Which protocol transfers web resources?', default_points: 2,
      options_json: { options: [{ id: 'a', text: 'HTTP' }, { id: 'b', text: 'SQL' }] }, correct_answer_json: { correct_option_id: 'a' } });
    const essay = await post(`/question-banks/${bank.id}/questions`, { question_bank_id: bank.id, type: 'essay',
      content: 'QA: Explain HTTP in one sentence.', default_points: 2 });
    const now = Date.now();
    const exam = await post('/exams', { title: 'QA: Real browser exam ' + now, start_time: new Date(now - 60000).toISOString(),
      end_time: new Date(now + 3600000).toISOString(), duration_minutes: 20, require_camera: false, require_mic: false,
      require_fullscreen: false, allow_review: true, shuffle_questions: false, shuffle_options: false });
    await post(`/exams/${exam.id}/questions`, { question_id: question.id, order_index: 0, points: 2 });
    await post(`/exams/${exam.id}/questions`, { question_id: essay.id, order_index: 1, points: 2 });
    await post(`/exam-assignments?exam_id=${exam.id}`, { class_id: demo.class_id });
    expect((await request.patch(`${origin}/exams/${exam.id}`, { headers, data: { status: 'published' } })).status()).toBe(200);
    let attemptId: string | undefined;
    try {
      await page.goto('/login');
      await page.getByLabel('Email', { exact: true }).fill(demo.actors.student.email);
      await page.getByLabel('Mật khẩu', { exact: true }).fill(demo.actors.student.password);
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
      await liveExpect(page).toHaveURL(/\/student$/);
      await page.goto(`/student/exams/${exam.id}/verify`);
      await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
      await page.getByRole('button', { name: 'Bắt đầu làm bài', exact: true }).click();
      await liveExpect(page).toHaveURL(/\/student\/attempts\/[0-9a-f-]+$/);
      attemptId = page.url().split('/').pop()!;
      const choiceSaved = page.waitForResponse(response => response.url().endsWith('/answers') && response.request().method() === 'PUT');
      await page.getByRole('radio', { name: 'HTTP', exact: true }).check();
      expect((await choiceSaved).status()).toBe(200);
      await page.getByRole('button', { name: 'Câu tiếp theo' }).click();
      const essayText = 'HTTP transfers web resources between clients and servers.';
      const essaySaved = page.waitForResponse(response => response.url().endsWith('/answers') && response.request().method() === 'PUT');
      await page.getByRole('textbox').fill(essayText);
      expect((await essaySaved).status()).toBe(200);
      // Also exercise the API's accepted object format when restoring an essay.
      expect((await page.request.post(`${origin}/attempts/${attemptId}/answers`, {
        data: { question_id: essay.id, answer_content: { text: essayText } },
      })).status()).toBe(200);
      await page.reload();
      await page.getByRole('button', { name: 'Câu tiếp theo' }).click();
      await expect(page.getByRole('textbox')).toHaveValue(essayText);
      await page.getByRole('button', { name: 'Câu trước' }).click();
      await liveExpect(page.getByRole('radio', { name: 'HTTP', exact: true })).toBeChecked();
      await page.getByRole('button', { name: 'Nộp bài', exact: true }).click();
      await page.getByRole('button', { name: 'Xác nhận nộp bài', exact: true }).click();
      await liveExpect(page).toHaveURL(new RegExp(`/student/attempts/${attemptId}/result$`));
      await expect(page.getByText('Đang chờ chấm', { exact: true }).first()).toBeVisible();
      const pending = (await (await request.get(`${origin}/attempts/${attemptId}/result`, { headers })).json()).data;
      const essayAnswer = pending.questions.find((item: { question_id: string }) => item.question_id === essay.id);
      expect((await request.patch(`${origin}/answers/${essayAnswer.answer_id}/grade`, { headers, data: { points_awarded: 1.5 } })).status()).toBe(200);
      await page.reload();
      await expect(page.getByText('3.5 / 4', { exact: true }).first()).toBeVisible();
      const studentResult = await page.request.get(`${origin}/attempts/${attemptId}/result`);
      const teacherResult = await request.get(`${origin}/attempts/${attemptId}/result`, { headers });
      expect(studentResult.status()).toBe(200); expect(teacherResult.status()).toBe(200);
      const mine = (await studentResult.json()).data, theirs = (await teacherResult.json()).data;
      expect(Number(mine.score)).toBe(3.5); expect(mine.score).toBe(theirs.score);
      const saved = await request.get(`${origin}/attempts/${attemptId}`, { headers });
      expect((await saved.json()).data.status).toBe('submitted');
      await page.goto('/student/exams');
      await expect(page.getByText(exam.title, { exact: true })).toHaveCount(0);
      await page.goto('/student/grades');
      await expect(page.getByRole('row').filter({ hasText: exam.title })).toContainText(/3[,.]5\s*\/\s*4/);
    } finally {
      if (attemptId) await page.request.post(`${origin}/attempts/${attemptId}/submit`).catch(() => undefined);
      await request.patch(`${origin}/exams/${exam.id}`, { headers, data: { status: 'closed' } });
    }
  });
});
