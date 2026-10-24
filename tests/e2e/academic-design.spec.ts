import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';

const base = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const headers = { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
async function setup(page: Page, role: string, theme: string) {
  const state = await uiSession(page, role);
  await page.clock.setFixedTime(new Date('2026-10-20T08:00:00+07:00'));
  await page.emulateMedia({ colorScheme: theme as 'light' | 'dark' });
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`, url: base }]);
  state.exams = [
    { id: 'exam-1', title: 'Cơ sở dữ liệu — Kiểm tra giữa kỳ', status: 'published', duration_minutes: 60, start_time: '2026-10-20T09:00:00+07:00', end_time: '2026-10-20T11:00:00+07:00' },
    { id: 'exam-2', title: 'Cấu trúc dữ liệu và giải thuật', status: 'ongoing', duration_minutes: 45, start_time: '2026-10-19T09:00:00+07:00', end_time: '2026-10-22T17:00:00+07:00' },
  ];
  await page.route('**/api/v1/dashboard/stats', route => route.fulfill({ headers, json: { data: { ongoing_exams: 4, active_attempts: 128, classes: 12, recent_violations: 3, recent_window_minutes: 5, as_of: '2026-10-20T01:00:00Z' } } }));
  await page.route('**/api/v1/live-classes?**', route => route.fulfill({ headers, json: { data: [{ id: 'live-1', title: 'Thảo luận đồ án học phần', status: 'scheduled', start_time: '2026-10-21T14:00:00+07:00', end_time: '2026-10-21T15:30:00+07:00' }], meta: { total: 1 } } }));
}

for (const theme of ['light', 'dark']) {
  for (const role of ['student', 'teacher', 'admin']) {
    test(`${role} ${theme}: shell and overview remain readable at desktop and mobile sizes`, async ({ page }, info) => {
      await setup(page, role, theme);
      await page.goto(role === 'student' ? '/student' : role === 'admin' ? '/admin' : '/teacher');
      await expect(page.locator('main .ui-card').first()).toBeVisible();
      await expect(page.locator('main .loading-skeleton')).toHaveCount(0);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('.sidebar nav a[aria-current="page"]')).toHaveCount(1);
      const shell = await page.locator('.app-shell').evaluate(node => {
        const sidebar = node.querySelector('.sidebar')!, card = node.querySelector('main .ui-card')!, header = node.querySelector('.topbar')!;
        const selected = getComputedStyle(node.querySelector('.sidebar nav a[aria-current="page"]')!);
        const rgb = (color: string) => (color.match(/[\d.]+/g) ?? []).map(Number);
        const under = rgb(getComputedStyle(sidebar).backgroundColor), over = rgb(selected.backgroundColor);
        const alpha = over[3] ?? 1;
        const background = under.slice(0, 3).map((v, i) => v * (1 - alpha) + over[i] * alpha);
        const luminance = (values: number[]) => values.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((total, v, i) => total + v * [.2126, .7152, .0722][i], 0);
        const fg = luminance(rgb(selected.color)), bg = luminance(background);
        return { sidebar: getComputedStyle(sidebar).backgroundColor, card: getComputedStyle(card).backgroundColor, page: getComputedStyle(node).backgroundColor, header: getComputedStyle(header).backgroundColor, logo: getComputedStyle(node.querySelector('.brand')!, '::before').backgroundImage, navContrast: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) };
      });
      expect(shell.sidebar).not.toBe(shell.page);
      expect(shell.sidebar).toBe('rgb(0, 109, 119)');
      expect(shell.navContrast).toBeGreaterThanOrEqual(4.5);
      expect(shell.card).not.toBe(shell.page);
      expect(shell.header).toBe(role==='student'?shell.page:shell.card);
      expect(shell.logo).toContain('proctoowl-mark.svg');
      await expect(page.locator('.sidebar .brand')).toHaveText('ProctoOwl');
      if (role === 'student') {
        const exam = page.locator('.calendar-event.exam').first(), live = page.locator('.calendar-event.live_class').first();
        await expect(exam).toBeVisible(); await expect(live).toBeVisible();
        expect(await exam.evaluate(e => getComputedStyle(e).backgroundColor)).not.toBe(await live.evaluate(e => getComputedStyle(e).backgroundColor));
      }
      for (const width of [1440, 1024, 768, 375]) {
        await page.setViewportSize({ width, height: 960 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        if (width >= 1024) await expect(page.locator('.sidebar')).toBeVisible();
        else {
          await page.getByRole('button', { name: 'Mở menu', exact: true }).click();
          await expect(page.getByRole('dialog', { name: 'Menu điều hướng' })).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(page.getByRole('button', { name: 'Mở menu', exact: true })).toBeFocused();
        }
        if (width === 1440 || width === 375) await page.screenshot({ path: info.outputPath(`${role}-${theme}-${width}.png`), fullPage: true });
      }
    });
  }
  test(`${theme}: semantic buttons and form controls have readable contrast`, async ({ page }, info) => {
    await setup(page, 'teacher', theme); await page.goto('/ui-kit');
    await expect(page.getByRole('button', { name: 'Primary', exact: true })).toBeVisible();
    expect(await page.getByRole('button', { name: 'Primary', exact: true }).evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(0, 109, 119)');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const contrast = await page.locator('.component-row .ui-button').evaluateAll(nodes => {
      const luminance = (color: string) => {
        const rgb = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      return nodes.map(node => {
        const style = getComputedStyle(node);
        let bg = style.backgroundColor, parent = node.parentElement;
        while ((bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') && parent) { bg = getComputedStyle(parent).backgroundColor; parent = parent.parentElement; }
        const fg = luminance(style.color), background = luminance(bg);
        return { name: node.textContent, contrast: (Math.max(fg, background) + .05) / (Math.min(fg, background) + .05) };
      });
    });
    for (const item of contrast) expect(item.contrast, item.name ?? '').toBeGreaterThanOrEqual(4.5);
    await page.getByPlaceholder('Nhập từ khóa').focus();
    await expect(page.getByPlaceholder('Nhập từ khóa')).toBeFocused();
    expect(await page.getByPlaceholder('Nhập từ khóa').evaluate(node => getComputedStyle(node).outlineWidth)).toBe('2px');
    await page.getByRole('button', { name: 'Mở dialog' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`controls-${theme}.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Mở dialog' })).toBeFocused();
  });
}

test('student schedule and navigation remain usable in landscape with reduced motion', async ({ page }, info) => {
  await setup(page, 'student', 'dark');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 812, height: 375 });
  await page.goto('/student');
  await expect(page.locator('main .ui-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(812);
  const menu = page.getByRole('button', { name: 'Mở menu', exact: true });
  await menu.click();
  const drawer = page.getByRole('dialog', { name: 'Menu điều hướng' });
  await expect(drawer).toBeVisible();
  expect((await drawer.boundingBox())!.height).toBeLessThanOrEqual(375);
  expect(await drawer.evaluate(node => getComputedStyle(node).transitionDuration.split(',').every(value => parseFloat(value) <= .01))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await page.screenshot({ path: info.outputPath('student-dark-landscape.png') });
});
