import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';
import type { CardStatus } from '@/lib/student-card';

const previewId = '22222222-2222-4222-8222-222222222222';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
async function cardSession(page: Page) {
  const session = await uiSession(page);
  Object.assign(session.user, { identity_profile_status: 'VERIFIED', student_code: '001IT123' });
  const state = { matched: true, unreadable: false, ocrName: 'Nguyễn Minh Anh' as string | null, nameMatchType: 'EXACT', nameLowConfidence: false, confirmed: false, profileVerified: true, expires: 600_000, gate: null as Promise<void> | null, confirmations: [] as unknown[], imageAuth: [] as string[],
    cardStatus: null as string | null, referenceStatus: null as CardStatus['reference_status'], updateReason: null as string | null, wasRevoked: false, updateRequested: false, statusFails: false,
    statusGate: null as Promise<void> | null, statusCalls: 0, previewCalls: 0,
    previewFailure: null as { status: number; code: string } | null, malformed: false, imageFails: false, extraBlocking: [] as string[],
    className: '21IT1' as string | null, classConfidence: .94 as number | null, classStatus: 'READABLE' as 'READABLE' | 'CLASS_UNREADABLE' };
  await page.route('**/api/v1/identity/student-card/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': request.headers().origin ?? 'http://localhost:3100', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (/\/previews\//.test(path)) {
      if (state.imageFails) return route.fulfill({ status: 404, headers, json: { error: { code: 'PREVIEW_NOT_FOUND' } } });
      state.imageAuth.push(request.headers().authorization);
      expect(request.url()).not.toContain('token');
      return route.fulfill({ headers, contentType: 'image/png', body: pixel });
    }
    if (path.endsWith('/confirm')) { state.confirmations.push(request.postDataJSON()); state.confirmed = true; }
    if (path.endsWith('/preview')) {
      state.previewCalls++;
      if (state.gate) await state.gate;
      if (state.previewFailure) return route.fulfill({ status: state.previewFailure.status, headers, json: { error: { code: state.previewFailure.code, message: 'SQL internal detail private-name must not appear' } } });
      if (state.malformed) return route.fulfill({ headers, json: { data: { old_image_field: '/private/internal/face.jpg' } } });
      return route.fulfill({ headers, json: { data: {
        preview_id: previewId, expires_at: new Date(Date.now() + state.expires).toISOString(),
        card_preview_url: `/api/v1/identity/student-card/previews/${previewId}/card`, face_preview_url: `/api/v1/identity/student-card/previews/${previewId}/face`,
        extracted: { full_name: state.ocrName, ocr_display_name: state.ocrName, student_code: state.unreadable ? null : state.matched ? '001IT123' : '06031034', class_name: state.className, class_confidence: state.classConfidence, class_status: state.classStatus, major: 'Kế toán doanh nghiệp' },
        comparison: { name_match: state.nameMatchType !== 'MISMATCH' && !!state.ocrName, name_match_type: state.nameMatchType, student_code_match: !state.unreadable && state.matched }, can_confirm: !state.extraBlocking.length && !state.unreadable && state.matched && !!state.ocrName && !state.nameLowConfidence && state.nameMatchType !== 'MISMATCH',
        blocking_errors: [...state.extraBlocking, ...(!state.ocrName ? ['NAME_UNREADABLE'] : state.nameLowConfidence ? ['NAME_LOW_CONFIDENCE'] : state.unreadable ? ['STUDENT_CODE_UNREADABLE'] : state.matched ? [] : ['STUDENT_CODE_MISMATCH'])], warnings: [],
      } } });
    }
    const data = { identity_profile_status: state.profileVerified ? 'VERIFIED' : 'PENDING', student_card_status: state.cardStatus ?? (state.confirmed ? 'VERIFIED' : 'NOT_SUBMITTED'), has_reference: state.confirmed, reference_version: state.confirmed ? previewId : null, updated_at: state.confirmed ? '2026-10-12T00:00:00Z' : null,
      reference_status: state.referenceStatus ?? (state.confirmed ? 'ACTIVE' : null), update_reason: state.updateReason, was_revoked: state.wasRevoked, update_requested: state.updateRequested };
    if (path.endsWith('/status')) { state.statusCalls++; if (state.statusGate) await state.statusGate; }
    if (path.endsWith('/status') && state.statusFails) return route.fulfill({ status: 503, headers, json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Chưa tải được trạng thái thẻ.' } } });
    return route.fulfill({ headers, json: { data } });
  });
  return state;
}
async function upload(page: Page) {
  await page.getByLabel('Ảnh thẻ sinh viên', { exact: true }).setInputFiles({ name: 'synthetic-card.png', mimeType: 'image/png', buffer: pixel });
}

test('class preview is separate from major and preserves class code punctuation', async ({ page }) => {
  const state = await cardSession(page); state.className = 'K22-CNTT1/1.2';
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên', exact: true })).toBeEnabled();
  await upload(page);
  const fields = page.getByRole('region', { name: 'Xác minh danh tính', exact: true }).locator('dl');
  await expect(fields.locator('dt')).toHaveText(['Họ và tên', 'Mã sinh viên', 'Ngành', 'Lớp']);
  await expect(fields.locator('dd')).toHaveText(['Nguyễn Minh Anh', '001IT123', 'Kế toán doanh nghiệp', 'K22-CNTT1/1.2']);
  await expect(page.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true })).toBeEnabled();
});

