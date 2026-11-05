import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';

const routes = {
  teacher: ['/teacher/help', '/dashboard/classes'],
  student: ['/student/help', '/student/classes'],
  admin: ['/admin/help', '/dashboard/users'],
} as const;

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const role of ['teacher', 'student', 'admin'] as const) for (const width of [1440, 390, 320]) {
  test(`${role} chat stays anchored while scrolling at ${width}px`, async ({ page }, info) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await uiSession(page, role);
    await page.routeWebSocket('**/api/v1/**', () => {});
    await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.fixture`, url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' }]);
    await page.route('**/api/v1/chat/unread-count', route => route.fulfill({
      status: route.request().method() === 'OPTIONS' ? 204 : 200,
      headers: { 'access-control-allow-origin': route.request().headers().origin ?? new URL(page.url()).origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type' },
      json: { data: { count: 3 } },
    }));
    await page.route('**/api/v1/support-assistant/sessions**', route => route.fulfill({
      status: route.request().method() === 'OPTIONS' ? 204 : 200,
      headers: { 'access-control-allow-origin': route.request().headers().origin ?? new URL(page.url()).origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' },
      json: { data: { id: 'position-fixture', status: 'AI_ACTIVE', phase: 'CATEGORY', provider_configured: true, category: null, conversation_id: null, greeting: 'Phiên kiểm tra giao diện', categories: [], topics: [], messages: [] } },
    }));
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(routes[role][0], { waitUntil: 'domcontentloaded' });
    const launcher = page.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true });
    await expect(launcher).toBeVisible();
    await expect(launcher.getByLabel('3 tin nhắn chưa đọc', { exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(launcher).toHaveCSS('position', 'fixed');
    const baseline = (await launcher.boundingBox())!;
    const gap = width < 768 ? 16 : 24;
    expect(baseline.x + baseline.width).toBe(width - gap);
    expect(baseline.y + baseline.height).toBe(900 - gap);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    // Move a normal page action through the launcher's viewport position.
    // The old collision hook raised the launcher when this action passed it.
    await page.locator('main').evaluate(main => {
      const section = document.createElement('section');
      section.style.cssText = 'height:2400px;position:relative';
      const action = document.createElement('button');
      action.id = 'chat-scroll-probe';
      action.dataset.chatAvoid = '';
      action.textContent = 'Kiểm tra vị trí';
      action.style.cssText = 'position:absolute;top:1000px;right:0;width:160px;height:64px';
      section.append(action);
      main.append(section);
    });
    const collisionScroll = await page.locator('#chat-scroll-probe').evaluate((el, y) => el.getBoundingClientRect().top + scrollY - y, baseline.y);
    for (const top of [collisionScroll, collisionScroll + 300, 0]) {
      await page.evaluate(top => window.scrollTo({ top, behavior: 'instant' }), top);
      await settle(page);
      expect(await launcher.boundingBox()).toEqual(baseline);
    }
    await page.locator('#chat-scroll-probe').evaluate(el => {
      const scroller = document.createElement('div');
      scroller.style.cssText = 'height:100px;overflow:auto';
      const content = document.createElement('div');
      content.style.height = '600px';
      scroller.append(content);
      el.parentElement!.append(scroller);
      scroller.scrollTop = 400;
    });
    await settle(page);
    expect(await launcher.boundingBox()).toEqual(baseline);

    // A transformed/paint-containing shell must not become its fixed container.
    await page.locator('.app-shell').evaluate(shell => {
      (shell as HTMLElement).style.transform = 'translateZ(0)';
      (shell as HTMLElement).style.contain = 'paint';
    });
    await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'instant' }));
    await settle(page);
    expect(await launcher.boundingBox()).toEqual(baseline);
    const topbar = (await page.locator('.topbar').boundingBox())!;
    expect(baseline.y).toBeGreaterThan(topbar.y + topbar.height);
    if (width === 1440) {
      const sidebar = (await page.locator('.sidebar').boundingBox())!;
      expect(baseline.x).toBeGreaterThan(sidebar.x + sidebar.width);
      const contentBox = await page.locator('main').boundingBox();
      await launcher.hover();
      await launcher.focus();
      const tooltip = page.getByRole('tooltip', { name: 'Tin nhắn hỗ trợ', exact: true });
      await expect(tooltip).toBeVisible();
      const label = (await tooltip.boundingBox())!;
      expect(label.x + label.width + 10).toBeCloseTo(baseline.x, 1);
      expect(label.y + label.height / 2).toBeCloseTo(baseline.y + baseline.height / 2, 1);
      expect(await launcher.boundingBox()).toEqual(baseline);
      expect(await page.locator('main').boundingBox()).toEqual(contentBox);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`${role}-${width}-fixed.png`) });

    await page.goto(routes[role][1], { waitUntil: 'domcontentloaded' });
    await expect(launcher).toBeVisible();
    expect(await launcher.boundingBox()).toEqual(baseline);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width === 1440) {
      await launcher.click();
      if (role === 'admin') {
        await expect(page).toHaveURL(/\/admin\/messages$/);
        await expect(launcher).toHaveCount(0);
      } else {
        const dialog = page.getByRole('dialog', { name: 'ProctoOwl Support', exact: true });
        await expect(dialog).toBeVisible();
        await expect(launcher).toBeHidden();
        await dialog.getByRole('button', { name: 'Đóng chat hỗ trợ', exact: true }).click();
        await expect(launcher).toBeFocused();
        expect(await launcher.boundingBox()).toEqual(baseline);
        await launcher.click();
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(launcher).toBeFocused();
        await expect(launcher.getByLabel('3 tin nhắn chưa đọc', { exact: true })).toBeVisible();
      }
    }
    expect(errors).toEqual([]);
  });
}
