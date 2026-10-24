import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';

const draftId = '22222222-2222-4222-8222-222222222222';
const publishedId = '33333333-3333-4333-8333-333333333333';
const resultsId = '44444444-4444-4444-8444-444444444444';
const closedId = '55555555-5555-4555-8555-555555555555';
const base = { attempt_count:0,completed_attempt_count:0,description: null, duration_minutes: 30, questions_count: 5, classes: [], require_camera: true, require_mic: true,
  start_time: '2099-01-01T01:00:00Z', end_time: '2099-01-01T02:00:00Z' };
async function setup(page: Page) {
  const session = await uiSession(page, 'teacher');
  session.exams = [{ ...base, id: draftId, title: 'Đề nháp', status: 'draft' }, { ...base, id: publishedId, title: 'Đề xuất bản', status: 'published' },
    { ...base, id: resultsId, attempt_count:1,completed_attempt_count:1, title: 'Đề đã có bài nộp', status: 'published' }, { ...base, id: closedId, title: 'Đề đóng', status: 'closed' }];
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({role:'teacher'})).toString('base64url')}.signature`, url: 'http://localhost:3000' }]);
  const state = { session, reportsStatus: 200, actionStatus: 200, actionCode: '', gate: null as Promise<void> | null, mutations: [] as { method: string; id: string; body: unknown }[] };
  const headers = { 'access-control-allow-origin': process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,PATCH,DELETE,OPTIONS' };
  await page.route('**/api/v1/teacher/reports', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    await route.fulfill({ status: state.reportsStatus, headers, json: state.reportsStatus === 200 ? { data: { exams: session.exams, completed_statuses: ['submitted','auto_submitted','terminated'],
      results: [{ exam_id: resultsId, status: 'submitted' }] } } : { error: { code: 'TEST_ERROR', message: 'PRIVATE_DATABASE_ERROR' } } });
  });
  await page.route('**/api/v1/exams?**',route=>route.fulfill({headers,json:{data:session.exams.map(exam=>state.reportsStatus===200?exam:{...exam,attempt_count:undefined,completed_attempt_count:undefined})}}));
  await page.route('**/api/v1/exams/*', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (!['PATCH', 'DELETE'].includes(request.method())) return route.fallback();
    const id = new URL(request.url()).pathname.split('/').pop()!;
    const body = request.method() === 'PATCH' ? request.postDataJSON() : null;
    state.mutations.push({ method: request.method(), id, body });
    if (state.gate) await state.gate;
    if (state.actionStatus !== 200) return route.fulfill({ status: state.actionStatus, headers, json: { error: { code: state.actionCode, message: 'PRIVATE_DATABASE_ERROR' } } });
    if (request.method() === 'DELETE') session.exams = session.exams.filter(exam => exam.id !== id);
    else session.exams.forEach(exam => { if (exam.id === id) Object.assign(exam, body); });
    await route.fulfill({ headers, json: { data: { deleted: request.method() === 'DELETE' } } });
  });
  await page.goto('/dashboard/exams');
  await expect(page.getByRole('row').filter({ hasText: 'Đề nháp' })).toBeVisible({timeout:45_000});
  return state;
}

test('desktop row has one primary and menu with true state restrictions', async ({ page }) => {
  await setup(page);
  const draft = page.getByRole('row').filter({ hasText: 'Đề nháp' });
  await expect(draft.getByRole('button', { name: 'Xem / Sửa', exact: true })).toBeVisible();
  await expect(draft.getByRole('button')).toHaveCount(2);
  const submitted = page.getByRole('row').filter({ hasText: 'Đề đã có bài nộp' });
  await expect(submitted.getByRole('link', { name: 'Xem kết quả' })).toHaveAttribute('href', `/dashboard/exams/${resultsId}/attempts`);
  await draft.getByRole('button', { name: 'Thao tác đề Đề nháp' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Xem / Sửa', 'Xuất bản', 'Xóa đề']);
  await page.keyboard.press('Escape');
  await submitted.getByRole('button', { name: 'Thao tác đề Đề đã có bài nộp' }).click();
  await expect(page.getByRole('menuitem', { name: 'Đóng đề', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Xóa đề', exact: true })).toBeDisabled();
  await expect(page.getByText('Đề đã có bài làm nên không thể đổi trạng thái hoặc xóa.')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Xem giám sát' })).toHaveAttribute('href', `/dashboard/monitor/${resultsId}`);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Thao tác đề Đề đóng' }).click();
  await expect(page.getByRole('menuitem', { name: 'Xem chi tiết', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Đóng đề', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Xuất bản', exact: true })).toHaveCount(0);
});

test('publish uses existing PATCH and close/delete require modal confirmation', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Thao tác đề Đề nháp' }).click();
  await page.getByRole('menuitem', { name: 'Xuất bản', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Đề nháp' })).toContainText('Đã xuất bản');
  expect(state.mutations).toEqual([{ method: 'PATCH', id: draftId, body: { status: 'published' } }]);
  await page.getByRole('button', { name: 'Thao tác đề Đề xuất bản' }).click();
  await page.getByRole('menuitem', { name: 'Đóng đề', exact: true }).click();
  const close = page.getByRole('dialog', { name: 'Đóng đề thi?' });
  await expect(close).toContainText('Sinh viên sẽ không thể tiếp tục làm bài');
  expect(state.mutations).toHaveLength(1);
  await close.getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(close).toHaveCount(0); expect(state.mutations).toHaveLength(1);
  await page.getByRole('button', { name: 'Thao tác đề Đề xuất bản' }).click();
  await page.getByRole('menuitem', { name: 'Đóng đề', exact: true }).click();
  await close.getByRole('button', { name: 'Đóng đề', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Đề xuất bản' })).toContainText('Đã đóng');
  expect(state.mutations[1]).toEqual({ method: 'PATCH', id: publishedId, body: { status: 'closed' } });
  await page.getByRole('button', { name: 'Thao tác đề Đề đóng' }).click();
  await page.getByRole('menuitem', { name: 'Xóa đề', exact: true }).click();
  const remove = page.getByRole('dialog', { name: 'Xóa đề thi?' });
  await expect(remove).toContainText('Hành động này không thể hoàn tác.');
  expect(state.mutations).toHaveLength(2);
  await remove.getByRole('button', { name: 'Xóa', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Đề đóng' })).toHaveCount(0);
  expect(state.mutations[2]).toEqual({ method: 'DELETE', id: closedId, body: null });
});

test('menu supports arrow keys, escape, outside click and focus return', async ({ page }) => {
  await setup(page);
  const trigger = page.getByRole('button', { name: 'Thao tác đề Đề nháp' });
  await trigger.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Xem / Sửa', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitem', { name: 'Xuất bản', exact: true })).toBeFocused();
  await page.keyboard.press('End'); await expect(page.getByRole('menuitem', { name: 'Xóa đề', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.getByRole('menu')).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.click(); await page.getByRole('main').click({position:{x:4,y:4}});
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('running camera exam without submitted work uses monitoring primary from actual time', async ({ page }) => {
  const state = await setup(page);
  Object.assign(state.session.exams.find(exam => exam.id === publishedId)!, {
    start_time: new Date(Date.now() - 60_000).toISOString(), end_time: new Date(Date.now() + 3_600_000).toISOString(),
  });
  await page.getByRole('button', { name: 'Tải lại danh sách' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Đề xuất bản' });
  await expect(row.getByRole('link', { name: 'Giám sát', exact: true })).toHaveAttribute('href', `/dashboard/monitor/${publishedId}`);
  await expect(row.getByRole('button', { name: 'Xem / Sửa', exact: true })).toHaveCount(0);
});

test('stale attempt race is rejected by backend and errors keep confirmation open', async ({ page }) => {
  const state = await setup(page); state.actionStatus = 409; state.actionCode = 'EXAM_HAS_ATTEMPTS';
  await page.getByRole('button', { name: 'Thao tác đề Đề nháp' }).click(); await page.getByRole('menuitem', { name: 'Xóa đề' }).click();
  const dialog = page.getByRole('dialog', { name: 'Xóa đề thi?' });
  let release!: () => void; state.gate = new Promise<void>(resolve => { release = resolve; });
  await dialog.getByRole('button', { name: 'Xóa', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Hủy', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible(); release();
  await expect(dialog.getByRole('alert')).toContainText('Đề đã có bài làm.');
  await expect(page.getByText('PRIVATE_DATABASE_ERROR')).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'Đề nháp' })).toBeVisible();
  expect(state.mutations).toHaveLength(1);
});

test('unknown attempt state never enables destructive actions and retry recovers', async ({ page }) => {
  const state = await setup(page); state.reportsStatus = 500;
  await page.getByRole('button', { name: 'Tải lại danh sách' }).click();
  await page.getByRole('button', { name: 'Thao tác đề Đề nháp' }).click();
  await expect(page.getByRole('menuitem', { name: 'Xóa đề' })).toBeDisabled();
  await expect(page.getByText(/Chưa kiểm tra được tình trạng bài làm/)).toBeVisible();
  await page.keyboard.press('Escape'); state.reportsStatus = 200;
  await page.getByRole('button', { name: 'Tải lại danh sách' }).click();
  await page.getByRole('button', { name: 'Thao tác đề Đề nháp' }).click();
  await expect(page.getByRole('menuitem', { name: 'Xóa đề' })).toBeEnabled();
});

for (const width of [375, 768, 1440]) test(`menu stays in viewport and escapes table clipping at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 720 }); await setup(page);
  const row = page.getByRole('row').filter({ hasText: 'Đề đã có bài nộp' });
  const trigger = row.getByRole('button', { name: 'Thao tác đề Đề đã có bài nộp' });
  await trigger.scrollIntoViewIfNeeded();
  if (width < 768) await expect(row.getByRole('link', { name: 'Xem kết quả' })).toBeHidden();
  else {
    await expect(row.getByRole('link', { name: 'Xem kết quả' })).toBeVisible();
    const overflow = await row.locator('.ui-button').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent));
    expect(overflow).toEqual([]);
    const primary = (await row.getByRole('link', { name: 'Xem kết quả' }).boundingBox())!;
    const action = (await trigger.boundingBox())!;
    expect(primary.x + primary.width).toBeLessThanOrEqual(action.x - 7);
  }
  await trigger.click(); const menu = page.getByRole('menu'); await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(720);
  expect(await menu.evaluate(node => node.parentElement === document.body)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
