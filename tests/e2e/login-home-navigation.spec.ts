import { expect, test } from '@playwright/test';
import { uiSession } from './ui-fixtures';

for (const role of ['guest', 'student', 'teacher', 'admin']) for (const width of [1440, 390]) {
  test(`login back link opens the public homepage for ${role} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ colorScheme: width === 390 ? 'dark' : 'light' });
    const session = await uiSession(page, role === 'guest' ? 'student' : role, role !== 'guest');
    await page.routeWebSocket('**/api/v1/**', () => {});
    const restored = role === 'guest' ? null : page.waitForResponse(response => response.url().endsWith('/api/v1/auth/me') && response.request().method() === 'GET');
    await page.goto('/login');
    if (restored) await restored;
    const back = page.getByRole('link', { name: 'Quay lại trang chủ', exact: true });
    if (width === 390) {
      await back.focus();
      await page.keyboard.press('Enter');
    } else {
      await back.click();
    }
    await expect(page).toHaveURL('/#trang-chu');
    await expect(page.locator('#hero-title')).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-public-home-auth', 'pending');
    await expect(page.locator('.app-shell')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (role !== 'guest') {
      expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('ai-proctoring-current-user')!).role)).toBe(role);
    }
    expect(session.requests.filter(request => ['/auth/logout', '/auth/login', '/auth/register'].includes(request.path))).toEqual([]);

    if (role === 'student' && width === 1440) {
      const reloadedSession = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/me') && response.request().method() === 'GET');
      await page.reload();
      await reloadedSession;
      await expect(page.locator('#hero-title')).toBeVisible();
      await expect(page).toHaveURL('/#trang-chu');
      await expect(page.locator('html')).not.toHaveAttribute('data-public-home-auth', 'pending');
    }
  });
}

test('explicit homepage remains visible while a saved session is restored', async ({ page }) => {
  const session = await uiSession(page, 'teacher');
  await page.routeWebSocket('**/api/v1/**', () => {});
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/auth/me', async route => {
    const headers = {
      'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000',
      'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    await gate;
    return route.fulfill({
      headers,
      json: { user: session.user },
    });
  });
  try {
    await page.goto('/#trang-chu');
    await expect(page.locator('#hero-title')).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-public-home-auth', 'pending');
    const restored = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/me') && response.request().method() === 'GET');
    release();
    await restored;
    await expect(page.locator('#hero-title')).toBeVisible();
    await expect(page).toHaveURL('/#trang-chu');
  } finally {
    release();
  }
});
