import { expect, test } from '@playwright/test';
import { uiSession } from './ui-fixtures';

for (const width of [1440, 768, 390]) {
  test(`login/register overlay switches in place without requests at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const session = await uiSession(page, 'student', false);
    await page.goto('/login');
    const shell = page.locator('[data-auth-layout]');
    await expect(shell).toHaveAttribute('data-auth-layout', 'login');
    await expect(page.getByRole('heading', { name: 'Hello, Friend!' })).toBeVisible();
    const url = page.url();
    await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
    await expect(shell).toHaveAttribute('data-auth-layout', 'register');
    await expect(page.getByLabel('Họ và tên', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Welcome Back!' })).toBeVisible();
    expect(page.url()).toBe(url);
    await expect(page.getByLabel('Họ và tên', { exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(shell).toHaveAttribute('data-auth-layout', 'login');
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    expect(page.url()).toBe(url);
    expect(session.requests.filter(request => ['/auth/login','/auth/register'].includes(request.path))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('desktop teal panel travels half a card width and uses the 600ms transition', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await uiSession(page, 'student', false);
  await page.goto('/login');
  const shell = page.locator('[data-auth-layout]');
  const track = shell.locator('[class*="overlayTrack"]');
  const canvas = await page.locator('main').evaluate(element => ({
    image: getComputedStyle(element).backgroundImage,
    size: getComputedStyle(element).backgroundSize,
  }));
  const card = await shell.boundingBox();
  const start = await track.boundingBox();
  expect(card).not.toBeNull();
  expect(start).not.toBeNull();
  expect(await track.evaluate(element => getComputedStyle(element).transitionDuration)).toContain('0.6s');
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await expect.poll(async () => (await track.boundingBox())?.x ?? Number.POSITIVE_INFINITY)
    .toBeLessThan((start?.x ?? 0) - 250);
  await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeEnabled();
  const end = await track.boundingBox();
  expect(Math.abs((start?.x ?? 0) - (end?.x ?? 0) - (card?.width ?? 0) / 2)).toBeLessThan(4);
  const after = await page.locator('main').evaluate(element => ({
    image: getComputedStyle(element).backgroundImage,
    size: getComputedStyle(element).backgroundSize,
  }));
  expect(after).toEqual(canvas);
});

test('registration via URL opens the correct side without triggering login requests', async ({ page }) => {
  const session = await uiSession(page, 'student', false);
  await page.goto('/login?mode=register');
  await expect(page.locator('[data-auth-layout]')).toHaveAttribute('data-auth-layout', 'register');
  await expect(page.getByLabel('Họ và tên', { exact: true })).toBeVisible();
  expect(session.requests.filter(request => ['/auth/login','/auth/register'].includes(request.path))).toEqual([]);
});

test('reduced motion switches instantly and keeps focus on the next form', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await uiSession(page, 'student', false);
  await page.goto('/login');
  const track = page.locator('[class*="overlayTrack"]');
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await expect(page.getByLabel('Họ và tên', { exact: true })).toBeFocused();
  expect(await track.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
});

test('forgot-password and reset flows remain accessible from the sliding shell', async ({ page }) => {
  const session = await uiSession(page, 'student', false);
  session.resetToken = 'test-issued-reset-token-longer-than-twenty';
  await page.goto('/login');
  await page.getByRole('button', { name: 'Quên mật khẩu?' }).click();
  await expect(page.getByRole('heading', { name: 'Quên mật khẩu' })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill('student@example.com');
  await page.getByRole('button', { name: 'Yêu cầu đặt lại mật khẩu' }).click();
  await expect(page.getByRole('heading', { name: 'Đặt lại mật khẩu' })).toBeVisible();
  await expect(page.getByLabel('Mã đặt lại')).toHaveValue(session.resetToken);
});
