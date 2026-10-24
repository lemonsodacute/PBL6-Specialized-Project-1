import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';

async function registerForm(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
}
async function fillRegistration(page: Page) {
  await page.getByLabel('Họ và tên', { exact: true }).fill('Nguyễn Minh Anh');
  await page.getByLabel('Email', { exact: true }).fill('student@example.com');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('abcdefgh');
  await page.getByLabel('Xác nhận mật khẩu', { exact: true }).fill('abcdefgh');
}

test('registration exposes only supported fields and student role', async ({ page }) => {
  await uiSession(page, 'student', false); await registerForm(page);
  await expect(page.getByRole('radio', { name: 'Sinh viên' })).toBeChecked();
  await expect(page.getByRole('radio')).toHaveCount(1);
  await expect(page.getByText('Tài khoản giảng viên do quản trị viên cấp.')).toBeVisible();
  await expect(page.getByLabel(/Mã sinh viên|Mã giảng viên|Admin/)).toHaveCount(0);
  await fillRegistration(page);
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await expect(page).toHaveURL(/\/student$/);
});

test('registration validation is associated with fields and blocks invalid requests', async ({ page }) => {
  const state = await uiSession(page, 'student', false); await registerForm(page);
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await expect(page.getByLabel('Họ và tên', { exact: true })).toBeFocused();
  await fillRegistration(page);
  await page.getByLabel('Email', { exact: true }).fill('not-an-email');
  await page.getByLabel('Xác nhận mật khẩu', { exact: true }).fill('different');
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Mật khẩu xác nhận chưa khớp.')).toBeVisible();
  expect(state.requests.filter(request => request.path === '/auth/register')).toHaveLength(0);
});

