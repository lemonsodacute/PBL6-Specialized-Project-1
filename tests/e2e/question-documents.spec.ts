import { expect, test, type Page, type Route } from '@playwright/test';
import { uiSession } from './ui-fixtures';
import type { DocumentDraft, DocumentSession } from '../../lib/question-documents';
import { aiErrorMessages, type AIErrorCode } from '../../lib/ai-provider';
import type { QualityFeedback } from '../../components/teacher/DraftQualityReview';

test.use({ trace: 'off' });

const bankId = '33333333-3333-4333-8333-333333333333';
const documentId = '88888888-8888-4888-8888-888888888888';
const base = `/dashboard/question-banks/${bankId}/documents`;
const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const source = 'HTML mô tả cấu trúc của trang web. CSS trình bày hình thức của trang web.';
function draft(index: number, patch: Partial<DocumentDraft> = {}): DocumentDraft {
  return { id: `99999999-9999-4999-8999-${String(index).padStart(12, '0')}`, content: `Câu hỏi đề xuất ${index}: HTML mô tả điều gì?`,
    type: 'mcq_single', difficulty: 'medium', topic: 'Web', default_points: '1', options: ['Cấu trúc', 'Hình thức'], answers: ['Cấu trúc'],
    explanation: 'HTML mô tả cấu trúc trang.', source_page: null, source_section: 'Phần 1', source_chunk_id: 'chunk-1', source_excerpt: source, warnings: [], duplicate: false, ...patch };
}
async function respond(route: Route, data: unknown, status = 200) {
  const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3100', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS' };
  return route.fulfill({ status, headers, json: status >= 400 ? { error: data } : { data } });
}
async function setup(page: Page, generation = false) {
  await uiSession(page, 'teacher');
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role: 'teacher' })).toString('base64url')}.fixture`, url: test.info().project.use.baseURL! }]);
  const session: DocumentSession = { id: documentId, filename: 'questions.docx', expires_at: new Date(Date.now() + 7_200_000).toISOString(),
    sections: [{ text: source, page: null, label: 'Phần 1' }], warnings: [], character_count: source.length, questions: [], batches: [], config: null };
  const state = { session, feedback: {} as Record<string, QualityFeedback>, failFeedback: false, feedbackDelay: 0, calls: [] as { path: string; body: any }[], imported: [] as DocumentDraft[], failImport: false, failBatch: true, rejectFile: false, expired: false, providerError: null as AIErrorCode | null, batchError: null as AIErrorCode | null, batchHttpError: 0, customPlan: null as number[] | null, failIndices: new Set<number>() };
  await page.route('**/api/v1/question-banks/**', async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method();
    if (method === 'OPTIONS') return respond(route, {});
    if (path.endsWith('/document-capabilities')) return respond(route, { generation_available: generation && !state.providerError, provider_status: { configured: generation && !state.providerError, error: state.providerError ? { code: state.providerError, message: 'private-provider-detail' } : null }, max_file_bytes: 10 * 1024 * 1024, max_questions: 100, formats: ['pdf', 'docx'] });
    if (path.endsWith(`/${bankId}`)) return respond(route, { id: bankId, name: 'Lập trình Web', questions_count: 1, questions: [{ id: 'existing', content: 'Câu đã tồn tại', type: 'essay' }] });
    if (path.endsWith('/documents') && method === 'POST') {
      state.calls.push({ path, body: 'multipart' });
      if (state.rejectFile) return respond(route, { code: 'DOCUMENT_HAS_NO_TEXT', message: 'Tài liệu không có text đọc được.' }, 422);
      return respond(route, state.session);
    }
    if (path.endsWith('/feedback')) {
      if (method === 'GET') return respond(route, state.feedback);
      if (state.feedbackDelay) await new Promise(resolve => setTimeout(resolve, state.feedbackDelay));
      if (state.failFeedback) { state.failFeedback = false; return respond(route, { code: 'SAVE_FAILED', message: 'Chưa lưu được đánh giá. Vui lòng thử lại.' }, 503); }
      const id = path.split('/').at(-2)!;
      state.feedback[id] = { ...(state.feedback[id] ?? { decision: null, reason: null, quality_rating: null, reason_note: null }), ...route.request().postDataJSON() };
      return respond(route, state.feedback[id]);
    }
    if (method === 'GET') return state.expired ? respond(route, { code: 'DOCUMENT_EXPIRED', message: 'Phiên tài liệu đã hết hạn. Vui lòng tải lại file.' }, 410) : respond(route, state.session);
    if (method === 'DELETE') return respond(route, { discarded: true });
    const body = route.request().postDataJSON() ?? {};
    state.calls.push({ path, body });
    if (path.endsWith('/drafts')) {
      state.session.config = body;
      if (body.mode === 'import') state.session.questions = [draft(1), draft(2, { content: 'Câu cần bổ sung đáp án', answers: [] }), draft(3, { content: 'Câu đã tồn tại', duplicate: true }), draft(4)];
      else { state.session.questions = []; state.session.batches = (state.customPlan ?? [5, 1]).map((count, index) => ({ index, count, complete: false })); }
      return respond(route, state.session);
    }
    if (path.includes('/batches/')) {
      if (state.batchHttpError) return respond(route, { code: 'HTTP_ERROR', message: 'private-provider-detail' }, state.batchHttpError);
      if (state.batchError) return respond(route, { code: state.batchError, message: 'private-provider-detail' }, 502);
      const index = Number(path.split('/').at(-1));
      if (state.failIndices.has(index)) { state.failIndices.delete(index); return respond(route, { code: 'AI_PROVIDER_UNAVAILABLE', message: 'Unavailable' }, 503); }
      if (index === 1 && state.failBatch) { state.failBatch = false; return respond(route, { code: 'GENERATION_TIMEOUT', message: 'Dịch vụ AI quá thời gian chờ. Các bản nháp đã tạo được giữ lại để bạn tiếp tục.' }, 504); }
      if (!state.session.batches[index].complete) {
        const first = state.session.batches.slice(0, index).reduce((sum, batch) => sum + batch.count, 0) + 1;
        state.session.questions.push(...Array.from({ length: state.session.batches[index].count }, (_, offset) => draft(first + offset)));
        state.session.batches[index].complete = true;
      }
      return respond(route, state.session);
    }
    if (path.endsWith('/regenerate')) {
      const id = path.split('/').at(-2)!;
      const question = state.session.questions.find(item => item.id === id)!;
      question.content = 'Câu hỏi đã tạo lại từ phần nguồn';
      return respond(route, question);
    }
    if (path.endsWith('/import')) {
      if (state.failImport) { state.failImport = false; return respond(route, { code: 'IMPORT_FAILED', message: 'Chưa thêm được câu hỏi. Không có câu mới được lưu trong lượt này; vui lòng thử lại.' }, 422); }
      state.imported = body.questions;
      return respond(route, { imported_count: body.questions.length, question_ids: body.questions.map((question: DocumentDraft) => question.id) });
    }
    throw new Error(`Unexpected document API ${path}`);
  });
  return state;
}
async function upload(page: Page) {
  await page.getByLabel('Chọn tài liệu', { exact: true }).setInputFiles({ name: 'questions.docx', mimeType: mime, buffer: Buffer.from('synthetic document fixture; real parsing covered in backend integration') });
  await page.getByRole('button', { name: 'Đọc tài liệu', exact: true }).click();
  await expect(page.getByText('Đã đọc tài liệu thành công', { exact: true })).toBeVisible();
  await expect(page.getByText('Phần 1', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Xem trước nội dung', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Xem trước nội dung', exact: true })).toHaveValue(source);
  await page.getByRole('button', { name: 'Tiếp tục cấu hình', exact: true }).click();
}

for (const width of [320, 375, 768, 1440]) {
  test(`document review, edit, select and explicit retryable import at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 960 });
    const state = await setup(page); state.failImport = true;
    await page.goto(base);
    await upload(page);
    await page.getByLabel('Chủ đề / chương', { exact: true }).pressSequentially('Chương thử nghiệm');
    await expect(page.getByLabel('Chủ đề / chương', { exact: true })).toHaveValue('Chương thử nghiệm');
    await expect(page.getByRole('option', { name: 'Tạo câu hỏi từ tài liệu', exact: true })).toHaveAttribute('disabled', '');
    await page.getByRole('button', { name: 'Đọc câu hỏi có sẵn', exact: true }).click();
    expect(state.calls.find(call => call.path.endsWith('/drafts'))!.body.topic).toBe('Chương thử nghiệm');
    await expect(page.locator('.document-draft-card')).toHaveCount(4);
    await expect(page.locator('.document-review-actions')).toContainText('Đã chọn: 2');
    await expect(page.locator('.document-review-actions')).toContainText('Sẵn sàng thêm: 2');
    await expect(page.getByText(/Câu hỏi này có thể đã tồn tại/)).toBeVisible();
    const row = page.locator('.document-draft-card').nth(1);
    await row.getByRole('button', { name: 'Sửa', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Sửa câu hỏi đề xuất', exact: true });
    await dialog.getByRole('textbox', { name: 'Nội dung câu hỏi', exact: true }).fill('Câu đã sửa nội dung và đáp án');
    await dialog.getByRole('radio', { name: 'Đáp án đúng 1', exact: true }).check();
    await dialog.getByLabel('Điểm mặc định', { exact: true }).fill('2.5');
    await dialog.getByRole('combobox', { name: 'Độ khó', exact: true }).selectOption('hard');
    await dialog.getByLabel('Chủ đề / chương', { exact: true }).fill('Chương 1');
    await dialog.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.imported).toHaveLength(0);
    await page.getByRole('button', { name: 'Bỏ chọn tất cả', exact: true }).click();
    await page.getByRole('button', { name: 'Chọn tất cả', exact: true }).click();
    await expect(page.locator('.document-review-actions')).toContainText('Đã chọn: 3');
    await expect(page.locator('.document-review-actions')).toContainText('Sẵn sàng thêm: 3');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`document-review-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Tiếp tục thêm 3 câu', exact: true }).click();
    expect(state.calls.filter(call => call.path.endsWith('/import'))).toHaveLength(0);
    await page.getByRole('button', { name: 'Thêm 3 câu vào ngân hàng', exact: true }).click();
    await expect(page.locator('main').getByRole('alert')).toContainText('Chưa thêm được câu hỏi');
    expect(state.imported).toHaveLength(0);
    await page.getByRole('button', { name: 'Thêm 3 câu vào ngân hàng', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Đã thêm 3 câu');
    expect(state.imported[1]).toMatchObject({ content: 'Câu đã sửa nội dung và đáp án', answers: ['Cấu trúc'], difficulty: 'hard', topic: 'Chương 1', default_points: 2.5 });
    expect(state.imported.some(question => question.content === 'Câu đã tồn tại')).toBe(false);
  });
}

test('AI batch retry after reload retains progress and regenerates only one draft', async ({ page }) => {
  test.setTimeout(90_000);
  const state = await setup(page, true);
  await page.goto(base); await upload(page);
  await expect(page.getByText(/Chức năng tạo bằng AI chưa được cấu hình/)).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Cách xử lý tài liệu', exact: true }).selectOption('generate');
  const types=page.getByRole('combobox',{name:'Loại câu hỏi',exact:true});
  await expect(types.locator('option')).toHaveCount(3);await expect(types.locator('option[value="oral"]')).toHaveCount(0);
  await page.getByLabel('Số câu', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Tạo bản nháp', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('quá thời gian chờ');
  expect(state.session.questions).toHaveLength(5);
  await page.reload();
  await page.getByRole('button', { name: 'Tiếp tục tạo câu hỏi', exact: true }).click();
  await expect(page.locator('.document-draft-card')).toHaveCount(6);
  expect(state.calls.filter(call => call.path.endsWith('/batches/0'))).toHaveLength(1);
  expect(state.calls.filter(call => call.path.endsWith('/batches/1'))).toHaveLength(2);
  await page.locator('.document-draft-card').first().getByRole('button', { name: 'Tạo lại câu này', exact: true }).click();
  await expect(page.locator('.document-draft-card').first()).toContainText('Câu hỏi đã tạo lại');
  await expect(page.locator('.document-draft-card').nth(1)).toContainText('Câu hỏi đề xuất 2');
  expect(state.imported).toHaveLength(0);
});

test('automatic quality flags stay separate from human review and invalidate after editing', async ({ page }) => {
  const state = await setup(page, true);
  const pass = { status: 'pass' as const, flags: [], grounded: true, assessed_difficulty: 'medium' as const, fingerprint: 'a'.repeat(64) };
  state.session.config = { mode: 'generate', count: 3, question_type: 'mcq_single', difficulty: 'medium', topic: null };
  state.session.batches = [{ index: 0, count: 3, complete: true }];
  state.session.questions = [draft(1, { quality_check: pass }),
    draft(2, { quality_check: { ...pass, status: 'review', flags: ['AMBIGUOUS'], grounded: false } }),
    draft(3, { quality_check: { ...pass, status: 'review', flags: ['POTENTIAL_DUPLICATE'] } })];
  await page.goto(`${base}?document=${documentId}`);
  const cards = page.locator('.document-draft-card');
  await expect(cards.nth(0).getByRole('note', { name: 'Kiểm tra tự động' })).toContainText('Đạt');
  await expect(cards.nth(1).getByRole('note', { name: 'Kiểm tra tự động' })).toContainText('Cần xem lại');
  await expect(cards.nth(0).getByRole('checkbox')).toBeChecked();
  await expect(cards.nth(1).getByRole('checkbox')).not.toBeChecked();
  await expect(cards.nth(2).getByRole('checkbox')).not.toBeChecked();
  expect(Object.keys(state.feedback)).toHaveLength(0);
  expect(state.imported).toHaveLength(0);
  await cards.nth(0).getByRole('button', { name: 'Sửa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sửa câu hỏi đề xuất', exact: true });
  await dialog.getByRole('textbox', { name: 'Nội dung câu hỏi', exact: true }).fill('Câu hỏi đã sửa, cần kiểm tra lại đáp án');
  await dialog.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
  await expect(cards.nth(0).getByRole('note', { name: 'Kiểm tra tự động' })).toContainText('Đã sửa nội dung; cần kiểm tra lại');
  await cards.nth(1).getByRole('checkbox').check();
  await expect(cards.nth(1).getByRole('checkbox')).toBeChecked();
  await cards.nth(2).getByRole('checkbox').check();
  await expect(page.locator('.document-review-actions')).toContainText('câu đang chọn chưa hợp lệ');
  expect(state.calls.some(call => call.path.endsWith('/import'))).toBe(false);
});

test('quality recheck sends current edited drafts and deselects newly flagged questions', async ({ page }) => {
  const state = await setup(page, true);
  state.session.config = { mode: 'generate', count: 2, question_type: 'mcq_single', difficulty: 'medium', topic: null };
  state.session.batches = [{ index: 0, count: 2, complete: true }];
  state.session.questions = [draft(1), draft(2)];
  let sent: DocumentDraft[] = [];
  await page.route('**/documents/*/quality', async route => {
    if (route.request().method() === 'OPTIONS') return respond(route, {});
    sent = route.request().postDataJSON().questions;
    state.session.questions = sent.map(question => ({ ...question, quality_check: { status: 'review', flags: ['REVIEW_UNAVAILABLE'],
      grounded: null, assessed_difficulty: null, fingerprint: 'b'.repeat(64) } }));
    return respond(route, state.session);
  });
  await page.goto(`${base}?document=${documentId}`);
  await expect(page.locator('.document-review-actions')).toContainText('Đã chọn: 2');
  await page.getByRole('button', { name: 'Kiểm tra chất lượng', exact: true }).click();
  await expect(page.locator('.document-review-actions')).toContainText('Đã chọn: 0');
  expect(sent.map(question => question.id)).toEqual(state.session.questions.map(question => question.id));
  expect(state.feedback).toEqual({});
  expect(state.imported).toHaveLength(0);
});

test('partial batch with HTTP 200 retains drafts and exposes retry for only the remainder', async ({ page }) => {
  const state = await setup(page, true); state.customPlan = [2];
  let calls = 0;
  await page.route('**/documents/*/batches/0', async route => {
    if (route.request().method() === 'OPTIONS') return respond(route, {});
    calls++;
    state.session.questions.push(draft(calls));
    state.session.batches[0].complete = calls === 2;
    state.session.batches[0].error = calls === 1 ? { code: 'AI_TIMEOUT', message: 'Một phần chưa hoàn tất. Câu đã tạo được giữ lại.' } : null;
    return respond(route, state.session);
  });
  await page.goto(base); await upload(page);
  await page.getByRole('combobox', { name: 'Cách xử lý tài liệu', exact: true }).selectOption('generate');
  await page.getByLabel('Số câu', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Tạo bản nháp', exact: true }).click();
  await expect(page.locator('.document-draft-card')).toHaveCount(1);
  await expect(page.locator('main').getByRole('alert')).toContainText('Câu đã tạo được giữ lại');
  const first = state.session.questions[0].id;
  await page.getByRole('button', { name: 'Thử lại phần lỗi', exact: true }).click();
  await expect(page.locator('.document-draft-card')).toHaveCount(2);
  expect(state.session.questions[0].id).toBe(first);
  expect(calls).toBe(2);
  expect(state.calls.filter(call => call.path.endsWith('/drafts'))).toHaveLength(1);
  expect(state.imported).toHaveLength(0);
});

test('partial success keeps 12 drafts and retries only two failed parts out of five', async ({ page }) => {
  const state = await setup(page, true); state.failBatch = false;
  state.customPlan = [4, 4, 4, 4, 4]; state.failIndices = new Set([1, 3]);
  await page.goto(base); await upload(page);
  await page.getByRole('combobox', { name: 'Cách xử lý tài liệu', exact: true }).selectOption('generate');
  await page.getByRole('button', { name: 'Tạo bản nháp', exact: true }).click();
  await expect(page.locator('.document-draft-card')).toHaveCount(12);
  await expect(page.getByText('Đã tạo 12 câu hỏi. 2 phần chưa xử lý được.')).toBeVisible();
  await page.getByRole('button', { name: 'Thử lại phần lỗi', exact: true }).click();
  await expect(page.locator('.document-draft-card')).toHaveCount(20);
  for (const index of [0, 2, 4]) expect(state.calls.filter(call => call.path.endsWith(`/batches/${index}`))).toHaveLength(1);
  for (const index of [1, 3]) expect(state.calls.filter(call => call.path.endsWith(`/batches/${index}`))).toHaveLength(2);
  expect(state.imported).toHaveLength(0);
});

test('15 valid drafts remain importable when a separate generation batch fails', async ({ page }) => {
  const state = await setup(page, true); state.failBatch = false;
  state.customPlan = [5, 5, 5, 5]; state.failIndices = new Set([0]);
  await page.goto(base); await upload(page);
  await page.getByRole('combobox', { name: 'Cách xử lý tài liệu', exact: true }).selectOption('generate');
  await page.getByRole('button', { name: 'Tạo bản nháp', exact: true }).click();
  await expect(page.locator('.document-draft-card')).toHaveCount(15);
  const footer = page.locator('.document-review-actions');
  await expect(footer).toContainText('Đã chọn: 15');
  await expect(footer).toContainText('Sẵn sàng thêm: 15');
  await expect(footer).toContainText('Chưa đánh giá: 15');
  await expect(footer).toContainText('Còn 1 phần chưa xử lý xong');
  await expect(page.getByRole('button', { name: 'Thử lại phần lỗi', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Tiếp tục thêm 15 câu', exact: true }).click();
  expect(state.imported).toHaveLength(0);
  await expect(page.locator('.document-stage')).toContainText('các phần chưa xong sẽ không được nhập');
  await page.getByRole('button', { name: 'Thêm 15 câu vào ngân hàng', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Đã thêm 15 câu');
  expect(state.imported.map(question => question.id)).toEqual(state.session.questions.map(question => question.id));
});

for (const accepted of [10, 15]) {
  test(`optional feedback: ${accepted} accepted out of 15 valid selected questions does not gate import`, async ({ page }) => {
    const state = await setup(page, true);
    state.session.config = { mode: 'generate', count: 15, question_type: 'mcq_single', difficulty: 'medium', topic: null };
    state.session.batches = [{ index: 0, count: 15, complete: true }];
    state.session.questions = Array.from({ length: 15 }, (_, i) => draft(i + 1));
    state.feedback = Object.fromEntries(state.session.questions.slice(0, accepted).map(question => [question.id, { decision: 'accepted', reason: null }]));
    await page.goto(`${base}?document=${documentId}`);
    const footer = page.locator('.document-review-actions');
    await expect(footer).toContainText(`Đạt: ${accepted}`);
    await expect(footer).toContainText(`Chưa đánh giá: ${15 - accepted}`);
    await expect(footer).toContainText('Sẵn sàng thêm: 15');
    await expect(page.getByRole('button', { name: 'Tiếp tục thêm 15 câu', exact: true })).toBeEnabled();
    const acceptedButton = page.locator('.document-draft-card').first().getByRole('button', { name: 'Đạt', exact: true });
    await expect(acceptedButton).toHaveAttribute('aria-pressed', 'true');
    await expect(acceptedButton).toHaveClass(/draft-decision-accepted/);
    await page.getByRole('button', { name: 'Tiếp tục thêm 15 câu', exact: true }).click();
    await page.getByRole('button', { name: 'Thêm 15 câu vào ngân hàng', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Đã thêm 15 câu');
    expect(state.imported).toHaveLength(15);
  });
}

test('reject removes selection immediately and after reload; needs-edit can be fixed and accepted', async ({ page }) => {
  const state = await setup(page, true);
  state.session.config = { mode: 'generate', count: 15, question_type: 'mcq_single', difficulty: 'medium', topic: null };
  state.session.questions = Array.from({ length: 15 }, (_, i) => draft(i + 1));
  await page.goto(`${base}?document=${documentId}`);
  const first = page.locator('.document-draft-card').first();
  await first.getByRole('button', { name: 'Loại bỏ', exact: true }).click();
  await expect(first.getByRole('button', { name: 'Loại bỏ', exact: true })).toHaveClass(/draft-decision-rejected/);
  await expect(first.getByRole('checkbox')).not.toBeChecked();
  await expect(first.getByRole('checkbox')).toBeDisabled();
  await expect(page.locator('.document-review-actions')).toContainText('Sẵn sàng thêm: 14');
  await page.getByRole('button', { name: 'Chọn tất cả', exact: true }).click();
  await expect(first.getByRole('checkbox')).not.toBeChecked();
  await page.reload();
  await expect(first.getByRole('button', { name: 'Loại bỏ', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.document-review-actions')).toContainText('Đã chọn: 14');
  const second = page.locator('.document-draft-card').nth(1);
  await second.getByRole('button', { name: 'Cần sửa', exact: true }).click();
  await expect(second.getByRole('button', { name: 'Cần sửa', exact: true })).toHaveClass(/draft-decision-edited/);
  await second.getByRole('button', { name: 'Sửa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sửa câu hỏi đề xuất', exact: true });
  await dialog.getByRole('textbox', { name: 'Nội dung câu hỏi', exact: true }).fill('Nội dung đã chỉnh sửa');
  await dialog.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
  await expect(second.getByRole('button', { name: 'Cần sửa', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await second.getByRole('button', { name: 'Đạt', exact: true }).click();
  await expect(second.getByRole('button', { name: 'Đạt', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Tiếp tục thêm 14 câu', exact: true }).click();
  await page.getByRole('button', { name: 'Thêm 14 câu vào ngân hàng', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Đã thêm 14 câu');
  expect(state.imported.some(question => question.id === state.session.questions[0].id)).toBe(false);
  expect(state.imported[0].content).toBe('Nội dung đã chỉnh sửa');
});

test('invalid selected answer has card and footer errors and unlocks after editing', async ({ page }) => {
  const state = await setup(page, true);
  state.session.config = { mode: 'generate', count: 15, question_type: 'mcq_single', difficulty: 'medium', topic: null };
  state.session.questions = Array.from({ length: 15 }, (_, i) => draft(i + 1, i === 0 ? { answers: [] } : {}));
  await page.goto(`${base}?document=${documentId}`);
  const first = page.locator('.document-draft-card').first();
  await expect(first).toContainText('Chưa chọn đáp án đúng hợp lệ');
  await first.getByRole('checkbox').check();
  const button = page.getByRole('button', { name: 'Tiếp tục thêm 14 câu', exact: true });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('aria-describedby', 'document-import-blockers');
  await expect(page.locator('.document-review-actions')).toContainText('Đã chọn: 15');
  await expect(page.locator('#document-import-blockers')).toContainText('Còn 1 câu đang chọn chưa hợp lệ');
  await first.getByRole('button', { name: 'Sửa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sửa câu hỏi đề xuất', exact: true });
  await dialog.getByRole('radio', { name: 'Đáp án đúng 1', exact: true }).check();
  await dialog.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tiếp tục thêm 15 câu', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Bỏ chọn tất cả', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tiếp tục thêm 0 câu', exact: true })).toBeDisabled();
  await expect(page.locator('#document-import-blockers')).toContainText('Chưa chọn câu hỏi nào');
  expect(state.imported).toHaveLength(0);
});

test('review reports all structural and duplicate errors; select-all recovers a valid unique selection', async ({ page }) => {
  const state = await setup(page);
  state.session.config = { mode: 'import', count: 4, question_type: 'mcq_single', difficulty: 'medium', topic: null };
  state.session.questions = [draft(1, { content: '', options: [], answers: [] }),
    draft(2, { content: 'Câu đã tồn tại', duplicate: true }), draft(3), draft(4, { content: draft(3).content })];
  await page.goto(`${base}?document=${documentId}`);
  const first = page.locator('.document-draft-card').first();
  await expect(first).toContainText('Nội dung câu hỏi trống');
  await expect(first).toContainText('Cần từ 2 đến 12 phương án');
  await expect(first).toContainText('Chưa chọn đáp án đúng hợp lệ');
  await page.getByRole('button', { name: 'Chọn tất cả', exact: true }).click();
  await expect(page.locator('.document-review-actions')).toContainText('Sẵn sàng thêm: 1');
  await first.getByRole('checkbox').check();
  await page.locator('.document-draft-card').nth(1).getByRole('checkbox').check();
  await page.locator('.document-draft-card').nth(3).getByRole('checkbox').check();
  await expect(page.locator('.document-draft-card').nth(2)).toContainText('Nội dung trùng với câu khác đang chọn');
  await expect(page.locator('#document-import-blockers')).toContainText('Còn 4 câu đang chọn chưa hợp lệ');
  await expect(page.getByRole('button', { name: 'Tiếp tục thêm 0 câu', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Chọn tất cả', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tiếp tục thêm 1 câu', exact: true })).toBeEnabled();
  await expect(page.locator('.document-draft-card').nth(2).getByRole('checkbox')).toBeChecked();
  expect(state.imported).toHaveLength(0);
});

test('teacher quality feedback persists on refresh without importing or fabricating a rating', async ({ page }) => {
  const state = await setup(page, true); state.failBatch = false;
  const feedback: Record<string, { decision: string; reason: string | null }> = {};
  await page.route('**/api/v1/question-banks/**/feedback', async route => {
    if (route.request().method() === 'OPTIONS') return respond(route, {});
    if (route.request().method() === 'GET') return respond(route, feedback);
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    feedback[id] = { ...(feedback[id] ?? { decision: null, reason: null }), ...route.request().postDataJSON() }; return respond(route, feedback[id]);
  });
  await page.goto(base); await upload(page);
  await page.getByRole('combobox', { name: 'Cách xử lý tài liệu', exact: true }).selectOption('generate');
  await page.getByRole('button', { name: 'Tạo bản nháp', exact: true }).click();
  const first = page.locator('.document-draft-card').first();
  await expect(first.getByRole('button', { name: 'Đạt', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await first.getByRole('combobox', { name: 'Lý do (tùy chọn)', exact: true }).selectOption('ambiguous');
  await first.getByRole('button', { name: 'Cần sửa', exact: true }).click();
  await expect(first.getByRole('button', { name: 'Cần sửa', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(first.getByRole('button', { name: 'Cần sửa', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(first.getByRole('combobox', { name: 'Lý do (tùy chọn)', exact: true })).toHaveValue('ambiguous');
  expect(state.imported).toHaveLength(0);
  expect(Object.values(feedback)).toMatchObject([{ decision: 'edited', reason: 'ambiguous' }]);
});

for (const width of [320, 1440]) {
  test(`star rating autosaves independently from decisions and restores notes at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    const state = await setup(page, true);
    state.session.config = { mode: 'generate', count: 1, question_type: 'mcq_single', difficulty: 'medium', topic: null };
    state.session.questions = [draft(1)];
    await page.goto(`${base}?document=${documentId}`);
    const card = page.locator('.document-draft-card').first();
    const rating = card.getByRole('radiogroup', { name: 'Đánh giá chất lượng từ 1 đến 5 sao' });
    await expect(rating.getByRole('radio')).toHaveCount(5);
    await expect(rating.locator('input:checked')).toHaveCount(0);
    await card.getByRole('radio', { name: '4 sao · Tốt', exact: true }).hover();
    await expect(rating.locator('.is-filled')).toHaveCount(4);
    expect(state.feedback).toEqual({});
    await card.getByRole('radio', { name: '4 sao · Tốt', exact: true }).check();
    await expect.poll(() => state.feedback[draft(1).id]?.quality_rating).toBe(4);
    expect(state.feedback[draft(1).id].decision).toBeNull();
    await card.getByRole('combobox', { name: 'Lý do (tùy chọn)', exact: true }).selectOption('other');
    await card.getByRole('textbox', { name: 'Mô tả lý do', exact: true }).fill('Cần làm rõ thuật ngữ trong câu hỏi.');
    await expect.poll(() => state.feedback[draft(1).id]?.reason_note).toBe('Cần làm rõ thuật ngữ trong câu hỏi.');
    await expect(card.locator('.draft-review-save-status')).toHaveText('Đã lưu đánh giá.');
    await page.reload();
    await expect(card.getByRole('radio', { name: '4 sao · Tốt', exact: true })).toBeChecked();
    await expect(card.getByRole('textbox', { name: 'Mô tả lý do', exact: true })).toHaveValue('Cần làm rõ thuật ngữ trong câu hỏi.');
    await expect(card.getByRole('button', { name: 'Đạt', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(card.getByRole('checkbox')).toBeChecked();
    const stars = await rating.locator('label').evaluateAll(labels => labels.map(label => label.getBoundingClientRect().top));
    expect(new Set(stars).size).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await card.screenshot({ path: testInfo.outputPath(`quality-rating-${width}.png`) });
    await card.getByRole('radio', { name: '4 sao · Tốt', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => state.feedback[draft(1).id]?.quality_rating).toBe(5);
    expect(state.feedback[draft(1).id].decision).toBeNull();
    await card.getByRole('button', { name: 'Đạt', exact: true }).click();
    await expect.poll(() => state.feedback[draft(1).id]?.decision).toBe('accepted');
    await card.getByRole('radio', { name: '1 sao · Rất kém', exact: true }).check();
    await expect.poll(() => state.feedback[draft(1).id]?.quality_rating).toBe(1);
    expect(state.feedback[draft(1).id].decision).toBe('accepted');
    await expect(card.getByRole('checkbox')).toBeChecked();
    await card.getByRole('combobox', { name: 'Lý do (tùy chọn)', exact: true }).selectOption('weak_explanation');
    await expect.poll(() => state.feedback[draft(1).id]?.reason).toBe('weak_explanation');
    expect(state.feedback[draft(1).id].reason_note).toBeNull();
    await expect(card.getByRole('textbox', { name: 'Mô tả lý do', exact: true })).toHaveCount(0);
    await expect(card.getByRole('group', { name: 'Thao tác câu 1', exact: true }).getByRole('button')).toHaveText(['Sửa', 'Tạo lại câu này', 'Bỏ']);
    expect(state.imported).toHaveLength(0);
  });
}

test('failed feedback keeps import selection until saved and retries the real rating and decision', async ({ page }) => {
  const state = await setup(page, true);
  state.session.config = { mode: 'generate', count: 1, question_type: 'mcq_single', difficulty: 'medium', topic: null };
  state.session.questions = [draft(1)];
  await page.goto(`${base}?document=${documentId}`);
  const card = page.locator('.document-draft-card').first();
  state.failFeedback = true;
  await card.getByRole('radio', { name: '4 sao · Tốt', exact: true }).check();
  await expect(card.getByRole('alert')).toContainText('Chưa lưu được đánh giá');
  expect(state.feedback).toEqual({});
  await card.getByRole('button', { name: 'Thử lưu lại', exact: true }).click();
  await expect.poll(() => state.feedback[draft(1).id]?.quality_rating).toBe(4);
  state.failFeedback = true;
  await card.getByRole('button', { name: 'Loại bỏ', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText('Chưa lưu được đánh giá');
  await expect(card.getByRole('checkbox')).toBeChecked();
  expect(state.feedback[draft(1).id].decision).toBeNull();
  await card.getByRole('button', { name: 'Thử lưu lại', exact: true }).click();
  await expect(card.getByRole('checkbox')).not.toBeChecked();
  await page.reload();
  await expect(card.getByRole('radio', { name: '4 sao · Tốt', exact: true })).toBeChecked();
  await expect(card.getByRole('button', { name: 'Loại bỏ', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('pending note and decision saves preserve each other and finish before import', async ({ page }) => {
  const state = await setup(page, true);
  state.session.config = { mode: 'generate', count: 1, question_type: 'mcq_single', difficulty: 'medium', topic: null };
  state.session.questions = [draft(1)];
  await page.goto(`${base}?document=${documentId}`);
  const card = page.locator('.document-draft-card').first();
  await card.getByRole('radio', { name: '5 sao · Rất tốt', exact: true }).check();
  await expect(card.locator('.draft-review-save-status')).toHaveText('Đã lưu đánh giá.');
  await card.getByRole('combobox', { name: 'Lý do (tùy chọn)', exact: true }).selectOption('other');
  await expect(card.locator('.draft-review-save-status')).toHaveText('Đã lưu đánh giá.');
  state.feedbackDelay = 800;
  await card.getByRole('textbox', { name: 'Mô tả lý do', exact: true }).fill('Ghi chú cuối cùng cần được giữ.');
  await card.getByRole('button', { name: 'Đạt', exact: true }).click();
  const proceed = page.getByRole('button', { name: 'Tiếp tục thêm 1 câu', exact: true });
  await expect(proceed).toBeDisabled();
  await expect(page.locator('#document-import-blockers')).toContainText('Đang lưu đánh giá chất lượng');
  await expect(card.getByRole('group', { name: 'Thao tác câu 1', exact: true }).getByRole('button', { name: 'Bỏ', exact: true })).toBeDisabled();
  await expect.poll(() => state.feedback[draft(1).id]).toMatchObject({ decision: 'accepted', quality_rating: 5, reason: 'other', reason_note: 'Ghi chú cuối cùng cần được giữ.' });
  await expect(proceed).toBeEnabled();
  await page.reload();
  await expect(card.getByRole('textbox', { name: 'Mô tả lý do', exact: true })).toHaveValue('Ghi chú cuối cùng cần được giữ.');
  await expect(card.getByRole('radio', { name: '5 sao · Rất tốt', exact: true })).toBeChecked();
  await expect(card.getByRole('button', { name: 'Đạt', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('retry failed parts preserves reviewed edits removals selection and the original plan', async ({ page }) => {
  const state = await setup(page, true);
  await page.goto(base); await upload(page);
  await page.getByRole('combobox', { name: 'Cách xử lý tài liệu', exact: true }).selectOption('generate');
  await page.getByLabel('Số câu', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Tạo bản nháp', exact: true }).click();
  await expect(page.locator('.document-draft-card')).toHaveCount(5);
  await page.locator('.document-draft-card').first().getByRole('button', { name: 'Bỏ', exact: true }).click();
  const reviewed = page.locator('.document-draft-card').first();
  await reviewed.getByRole('checkbox').uncheck();
  await reviewed.getByRole('button', { name: 'Sửa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sửa câu hỏi đề xuất', exact: true });
  await dialog.getByRole('textbox', { name: 'Nội dung câu hỏi', exact: true }).fill('Nội dung đã review cần giữ nguyên');
  await dialog.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
  await page.getByRole('button', { name: 'Quay lại cấu hình', exact: true }).click();
  await page.getByLabel('Số câu', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Thử lại phần lỗi', exact: true }).click();
  await expect(page.locator('.document-draft-card')).toHaveCount(5);
  await expect(reviewed).toContainText('Nội dung đã review cần giữ nguyên');
  await expect(reviewed.getByRole('checkbox')).not.toBeChecked();
  await expect(page.locator('.document-draft-content')).not.toContainText(['Câu hỏi đề xuất 1:']);
  await expect(page.locator('.document-review-actions')).toContainText('Đã chọn: 4');
  expect(state.calls.filter(call => call.path.endsWith('/drafts'))).toHaveLength(1);
  expect(state.calls.filter(call => call.path.endsWith('/batches/0'))).toHaveLength(1);
  expect(state.session.config?.count).toBe(6);
  expect(state.imported).toHaveLength(0);
});

for (const code of ['AI_PROVIDER_UNAVAILABLE', 'AI_REQUEST_FAILED', 'AI_MODEL_UNSUPPORTED', 'AI_AUTH_FAILED', 'AI_RATE_LIMITED', 'AI_INVALID_RESPONSE', 'AI_TIMEOUT', 'AI_PARSE_ERROR'] as const) {
  test(`configured AI keeps generation enabled and reports ${code} distinctly`, async ({ page }) => {
    const state = await setup(page, true); state.batchError = code;
    state.session.image_count = 1;
    await page.goto(base); await upload(page);
    await expect(page.getByText(/AI vẫn có thể tạo câu hỏi từ phần văn bản/)).toBeVisible();
    await page.getByRole('combobox', { name: 'Cách xử lý tài liệu', exact: true }).selectOption('generate');
    await page.getByRole('button', { name: 'Tạo bản nháp', exact: true }).click();
    await expect(page.locator('main').getByRole('alert')).toContainText(aiErrorMessages[code]);
    await expect(page.locator('main')).not.toContainText('private-provider-detail');
    await expect(page.locator('main')).not.toContainText('chưa được cấu hình');
  });
}

test('invalid provider URL has a configuration error instead of missing-provider copy', async ({ page }) => {
  const state = await setup(page, true); state.providerError = 'AI_REQUEST_FAILED';
  await page.goto(base); await upload(page);
  await expect(page.getByText(aiErrorMessages.AI_REQUEST_FAILED, { exact: false })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Chức năng tạo bằng AI chưa được cấu hình');
  await expect(page.locator('main')).not.toContainText('private-provider-detail');
});

for (const status of [429, 503, 500]) {
  test(`uncoded backend HTTP ${status} shows a concrete cause instead of generic draft failure`, async ({ page }) => {
    const state = await setup(page, true); state.batchHttpError = status;
    await page.goto(base); await upload(page);
    await page.getByRole('combobox', { name: 'Cách xử lý tài liệu', exact: true }).selectOption('generate');
    await page.getByRole('button', { name: 'Tạo bản nháp', exact: true }).click();
    await expect(page.locator('main').getByRole('alert')).toContainText(status === 429 ? 'Đã đạt giới hạn AI tạm thời' : status === 503 ? 'Dịch vụ AI đang tạm thời không khả dụng' : 'Máy chủ gặp lỗi');
    await expect(page.locator('main')).not.toContainText('Chưa tạo được bản nháp');
    await expect(page.locator('main')).not.toContainText('private-provider-detail');
  });
}

test('invalid extension and scan errors leave document upload recoverable', async ({ page }) => {
  const state = await setup(page); state.rejectFile = true;
  await page.goto(base);
  await page.getByLabel('Chọn tài liệu', { exact: true }).setInputFiles({ name: 'unsafe.docm', mimeType: 'application/octet-stream', buffer: Buffer.from('macro') });
  await page.getByRole('button', { name: 'Đọc tài liệu', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('PDF hoặc DOCX');
  expect(state.calls).toHaveLength(0);
  await page.getByLabel('Chọn tài liệu', { exact: true }).setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-fixture') });
  await page.getByRole('button', { name: 'Đọc tài liệu', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('không có text');
  await expect(page.getByLabel('Chọn tài liệu', { exact: true })).toBeEnabled();
});

test('expired saved session allows a new upload in the same wizard', async ({ page }) => {
  const state = await setup(page); state.expired = true;
  await page.goto(`${base}?document=${documentId}`);
  await expect(page.locator('main').getByRole('alert')).toContainText('hết hạn');
  await expect(page.getByLabel('Chọn tài liệu', { exact: true })).toBeEnabled();
  await expect(page).toHaveURL(new RegExp(`${base}$`));
});

for (const width of [375, 1440]) {
  test(`document metadata, coherent preview and protected associated images at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    const state = await setup(page);
    state.session.filename = 'On_tap_quan_tri_mang.docx';
    state.session.file_type = 'docx'; state.session.page_count = 32; state.session.page_count_estimated = true;
    state.session.character_count = 33287; state.session.image_count = 1; state.session.structured_question_count = 87;
    state.session.structure_parsed = true;
    state.session.preview_text = ('Câu 8: Quan sát sơ đồ mạng và chọn phương án đúng.\nA. Mạng nội bộ\nB. Mạng diện rộng\nĐáp án: A\n' + source.repeat(9)).slice(0, 950);
    const image = { id: '77777777-7777-4777-8777-777777777777', page: null, position: { paragraph: 8 },
      nearby_paragraph: 'Câu 8: Quan sát sơ đồ mạng', question_number: 8, mime_type: 'image/png', byte_count: 68,
      temp_url: `/question-banks/${bankId}/documents/${documentId}/images/77777777-7777-4777-8777-777777777777` };
    const unassigned = { ...image, id: '77777777-7777-4777-8777-888888888888', question_number: null,
      temp_url: `/question-banks/${bankId}/documents/${documentId}/images/77777777-7777-4777-8777-888888888888` };
    state.session.images = [image, unassigned]; state.session.image_count = 2;
    await page.route('**/api/v1/question-banks/**/images/*', async route => {
      if (route.request().method() === 'OPTIONS') return respond(route, {});
      expect(route.request().headers().authorization).toBeTruthy();
      await route.fulfill({ contentType: 'image/png', headers: { 'access-control-allow-origin': new URL(testInfo.project.use.baseURL!).origin,
        'access-control-allow-credentials': 'true', 'cache-control': 'no-store' },
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOuoAAAAASUVORK5CYII=', 'base64') });
    });
    await page.goto(base);
    await page.getByLabel('Chọn tài liệu', { exact: true }).setInputFiles({ name: 'network.docx', mimeType: mime, buffer: Buffer.from('fixture') });
    await page.getByRole('button', { name: 'Đọc tài liệu', exact: true }).click();
    await expect(page.getByText('Đã đọc tài liệu thành công', { exact: true })).toBeVisible();
    await expect(page.getByText('33.287 ký tự', { exact: true })).toBeVisible();
    await expect(page.getByText('87 câu hỏi có cấu trúc được phát hiện', { exact: true })).toBeVisible();
    await expect(page.getByText(/90 câu hỏi/)).toHaveCount(0);
    await expect(page.getByText(/Phần 352|chunk[_-]|Nội dung đã đọc/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Xem trước nội dung', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Xem trước nội dung', exact: true })).toHaveValue(state.session.preview_text);
    await page.getByRole('button', { name: 'Xem hình ảnh', exact: true }).click();
    const thumbnail = page.getByRole('img', { name: 'Hình ảnh trong tài liệu 1', exact: true });
    await expect(thumbnail).toBeVisible();
    await expect(thumbnail).toHaveAttribute('src', /^blob:/);
    await expect(page.locator('figcaption').first()).toContainText('Câu 8');
    const overflow = await page.evaluate(() => ({width:document.documentElement.scrollWidth,viewport:innerWidth,scrollX,items:Array.from(document.querySelectorAll('*')).filter(node=>node.getBoundingClientRect().right>innerWidth+1||node.scrollWidth>node.clientWidth+1).map(node=>({tag:node.tagName,className:node.className,right:node.getBoundingClientRect().right,left:node.getBoundingClientRect().left,width:node.getBoundingClientRect().width,scroll:node.scrollWidth,client:node.clientWidth})).slice(0,16)}));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),JSON.stringify(overflow)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`document-preview-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Tiếp tục cấu hình', exact: true }).click();
    await page.getByRole('button', { name: 'Đọc câu hỏi có sẵn', exact: true }).click();
    state.session.questions[0].images = [image]; state.session.questions[0].warning_codes = ['IMAGE_REQUIRES_VISION'];
    await page.reload();
    const first = page.locator('.document-draft-card').first();
    await expect(first).toContainText('Hình ảnh chưa được AI phân tích. Hãy kiểm tra hình và đáp án trước khi nhập.');
    await expect(first.getByRole('img')).toBeVisible();
    await expect(first).toContainText('1 hình đi kèm');
    await expect(first.locator('summary')).toContainText('Hiển thị đoạn nguồn');
    await first.getByRole('button', { name: 'Sửa', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('img')).toBeVisible();
    await page.getByRole('dialog').getByRole('checkbox', { name: 'Hình 2 · Chưa xác định câu hỏi', exact: true }).check();
    await expect(page.getByRole('dialog').getByRole('img')).toHaveCount(2);
    await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
    await expect(first).toContainText('2 hình đi kèm');
  });
}

test('unstructured document does not invent a structured question count', async ({ page }) => {
  const state = await setup(page);
  state.session.structured_question_count = null;
  await page.goto(base); await upload(page);
  await page.getByRole('button', { name: 'Quay lại tài liệu', exact: true }).click();
  await expect(page.getByText(/câu hỏi có cấu trúc/)).toHaveCount(0);
});

test('student attempt renders a private question image with its attempt scope', async ({ page }) => {
  await uiSession(page, 'student');
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role: 'student' })).toString('base64url')}.fixture`, url: test.info().project.use.baseURL! }]);
  await page.routeWebSocket('**/api/v1/ws/call/**', () => {});
  const attemptId = '66666666-6666-4666-8666-666666666666', questionId = '55555555-5555-4555-8555-555555555555';
  const imagePath = `/question-images/${questionId}/77777777-7777-4777-8777-777777777777`;
  await page.route(`**/api/v1/attempts/${attemptId}**`, route => respond(route, {
    id: attemptId, exam_id: 'image-exam', status: 'in_progress', remaining_seconds: 3600,
    started_at: new Date().toISOString(), server_deadline_at: new Date(Date.now() + 3600000).toISOString(), answers: [],
    questions: [{ id: questionId, content: 'Quan sát sơ đồ mạng và chọn phương án đúng.', type: 'mcq_single',
      options_json: { options: ['Hai mạng', 'Một mạng'] }, default_points: 1,
      images: [{ id: '77777777-7777-4777-8777-777777777777', preview_url: imagePath }] }],
  }));
  await page.route('**/api/v1/exams/image-exam', route => respond(route, { id: 'image-exam', title: 'Bài thi có hình',
    duration_minutes: 60, require_camera: false, require_mic: false, require_fullscreen: false }));
  await page.route('**/api/v1/question-images/**', async route => {
    if (route.request().method() === 'OPTIONS') return respond(route, {});
    expect(new URL(route.request().url()).searchParams.get('attempt_id')).toBe(attemptId);
    expect(route.request().headers().authorization).toBe('Bearer synthetic-token');
    await route.fulfill({ contentType: 'image/png', headers: { 'access-control-allow-origin': new URL(test.info().project.use.baseURL!).origin,
      'access-control-allow-credentials': 'true', 'cache-control': 'no-store' },
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOuoAAAAASUVORK5CYII=', 'base64') });
  });
  await page.goto(`/student/attempts/${attemptId}`);
  const picture = page.getByRole('img', { name: 'Hình đi kèm câu hỏi 1', exact: true });
  await expect(picture).toBeVisible(); await expect(picture).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => picture.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole('radio')).toHaveCount(2);
});