test('unreadable class shows a clear fallback and keeps identity confirmation available', async ({ page }) => {
  const state = await cardSession(page); state.className = null; state.classConfidence = null; state.classStatus = 'CLASS_UNREADABLE';
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên', exact: true })).toBeEnabled();
  await upload(page);
  const fields = page.getByRole('region', { name: 'Xác minh danh tính', exact: true }).locator('dl');
  await expect(fields.locator('dd').last()).toHaveText('Không đọc được');
  await expect(fields).not.toContainText('undefined'); await expect(fields).not.toContainText('null');
  await page.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true }).click();
  await expect(page.getByText('Ảnh định danh đã được xác nhận.')).toBeVisible();
  expect(state.confirmations).toEqual([{ preview_id: previewId }]);
});

test('file picker focus refresh cannot detach the input or silently discard the selection', async ({ page }) => {
  const state = await cardSession(page);
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên', exact: true })).toBeEnabled();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Tải thẻ sinh viên', exact: true }).click();
  const chooser = await chooserPromise;
  let release!: () => void;
  const before = state.statusCalls;
  state.statusGate = new Promise(resolve => { release = resolve; });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => state.statusCalls).toBeGreaterThan(before);
    await chooser.setFiles({ name: 'synthetic-card.png', mimeType: 'image/png', buffer: pixel });
    await expect.poll(() => state.previewCalls, { timeout: 3_000 }).toBe(1);
    await expect(page.getByRole('img', { name: 'Khuôn mặt được phát hiện' })).toBeVisible();
  } finally { release(); }
});

test('file selection immediately sends authenticated image multipart and shows loading then parsed OCR', async ({ page }) => {
  const state = await cardSession(page);
  const logs: string[] = []; page.on('console', message => { if (message.text().startsWith('CARD_')) logs.push(message.text()); });
  let release!: () => void; state.gate = new Promise(resolve => { release = resolve; });
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên', exact: true })).toBeEnabled();
  const requestPromise = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/identity/student-card/preview'));
  await upload(page); const request = await requestPromise;
  expect(request.headers()['content-type']).toMatch(/^multipart\/form-data; boundary=/);
  expect(request.headers().authorization).toBe('Bearer synthetic-token');
  const parts = [...request.postDataBuffer()!.toString('latin1').matchAll(/; name="([^"]+)"/g)].map(match => match[1]);
  expect(parts).toEqual(['image']);
  await expect(page.getByText('Đang kiểm tra thẻ sinh viên...', { exact: true })).toBeVisible();
  await expect(page.locator('[role=status] .ui-spinner')).toBeVisible();
  release();
  await expect(page.getByRole('img', { name: 'Khuôn mặt được phát hiện' })).toBeVisible();
  const identity = page.getByRole('region', { name: 'Xác minh danh tính', exact: true });
  await expect(identity.locator('dd').filter({ hasText: /^001IT123$/ })).toBeVisible();
  await expect(identity.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true })).toBeEnabled();
  await expect(identity.getByText('Chưa xác thực thẻ sinh viên', { exact: true })).toHaveCount(0);
  const developmentLogs = process.env.PLAYWRIGHT_APP_ENV !== 'production';
  expect(logs.some(line => line.startsWith('CARD_FILE_SELECTED'))).toBe(developmentLogs);
  expect(logs.some(line => line.startsWith('CARD_PREVIEW_REQUEST_START'))).toBe(developmentLogs);
  expect(logs.some(line => line.startsWith('CARD_PREVIEW_RESPONSE'))).toBe(developmentLogs);
  expect(logs.join('\n')).not.toMatch(/Nguyễn Minh Anh|001IT123|base64|\/private\//);
});

