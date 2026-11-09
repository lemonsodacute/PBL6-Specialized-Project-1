import { expect, test } from '@playwright/test';
import { uiSession } from './ui-fixtures';

for (const height of [768, 900]) {
  test(`login screen has no unnecessary document scrollbar at 1440x${height}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height });
    await uiSession(page, 'student', false);
    await page.goto('/login');
    await expect(page.locator('[data-auth-layout="login"]')).toBeVisible();
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Mật khẩu', { exact: true })).toBeVisible();
    const sizes = await page.evaluate(() => ({
      outer: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      inner: getComputedStyle(document.querySelector('[class*="formPane"]') as HTMLElement).scrollbarWidth,
    }));
    expect(sizes.outer).toBeLessThanOrEqual(2);
    expect(sizes.inner).toBe('none');
  });
}

test('compact height keeps all registration fields reachable without a visible inner scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 600 });
  await uiSession(page, 'student', false);
  await page.goto('/login?mode=register');
  await expect(page.getByLabel('Họ và tên', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Xác nhận mật khẩu', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đăng ký', exact: true }).last()).toBeVisible();
  const form = page.locator('[class*="formPane"]');
  await expect(form).toHaveCSS('scrollbar-width', 'none');
  await page.getByLabel('Xác nhận mật khẩu', { exact: true }).focus();
  await expect(page.getByLabel('Xác nhận mật khẩu', { exact: true })).toBeFocused();
});
