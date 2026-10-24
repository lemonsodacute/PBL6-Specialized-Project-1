import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';

const examA = '22222222-2222-4222-8222-222222222222';
const examB = '55555555-5555-4555-8555-555555555555';
const attemptId = '33333333-3333-4333-8333-333333333333';
const cors = { 'access-control-allow-origin': 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,OPTIONS' };
const rowA = { attempt_id: attemptId, exam_id: examA, exam_title: 'Đề A từ API', student_id: 'student-a', student_code: 'TEST-A', full_name: 'Sinh viên API A',
  attempt_number: 1, status: 'submitted', score: '12.50', max_score: '15.00', percentage: '83.3333',
  started_at: '2026-10-10T01:00:00Z', submitted_at: '2026-10-10T01:20:00Z',
  violation_count: 2, browser_violation_count: 1, detection_count: 1, risk_score: '38.00' };
const rowB = { ...rowA, attempt_id: 'attempt-b', exam_id: examB, exam_title: 'Đề B từ API', student_code: 'TEST-B', full_name: 'Sinh viên API B', score: '14.00', max_score: '17.00', percentage: '82.3529', violation_count: 0, browser_violation_count: 0, detection_count: 0, risk_score: null };
function response(selected = '') {
  const rows = selected === examA ? [rowA] : selected === examB ? [rowB] : [rowA, rowB];
  return { exam_id: selected || null, exams: [{ id: examA, title: rowA.exam_title, classes: [] }, { id: examB, title: rowB.exam_title, classes: [] }],
    completed_statuses: ['submitted', 'auto_submitted', 'terminated'], results: rows.map(row => ({ ...row })),
    summary: { completed_attempts: rows.length, scored_attempts: rows.length, percentage_attempts: rows.length,
      average_percentage: selected === examA ? '83.33' : selected === examB ? '82.35' : '82.84',
      average_score: selected === examA ? '12.50' : selected === examB ? '14.00' : null,
      max_score: selected === examA ? '15.00' : selected === examB ? '17.00' : null,
      total_violations: selected === examB ? 0 : 2, browser_violation_count: selected === examB ? 0 : 1,
      detection_count: selected === examB ? 0 : 1, average_risk_score: selected === examB ? null : '38.00',
      risk_scored_attempts: selected === examB ? 0 : 1, attempt_count: rows.length } };
}
async function setup(page: Page) {
  const session=await uiSession(page, 'teacher');session.exams=[{id:examA,title:rowA.exam_title},{id:examB,title:rowB.exam_title}];
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role: 'teacher' })).toString('base64url')}.signature`, url: 'http://localhost:3000' }]);
  const state = { status: 200, empty: false, calls: [] as string[], override: null as ReturnType<typeof response> | null, gates: {} as Partial<Record<string, Promise<void>>> };
  await page.route('**/api/v1/teacher/reports*', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const selected = new URL(route.request().url()).searchParams.get('exam_id') || ''; state.calls.push(selected);
    expect(route.request().headers().authorization).toBe('Bearer synthetic-token');
    const data = state.override ?? response(selected);
    if (state.empty) { data.results = []; Object.assign(data.summary, { completed_attempts: 0, scored_attempts: 0, percentage_attempts: 0,
      average_percentage: null, average_score: null, max_score: null, total_violations: 0, browser_violation_count: 0, detection_count: 0,
      average_risk_score: null, risk_scored_attempts: 0, attempt_count: 0 }); }
    if(new URL(route.request().url()).searchParams.get('format')==='csv') {
      const lines=['Exam,MSSV,Student Name,Score,Percentage,Risk Score',...data.results.map(row=>[row.exam_title,row.student_code,row.full_name,row.score,row.percentage,row.risk_score].join(','))];
      return route.fulfill({headers:{...cors,'content-type':'text/csv'},body:lines.join('\n')});
    }
    if (state.gates[selected]) await state.gates[selected];
    await route.fulfill({ status: state.status, headers: cors, json: state.status === 200 ? { data } : { error: { code: 'TEST', message: 'PRIVATE_DATABASE_ERROR' } } });
  });
  await page.route(`**/api/v1/reports/attempts/${attemptId}*`, route => route.fulfill({ headers: cors, json: { data: { ...rowA,
    events: [{ id: 'v1', source: 'browser', type: 'tab_switch', severity: 'low', occurred_at: rowA.started_at, confidence: null },
      { id: 'd1', source: 'detector', type: 'face_not_detected', severity: 'medium', occurred_at: rowA.submitted_at, confidence: '0.90' }] } } }));
  return state;
}

test('reports filter uses real IDs, mixed-scale average and filtered CSV', async ({ page }) => {
  const state = await setup(page); await page.goto('/dashboard/reports');
  await expect(page.getByText('82,84%', { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'TEST-A' })).toContainText('12,5 / 15');
  await expect(page.getByRole('row').filter({ hasText: 'TEST-B' })).toContainText('14 / 17');
  await page.getByLabel('Đề thi', { exact: true }).selectOption(examA);
  await expect(page.getByRole('row').filter({ hasText: 'TEST-B' })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'TEST-A' })).toBeVisible();
  expect(state.calls).toContain(examA);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Xuất CSV' }).click();
  const file = await download; const stream = await file.createReadStream(); let csv = ''; for await (const chunk of stream!) csv += chunk.toString();
  expect(csv).toContain('Exam'); expect(csv).toContain('Percentage'); expect(csv).toContain('TEST-A'); expect(csv).toContain('12.50'); expect(csv).toContain('38.00'); expect(csv).not.toContain('TEST-B');
  await page.getByRole('row').filter({ hasText: 'TEST-A' }).getByRole('link', { name: 'Xem', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Chi tiết báo cáo' })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('TEST-A', { exact: true })).toBeVisible();
  await expect(page.getByText('12,5 / 15', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Sự kiện giám sát' })).toContainText('Chuyển tab');
  await expect(page.getByRole('region', { name: 'Sự kiện giám sát' })).toContainText('Không thấy khuôn mặt');
  await expect(page.getByRole('link', { name: /Xem bài làm và đáp án/ })).toHaveAttribute('href', `/dashboard/exams/${examA}/grade/${attemptId}`);
});

test('empty report has no demo rows, zero counts and no fake risk score', async ({ page }) => {
  const state = await setup(page); state.empty = true; await page.goto('/dashboard/reports');
  await expect(page.getByText('Chưa có kết quả bài thi.', { exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByText('Chưa ghi nhận vi phạm trong phạm vi đang chọn.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xuất CSV' })).toBeDisabled();
  await expect(page.getByLabel('Thống kê báo cáo')).toContainText('0');
  await expect(page.getByText(/Chưa có dữ liệu đánh giá rủi ro/)).toBeVisible();
});

for (const status of [401, 403, 500]) test(`API ${status} hides data and allows retry`, async ({ page }) => {
  const state = await setup(page); state.status = status; await page.goto('/dashboard/reports');
  await expect(page.locator('main').getByRole('alert')).toBeVisible({timeout:30_000}); await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByText('PRIVATE_DATABASE_ERROR')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Xuất CSV' })).toBeDisabled();
  state.status = 200; await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'TEST-A' })).toBeVisible();
});

test('latest filter wins out-of-order response and refresh replaces stale rows', async ({ page }) => {
  const state = await setup(page); await page.goto('/dashboard/reports');
  await expect(page.getByRole('row').filter({ hasText: 'TEST-A' })).toBeVisible();
  let release!: () => void; state.gates[examA] = new Promise<void>(resolve => { release = resolve; });
  await page.getByLabel('Đề thi', { exact: true }).selectOption(examA);
  await expect.poll(() => state.calls.includes(examA)).toBe(true);
  await page.getByLabel('Đề thi', { exact: true }).selectOption(examB);
  await expect(page.getByRole('row').filter({ hasText: 'TEST-B' })).toBeVisible(); release();
  await expect(page.getByRole('row').filter({ hasText: 'TEST-A' })).toHaveCount(0);
  await expect(page.getByText('Chưa ghi nhận vi phạm trong phạm vi đang chọn.')).toBeVisible();
  state.override = response(examB); state.override.results[0].score = '0.00';
  await page.getByRole('button', { name: 'Tải lại báo cáo' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'TEST-B' })).toContainText('0 / 17');
});