test('partial OCR survives profile and card status refresh while the request is pending', async ({ page }) => {
  const state = await cardSession(page); state.ocrName = null;
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên', exact: true })).toBeEnabled();
  await upload(page);
  const identity = page.getByRole('region', { name: 'Xác minh danh tính', exact: true });
  await expect(identity.getByText('Chưa đọc rõ họ tên.', { exact: true })).toBeVisible();
  const originalPhoto = await identity.getByRole('img', { name: 'Khuôn mặt được phát hiện' }).getAttribute('src');
  let release!: () => void; const before = state.statusCalls;
  state.statusGate = new Promise(resolve => { release = resolve; });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => state.statusCalls).toBeGreaterThan(before);
    await expect(identity.locator('dd').filter({ hasText: /^001IT123$/ })).toBeVisible();
    await expect(identity.getByRole('img', { name: 'Khuôn mặt được phát hiện' })).toHaveAttribute('src', originalPhoto!);
    release(); state.statusGate = null;
    await expect(identity.getByText('Chưa đọc rõ họ tên.', { exact: true })).toBeVisible();
    await expect(identity.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true })).toBeDisabled();
    expect(state.previewCalls).toBe(1);
  } finally { release(); }
});

test('a delayed status response from before confirm cannot restore the upload action', async ({ page }) => {
  const state = await cardSession(page);
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên', exact: true })).toBeEnabled();
  await upload(page);
  await expect(page.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true })).toBeEnabled();
  let release!: () => void; const before = state.statusCalls;
  state.statusGate = new Promise(resolve => { release = resolve; });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => state.statusCalls).toBeGreaterThan(before);
    const statusResponse = page.waitForResponse(response => response.url().endsWith('/identity/student-card/status'));
    await page.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true }).click();
    await expect(page.getByText('Ảnh định danh đã được xác nhận.')).toBeVisible();
    release(); await (await statusResponse).finished();
    await expect(page.getByText('Ảnh định danh đã được xác nhận.')).toBeVisible();
    await expect(page.getByLabel('Ảnh thẻ sinh viên', { exact: true })).toHaveCount(0);
    expect(state.confirmations).toEqual([{ preview_id: previewId }]);
  } finally { release(); }
});