test('registration honors the server password policy and sends no role or confirmation', async ({ page }) => {
  const state = await uiSession(page, 'student', false); await registerForm(page); await fillRegistration(page);
  await page.getByRole('button', { name: 'Hiện mật khẩu', exact: true }).click();
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hiện mật khẩu xác nhận', exact: true }).click();
  await expect(page.getByLabel('Xác nhận mật khẩu', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await expect(page).toHaveURL(/\/student$/);
  const sent = state.requests.find(request => request.path === '/auth/register')!.body;
  expect(sent).toEqual({ full_name: 'Nguyễn Minh Anh', email: 'student@example.com', password: 'abcdefgh' });
});

test('registration prevents duplicate submits and localizes duplicate email errors', async ({ page }) => {
  const state = await uiSession(page, 'student', false);
  state.authStatus = 409; state.authCode = 'EMAIL_EXISTS';
  let release!: () => void; state.gate = new Promise<void>(resolve => { release = resolve; });
  await registerForm(page); await fillRegistration(page);
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đang đăng ký…' })).toBeDisabled();
  await page.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  release();
  await expect(page.getByText('Email này đã được sử dụng.')).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
  expect(state.requests.filter(request => request.path === '/auth/register')).toHaveLength(1);
  await expect(page.locator('main')).not.toContainText('SQL internal');
});

for (const role of ['student', 'teacher', 'admin']) {
  test(`login redirects from the authenticated ${role} role`, async ({ page }) => {
    const state = await uiSession(page, role, false);
    await page.goto('/login');
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Ghi nhớ đăng nhập' })).toHaveCount(0);
    await page.getByLabel('Email', { exact: true }).fill('student@example.com');
    await page.getByLabel('Mật khẩu', { exact: true }).fill('abcdefgh');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL(role === 'student' ? /\/student$/ : role === 'admin' ? /\/admin$/ : /\/dashboard$/);
    expect(state.requests.find(request => request.path === '/auth/login')?.body).toEqual({ email: 'student@example.com', password: 'abcdefgh' });
  });
}

for (const failure of [{ status: 401, message: 'Email hoặc mật khẩu không chính xác.' }, { status: 403, message: 'Tài khoản hiện không thể đăng nhập.' }, { status: 503, message: 'Không thể hoàn tất thao tác. Vui lòng thử lại.' }]) {
  test(`login failure ${failure.status} is readable and hides internal details`, async ({ page }) => {
    const state = await uiSession(page, 'student', false); state.authStatus = failure.status;
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('student@example.com');
    await page.getByLabel('Mật khẩu', { exact: true }).fill('abcdefgh');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(failure.message);
    await expect(page.locator('main')).not.toContainText('SQL internal');
  });
}

test('login show/hide and pending state are keyboard accessible', async ({ page }) => {
  const state = await uiSession(page, 'student', false);
  let release!: () => void; state.gate = new Promise<void>(resolve => { release = resolve; });
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('student@example.com');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('abcdefgh');
  await page.getByRole('button', { name: 'Hiện mật khẩu', exact: true }).focus(); await page.keyboard.press('Space');
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Ẩn mật khẩu', exact: true }).click();
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đang đăng nhập…' })).toBeDisabled();
  release(); await expect(page).toHaveURL(/\/student$/);
});

test('forgot/reset uses the existing issued token and returns to login', async ({ page }) => {
  const state = await uiSession(page, 'student', false); state.resetToken = 'synthetic-issued-reset-token-for-tests';
  await page.goto('/login'); await page.getByRole('button', { name: 'Quên mật khẩu?' }).click();
  await page.getByLabel('Email', { exact: true }).fill('student@example.com');
  await page.getByRole('button', { name: 'Yêu cầu đặt lại mật khẩu' }).click();
  await expect(page.getByLabel('Mã đặt lại')).toHaveValue(state.resetToken);
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill('newpassword');
  await page.getByLabel('Xác nhận mật khẩu', { exact: true }).fill('newpassword');
  await page.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Đặt lại mật khẩu thành công.');
  expect(state.requests.find(request => request.path === '/auth/reset-password')?.body).toEqual({ token: state.resetToken, password: 'newpassword' });
});

test('forgot password does not claim an email was sent when no token is returned', async ({ page }) => {
  await uiSession(page, 'student', false);
  await page.goto('/login'); await page.getByRole('button', { name: 'Quên mật khẩu?' }).click();
  await page.getByLabel('Email', { exact: true }).fill('student@example.com');
  await page.getByRole('button', { name: 'Yêu cầu đặt lại mật khẩu' }).click();
  await expect(page.getByRole('status')).toContainText('Yêu cầu khôi phục đã được ghi nhận.');
  await expect(page.getByLabel('Mã đặt lại')).toHaveCount(0);
});

test('switching auth forms moves keyboard focus to the next useful field', async ({ page }) => {
  await uiSession(page, 'student', false); await registerForm(page);
  await expect(page.getByLabel('Họ và tên', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Quay lại đăng nhập' }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Quên mật khẩu?' }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Tôi đã có mã đặt lại' }).click();
  await expect(page.getByLabel('Mã đặt lại')).toBeFocused();
});

test('unavailable network gives a friendly error and permits retry', async ({ page }) => {
  await uiSession(page, 'student', false);
  await page.route('**/api/v1/auth/login', route => route.abort('failed'));
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('student@example.com');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('abcdefgh');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Không thể kết nối đến máy chủ. Vui lòng thử lại.');
  await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeEnabled();
  await page.unroute('**/api/v1/auth/login');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/student$/);
});

test('registration rejects passwords outside server limits without an API call', async ({ page }) => {
  const state = await uiSession(page, 'student', false); await registerForm(page); await fillRegistration(page);
  for (const [password, message] of [['short', 'Mật khẩu phải có ít nhất 8 ký tự.'], ['a'.repeat(129), 'Mật khẩu không được vượt quá 128 ký tự.']]) {
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByLabel('Xác nhận mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(page.getByLabel('Mật khẩu', { exact: true })).toBeFocused();
  }
  expect(state.requests.filter(request => request.path === '/auth/register')).toHaveLength(0);
});

test('registration service errors stay in the form and allow another attempt', async ({ page }) => {
  const state = await uiSession(page, 'student', false); state.authStatus = 503;
  await registerForm(page); await fillRegistration(page);
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Không thể hoàn tất thao tác. Vui lòng thử lại.');
  await expect(page.getByRole('main').getByRole('alert')).toBeFocused();
  await expect(page.locator('main')).not.toContainText('SQL internal');
  state.authStatus = 200;
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await expect(page).toHaveURL(/\/student$/);
});
