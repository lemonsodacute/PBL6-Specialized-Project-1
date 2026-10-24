import { expect, test, type Page, type Route } from '@playwright/test';
import { uiSession } from './ui-fixtures';

const bankId = '33333333-3333-4333-8333-333333333333';
const examId = '44444444-4444-4444-8444-444444444444';
const bank = { id: bankId, name: 'Lập trình Web', subject: 'Công nghệ thông tin', questions_count: 90 };
async function respond(route: Route, data: unknown, status = 200) {
  const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3100', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS' };
  return route.fulfill({ status, headers, json: status >= 400 ? data : { data } });
}
async function setup(page: Page) {
  const session = await uiSession(page, 'teacher');
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role: 'teacher' })).toString('base64url')}.fixture`, url: test.info().project.use.baseURL! }]);
  const questions = Array.from({ length: 90 }, (_, index) => {
    const topic = index < 40 ? 'HTML' : index < 70 ? 'CSS' : 'JavaScript';
    return { id: `55555555-5555-4555-8555-${String(index + 1).padStart(12, '0')}`, question_bank_id: bankId,
      content: `${topic} Câu ${String(index + 1).padStart(3, '0')} — Nội dung cần đọc trước khi lựa chọn`, type: index % 7 ? 'mcq_single' : 'essay',
      difficulty: index < 40 ? 'easy' : index < 70 ? 'medium' : 'hard', topic, is_active: true, default_points: 2,
      options_json: { options: ['A', 'B'] }, correct_answer_json: { answer: 'A' }, explanation: null };
  });
  const exam = { id: examId, title: 'Đề nháp Web', description: '', status: 'draft', start_time: '2026-12-25T01:00:00Z', end_time: '2026-12-25T03:00:00Z', duration_minutes: 60, classes: [], questions_count: 3, require_camera: true,
    questions: questions.slice(0, 3).map(q => ({ ...q, points: 2.5 })) };
  const state = { session, questions, exam, banks: [{ ...bank }], calls: [] as { path: string; method: string; body: any }[], failSelectionOnce: false, failQuestionId: '', assignments: [] as { id: string; class_id: string }[], created: 0 };
  await page.route('**/api/v1/auth/me', async route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3100', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,PATCH,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON(); state.calls.push({ path: '/auth/me', method: 'PATCH', body });
      state.session.user.phone = body.phone;
    }
    return route.fulfill({ headers, json: { user: state.session.user } });
  });
  await page.route('**/api/v1/question-banks**', async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/api/v1', ''), method = route.request().method();
    if (method === 'OPTIONS') return respond(route, {});
    const body = method === 'GET' ? null : route.request().postDataJSON();
    if (method !== 'GET') state.calls.push({ path, method, body });
    if (path.endsWith('/random-select')) {
      const pool = questions.filter(q => q.is_active && !body.exclude_ids.includes(q.id) && (!body.question_type || q.type === body.question_type) && (!body.difficulty || q.difficulty === body.difficulty) && (!body.topic || q.topic === body.topic));
      const groupField = body.difficulty_counts ? 'difficulty' : 'topic';
      const groups = body.difficulty_counts ?? body.topic_counts;
      const rows = groups ? Object.entries(groups).map(([key, count]) => ({ key, count: count as number, pool: pool.filter(q => q[groupField] === key) })) : [{ key: 'phù hợp', count: body.count, pool }];
      const shortage = rows.find(row => row.pool.length < row.count);
      if (shortage) return respond(route, { error: { code: 'NOT_ENOUGH_QUESTIONS', message: `Ngân hàng chỉ có ${shortage.pool.length} câu ${shortage.key} nhưng bạn yêu cầu ${shortage.count} câu.` } }, 400);
      return respond(route, rows.flatMap(row => row.pool.slice(0, row.count)));
    }
    if (path.includes('/questions/') && method !== 'GET') {
      const q = questions.find(q => q.id === path.split('/').pop())!;
      if (state.failQuestionId === q.id) { state.failQuestionId = ''; return respond(route, { error: { code: 'SYNTHETIC_FAILURE', message: 'Internal error' } }, 503); }
      if (method === 'DELETE') q.is_active = false; else Object.assign(q, body);
      return respond(route, q);
    }
    if (path.endsWith('/questions')) {
      if (method === 'POST') { const q = { ...questions[0], ...body, id: '66666666-6666-4666-8666-666666666666' }; questions.push(q); return respond(route, q); }
      const params=new URL(route.request().url()).searchParams;
      const matches=questions.filter(q=>q.question_bank_id===path.split('/')[2]&&(!params.get('q')||q.content.toLowerCase().includes(params.get('q')!.toLowerCase()))&&(!params.get('type')||q.type===params.get('type'))&&(!params.get('topic')||q.topic===params.get('topic'))&&(!params.get('difficulty')||q.difficulty===params.get('difficulty'))&&(!params.get('is_active')||q.is_active===(params.get('is_active')==='true')));
      if(!params.has('page'))return respond(route,matches);
      const pageNumber=Number(params.get('page')),limit=Number(params.get('limit')||20);
      return route.fulfill({headers:{'access-control-allow-origin':route.request().headers().origin??'http://localhost:3000','access-control-allow-credentials':'true','access-control-allow-headers':'authorization,content-type'},json:{data:matches.slice((pageNumber-1)*limit,pageNumber*limit),meta:{total:matches.length,page:pageNumber,limit,topics:Array.from(new Set(questions.map(q=>q.topic).filter(Boolean))).sort(),has_difficulty:questions.some(q=>q.difficulty)}}});
    }
    if (path === '/question-banks' && method === 'POST') { const newBank = { ...bank, ...body, id: '77777777-7777-4777-8777-777777777777', questions_count: 0 }; state.banks.push(newBank); return respond(route, newBank); }
    if (path !== '/question-banks') {
      const current = state.banks.find(item => item.id === path.split('/')[2]);
      if (!current) return respond(route, { error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
      if (method === 'PATCH') Object.assign(current, body);
      if (method === 'DELETE') { state.banks = state.banks.filter(item => item.id !== current.id); return respond(route, { deleted: true }); }
      return respond(route, { ...current, questions: questions.filter(q => q.question_bank_id === current.id) });
    }
    return respond(route, state.banks);
  });
  await page.route('**/api/v1/exams**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', ''), method = route.request().method();
    if (method === 'OPTIONS') return respond(route, {});
    const body = method === 'GET' ? null : route.request().postDataJSON();
    if (method !== 'GET') state.calls.push({ path, method, body });
    if (method === 'PUT') {
      if (state.failSelectionOnce) { state.failSelectionOnce = false; return respond(route, { error: { code: 'SYNTHETIC_FAILURE', message: 'Internal error' } }, 503); }
      state.exam.questions = body.question_ids.map((id: string) => ({ ...questions.find(q => q.id === id)!, points: state.exam.questions.find(q => q.id === id)?.points ?? 1 }));
      state.exam.questions_count = body.question_ids.length;
      return respond(route, { question_ids: body.question_ids });
    }
    if (method === 'POST') { state.created++; Object.assign(state.exam, body); return respond(route, state.exam); }
    if (method === 'PATCH') Object.assign(state.exam, body);
    return respond(route, path === '/exams' ? [state.exam] : state.exam);
  });
  await page.route('**/api/v1/exam-assignments**', route => respond(route, state.assignments));
  return state;
}
async function noOverflow(page: Page, region?: ReturnType<Page['locator']>) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if (region) {
    const rect = (await region.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1);
    expect(await region.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
}
for (const width of [320, 375, 768, 1024, 1440]) {
  test(`teacher profile, question filters and selection fit ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /^Tài khoản của/ }).click();
    await page.getByRole('menuitem', { name: 'Hồ sơ giảng viên', exact: true }).click();
    await expect(page).toHaveURL(/\/teacher\/profile$/,{timeout:30_000});
    await expect(page.getByRole('heading', { name: 'Thông tin giảng viên', exact: true })).toBeVisible();await expect(page.locator('main h1')).toHaveCount(0);
    await expect(page.getByText('Giảng viên', { exact: true }).first()).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`teacher-profile-${width}.png`), fullPage: true });
    await page.goto('/dashboard/question-banks');
    await expect(page.getByRole('combobox', { name: 'Ngân hàng câu hỏi', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Mở ngân hàng Lập trình Web', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Chọn tất cả 90 kết quả', exact: true })).toBeVisible({timeout:30_000});
    await page.getByRole('checkbox', { name: 'Chọn tất cả trên trang', exact: true }).check();
    await expect(page.locator('.selection-bulk-actions')).toContainText('Đã chọn: 20 câu');
    await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
    await page.locator('.selector-question-choice input').first().check();
    await expect(page.locator('.selection-bulk-actions')).toContainText('Đã chọn: 21 câu');
    await page.getByRole('button', { name: 'Trang trước', exact: true }).click();
    await expect(page.locator('.selector-question-choice input').first()).toBeChecked();
    await page.getByLabel('Tìm theo nội dung', { exact: true }).fill('HTML');
    await page.getByRole('button', { name: 'Chọn tất cả 40 kết quả', exact: true }).click();
    await expect(page.locator('.selection-bulk-actions')).toContainText('Đã chọn: 40 câu');
    await noOverflow(page, page.locator('.question-selector'));
    await page.screenshot({ path: testInfo.outputPath(`bank-${width}.png`), fullPage: true });
    await page.goto('/dashboard/exams');
    await page.getByRole('button', { name: '+ Tạo đề thi', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Tạo đề thi' });
    await dialog.getByRole('combobox', { name: 'Ngân hàng câu hỏi', exact: true }).selectOption(bankId);
    await dialog.getByRole('button', { name: 'Chọn tất cả 90 kết quả', exact: true }).click();
    await dialog.getByRole('button', { name: 'Xem câu đã chọn', exact: true }).click();
    await dialog.getByRole('region', { name: 'Câu hỏi đã chọn', exact: true }).getByRole('button', { name: 'Xem', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: 'Chi tiết câu hỏi' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Chi tiết câu hỏi' })).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await noOverflow(page, dialog);
    await page.screenshot({ path: testInfo.outputPath(`selector-${width}.png`) });
  });
}

test('teacher can save and clear own phone; profile has no invented fields', async ({ page }) => {
  const state = await setup(page);
  state.session.user.phone = null as unknown as string;
  await page.goto('/teacher/profile');
  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true }).click();
  await page.getByLabel('Số điện thoại', { exact: true }).fill('0012345678');
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  await expect(page.getByText('0012345678', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('0012345678', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true }).click();
  await page.getByLabel('Số điện thoại', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  expect(state.calls.filter(call => call.path === '/auth/me').map(call => call.body)).toEqual([
    { full_name: state.session.user.full_name, phone: '0012345678' }, { full_name: state.session.user.full_name, phone: null },
  ]);
  await expect(page.getByText('Mã giảng viên', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Vai trò' })).toHaveCount(0);
});

test('random distributions, replacement and shortages stay in preview until save', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/dashboard/exams');
  await page.getByRole('button', { name: '+ Tạo đề thi', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Tạo đề thi' });
  await dialog.getByRole('combobox', { name: 'Ngân hàng câu hỏi', exact: true }).selectOption(bankId);
  await dialog.getByRole('button', { name: 'Chọn nhanh / Ngẫu nhiên', exact: true }).click();
  await dialog.getByRole('button', { name: 'Đề 30 câu cơ bản', exact: true }).click();
  await dialog.getByRole('button', { name: 'Chọn ngẫu nhiên', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Câu hỏi đã chọn', exact: true }).locator('li')).toHaveCount(30);
  await dialog.getByRole('button', { name: 'Lưu cấu hình', exact: true }).click();
  const first = state.calls.find(call => call.path.endsWith('/random-select'))!;
  expect(first.body.difficulty_counts).toEqual({ easy: 10, medium: 15, hard: 5 });
  const old = await dialog.locator('.selected-question-list li p').first().textContent();
  await dialog.getByRole('button',{name:/^Thao tác câu đã chọn:/}).first().click();
  await page.getByRole('menuitem',{name:'Thay câu',exact:true}).click();
  await expect(dialog.locator('.selected-question-list li p').first()).not.toHaveText(old!);
  expect(state.calls.filter(call => call.path.endsWith('/random-select')).at(-1)!.body.exclude_ids.length).toBe(30);
  await dialog.getByRole('combobox', { name: 'Cách chọn', exact: true }).selectOption('count');
  await dialog.getByLabel('Số câu', { exact: true }).fill('100');
  await dialog.getByRole('button', { name: 'Chọn ngẫu nhiên', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Ngân hàng chỉ có');
  await expect(dialog.getByRole('region', { name: 'Câu hỏi đã chọn', exact: true }).locator('li')).toHaveCount(30);
  expect(state.calls.filter(call => call.path.startsWith('/exams'))).toHaveLength(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '+ Tạo đề thi', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Ngân hàng câu hỏi', exact: true }).selectOption(bankId);
  await dialog.getByRole('button', { name: 'Chọn nhanh / Ngẫu nhiên', exact: true }).click();
  await dialog.getByRole('button', { name: 'Dùng cấu hình đã lưu', exact: true }).click();
  await expect(dialog.getByLabel('Dễ', { exact: true })).toHaveValue('10');
});

test('bulk topic update and soft deletion use existing authorized APIs', async ({ page }) => {
  test.setTimeout(90_000); // Two batches of 20 existing per-question API writes.
  const state = await setup(page);
  await page.goto(`/dashboard/question-banks/${bankId}`);
  await page.getByRole('checkbox', { name: 'Chọn tất cả trên trang', exact: true }).check();
  await page.getByRole('button',{name:'Thao tác các câu đã chọn'}).click();await page.getByRole('menuitem', { name: 'Chuyển chủ đề', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Chủ đề mới', { exact: true }).fill('Chương mới');
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 });
  expect(state.calls.filter(call => call.method === 'PATCH' && call.path.includes('/questions/'))).toHaveLength(20);
  await page.getByRole('combobox', { name: 'Chủ đề / chương', exact: true }).selectOption('Chương mới');
  await page.getByRole('button', { name: 'Chọn tất cả 20 kết quả', exact: true }).click();
  await page.getByRole('button',{name:'Thao tác các câu đã chọn'}).click();await page.getByRole('menuitem', { name: 'Xóa đã chọn', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole('combobox', { name: 'Trạng thái câu hỏi', exact: true }).selectOption('active');
  await expect(page.getByText('Không tìm thấy kết quả phù hợp.', { exact: true })).toBeVisible();
  expect(state.questions.filter(q => !q.is_active)).toHaveLength(20);
});

test('bank selection transfers to create preview without saving an exam', async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/dashboard/question-banks/${bankId}`);
  await page.getByRole('checkbox', { name: 'Chọn tất cả trên trang', exact: true }).check();
  await page.getByRole('button', { name: 'Thêm vào đề', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Tiếp tục tạo đề', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/exams\?create=1/,{timeout:45_000});
  const dialog = page.getByRole('dialog', { name: 'Tạo đề thi' });
  await expect(dialog).toBeVisible({timeout:45_000});
  await expect(dialog.locator('.selection-summary-panel > summary')).toHaveText('Đã chọn: 20 câu');
  expect(state.created).toBe(0);
  expect(state.calls.filter(call => call.path.startsWith('/exams'))).toHaveLength(0);
});

test('draft editing removes selected questions and keeps other question points', async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/dashboard/exams/${examId}`);
  await expect(page.locator('.selector-question-choice input').first()).toBeChecked();
  await page.locator('.selector-question-choice input').first().uncheck();
  await page.locator('.selector-question-choice input').nth(5).check();
  await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/exams$/);
  const saved = state.calls.find(call => call.method === 'PUT')!;
  expect(saved.body.question_ids).toEqual([state.questions[1].id, state.questions[2].id, state.questions[5].id]);
  expect(state.exam.questions.map(q => q.points)).toEqual([2.5, 2.5, 1]);
});

test('retry after draft creation does not create a duplicate exam', async ({ page }) => {
  const state = await setup(page); state.failSelectionOnce = true;
  await page.goto('/dashboard/exams');
  await page.getByRole('button', { name: '+ Tạo đề thi', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Tạo đề thi' });
  await dialog.getByLabel('Tên đề thi', { exact: true }).fill('Đề mới');
  await dialog.getByLabel('Bắt đầu', { exact: true }).fill('2026-12-25T08:00');
  await dialog.getByLabel('Kết thúc', { exact: true }).fill('2026-12-25T10:00');
  await dialog.getByRole('combobox', { name: 'Ngân hàng câu hỏi', exact: true }).selectOption(bankId);
  await dialog.locator('.selector-question-choice input').first().check();
  await dialog.getByRole('button', { name: 'Lưu nháp', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Không thể lưu đề thi.');
  await dialog.getByRole('button', { name: 'Lưu nháp', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.created).toBe(1);
});

test('topic distribution and replace-all keep exact counts without duplicates', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/dashboard/exams');
  await page.getByRole('button', { name: '+ Tạo đề thi', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Tạo đề thi' });
  await dialog.getByRole('combobox', { name: 'Ngân hàng câu hỏi', exact: true }).selectOption(bankId);
  await dialog.getByRole('button', { name: 'Chọn nhanh / Ngẫu nhiên', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Cách chọn', exact: true }).selectOption('topic');
  for (const [topic, count] of [['HTML', '5'], ['CSS', '5'], ['JavaScript', '10']]) await dialog.getByLabel(topic, { exact: true }).fill(count);
  await dialog.getByRole('button', { name: 'Chọn ngẫu nhiên', exact: true }).click();
  await expect(dialog.locator('.selected-question-list li')).toHaveCount(20);
  const old = await dialog.locator('.selected-question-list li p').allTextContents();
  await dialog.getByRole('button', { name: 'Thay tất cả ngẫu nhiên', exact: true }).click();
  await expect(dialog.locator('.selected-question-list li p').first()).not.toHaveText(old[0]);
  const values = await dialog.locator('.selected-question-list li p').allTextContents();
  expect(values).toHaveLength(20); expect(new Set(values).size).toBe(20);
  expect(values.some(value => old.includes(value))).toBe(false);
  const requests = state.calls.filter(call => call.path.endsWith('/random-select'));
  expect(requests[0].body.topic_counts).toEqual({ CSS: 5, HTML: 5, JavaScript: 10 });
  expect(requests.slice(1).map(call => call.body.count).sort((a, b) => a - b)).toEqual([5, 5, 10]);
  expect(state.created).toBe(0);
});

test('adding to an existing draft preserves existing questions and skips duplicates', async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/dashboard/question-banks/${bankId}`);
  await page.locator('.selector-question-choice input').nth(1).check();
  await page.locator('.selector-question-choice input').nth(5).check();
  await page.getByRole('button', { name: 'Thêm vào đề', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Đề nhận câu hỏi', exact: true }).selectOption(examId);
  await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.exam.questions.map(q => q.id)).toEqual([state.questions[0].id, state.questions[1].id, state.questions[2].id, state.questions[5].id]);
  expect(state.exam.questions.map(q => q.points)).toEqual([2.5, 2.5, 2.5, 1]);
});

test('a partial bulk failure keeps only unfinished questions for retry', async ({ page }) => {
  const state = await setup(page); state.failQuestionId = state.questions[2].id;
  await page.goto(`/dashboard/question-banks/${bankId}`);
  await page.getByRole('checkbox', { name: 'Chọn tất cả trên trang', exact: true }).check();
  await page.getByRole('button',{name:'Thao tác các câu đã chọn'}).click();await page.getByRole('menuitem', { name: 'Chuyển chủ đề', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Chủ đề mới', { exact: true }).fill('Chương mới');
  await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Đã cập nhật 2 câu');
  await expect(page.locator('.selection-bulk-actions')).toContainText('Đã chọn: 18 câu');
  await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.questions.filter(q => q.topic === 'Chương mới')).toHaveLength(20);
});

test('new bank and question forms persist through the existing APIs', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/dashboard/question-banks');
  await page.getByRole('button', { name: '+ Tạo ngân hàng', exact: true }).click();
  const bankDialog = page.getByRole('dialog', { name: 'Tạo ngân hàng câu hỏi' });
  await bankDialog.getByLabel('Tên ngân hàng', { exact: true }).fill('Lập trình mới');
  await expect(bankDialog.getByLabel('Môn học', { exact: true })).toHaveCount(0);
  await bankDialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(bankDialog).toHaveCount(0);
  await page.getByRole('link', { name: 'Mở ngân hàng Lập trình mới', exact: true }).click();
  await page.getByRole('button', { name: '+ Thêm câu hỏi', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Thêm câu hỏi' });
  await dialog.getByLabel('Nội dung câu hỏi', { exact: true }).fill('Câu hỏi mới dùng API thật');
  await dialog.getByPlaceholder('Phương án 1').fill('A');
  await dialog.getByPlaceholder('Phương án 2').fill('B');
  await dialog.getByRole('checkbox', { name: 'Đang sử dụng', exact: true }).check();
  await dialog.getByRole('radio', { name: 'Đáp án đúng 1', exact: true }).check();
  await dialog.getByRole('button', { name: 'Lưu câu hỏi', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Câu hỏi mới dùng API thật', { exact: true })).toBeVisible();
  const saved = state.calls.find(call => call.path.endsWith('/questions') && call.method === 'POST')!;
  expect(saved.body.question_bank_id).toBe('77777777-7777-4777-8777-777777777777');
  expect(saved.body.options_json).toEqual({ options: ['A', 'B'] });
  expect(saved.body.correct_answer_json).toEqual({ answer: 'A' });
  await page.locator('.selector-question-row').first().getByRole('button',{name:/^Thao tác câu:/}).click();
  await page.getByRole('menuitem', { name: 'Sửa', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: 'Sửa câu hỏi' });
  await editDialog.getByRole('combobox', { name: 'Loại câu', exact: true }).selectOption('mcq_multi');
  await editDialog.getByRole('button', { name: 'Lưu câu hỏi', exact: true }).click();
  await expect(editDialog).toHaveCount(0);
  const edited = state.calls.find(call => call.path.includes('/questions/66666666') && call.method === 'PATCH')!;
  expect(edited.body.correct_answer_json).toEqual({ answers: ['A'] });
});

test('bank list renames and archives banks without invented subject fields', async ({ page }, testInfo) => {
  const state = await setup(page);
  await page.goto('/dashboard/question-banks');
  await expect(page.getByRole('combobox',{name:'Môn học',exact:true})).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Mở ngân hàng Lập trình Web', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('bank-list-1440.png'), fullPage: true });
  await page.getByRole('button',{name:'Thao tác ngân hàng Lập trình Web'}).click();await page.getByRole('menuitem',{name:'Đổi tên',exact:true}).click();
  const rename = page.getByRole('dialog', { name: 'Đổi tên ngân hàng', exact: true });
  await rename.getByLabel('Tên ngân hàng', { exact: true }).fill('Web nâng cao');
  await rename.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Mở ngân hàng Web nâng cao', exact: true })).toBeVisible();
  await page.getByRole('button',{name:'Thao tác ngân hàng Web nâng cao'}).click();await page.getByRole('menuitem',{name:'Xóa',exact:true}).click();
  await page.getByRole('dialog', { name: 'Xóa ngân hàng', exact: true }).getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByText('Không tìm thấy kết quả phù hợp.', { exact: true })).toBeVisible();
  expect(state.questions).toHaveLength(90);
  expect(state.calls.filter(call => call.path === `/question-banks/${bankId}`).map(call => call.method)).toEqual(['PATCH', 'DELETE']);
});