for (const failure of [
  { status: 400, code: 'INVALID_IMAGE', message: 'Vui lòng chọn ảnh JPG hoặc PNG hợp lệ.' },
  { status: 401, code: 'UNAUTHORIZED', message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' },
  { status: 403, code: 'FORBIDDEN', message: 'Bạn không có quyền thực hiện thao tác này.' },
  { status: 422, code: 'NO_FACE_DETECTED', message: 'Không phát hiện khuôn mặt trên thẻ. Vui lòng chọn ảnh rõ nét hơn.' },
  { status: 500, code: 'INTERNAL_ERROR', message: 'Không thể đọc thẻ sinh viên. Vui lòng chọn lại ảnh và thử lại.' },
] as const) {
  test(`preview API ${failure.status} displays safe error and allows retrying the same file`, async ({ page }) => {
    const state = await cardSession(page); state.previewFailure = failure;
    const logs: string[] = []; page.on('console', message => { if (message.text().startsWith('CARD_')) logs.push(message.text()); });
    await page.goto('/student/profile');
    await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên', exact: true })).toBeEnabled();
    await upload(page);
    const identity = page.getByRole('region', { name: 'Xác minh danh tính', exact: true });
    await expect(identity.getByRole('alert')).toContainText(failure.message);
    await expect(identity.getByRole('button', { name: 'Chọn ảnh khác', exact: true })).toBeEnabled();
    await expect(identity).not.toContainText('SQL internal detail');
    expect(logs.some(line => line.startsWith('CARD_PREVIEW_ERROR'))).toBe(process.env.PLAYWRIGHT_APP_ENV !== 'production');
    expect(logs.join('\n')).not.toContain('private-name');
    state.previewFailure = null;
    await upload(page);
    await expect(identity.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true })).toBeEnabled();
    expect(state.previewCalls).toBe(2);
  });
}

test('malformed successful response shows recovery action instead of crashing or rendering a private path', async ({ page }) => {
  const state = await cardSession(page); state.malformed = true;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên', exact: true })).toBeEnabled();
  await upload(page);
  await expect(page.getByRole('region', { name: 'Xác minh danh tính', exact: true }).getByRole('alert')).toContainText('Không thể đọc thẻ sinh viên');
  await expect(page.getByRole('button', { name: 'Chọn ảnh khác', exact: true })).toBeEnabled();
  await expect(page.locator('body')).not.toContainText('/private/internal');
  expect(errors).toEqual([]);
});

test('image fetch failure retains extracted fields and blocks confirmation', async ({ page }) => {
  const state = await cardSession(page); state.imageFails = true;
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên', exact: true })).toBeEnabled();
  await upload(page);
  const identity = page.getByRole('region', { name: 'Xác minh danh tính', exact: true });
  await expect(identity.getByRole('alert')).toContainText('Thông tin đọc từ thẻ vẫn được giữ lại');
  await expect(identity.locator('dd').filter({ hasText: /^001IT123$/ })).toBeVisible();
  await expect(identity.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true })).toBeDisabled();
});

test('blocking face and profile errors remain visible with an otherwise usable preview', async ({ page }) => {
  const state = await cardSession(page); state.extraBlocking = ['NO_FACE_DETECTED', 'MULTIPLE_FACES_DETECTED', 'FACE_TOO_SMALL', 'PROFILE_MISMATCH'];
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên', exact: true })).toBeEnabled();
  await upload(page);
  const identity = page.getByRole('region', { name: 'Xác minh danh tính', exact: true });
  await expect(identity.locator('dd').filter({ hasText: /^001IT123$/ })).toBeVisible();
  await expect(identity.getByRole('alert')).toHaveCount(4);
  await expect(identity.getByRole('alert')).toContainText(['Không phát hiện khuôn mặt', 'Phát hiện nhiều hơn một khuôn mặt', 'Khuôn mặt trên thẻ quá nhỏ', 'Thông tin trên thẻ không khớp hồ sơ']);
  await expect(identity.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true })).toBeDisabled();
});

test('verified active card shows confirmation date with no upload or avatar actions', async ({ page }) => {
  const state = await cardSession(page); state.confirmed = true;
  state.updateReason = 'Yêu cầu cũ đã được xử lý.';
  await page.goto('/student/profile');
  const identity = page.getByRole('region', { name: 'Xác minh danh tính', exact: true });
  await expect(identity.getByText('Hồ sơ sinh viên đã được xác nhận', { exact: true })).toBeVisible();
  await expect(identity.getByText('Đã xác thực', { exact: true })).toBeVisible();
  await expect(identity.getByText('Ảnh định danh đã được xác nhận.')).toBeVisible();
  await expect(identity.getByText(/^Cập nhật: /)).toContainText('12/10/2026');
  await expect(identity.getByRole('button')).toHaveCount(0);
  await expect(identity.locator('input[type=file]')).toHaveCount(0);
  await expect(identity.getByText(/Yêu cầu cũ/)).toHaveCount(0);
});

