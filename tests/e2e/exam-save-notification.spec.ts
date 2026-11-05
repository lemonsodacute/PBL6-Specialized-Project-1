import { expect, test, type Page, type Route } from '@playwright/test';
import { uiSession } from './ui-fixtures';

test.setTimeout(90000);
const examId = '33333333-3333-4333-8333-333333333333';
const question = { id: 'question-save', question_bank_id: 'bank-save', content: 'Câu hỏi kiểm tra lưu đề', type: 'mcq_single',
  difficulty: 'easy', is_active: true, default_points: 1, points: 1, options_json: ['A', 'B'] };
const originalTitle = 'Đề thi kiểm tra thông báo';
const initialExam = { id: examId, title: originalTitle, description: 'Mô tả ban đầu', status: 'published',
  start_time: '2099-01-01T01:00:00Z', end_time: '2099-01-01T02:00:00Z', duration_minutes: 30,
  questions_count: 1, questions: [question], classes: [{ id: 'class-save', name: 'Lớp kiểm thử' }],
  require_camera: true, require_mic: true, max_attempts: 1, attempt_count: 0, completed_attempt_count: 0 };

async function respond(route: Route, data: unknown, status = 200) {
  const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3100',
    'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
  return route.fulfill({ status: route.request().method() === 'OPTIONS' ? 204 : status, headers,
    ...(route.request().method() === 'OPTIONS' ? {} : { json: data }) });
}

