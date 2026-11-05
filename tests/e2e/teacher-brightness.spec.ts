import { expect, test } from '@playwright/test';
import { teacherColorSession } from './teacher-color-fixture';

const collections = ['/dashboard/question-banks', '/dashboard/classes', '/dashboard/live-classes'];
function luminance(color: string) {
  const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  const rgb = channels.map(value => color.startsWith('color(srgb') ? value : value / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a: string, b: string) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }

test.use({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
for (const [width, theme] of [[320, 'light'], [390, 'light'], [768, 'light'], [1024, 'light'], [1440, 'light'], [390, 'dark'], [1440, 'dark']] as const) {
  test(`collections match current Overview surfaces at ${width}px ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await teacherColorSession(page);
    await page.goto('/dashboard', { waitUntil: 'networkidle' });
    await expect(page.locator('.an-kpi').first()).toBeVisible();
    const baseline = await page.locator('main').evaluate(main => {
      const card = getComputedStyle(main.querySelector('.ui-card')!), kpi = getComputedStyle(main.querySelector('.an-kpi')!);
      return { page: getComputedStyle(main.closest('.workspace')!).backgroundColor, surface: card.backgroundColor,
        border: card.borderTopColor, ink: card.color, muted: getComputedStyle(main.querySelector('.card-toolbar p')!).color, shadow: kpi.boxShadow };
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const path of collections) await test.step(path, async () => {
      await page.goto(path, { waitUntil: 'networkidle' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const hero = page.locator('section[aria-labelledby="question-banks-title"], section[aria-labelledby^="teaching-"]');
      await expect(hero).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const colors = await hero.evaluate(el => {
        const s = getComputedStyle(el), title = getComputedStyle(el.querySelector('h1')!), description = getComputedStyle(el.querySelector('h1 + p')!);
        const stat = getComputedStyle(el.querySelector('dl > div')!);
        const card = getComputedStyle(document.querySelector('main .question-bank-card, main [data-teaching-class], main [data-live-session]')!);
        const filter = getComputedStyle(document.querySelector('main fieldset[role="search"]')!.closest('.ui-card')!);
        return { page: getComputedStyle(el.closest('.workspace')!).backgroundColor, gradient: s.backgroundImage,
          title: title.color, description: description.color, border: s.borderTopColor,
          stat: stat.backgroundColor, statBorder: stat.borderTopColor, surface: card.backgroundColor,
          cardBorder: card.borderTopColor, ink: card.color, shadow: card.boxShadow, filter: filter.backgroundColor, filterBorder: filter.borderTopColor };
      });
      expect(colors.page).toBe(baseline.page);
      expect(colors.surface).toBe(baseline.surface);
      expect(colors.filter).toBe(baseline.surface);
      expect(colors.cardBorder).toBe(baseline.border);
      expect(colors.filterBorder).toBe(baseline.border);
      expect(colors.ink).toBe(baseline.ink);
      expect(colors.shadow).toBe(baseline.shadow);
      const stops = colors.gradient.match(/rgb\([^)]+\)/g)!;
      expect(stops.length).toBeGreaterThanOrEqual(2);
      for (const stop of stops) {
        expect(contrast(colors.title, stop)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors.description, stop)).toBeGreaterThanOrEqual(4.5);
        if (theme === 'light') expect(luminance(stop)).toBeGreaterThanOrEqual(luminance(baseline.page) - .005);
      }
      if (theme === 'light') {
        expect(colors.title).toBe(baseline.ink);
        expect(colors.description).toBe(baseline.muted);
        expect(colors.border).toBe(baseline.border);
        expect(colors.stat).toBe(baseline.surface);
        expect(colors.statBorder).toBe(baseline.border);
      }
      for (const field of await page.locator('main fieldset .ui-field').all()) {
        const values = await field.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, height: el.getBoundingClientRect().height }));
        expect(contrast(values.color, values.background)).toBeGreaterThanOrEqual(4.5);
        expect(values.height).toBeGreaterThanOrEqual(44);
        if (theme === 'light') expect(luminance(values.background)).toBeGreaterThan(luminance(baseline.page));
      }
      for (const chip of await page.locator('main [class*="dateTile"], main [class*="period"], main [class*="subject"] span, main [class*="avatar"]').all()) {
        const values = await chip.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
        expect(contrast(values.color, values.background)).toBeGreaterThanOrEqual(4.5);
        if (theme === 'light') expect(luminance(values.background)).toBeGreaterThan(.9);
      }
    });
  });
}
