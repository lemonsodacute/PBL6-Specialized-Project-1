import { test, expect, type Page, type Route } from '@playwright/test';
import { uiSession } from './ui-fixtures';

const base = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const title = /Giám thị AI\s*không bao giờ\s*chớp mắt\./;
async function respond(route: Route, json: unknown, status = 200) {
  const headers = { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  return route.fulfill({ status: route.request().method() === 'OPTIONS' ? 204 : status, headers,
    ...(route.request().method() === 'OPTIONS' ? {} : { json }) });
}
async function publicVisit(page: Page) {
  const apiRequests: string[] = [], sockets: string[] = [], errors: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/')) apiRequests.push(request.url()); });
  page.on('websocket', socket => {
    // Development hot reload is not an application/private-resource connection.
    if (new URL(socket.url()).pathname !== '/_next/webpack-hmr') sockets.push(socket.url());
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => respond(route, { error: { code: 'UNAUTHORIZED' } }, 401));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'publicMediaRequests', { value: [], configurable: true });
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async constraints => {
      (window as unknown as { publicMediaRequests: unknown[] }).publicMediaRequests.push(constraints);
      throw new Error('Public homepage must not request media');
    };
  });
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  return { apiRequests, sockets, errors };
}

for (const theme of ['light', 'dark'] as const) for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
  test(`public homepage fits ${width}px in ${theme} mode without private resources`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    const audit = await publicVisit(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('.app-shell')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    // Inspect product landmarks; Next.js's development-tools shadow UI is external to the page.
    const outside = await page.locator('header a,header button,main a,main button,main summary,footer a,footer button').evaluateAll(nodes => nodes.filter(node => {
      if (!node.getClientRects().length) return false;
      const b = node.getBoundingClientRect(); return b.left < -1 || b.right > innerWidth + 1 || node.scrollWidth > node.clientWidth + 1;
    }).map(node => node.textContent));
    expect(outside).toEqual([]);
    const header = page.getByRole('banner'), nav = page.getByRole('navigation', { name: 'Điều hướng trang chủ' });
    if (width <= 900) {
      const toggle = page.getByRole('button', { name: 'Mở menu', exact: true });
      await expect(nav).toBeHidden(); await toggle.click();
      await expect(nav).toBeVisible(); await expect(nav.getByRole('link', { name: 'Trang chủ', exact: true })).toBeFocused();
      if (width === 360) await page.screenshot({ path: info.outputPath(`menu-${theme}.png`) });
      await page.keyboard.press('Escape'); await expect(toggle).toBeFocused(); await expect(nav).toBeHidden();
      await toggle.click();
    }
    await nav.getByRole('link', { name: 'Tính năng', exact: true }).click();
    await expect(page).toHaveURL(/#tinh-nang$/);
    await expect.poll(() => header.evaluate(node => Math.abs(node.getBoundingClientRect().top))).toBeLessThanOrEqual(1);
    const heading = (await page.getByRole('heading', { name: 'Một nền tảng cho toàn bộ quá trình thi', exact: true }).boundingBox())!;
    expect(heading.y).toBeGreaterThan((await header.boundingBox())!.height);
    await page.locator('#ho-tro').getByRole('link', { name: 'Trợ giúp', exact: true }).click();
    await expect(page).toHaveURL(/#huong-dan$/);
    await expect(page.locator('#ho-tro').getByRole('link', { name: 'Đăng nhập', exact: true })).toHaveAttribute('href', '/login');
    await page.locator('#ho-tro summary').first().click();
    await expect(page.locator('#ho-tro details').first()).toHaveAttribute('open', '');
    if (width === 390 || width === 768 || width === 1440) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: info.outputPath(`home-${width}-${theme}.png`), fullPage: true });
      if (width === 1440) await page.screenshot({ path: info.outputPath(`hero-${theme}.png`) });
    }
    expect(audit.apiRequests).toEqual([]); expect(audit.sockets).toEqual([]); expect(audit.errors).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { publicMediaRequests: unknown[] }).publicMediaRequests)).toEqual([]);
  });
}

test('public content is server rendered with metadata, valid destinations and no invented metrics', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: base });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page).toHaveTitle('ProctoOwl - Giám thị AI hỗ trợ thi trực tuyến');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Nền tảng hỗ trợ quản lý bài thi, lớp học, xác minh danh tính và giám sát thi trực tuyến.');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('Giao diện minh họa', { exact: true })).toBeVisible();
  const links = await page.locator('a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
  for (const href of links) {
    expect(href).toBeTruthy();
    if (href!.startsWith('#')) await expect(page.locator(href!)).toHaveCount(1);
    else expect(['/', '/login', '/login?mode=register']).toContain(href);
  }
  await expect(page.locator('body')).not.toContainText(/10[,.]000|99[,.]9%|SOC 2|ISO 27001|GDPR certified/);
  await context.close();
});

test('auth CTAs reach the existing login and registration forms', async ({ page }) => {
  await publicVisit(page);
  await page.getByRole('link', { name: 'Bắt đầu ngay', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?mode=register$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Đăng ký', exact: true })).toBeVisible();
  await expect(page.getByLabel('Họ và tên', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Sinh viên', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Quay lại đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
  await page.goto('/');
  await page.getByRole('banner').getByRole('link', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
});

for (const [role, destination] of [['student', '/student'], ['teacher', '/dashboard'], ['admin', '/admin']]) {
  test(`restored ${role} session skips the landing page and opens ${destination}`, async ({ page }) => {
    const session = await uiSession(page, role);
    await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`, url: base }]);
    await page.routeWebSocket('**/api/v1/chat/ws', socket => socket.onMessage(() => socket.send(JSON.stringify({ type: 'ready' }))));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/v1/auth/me', async route => { await gate; return respond(route, { user: session.user }); });
    await page.goto('/');
    await expect(page.getByText('Đang mở không gian làm việc…', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeHidden();
    release();
    await expect(page).toHaveURL(new RegExp(`${destination}$`));
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-public-home-auth', 'pending');
  });
}

test('expired stored session settles on the public homepage', async ({ page }) => {
  await uiSession(page);
  await page.route('**/api/v1/auth/**', route => respond(route, { error: { code: 'UNAUTHORIZED' } }, 401));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-public-home-auth', 'pending');
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => sessionStorage.getItem('ai-proctoring-current-user'))).toBeNull();
});

test('keyboard skip link and primary action contrast work in both themes', async ({ page }) => {
  await publicVisit(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Đến nội dung chính' })).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('main')).toBeFocused();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    const contrast = await page.getByRole('link', { name: 'Bắt đầu ngay', exact: true }).evaluate(node => {
      const luminance = (color: string) => {
        const v = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(value => { const x = value / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
        return v[0] * .2126 + v[1] * .7152 + v[2] * .0722;
      };
      const style = getComputedStyle(node), a = luminance(style.color), b = luminance(style.backgroundColor);
      return { ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), background: style.backgroundColor };
    });
    expect(contrast.background).toBe('rgb(0, 109, 119)'); expect(contrast.ratio).toBeGreaterThanOrEqual(4.5);
  }
});
