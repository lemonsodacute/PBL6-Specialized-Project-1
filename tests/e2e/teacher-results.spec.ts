import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';

const examId = '22222222-2222-4222-8222-222222222222';
const attemptId = '33333333-3333-4333-8333-333333333333';
const studentId = '44444444-4444-4444-8444-444444444444';
const current = {
  student_id: studentId, student_code: 'TEST102', full_name: 'Sinh viên kiểm thử', attempt_id: attemptId,
  attempt_number: 1, status: 'submitted', started_at: '2026-10-10T01:00:00Z', submitted_at: '2026-10-10T01:20:00Z',
  score: '1.00', max_score: '15.00', correct_count: 1, total_questions: 15, objective_question_count: 15, pending_manual_count: 0,
};
function report() {
  const waiting = { ...current, student_id: 'waiting', student_code: 'TEST103', full_name: 'Sinh viên chưa làm', attempt_id: null, attempt_number: null,
    status: 'not_started', score: null, correct_count: null, started_at: null, submitted_at: null, attempts: [] };
  const active = { ...waiting, student_id: 'active', student_code: 'TEST104', full_name: 'Sinh viên đang làm', status: 'in_progress', attempt_id: 'active-attempt', attempt_number: 1 };
  return {
    exam: { id: examId, title: 'Đề kiểm thử kết quả', max_score: '15.00', max_attempts: 3, classes: [{ id: 'class-test', name: 'Lớp kiểm thử' }] },
    summary: { student_count: 3, submitted_count: 1, in_progress_count: 1, not_started_count: 1 },
    results: [{ ...current, attempts: [{ ...current }] }, waiting, active],
  };
}
const detail = {
  id: attemptId, exam_id: examId, exam_title: 'Đề kiểm thử kết quả', status: 'submitted', attempt_number: 1,
  student: { id: studentId, full_name: current.full_name, student_code: current.student_code },
  score: current.score, max_score: current.max_score, started_at: current.started_at, submitted_at: current.submitted_at,
  questions: [{ question_id: 'question-test', answer_id: 'answer-test', type: 'mcq_single', content: 'Câu hỏi thực từ API',
    options_json: { options: [{ id: 'a', text: 'Nội dung A' }, { id: 'b', text: 'Nội dung B' }] },
    student_answer: { selected_option_id: 'a' }, correct_answer: { correct_option_id: 'a' }, is_correct: true,
    points_awarded: '1.00', points: '1.00', explanation: null }],
};
async function setup(page: Page) {
  const state = await uiSession(page, 'teacher');
  state.exams = [{ id: examId, title: detail.exam_title, classes: [{ id: 'class-test', name: 'Lớp kiểm thử' }], questions_count: 15 }];
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role: 'teacher' })).toString('base64url')}.signature`, url: 'http://localhost:3000' }]);
  let data = report(); let status = 200; let calls = 0;
  await page.route(`**/api/v1/exams/${examId}/report*`, async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    calls++;
    expect(route.request().headers().authorization).toBe('Bearer synthetic-token');
    await route.fulfill({ status, headers: cors, json: status === 200 ? { data } : { error: { message: 'SQL_INTERNAL_SECRET', code: 'TEST_ERROR' } } });
  });
  await page.route(`**/api/v1/attempts/${attemptId}/result`, route => route.fulfill({ headers: cors, json: { data: detail } }));
  await page.route('**/api/v1/teacher/reports*', route => route.fulfill({ headers: cors, json: { data: {
    exams: [{ id: examId, title: detail.exam_title, classes: [] }], exam_id: null,
    completed_statuses: ['submitted', 'auto_submitted', 'terminated'], results: [],
    summary: { completed_attempts: 0, scored_attempts: 0, percentage_attempts: 0, average_percentage: null, average_score: null, max_score: null,
      total_violations: 0, browser_violation_count: 0, detection_count: 0, average_risk_score: null, risk_scored_attempts: 0, attempt_count: 0 },
  } } }));
  return { get data() { return data; }, set data(value) { data = value; }, set status(value: number) { status = value; }, get calls() { return calls; } };
}
const cors = { 'access-control-allow-origin': 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };

test('reports hub navigates to API results with real contract and correct detail', async ({ page }) => {
  test.setTimeout(120_000);
  const state = await setup(page);
  await page.goto('/dashboard/reports');
  await page.getByRole('link', { name: /^Xem kết quả —/ }).click();
  await expect(page).toHaveURL(new RegExp(`/exams/${examId}/attempts$`), { timeout: 45_000 });
  const row = page.getByRole('row').filter({ hasText: current.full_name });
  await expect(row).toContainText('TEST102'); await expect(row).toContainText('1 / 15'); await expect(row).toContainText('1/15');
  await expect(page.getByRole('row').filter({ hasText: 'Sinh viên chưa làm' })).toContainText('Chưa làm');
  await expect(page.getByRole('row').filter({ hasText: 'Sinh viên đang làm' })).toContainText('Đang làm');
  expect(state.calls).toBeGreaterThan(0);
  await row.getByRole('link', { name: 'Xem chi tiết' }).click();
  await expect(page.locator('main .page-context h1')).toHaveText(detail.exam_title,{ timeout: 45_000 });
  await expect(page.getByText('TEST102', { exact: true })).toBeVisible();
  await expect(page.getByText('1 / 15', { exact: true })).toBeVisible();
  await expect(page.getByText('Nội dung A', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Đúng', { exact: true })).toBeVisible();
});

test('both existing result URLs fetch backend, refresh shows new persisted response', async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/dashboard/exams/${examId}/report`);
  const row = page.getByRole('row').filter({ hasText: current.full_name });
  await expect(row).toContainText('1 / 15');
  state.data.results[0].score = '0.00'; state.data.results[0].attempts[0].score = '0.00';
  await page.getByRole('button', { name: 'Tải lại kết quả' }).click();
  await expect(row).toContainText('0 / 15');
  await page.reload(); await expect(row).toContainText('0 / 15');
  await page.goto(`/dashboard/exams/${examId}/attempts`); await expect(row).toContainText('0 / 15');
});

