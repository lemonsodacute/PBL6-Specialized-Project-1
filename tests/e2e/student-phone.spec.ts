import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';

async function setup(page: Page, phone: string | null = null) {
  const session = await uiSession(page);
  Object.assign(session.user, { phone, identity_profile_status: 'VERIFIED', student_code: '001IT123', identity_profile_version: 4 });
  const state = { calls: [] as Record<string, unknown>[], fail: false, gate: null as Promise<void> | null };
  await page.route('**/api/v1/auth/me', async route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3100', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,PATCH,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      state.calls.push(body);
      if (state.gate) await state.gate;
      if (state.fail) return route.fulfill({ status: 503, headers, json: { error: { code: 'PHONE_UPDATE_FAILED', message: 'private internal exception' } } });
      Object.assign(session.user, { phone: body.phone });
    }
    return route.fulfill({ headers, json: { user: session.user } });
  });
  await page.goto('/student/profile');
  return state;
}

test('add, persist after reload, edit and clear phone without disturbing identity UI', async ({ page }) => {
  const state = await setup(page);
  await expect(page.getByRole('button', { name: 'Thêm số điện thoại' })).toBeVisible();
  await page.getByRole('button', { name: 'Thêm số điện thoại' }).click();
  await expect(page.getByLabel('Số điện thoại', { exact: true })).toBeFocused();
  await page.getByLabel('Số điện thoại', { exact: true }).fill(' 0901234567 ');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByRole('status')).toContainText('Số điện thoại đã được cập nhật.');
  await expect(page.getByText('0901234567', { exact: true })).toBeVisible();
  await expect(page.getByText('Hồ sơ sinh viên đã được xác nhận')).toBeVisible();
  await page.reload();
  await expect(page.getByText('0901234567', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
  await page.getByLabel('Số điện thoại', { exact: true }).fill('+84901234567');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('+84901234567', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
  await page.getByLabel('Số điện thoại', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByRole('button', { name: 'Thêm số điện thoại' })).toBeVisible();
  expect(state.calls).toEqual([{ phone: '0901234567' }, { phone: '+84901234567' }, { phone: null }]);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Thêm số điện thoại' })).toBeVisible();
});

test('cancel discards draft, restores focus and does not send a request', async ({ page }) => {
  const state = await setup(page, '0901234567');
  await page.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
  await page.getByLabel('Số điện thoại', { exact: true }).fill('0987654321');
  await page.getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(page.getByText('0901234567', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chỉnh sửa', exact: true })).toBeFocused();
  expect(state.calls).toEqual([]);
});

test('invalid phone is rejected inline before network request', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Thêm số điện thoại' }).click();
  await page.getByLabel('Số điện thoại', { exact: true }).fill('abc!!!');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('8–15 chữ số');
  await expect(page.getByLabel('Số điện thoại', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  expect(state.calls).toEqual([]);
});

test('saving disables actions, hides internal errors and permits retry', async ({ page }) => {
  const state = await setup(page);
  let release!: () => void;
  state.gate = new Promise<void>(resolve => { release = resolve; });
  state.fail = true;
  await page.getByRole('button', { name: 'Thêm số điện thoại' }).click();
  await page.getByLabel('Số điện thoại', { exact: true }).fill('0901234567');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByRole('button', { name: 'Đang lưu...' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Hủy', exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Không thể cập nhật số điện thoại. Vui lòng thử lại.');
  state.fail = false;
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('0901234567', { exact: true })).toBeVisible();
});

test('phone editor fits mobile and supports keyboard save', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page);
  await page.getByRole('button', { name: 'Thêm số điện thoại' }).click();
  await page.getByLabel('Số điện thoại', { exact: true }).fill('0901234567');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Hủy', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByText('0901234567', { exact: true })).toBeVisible();
});
