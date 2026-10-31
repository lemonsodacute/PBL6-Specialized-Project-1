import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) for (const theme of ['light', 'dark'] as const) {
  test(`login shares Home typography and controls, with its original palette: ${width} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const home = await page.evaluate(() => {
      const hero = document.querySelector('#hero-title')!.closest('section')!;
      const root = getComputedStyle(hero.closest('main')!.parentElement!);
      const dots = getComputedStyle(hero, '::before');
      const logo = document.querySelector('header a[aria-label="ProctoOwl — Trang chủ"]')!;
      const cta = hero.querySelector('a[href="/login?mode=register"]')!;
      // Home now has its own warm light variant. Auth keeps the base palette.
      const probe = document.createElement('div');
      probe.style.backgroundColor = 'var(--procto-bg)';
      probe.style.backgroundImage = 'var(--procto-dot-pattern)';
      document.body.append(probe);
      const baseBackground = getComputedStyle(probe).backgroundColor;
      const baseDots = getComputedStyle(probe).backgroundImage;
      probe.remove();
      return {
        background: root.backgroundColor, baseBackground, baseDots, body: root.fontFamily,
        heading: getComputedStyle(document.querySelector('#features-title')!).fontFamily,
        dots: dots.backgroundImage, spacing: dots.backgroundSize,
        logoFont: getComputedStyle(logo).fontFamily, logoSrc: logo.querySelector('img')!.getAttribute('src'),
        ctaFont: getComputedStyle(cta).fontFamily, ctaColor: getComputedStyle(cta).backgroundColor,
        ctaRadius: getComputedStyle(cta).borderRadius,
      };
    });
    await page.goto('/login');
    await page.evaluate(() => document.fonts.ready);
    const actual = await page.evaluate(() => {
      const root = getComputedStyle(document.querySelector('main')!);
      const logo = document.querySelector('a[aria-label="ProctoOwl — Trang chủ"]')!;
      const cta = getComputedStyle(document.querySelector('.login-submit')!);
      return {
        background: root.backgroundColor, body: root.fontFamily,
        heading: getComputedStyle(document.querySelector('h1')!).fontFamily,
        dots: root.backgroundImage, spacing: root.backgroundSize,
        logoFont: getComputedStyle(logo).fontFamily, logoSrc: logo.querySelector('img')!.getAttribute('src'),
        ctaFont: cta.fontFamily, ctaColor: cta.backgroundColor, ctaRadius: cta.borderRadius,
      };
    });
    // Home appends sans-serif to a token that already includes it. Repeated
    // fallback entries do not change the selected font or its fallback order.
    const fontStack = (value: string) => [...new Set(value.split(',').map(font => font.trim()))].join(',');
    const { baseBackground, baseDots, ...homePresentation } = home;
    expect(home.background).toBe(theme === 'light' ? 'rgb(255, 248, 243)' : baseBackground);
    expect({ ...actual, ctaFont: fontStack(actual.ctaFont) }).toEqual({
      ...homePresentation, background: baseBackground, dots: baseDots, ctaFont: fontStack(home.ctaFont),
    });
    await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
    const back = page.getByRole('link', { name: 'Quay lại trang chủ', exact: true });
    await expect(back).toHaveAttribute('href', '/#trang-chu');
    expect(await back.evaluate(el => !!el.closest('form'))).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.getByLabel('Email', { exact: true }).focus();
    await expect(page.getByLabel('Email', { exact: true })).toHaveCSS('border-color', 'rgb(0, 109, 119)');
    await back.focus();
    expect(await back.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/#trang-chu');
    await expect(page.locator('#hero-title')).toBeVisible();
  });
}