for (const status of [401, 403, 404, 500]) test(`API ${status} shows an error and never a sample table`, async ({ page }) => {
  const state = await setup(page); state.status = status;
  await page.goto(`/dashboard/exams/${examId}/attempts`);
  await expect(page.locator('main').getByRole('alert')).toBeVisible(); await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByText('SQL_INTERNAL_SECRET')).toHaveCount(0);
  state.status = 200; await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByRole('row').filter({ hasText: current.full_name })).toContainText('1 / 15');
});

test('multiple attempts show latest, history keeps prior score and correct detail URL', async ({ page }) => {
  const state = await setup(page);
  const earlier = { ...current }; const later = { ...current, attempt_id: 'later-attempt', attempt_number: 2, score: '0.00' };
  Object.assign(state.data.results[0], later, { attempts: [later, earlier] });
  await page.goto(`/dashboard/exams/${examId}/attempts`);
  const row = page.getByRole('row').filter({ hasText: current.full_name });
  await expect(row).toContainText('0 / 15');
  await page.getByRole('button', { name: 'Lịch sử 2 lần thi' }).click();
  const previous = page.getByRole('row').filter({ hasText: `${current.full_name} · Lần thi 1` });
  await expect(previous).toContainText('1 / 15');
  await expect(previous.getByRole('link', { name: 'Xem chi tiết' })).toHaveAttribute('href', `/dashboard/exams/${examId}/grade/${attemptId}`);
});

test('CSV contains returned zero scores and real identifiers, not demo export', async ({ page }) => {
  const state = await setup(page); state.data.results[0].attempts[0].score = '0.00';
  await page.goto(`/dashboard/exams/${examId}/attempts`);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất CSV' }).click();
  const result = await download; const stream = await result.createReadStream();
  let text = ''; for await (const chunk of stream!) text += chunk.toString();
  expect(text).toContain('TEST102'); expect(text).toContain('"0.00"'); expect(text).toContain('Sinh viên chưa làm');
});