for (const scenario of [
  { title: 'admin request with existing NEEDS_REUPLOAD status', status: 'NEEDS_REUPLOAD', reference: 'INVALIDATED', requested: true, revoked: false, message: 'Cần cập nhật thẻ sinh viên', button: 'Cập nhật thẻ sinh viên' },
  { title: 'explicit REQUIRES_UPDATE status', status: 'REQUIRES_UPDATE', reference: 'INVALIDATED', requested: false, revoked: false, message: 'Cần cập nhật thẻ sinh viên', button: 'Cập nhật thẻ sinh viên' },
  { title: 'admin revoked reference', status: 'NEEDS_REUPLOAD', reference: 'INVALIDATED', requested: false, revoked: true, message: 'Xác thực thẻ không còn hiệu lực', button: 'Tải thẻ sinh viên mới' },
  { title: 'invalidated reference with otherwise verified card', status: 'VERIFIED', reference: 'INVALIDATED', requested: false, revoked: false, message: 'Xác thực thẻ không còn hiệu lực', button: 'Tải thẻ sinh viên mới' },
] as const) {
  test(`${scenario.title} offers the correct card action and admin reason`, async ({ page }) => {
    const state = await cardSession(page);
    Object.assign(state, { cardStatus: scenario.status, referenceStatus: scenario.reference, updateRequested: scenario.requested, wasRevoked: scenario.revoked, updateReason: 'Ảnh thẻ cần xác thực lại.' });
    await page.goto('/student/profile');
    const identity = page.getByRole('region', { name: 'Xác minh danh tính', exact: true });
    await expect(identity.getByText(scenario.message, { exact: true })).toBeVisible();
    await expect(identity.getByText('Lý do: Ảnh thẻ cần xác thực lại.')).toBeVisible();
    await expect(identity.getByRole('button', { name: scenario.button, exact: true })).toBeEnabled();
    await expect(identity.getByRole('button', { name: 'Thay đổi ảnh' })).toHaveCount(0);
    await expect(identity.getByText('Ảnh định danh đã được xác nhận.')).toHaveCount(0);
    await upload(page);
    await expect(identity.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true })).toBeEnabled();
  });
}

test('unknown card status cannot offer upload until the status is loaded', async ({ page }) => {
  const state = await cardSession(page); state.statusFails = true;
  await page.goto('/student/profile');
  const identity = page.getByRole('region', { name: 'Xác minh danh tính', exact: true });
  await expect(identity.getByRole('button', { name: 'Tải lại trạng thái' })).toBeVisible();
  await expect(identity.locator('input[type=file]')).toHaveCount(0);
  state.statusFails = false;
  await identity.getByRole('button', { name: 'Tải lại trạng thái' }).click();
  await expect(identity.getByText('Chưa xác thực thẻ sinh viên', { exact: true })).toBeVisible();
  await expect(identity.getByRole('button', { name: 'Tải thẻ sinh viên', exact: true })).toBeEnabled();
});

test('verified state arriving on refresh removes an open upload preview', async ({ page }) => {
  const state = await cardSession(page);
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên', exact: true })).toBeEnabled();
  await upload(page);
  await expect(page.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true })).toBeEnabled();
  state.confirmed = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Ảnh định danh đã được xác nhận.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Ảnh thẻ sinh viên', { exact: true })).toHaveCount(0);
});