async function setup(page: Page, status = 'published') {
  await uiSession(page, 'teacher');
  const base = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role: 'teacher' })).toString('base64url')}.signature`, url: base }]);
  const state = { exam: { ...structuredClone(initialExam), status }, patches: [] as Record<string, unknown>[], listReads: 0,
    failure: '', patchGate: null as Promise<void> | null, assignmentGate: null as Promise<void> | null, assignmentReads: 0 };
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/v1', ''), method = request.method();
    if (method === 'OPTIONS') return respond(route, {});
    if (path === '/exams') { state.listReads++; return respond(route, { data: [state.exam], meta: { total: 1 } }); }
    if (path === `/exams/${examId}`) {
      if (method === 'PATCH') {
        const body = request.postDataJSON(); state.patches.push(body);
        if (state.patchGate) await state.patchGate;
        if (state.failure === 'patch') return respond(route, { error: { code: 'INVALID_EXAM', message: 'PRIVATE_DATABASE_ERROR' } }, 422);
        Object.assign(state.exam, body);
      }
      return respond(route, { data: state.exam });
    }
    if (path === `/exams/${examId}/questions`) return respond(route, { data: [question] });
    if (path === '/exam-assignments') {
      state.assignmentReads++;
      if (state.assignmentGate) await state.assignmentGate;
      if (state.failure === 'assignments') return respond(route, { error: { message: 'PRIVATE_ASSIGNMENT_ERROR' } }, 500);
      return respond(route, { data: [{ id: 'assignment-save', class_id: 'class-save' }] });
    }
    if (path === '/question-banks') return respond(route, { data: [{ id: 'bank-save', name: 'Ngân hàng kiểm thử', questions_count: 1 }] });
    if (path === '/question-banks/bank-save/questions') return respond(route, { data: [question] });
    if (path === '/classes') return respond(route, { data: initialExam.classes });
    return route.fallback();
  });
  await page.goto('/dashboard/exams');
  await expect(page.getByRole('heading', { name: originalTitle, exact: true })).toBeVisible({ timeout: 45000 });
  return state;
}

async function edit(page: Page) {
  await page.getByRole('button', { name: `Thao tác đề ${originalTitle}` }).click();
  await page.getByRole('menuitem', { name: 'Xem / Sửa', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Sửa đề thi', exact: true });
  await expect(editor.getByLabel('Tên đề thi', { exact: true })).toHaveValue(originalTitle);
  return editor;
}

test('save waits for every API, blocks double clicks, stays above scrolled editor and refreshes only after OK', async ({ page }, info) => {
  const state = await setup(page);
  const editor = await edit(page);
  await editor.getByLabel('Tên đề thi', { exact: true }).fill('Đề thi đã cập nhật');
  let releasePatch!: () => void, releaseAssignments!: () => void;
  state.patchGate = new Promise<void>(resolve => { releasePatch = resolve; });
  state.assignmentGate = new Promise<void>(resolve => { releaseAssignments = resolve; });
  const save = editor.getByRole('button', { name: 'Lưu thay đổi', exact: true });
  await save.scrollIntoViewIfNeeded();
  expect(await editor.locator('.modal-body').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await save.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(() => state.patches.length).toBe(1);
  await expect(editor.getByRole('button', { name: 'Đang lưu...', exact: true })).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'Đang lưu...', exact: true })).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('dialog', { name: 'Lưu thành công!' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  releasePatch();
  await expect.poll(() => state.assignmentReads).toBe(1);
  await expect(page.getByRole('dialog', { name: 'Lưu thành công!' })).toHaveCount(0);
  releaseAssignments();
  const result = page.getByRole('dialog', { name: 'Lưu thành công!', exact: true });
  await expect(result).toBeVisible();
  await expect(result).toContainText('Thông tin đề thi đã được cập nhật thành công.');
  const ok = result.getByRole('button', { name: 'OK', exact: true });
  await expect(ok).toBeFocused();
  await page.keyboard.press('Tab'); await expect(ok).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(ok).toBeFocused();
  const geometry = await result.evaluate(element => {
    const rect = element.getBoundingClientRect(), overlay = element.parentElement!;
    const background = document.querySelector('.exam-form-modal')!.parentElement!;
    return { centerX: rect.x + rect.width / 2, centerY: rect.y + rect.height / 2, width: innerWidth, height: innerHeight,
      portal: overlay.parentElement === document.body, layer: +getComputedStyle(overlay).zIndex,
      editorLayer: +getComputedStyle(background).zIndex,
      onTop: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('[role="dialog"]') === element };
  });
  expect(geometry.portal).toBe(true); expect(geometry.onTop).toBe(true); expect(geometry.layer).toBeGreaterThan(geometry.editorLayer);
  expect(Math.abs(geometry.centerX - geometry.width / 2)).toBeLessThan(2);
  expect(Math.abs(geometry.centerY - geometry.height / 2)).toBeLessThan(2);
  expect(state.listReads).toBe(1);
  await expect(page.locator('.ui-toast')).toHaveCount(0);
  await page.clock.install(); await page.clock.fastForward(60000);
  await expect(result).toBeVisible();
  await page.screenshot({ path: info.outputPath('save-success.png') });
  await ok.click();
  await expect(result).toHaveCount(0); await expect(editor).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Đề thi đã cập nhật', exact: true })).toBeVisible();
  expect(state.listReads).toBe(2); expect(state.patches).toHaveLength(1);
});

for (const failure of ['patch', 'assignments']) test(`save failure at ${failure} preserves form and allows retry`, async ({ page }, info) => {
  const state = await setup(page); state.failure = failure;
  const editor = await edit(page);
  await editor.getByLabel('Tên đề thi', { exact: true }).fill('Tên giữ lại sau lỗi');
  await editor.getByRole('textbox', { name: 'Mô tả', exact: true }).fill('Nội dung đã nhập cần giữ nguyên');
  await editor.getByLabel('Thời lượng (phút)', { exact: true }).fill('45');
  await editor.getByLabel('Yêu cầu Camera', { exact: true }).uncheck();
  await editor.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  const result = page.getByRole('dialog', { name: 'Lưu thất bại!', exact: true });
  await expect(result).toBeVisible();
  await expect(result).toContainText(failure === 'patch' ? 'Thông tin chưa hợp lệ.' : 'Không thể lưu đề thi. Vui lòng thử lại.');
  await expect(page.locator('body')).not.toContainText('PRIVATE_');
  await expect(editor.locator('.form-error')).toHaveCount(0);
  await expect(page.locator('.ui-toast')).toHaveCount(0);
  const description = await result.getAttribute('aria-describedby');
  expect(description).toBeTruthy();
  await expect(page.locator(`[id="${description}"]`)).not.toBeEmpty();
  await page.screenshot({ path: info.outputPath('save-error.png') });
  await result.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(result).toHaveCount(0); await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Lưu thay đổi', exact: true })).toBeFocused();
  await expect(editor.getByLabel('Tên đề thi', { exact: true })).toHaveValue('Tên giữ lại sau lỗi');
  await expect(editor.getByRole('textbox', { name: 'Mô tả', exact: true })).toHaveValue('Nội dung đã nhập cần giữ nguyên');
  await expect(editor.getByLabel('Thời lượng (phút)', { exact: true })).toHaveValue('45');
  await expect(editor.getByLabel('Yêu cầu Camera', { exact: true })).not.toBeChecked();
  expect(state.listReads).toBe(1);
  state.failure = '';
  await editor.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Lưu thành công!' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Tên giữ lại sau lỗi', exact: true })).toBeVisible();
});

test('Escape dismisses only error feedback and returns focus to the intact editor', async ({ page }) => {
  const state = await setup(page); state.failure = 'patch';
  const editor = await edit(page);
  await editor.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Lưu thất bại!' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Lưu thất bại!' })).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Lưu thay đổi', exact: true })).toBeFocused();
});

test('publish action and existing confirmation dialog keep their behavior', async ({ page }) => {
  const state = await setup(page, 'draft');
  await page.getByRole('button', { name: `Thao tác đề ${originalTitle}` }).click();
  await page.getByRole('menuitem', { name: 'Xuất bản', exact: true }).click();
  await expect(page.locator('.ui-badge').filter({ hasText: 'Đã xuất bản' })).toBeVisible();
  expect(state.patches).toEqual([{ status: 'published' }]);
  await expect(page.getByRole('dialog', { name: 'Lưu thành công!' })).toHaveCount(0);
  await page.getByRole('button', { name: `Thao tác đề ${originalTitle}` }).click();
  await page.getByRole('menuitem', { name: 'Đóng đề', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Đóng đề thi?' });
  await expect(confirmation.getByRole('button', { name: 'Hủy', exact: true })).toBeVisible();
  await expect(confirmation.getByRole('button', { name: 'Đóng', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0); expect(state.patches).toHaveLength(1);
});

test('publishing inside the editor does not open edit-save feedback', async ({ page }) => {
  const state = await setup(page, 'draft');
  const editor = await edit(page);
  await editor.getByRole('button', { name: 'Xuất bản', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.ui-badge').filter({ hasText: 'Đã xuất bản' })).toBeVisible();
  expect(state.patches).toHaveLength(2);
  expect(state.patches[1]).toEqual({ status: 'published' });
  await expect(page.getByRole('dialog', { name: 'Lưu thành công!' })).toHaveCount(0);
});

test('feedback fits a narrow viewport above a scrolled editor', async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await setup(page);
  const editor = await edit(page);
  await editor.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  const result = page.getByRole('dialog', { name: 'Lưu thành công!' });
  await expect(result.getByRole('button', { name: 'OK', exact: true })).toBeFocused();
  const bounds = (await result.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
  expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(740);
  expect(Math.abs(bounds.x + bounds.width / 2 - 375 / 2)).toBeLessThan(2);
  expect(Math.abs(bounds.y + bounds.height / 2 - 740 / 2)).toBeLessThan(2);
  await page.screenshot({ path: info.outputPath('save-mobile.png') });
  await result.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(editor).toHaveCount(0);
});
