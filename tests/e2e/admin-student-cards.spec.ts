import { expect, test, type Page, type Route } from '@playwright/test';
import { fixtureUser, uiSession } from './ui-fixtures';

const referenceId = '22222222-2222-4222-8222-222222222222';
const cardFixture = { student_id: fixtureUser.id, full_name: fixtureUser.full_name, student_code: '001IT123', email: fixtureUser.email,
  is_active: true, identity_profile_status: 'VERIFIED', identity_profile_version: 3, student_card_status: 'VERIFIED', management_status: 'VERIFIED',
  card_admin_version: 2, update_reason: null as string | null, face_preview_url: null,
  reference: { id: referenceId, status: 'ACTIVE', verified_at: '2026-10-11T13:00:00Z', identity_profile_version: 3,
    verification_source: 'STUDENT_SELF_CONFIRM', verified_by_user_id: fixtureUser.id, verified_by_role: 'student', verified_by_name: fixtureUser.full_name,
    revoked_at: null, revoke_reason: null, parser_version: 'student-card-name-roi-v6', face_model_name: 'SFace', face_model_version: '2021dec' },
};
function headers(route: Route) { return { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' }; }
async function setup(page: Page) {
  await uiSession(page, 'admin');
  const payload = Buffer.from(JSON.stringify({ role: 'admin' })).toString('base64url');
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${payload}.signature`, url: test.info().project.use.baseURL ?? 'http://localhost:3000' }]);
  const state = { card: structuredClone(cardFixture), calls: [] as { path: string; body: Record<string, unknown> }[], fail: false, stale: false, queries: [] as URLSearchParams[] };
  await page.route('**/api/v1/admin/student-cards**', async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: headers(route) });
    if (request.method() === 'GET') {
      if (state.fail) return route.fulfill({ status: 503, headers: headers(route), json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Chưa tải được dữ liệu thẻ.' } } });
      if (path.endsWith('/history')) return route.fulfill({ headers: headers(route), json: { data: [{ id: 'event-1', action: 'CARD_VERIFIED', actor_role: 'student', actor_name: fixtureUser.full_name, reason: null, created_at: '2026-10-11T13:00:00Z' }], meta: { total: 1 } } });
      if (path.endsWith('student-cards')) {
        state.queries.push(url.searchParams); const filter = url.searchParams.get('status');
        const data = !filter || filter === 'ALL' || filter === state.card.management_status ? [state.card] : [];
        return route.fulfill({ headers: headers(route), json: { data, meta: { total: data.length, page: 1, limit: 20 } } });
      }
      return route.fulfill({ headers: headers(route), json: { data: state.card } });
    }
    state.calls.push({ path, body: request.postDataJSON() });
    if (state.stale) return route.fulfill({ status: 409, headers: headers(route), json: { error: { code: 'CARD_CHANGED', message: 'Hồ sơ hoặc thẻ đã thay đổi. Vui lòng tải lại và kiểm tra trước khi xử lý.' } } });
    if (!path.endsWith('/notifications')) {
      state.card.card_admin_version++; state.card.student_card_status = 'NEEDS_REUPLOAD';
      state.card.management_status = path.endsWith('/revoke') ? 'REVOKED' : 'NEEDS_REUPLOAD';
      state.card.update_reason = request.postDataJSON().reason; state.card.reference.status = 'INVALIDATED';
    }
    return route.fulfill({ headers: headers(route), json: { data: state.card } });
  });
  return state;
}

test('admin sees real metadata, readonly technical fields and history', async ({ page }) => {
  await setup(page); await page.goto('/admin/student-cards');
  await expect(page.getByRole('searchbox',{name:'Tìm theo tên, MSSV hoặc email...'})).toBeVisible();
  await expect(page.getByRole('link', { name: 'Xác thực thẻ sinh viên', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Xem', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({hasNot:page.getByRole('heading',{name:'Thu hồi xác thực?',exact:true})});
  await expect(dialog.getByText('Sinh viên tự xác nhận', { exact: true })).toBeVisible();
  await expect(dialog.getByText(referenceId, { exact: true })).toBeVisible();
  await expect(dialog.getByText('student-card-name-roi-v6')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Lịch sử xác thực' })).toBeVisible();
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await dialog.getByRole('button',{name:'Thao tác hồ sơ thẻ'}).click();
  await expect(page.getByRole('menuitem', { name: 'Cập nhật hồ sơ sinh viên' })).toHaveAttribute('href', `/dashboard/users?student_id=${fixtureUser.id}&edit_user=${fixtureUser.id}`);
});

test('revoke requires reason and confirmation, then updates status', async ({ page }) => {
  const state = await setup(page); await page.goto('/admin/student-cards');
  await page.getByRole('button',{name:/^Thao tác thẻ/}).click();await page.getByRole('menuitem',{name:'Thu hồi',exact:true}).click();
  const dialog = page.getByRole('dialog').filter({hasNot:page.getByRole('heading',{name:'Thu hồi xác thực?',exact:true})}); const confirm = dialog.getByRole('button', { name: 'Xác nhận thu hồi' });
  await expect(dialog.getByRole('heading', { name: 'Thu hồi xác thực thẻ?' })).toBeVisible();
  await expect(confirm).toBeDisabled(); await dialog.getByLabel('Lý do').fill('Ảnh thẻ chưa rõ.');
  await confirm.click();await page.getByRole('dialog',{name:'Thu hồi xác thực?',exact:true}).getByRole('button',{name:'Thu hồi',exact:true}).click(); await expect(page.getByRole('main').getByText('Đã cập nhật trạng thái thẻ và gửi thông báo cho sinh viên.')).toBeVisible();
  await expect(dialog.getByText('Đã thu hồi', { exact: true })).toBeVisible();
  expect(state.calls).toEqual([{ path: `/api/v1/admin/student-cards/${fixtureUser.id}/revoke`, body: { identity_profile_version: 3, card_admin_version: 2, reference_id: referenceId, reason: 'Ảnh thẻ chưa rõ.' } }]);
});

test('card detail menu follows modal scrolling without losing its actions on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await setup(page); await page.goto('/admin/student-cards');
  await page.getByRole('button', { name: 'Xem', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Chi tiết xác thực thẻ sinh viên', exact: true });
  const trigger = dialog.getByRole('button', { name: 'Thao tác hồ sơ thẻ', exact: true });
  await trigger.click();
  const action = page.getByRole('menuitem', { name: 'Cập nhật hồ sơ sinh viên', exact: true });
  await expect(action).toBeVisible();
  const body = dialog.locator('.modal-body');
  expect(await body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await body.evaluate(element => { element.scrollTop = Math.max(0, element.scrollTop - 12); });
  await expect(action).toBeVisible();
  const bounds = await page.getByRole('menu').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('manual notification recipient is fixed, and request update keeps reason separate', async ({ page }) => {
  const state = await setup(page); await page.goto('/admin/student-cards');
  await page.getByRole('button', { name: 'Xem', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({hasNot:page.getByRole('heading',{name:'Thu hồi xác thực?',exact:true})}); await dialog.getByRole('button',{name:'Thao tác hồ sơ thẻ'}).click();await page.getByRole('menuitem',{name:'Gửi thông báo',exact:true}).click();
  await expect(dialog.getByText(`(${fixtureUser.email})`, { exact: false })).toBeVisible();
  await dialog.getByLabel('Tiêu đề').fill('Đối chiếu thẻ'); await dialog.getByLabel('Nội dung').fill('Vui lòng cung cấp thẻ mới.');
  await dialog.getByRole('button', { name: 'Gửi thông báo', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Thông tin xác thực' })).toBeVisible();
  expect(state.calls[0].body).toEqual({ title: 'Đối chiếu thẻ', message: 'Vui lòng cung cấp thẻ mới.' });
  await dialog.getByRole('button', { name: 'Yêu cầu cập nhật lại' }).click();
  await dialog.getByLabel('Lý do').fill('Thông tin thẻ không còn phù hợp.');
  await dialog.getByRole('button', { name: 'Xác nhận yêu cầu cập nhật' }).click();
  await expect(dialog.getByText('Lý do cần cập nhật: Thông tin thẻ không còn phù hợp.')).toBeVisible();
  expect(state.calls[1].path).toContain('/request-update');
});

test('stale action refreshes detail and asks admin to inspect again', async ({ page }) => {
  const state = await setup(page); await page.goto('/admin/student-cards');
  await page.getByRole('button',{name:/^Thao tác thẻ/}).click();await page.getByRole('menuitem',{name:'Thu hồi',exact:true}).click();
  const dialog = page.getByRole('dialog').filter({hasNot:page.getByRole('heading',{name:'Thu hồi xác thực?',exact:true})}); await dialog.getByLabel('Lý do').fill('Cần kiểm tra.'); state.stale = true;
  await dialog.getByRole('button', { name: 'Xác nhận thu hồi' }).click();await page.getByRole('dialog',{name:'Thu hồi xác thực?',exact:true}).getByRole('button',{name:'Thu hồi',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Hồ sơ hoặc thẻ đã thay đổi');
  await expect(dialog.getByRole('heading', { name: 'Thông tin xác thực' })).toBeVisible();
  expect(state.calls).toHaveLength(1);
});

test('search and status filters call backend and errors never show mock students', async ({ page }) => {
  const state = await setup(page); await page.goto('/admin/student-cards');
  await page.getByRole('searchbox').fill('001IT123'); await page.getByLabel('Trạng thái thẻ').selectOption('NOT_SUBMITTED');
  await expect(page.getByText('Không tìm thấy kết quả phù hợp.')).toBeVisible();
  await expect.poll(()=>state.queries.at(-1)?.get('q')).toBe('001IT123'); expect(state.queries.at(-1)?.get('status')).toBe('NOT_SUBMITTED');
  state.fail = true; await page.getByRole('button', { name: 'Làm mới' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Chưa tải được dữ liệu thẻ');
  await expect(page.locator('main').getByText(fixtureUser.email, { exact: true })).toHaveCount(0);
});

test('mobile page and action dialog fit viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); await setup(page); await page.goto('/admin/student-cards');
  await page.getByRole('button',{name:/^Thao tác thẻ/}).click();await page.getByRole('menuitem',{name:'Yêu cầu cập nhật',exact:true}).click();
  await expect(page.getByRole('dialog').getByLabel('Lý do')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('profile management link opens the selected student for editing with existing API', async ({ page }) => {
  await setup(page);
  await page.route(`**/api/v1/users/${fixtureUser.id}`, async route => route.fulfill({ headers: headers(route), json: { data: {
    ...fixtureUser, student_code: '001IT123', identity_profile_status: 'VERIFIED', identity_profile_version: 3,
  } } }));
  await page.goto('/admin/student-cards'); await page.getByRole('button', { name: 'Xem', exact: true }).click();
  await page.getByRole('button',{name:'Thao tác hồ sơ thẻ'}).click();await page.getByRole('menuitem',{name:'Cập nhật hồ sơ sinh viên'}).click();
  const dialog = page.getByRole('dialog').filter({hasNot:page.getByRole('heading',{name:'Thu hồi xác thực?',exact:true})});
  await expect(dialog.getByRole('heading', { name: 'Chỉnh sửa tài khoản' })).toBeVisible();
  await expect(dialog.getByLabel('Mã sinh viên')).toHaveValue('001IT123');
  await expect(dialog.getByLabel('Họ và tên')).toHaveValue(fixtureUser.full_name);
  await expect(dialog.getByLabel('Số điện thoại')).toHaveValue(fixtureUser.phone);
});

test('student notification opens card section and revoked status offers new upload', async ({ page }) => {
  await uiSession(page);
  await page.route('**/api/v1/identity/profile-verification/status', async route => route.fulfill({ headers: headers(route), json: { data: { identity_profile_status: 'VERIFIED', verification_request_status: 'COMPLETED' } } }));
  await page.route('**/api/v1/identity/student-card/status', async route => route.fulfill({ headers: headers(route), json: { data: { identity_profile_status: 'VERIFIED', student_card_status: 'NEEDS_REUPLOAD', has_reference: false, reference_version: null, updated_at: null, card_admin_version: 3, update_reason: 'Ảnh thẻ chưa rõ.', was_revoked: true } } }));
  await page.route('**/api/v1/notifications**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: headers(route) });
    return route.fulfill({ headers: headers(route), json: { data: route.request().url().includes('unread-count') ? { count: 1 } : [{ id: referenceId, type: 'student_card_update', title: 'Yêu cầu cập nhật thẻ sinh viên', message: 'Lý do: Ảnh thẻ chưa rõ.', is_read: false, severity: null, created_at: '2026-10-11T13:00:00Z' }] } });
  });
  await page.goto('/student/profile'); await page.getByRole('button', { name: 'Thông báo, 1 chưa đọc' }).click();
  await page.getByRole('button', { name: /Yêu cầu cập nhật thẻ sinh viên/ }).click();
  await expect(page).toHaveURL(/\/student\/profile#identity-heading$/);
  await expect(page.getByText('Xác thực thẻ không còn hiệu lực')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên mới', exact: true })).toBeEnabled();
  await expect(page.getByText('Ảnh định danh đã được xác nhận.')).toHaveCount(0);
});