test('profile upload loading protected preview and confirmation', async ({ page }) => {
  const state = await cardSession(page);
  let release!: () => void;
  state.gate = new Promise(resolve => { release = resolve; });
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên' })).toBeEnabled();
  await upload(page);
  await expect(page.getByText('Đang kiểm tra thẻ sinh viên...')).toBeVisible();
  release();
  await expect(page.getByRole('img', { name: 'Khuôn mặt được phát hiện' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xác nhận thẻ sinh viên' })).toBeEnabled();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Xác nhận thẻ sinh viên' }).click();
  await expect(page.getByText('Ảnh định danh đã được xác nhận.')).toBeVisible();
  expect(state.confirmations).toEqual([{ preview_id: previewId }]);
  expect(state.imageAuth).toEqual(['Bearer synthetic-token', 'Bearer synthetic-token']);
  await expect(page.getByRole('button', { name: 'Thay đổi ảnh' })).toHaveCount(0);
  await expect(page.getByLabel('Ảnh thẻ sinh viên', { exact: true })).toHaveCount(0);
});

test('mismatch cannot confirm and another upload can recover', async ({ page }) => {
  const state = await cardSession(page);
  state.matched = false;
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên' })).toBeEnabled();
  await upload(page);
  await expect(page.getByText('✕ MSSV trên thẻ không khớp với hồ sơ. Vui lòng liên hệ quản trị viên.')).toBeVisible();
  await expect(page.locator('dd').filter({ hasText: /^06031034$/ })).toBeVisible();
  await expect(page.getByText('Kế toán doanh nghiệp', { exact: true })).toBeVisible();
  await expect(page.getByText('Chưa đọc được', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Chưa đọc rõ mã sinh viên.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Xác nhận thẻ sinh viên' })).toBeDisabled();
  state.matched = true;
  await upload(page);
  await expect(page.getByRole('button', { name: 'Xác nhận thẻ sinh viên' })).toBeEnabled();
});

test('unreadable student code shows OCR warning rather than profile mismatch', async ({ page }) => {
  const state = await cardSession(page);
  state.unreadable = true;
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên' })).toBeEnabled();
  await upload(page);
  await expect(page.getByText('Chưa đọc được', { exact: true })).toBeVisible();
  await expect(page.getByText('Chưa đọc rõ mã sinh viên.')).toBeVisible();
  const cardPreview = page.getByRole('region', { name: 'Xác minh danh tính', exact: true });
  await expect(cardPreview.locator('dd').filter({ hasText: /^Nguyễn Minh Anh$/ })).toBeVisible();
  await expect(cardPreview.locator('dd').filter({ hasText: /^21IT1$/ })).toBeVisible();
  await expect(page.getByText('Thông tin chưa đủ rõ. Vui lòng tải ảnh rõ nét hơn.')).toHaveCount(0);
  await expect(page.getByText('✕ MSSV trên thẻ không khớp với hồ sơ. Vui lòng liên hệ quản trị viên.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Xác nhận thẻ sinh viên' })).toBeDisabled();
});

test('matching name keeps actual OCR spelling rather than profile accents', async ({ page }) => {
  const state = await cardSession(page);
  state.ocrName = 'NGUYEN MINH ANH';
  state.nameMatchType = 'NORMALIZED';
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên' })).toBeEnabled();
  await upload(page);
  const cardPreview = page.getByRole('region', { name: 'Xác minh danh tính', exact: true });
  await expect(cardPreview.locator('dd').filter({ hasText: /^NGUYEN MINH ANH$/ })).toBeVisible();
  await expect(cardPreview.locator('dd').filter({ hasText: /^Nguyễn Minh Anh$/ })).toHaveCount(0);
  await expect(cardPreview.getByText('Họ tên phù hợp sau chuẩn hóa', { exact: true })).toBeVisible();
  await expect(cardPreview.getByText('Hệ thống có thể chưa nhận chính xác dấu tiếng Việt.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xác nhận thẻ sinh viên' })).toBeEnabled();
});

test('exact OCR name and unreadable name retain independent student code preview', async ({ page }) => {
  const state = await cardSession(page);
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên' })).toBeEnabled();
  await upload(page);
  await expect(page.getByText('Họ tên khớp chính xác')).toBeVisible();
  state.ocrName = null;
  state.nameMatchType = 'UNREADABLE';
  await upload(page);
  await expect(page.getByText('Chưa đọc rõ họ tên.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Xác minh danh tính', exact: true }).locator('dd').filter({ hasText: /^001IT123$/ })).toBeVisible();
  await expect(page.getByText('Mã sinh viên khớp', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xác nhận thẻ sinh viên' })).toBeDisabled();
});

test('low confidence name remains visible without being called unreadable', async ({ page }) => {
  const state = await cardSession(page);
  state.nameLowConfidence = true;
  state.nameMatchType = 'NORMALIZED';
  state.ocrName = 'NGUYEN MINH ANH';
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên' })).toBeEnabled();
  await upload(page);
  await expect(page.locator('dd').filter({ hasText: /^NGUYEN MINH ANH$/ })).toBeVisible();
  await expect(page.getByText('Đã đọc được họ tên nhưng độ tin cậy chưa đủ. Vui lòng tải ảnh rõ nét hơn.')).toBeVisible();
  await expect(page.getByText('Chưa đọc rõ họ tên.')).toHaveCount(0);
  await expect(page.getByText('Chưa đọc được', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Xác nhận thẻ sinh viên' })).toBeDisabled();
});

test('expired preview blocks confirmation and releases images', async ({ page }) => {
  const state = await cardSession(page);
  state.expires = 500;
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên' })).toBeEnabled();
  await upload(page);
  await expect(page.getByText('Bản xem trước không còn khả dụng. Vui lòng tải lại ảnh thẻ.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xác nhận thẻ sinh viên' })).toBeDisabled();
  await expect(page.getByRole('img', { name: 'Khuôn mặt được phát hiện' })).toHaveCount(0);
});

async function examSession(page: Page) {
  await page.route('**/api/v1/exams/card-exam', route => route.fulfill({
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3100', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type' },
    json: { data: { title: 'Bài thi xác minh danh tính', require_camera: true } },
  }));
}

test('exam blocks pending profiles and missing references before opening camera', async ({ page }) => {
  const state = await cardSession(page);
  await examSession(page);
  state.profileVerified = false;
  await page.goto('/student/exams/card-exam/verify');
  await expect(page.getByText('Hồ sơ sinh viên của bạn chưa được xác nhận.')).toBeVisible();
  await expect(page.getByLabel('Hình ảnh trực tiếp từ camera')).toHaveCount(0);
  state.profileVerified = true;
  await page.reload();
  await expect(page.getByText('Bạn chưa thiết lập ảnh định danh.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Đi đến Hồ sơ' })).toHaveAttribute('href', '/student/profile');
  await expect(page.getByLabel('Hình ảnh trực tiếp từ camera')).toHaveCount(0);
});

test('profile card confirmation continues to webcam exam verification', async ({ page }) => {
  const state = await cardSession(page);
  await examSession(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext('2d')!;
      window.setInterval(() => { context.fillStyle = '#64748b'; context.fillRect(0, 0, 640, 480); }, 80);
      return canvas.captureStream(10);
    } });
  });
  let verified = false;
  await page.route('**/api/v1/identity/exams/card-exam/verify', route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3100', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    expect(state.confirmed).toBeTruthy();
    verified = true;
    return route.fulfill({ headers, json: { data: { verified: true, status: 'verified', reference_version: previewId, score: .8, threshold: .363, liveness_checked: false, message: 'Xác minh danh tính thành công.' } } });
  });
  await page.goto('/student/profile');
  await expect(page.getByRole('button', { name: 'Tải thẻ sinh viên' })).toBeEnabled();
  await upload(page);
  await page.getByRole('button', { name: 'Xác nhận thẻ sinh viên' }).click();
  await expect(page.getByText('Ảnh định danh đã được xác nhận.')).toBeVisible();
  await page.goto('/student/exams/card-exam/verify');
  await page.getByRole('button', { name: 'Kiểm tra thiết bị', exact: true }).click();
  await page.getByRole('button', { name: 'Chụp ảnh', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Xác minh khuôn mặt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Xác minh danh tính thành công' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bắt đầu làm bài' })).toBeEnabled();
  expect(verified).toBeTruthy();
});

test('legacy enrollment URL redirects to the student profile', async ({ page }) => {
  await uiSession(page);
  await page.goto('/student/identity');
  await expect(page).toHaveURL(/\/student\/profile$/);
  await expect(page.getByText('Hồ sơ sinh viên của bạn đang chờ xác nhận.')).toBeVisible();
});
