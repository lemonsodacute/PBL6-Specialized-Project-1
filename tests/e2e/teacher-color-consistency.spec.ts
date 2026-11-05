import { expect, test } from '@playwright/test';
import { teacherAuditPages, teacherColorSession } from './teacher-color-fixture';
import { uiSession } from './ui-fixtures';

function luminance(color: string) {
  const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a: string, b: string) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }

test.use({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
for (const width of [390, 768, 1024, 1440]) for (const theme of ['light', 'dark'] as const) {
  test(`teacher surfaces ${width}px ${theme}: all sections, nested pages, contrast and overflow`, async ({ page }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await teacherColorSession(page);
    await page.routeWebSocket('**/api/v1/**', () => {});
    let ctaColor: string | undefined;
    let overviewPalette: { sidebar: string; navigationInk: string; topbar: string; page: string; surface: string; border: string; ink: string } | undefined;
    for (const [name, path] of teacherAuditPages) {
      await test.step(name, async () => {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.app-shell')).toHaveAttribute('data-role', 'teacher');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const palette = await page.locator('.app-shell').evaluate(shell => {
          const main = getComputedStyle(shell.querySelector('main')!);
          return { sidebar: getComputedStyle(shell.querySelector('.sidebar')!).backgroundColor,
            navigationInk: getComputedStyle(shell.querySelector('.sidebar nav a:not([aria-current])')!).color,
            topbar: getComputedStyle(shell.querySelector('.topbar')!).backgroundColor,
            page: getComputedStyle(shell.querySelector('.workspace')!).backgroundColor,
            surface: main.getPropertyValue('--surface').trim(), border: main.getPropertyValue('--border').trim(),
            ink: main.getPropertyValue('--text-primary').trim() };
        });
        if (name === 'overview') overviewPalette = palette;
        else expect(palette, `${name} must use the current Overview palette`).toEqual(overviewPalette);
        await expect(page.locator('main .ui-card, main article, main .an-kpi').first()).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth), `${name} overflow`).toBeLessThanOrEqual(width);
        const colors = await page.locator('main').evaluate(main => {
          const style = getComputedStyle(main), card = main.querySelector('.ui-card, .an-kpi');
          return { text: style.color, card: card ? getComputedStyle(card).backgroundColor : '', page: getComputedStyle(main.parentElement!).backgroundColor };
        });
        expect(theme === 'light' ? luminance(colors.page) : 1 - luminance(colors.page)).toBeGreaterThan(.8);
        if (colors.card !== 'rgba(0, 0, 0, 0)' && colors.card) expect(contrast(colors.text, colors.card), `${name} text contrast`).toBeGreaterThanOrEqual(4.5);
        const action = page.locator('main .ui-button-primary:not(:disabled)').first();
        if (await action.count()) {
          const button = await action.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color, height: el.getBoundingClientRect().height }));
          expect(button.height).toBeGreaterThanOrEqual(44);
          expect(contrast(button.bg, button.fg), `${name} CTA contrast`).toBeGreaterThanOrEqual(4.5);
          if (ctaColor) expect(button.bg, `${name} primary CTA`).toBe(ctaColor);
          else ctaColor = button.bg;
        }
        const hero = page.locator('section[aria-labelledby="question-banks-title"], section[aria-labelledby^="teaching-"]');
        if (await hero.count()) {
          const values = await hero.evaluate(el => {
            const title = el.querySelector('h1')!, description = el.querySelector('h1 + p')!, stat = el.querySelector('dl > div')!;
            return { gradient: getComputedStyle(el).backgroundImage, title: getComputedStyle(title).color, description: getComputedStyle(description).color, stat: getComputedStyle(stat).backgroundColor, number: getComputedStyle(stat.querySelector('dd')!).color, label: getComputedStyle(stat.querySelector('dt')!).color, height: el.getBoundingClientRect().height };
          });
          const stops = values.gradient.match(/rgb\([^)]+\)/g)!;
          expect(stops.length).toBeGreaterThanOrEqual(2);
          for (const stop of stops) {
            expect(theme === 'light' ? luminance(stop) : 1 - luminance(stop)).toBeGreaterThan(.75);
            expect(contrast(values.title, stop)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(values.description, stop)).toBeGreaterThanOrEqual(4.5);
          }
          expect(contrast(values.number, values.stat)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(values.label, values.stat)).toBeGreaterThanOrEqual(4.5);
          expect(values.height).toBeLessThan(width === 390 ? 430 : 380);
        }
      });
    }
  });
}

test('teacher semantic actions keep distinct colors; save form uses the main CTA family', async ({ page }) => {
  await teacherColorSession(page);
  await page.goto('/dashboard/live-classes');
  const start = page.getByRole('button', { name: 'Bắt đầu', exact: true });
  const end = page.getByRole('button', { name: 'Kết thúc', exact: true });
  await expect(start).toBeVisible();
  const color = async (el: typeof start) => el.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
  const green = await color(start), red = await color(end), primary = await color(page.getByRole('button', { name: '+ Tạo buổi học', exact: true }));
  expect(new Set([green.bg, red.bg, primary.bg]).size).toBe(3);
  expect(contrast(green.bg, green.fg)).toBeGreaterThanOrEqual(4.5);
  await page.getByRole('button', { name: '+ Tạo buổi học', exact: true }).click();
  const save = page.getByRole('button', { name: 'Lưu buổi học', exact: true });
  expect((await color(save)).bg).toBe(primary.bg);
  await page.getByRole('dialog').getByRole('button', { name: 'Huỷ', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(save).toBeFocused();
  expect(await save.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.getByRole('dialog').getByRole('button', { name: 'Huỷ', exact: true }).click();
  await page.goto('/dashboard/exams/exam-a');
  const editSave = page.getByRole('button', { name: 'Lưu thay đổi', exact: true });
  await expect(editSave).toBeVisible();
  expect((await color(editSave)).bg).toBe(primary.bg);
});

test('teacher content overrides do not apply to student or admin content', async ({ page }) => {
  for (const role of ['student', 'admin']) {
    await uiSession(page, role);
    await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.fixture`, url: 'http://localhost:3000' }]);
    await page.goto(role === 'student' ? '/student/classes' : '/admin/classes');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-role', role);
    expect(await page.locator('main').evaluate(el => getComputedStyle(el).color)).not.toBe('rgb(23, 52, 60)');
    await page.evaluate(() => sessionStorage.clear());
  }
});
