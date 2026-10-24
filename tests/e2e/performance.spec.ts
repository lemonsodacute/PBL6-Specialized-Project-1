import { test, expect } from '@playwright/test';
import { uiSession } from './ui-fixtures';

test('sidebar shows pending feedback while the destination response is still pending', async ({ page }) => {
  await uiSession(page, 'teacher');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/dashboard/classes*', async route => {
    if (new URL(route.request().url()).pathname === '/dashboard/classes' && route.request().headers().rsc === '1') await gate;
    await route.continue();
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: /^Tài khoản của/ })).toBeVisible();
  try {
    await page.locator('aside.sidebar').getByRole('link', { name: 'Lớp học', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Đang chuyển trang', exact: true })).toBeVisible();
  } finally { release(); }
  await expect(page).toHaveURL(/\/dashboard\/classes$/);
});

test('initial socket snapshot and a tab activation do not duplicate unread requests', async ({ page }) => {
  await uiSession(page);
  const counts = { chat: 0, notifications: 0 };
  await page.routeWebSocket('**/api/v1/chat/ws', socket => {
    socket.onMessage(() => socket.send(JSON.stringify({ type: 'ready' })));
  });
  await page.route('**/api/v1/**/unread-count', async route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    counts[route.request().url().includes('/chat/') ? 'chat' : 'notifications']++;
    await route.fulfill({ headers, json: { data: { count: 0 } } });
  });
  await page.goto('/student/classes');
  await expect.poll(() => counts).toEqual({ chat: 1, notifications: 1 });
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => counts).toEqual({ chat: 2, notifications: 2 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(counts).toEqual({ chat: 2, notifications: 2 });
});

test('verified workspace opens before token rotation and a late refresh cannot undo logout', async ({ page }) => {
  const session = await uiSession(page);
  await page.routeWebSocket('**/api/v1/chat/ws', socket => socket.onMessage(() => socket.send(JSON.stringify({ type: 'ready' }))));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/auth/refresh', async route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    await gate;
    await route.fulfill({ headers, json: { user: session.user, access_token: 'late-fixture-token' } });
  });
  await page.goto('/student/classes');
  const refreshed = page.waitForResponse(response => response.url().endsWith('/auth/refresh') && response.request().method() === 'POST');
  try {
    await page.getByRole('button', { name: /^Tài khoản của/ }).click();
    await page.getByRole('menuitem', { name: 'Đăng xuất', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
  } finally { release(); }
  await refreshed;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => sessionStorage.getItem('ai-proctoring-access-token'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('ai-proctoring-current-user'))).toBeNull();
});
