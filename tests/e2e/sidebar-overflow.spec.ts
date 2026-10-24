import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';

// Headless Chromium otherwise hides all scrollbars itself, masking this bug.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

async function visitAdmin(page: Page) {
  await uiSession(page, 'admin');
  await page.context().addCookies([{
    name: 'auth_token',
    value: `fixture.${Buffer.from(JSON.stringify({ role: 'admin' })).toString('base64url')}.signature`,
    url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
  }]);
  await page.addInitScript(() => localStorage.setItem('proctoowl-sidebar-collapsed', 'false'));
  await page.goto('/admin');
  // The development-only Next.js launcher otherwise covers the Help icon.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await expect(page.getByRole('button', { name: 'Thu gọn thanh điều hướng', exact: true })).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
}

async function checkLayout(page: Page) {
  const sidebar = page.locator('#workspace-sidebar');
  const nav = sidebar.locator('nav');
  await expect(nav).toHaveCSS('overflow-y', 'auto');
  await expect(nav).toHaveCSS('scrollbar-width', 'none');
  expect(await nav.evaluate(el => {
    const style = getComputedStyle(el, '::-webkit-scrollbar');
    return { width: style.width, height: style.height };
  })).toEqual({ width: '0px', height: '0px' });
  const geometry = await sidebar.evaluate(el => {
    const nav = el.querySelector('nav')!;
    const footer = el.querySelector('.sidebar-bottom')!;
    const rect = el.getBoundingClientRect();
    return {
      top: rect.top, bottom: rect.bottom, height: rect.height,
      sidebarWidth: el.clientWidth, sidebarScrollWidth: el.scrollWidth,
      sidebarHeight: el.clientHeight, sidebarScrollHeight: el.scrollHeight,
      navWidth: nav.clientWidth, navScrollWidth: nav.scrollWidth,
      navBottom: nav.getBoundingClientRect().bottom,
      footerTop: footer.getBoundingClientRect().top,
      footerBottom: footer.getBoundingClientRect().bottom,
    };
  });
  expect(geometry.top).toBe(0);
  expect(geometry.height).toBe(page.viewportSize()!.height);
  expect(geometry.sidebarScrollHeight).toBe(geometry.sidebarHeight);
  expect(geometry.sidebarScrollWidth).toBe(geometry.sidebarWidth);
  expect(geometry.navScrollWidth).toBe(geometry.navWidth);
  expect(geometry.navBottom).toBeLessThanOrEqual(geometry.footerTop);
  expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.bottom);
  for (const name of ['Cài đặt', 'Trợ giúp']) {
    const action = sidebar.getByRole('link', { name, exact: true });
    await expect(action).toBeInViewport();
    await action.click({ trial: true });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }]) {
  test(`${viewport.width}x${viewport.height}: submenu and compact flyout have no sidebar scrollbar`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await visitAdmin(page);
    const sidebar = page.locator('#workspace-sidebar');
    const users = sidebar.getByRole('button', { name: 'Quản lý người dùng', exact: true });
    await expect(users).toHaveAttribute('aria-expanded', 'false');
    await checkLayout(page);
    await users.click();
    await expect(users).toHaveAttribute('aria-expanded', 'true');
    for (const name of ['Danh sách người dùng', 'Xác thực thẻ sinh viên']) {
      await expect(sidebar.getByRole('link', { name, exact: true })).toBeInViewport();
    }
    await checkLayout(page);
    await page.screenshot({ path: `artifacts/sidebar-overflow/expanded-${viewport.width}x${viewport.height}.png`, animations: 'disabled' });
    await sidebar.getByRole('button', { name: 'Thu gọn thanh điều hướng', exact: true }).click();
    await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(80);
    await checkLayout(page);
    await users.click();
    const panel = page.getByRole('region', { name: 'Quản lý người dùng', exact: true });
    await expect(panel).toBeInViewport();
    await expect(panel.getByRole('link', { name: 'Danh sách người dùng', exact: true })).toHaveAttribute('href', '/dashboard/users');
    await expect(panel.getByRole('link', { name: 'Xác thực thẻ sinh viên', exact: true })).toHaveAttribute('href', '/admin/student-cards');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(users).toBeFocused();
    await page.screenshot({ path: `artifacts/sidebar-overflow/compact-${viewport.width}x${viewport.height}.png`, animations: 'disabled' });
  });
}

test('short viewport: wheel scrolls only nav, footer stays reachable and page scroll is independent', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 560 });
  await visitAdmin(page);
  const sidebar = page.locator('#workspace-sidebar');
  const nav = sidebar.locator('nav');
  await sidebar.getByRole('button', { name: 'Quản lý người dùng', exact: true }).click();
  await checkLayout(page);
  expect(await nav.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
  const brandBefore = await sidebar.locator('.brand').boundingBox();
  const footerBefore = await sidebar.locator('.sidebar-bottom').boundingBox();
  const pageBefore = await page.evaluate(() => window.scrollY);
  await nav.hover();
  await page.mouse.wheel(0, 700);
  await expect.poll(() => nav.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await sidebar.evaluate(el => el.scrollTop)).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageBefore);
  expect(await sidebar.locator('.brand').boundingBox()).toEqual(brandBefore);
  expect(await sidebar.locator('.sidebar-bottom').boundingBox()).toEqual(footerBefore);
  await expect(nav.getByRole('link', { name: 'Nhật ký hệ thống', exact: true })).toBeInViewport();
  // Guarantee enough main content to exercise document scrolling with any fixture data.
  await page.locator('main').evaluate(el => { el.style.minHeight = '1800px'; });
  const navBefore = await nav.evaluate(el => el.scrollTop);
  await page.mouse.move(1000, 400);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(pageBefore);
  expect(await nav.evaluate(el => el.scrollTop)).toBe(navBefore);
  await checkLayout(page);
  await sidebar.getByRole('button', { name: 'Thu gọn thanh điều hướng', exact: true }).click();
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(80);
  await checkLayout(page);
  await nav.evaluate(el => { el.scrollTop = 0; });
  const compactPageBefore = await page.evaluate(() => window.scrollY);
  await nav.hover();
  await page.mouse.wheel(0, 700);
  await expect.poll(() => nav.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(compactPageBefore);
  await expect(nav.getByRole('link', { name: 'Nhật ký hệ thống', exact: true })).toBeInViewport();
});
