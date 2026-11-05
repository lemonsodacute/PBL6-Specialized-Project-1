import { expect, test } from '@playwright/test';

test('sections reveal once and focusing a CTA makes it immediately visible', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect(page.locator('#trang-chu')).toHaveAttribute('data-eye-tracking', 'enabled');
  const feature = page.locator('#tinh-nang article').first();
  await expect(feature).toHaveCSS('opacity', '0');
  await page.locator('#tinh-nang').scrollIntoViewIfNeeded();
  await expect(feature).toHaveCSS('opacity', '1');
  await expect(feature).toHaveCSS('transform', 'none');
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator('#tinh-nang').scrollIntoViewIfNeeded();
  await expect(feature).toHaveCSS('opacity', '1');
  await expect(feature).toHaveCSS('transform', 'none');

  const finalCta = page.locator('[class*="finalCta"]');
  await expect(finalCta).toHaveCSS('opacity', '0');
  await finalCta.getByRole('link', { name: 'Đăng nhập', exact: true }).focus();
  await expect(finalCta).toHaveCSS('opacity', '1');
  await expect(finalCta).toHaveCSS('transform', 'none');
});

test('reduced motion cancels active entrances and restores all unvisited sections', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const hero = page.locator('#trang-chu');
  await expect(hero).toHaveAttribute('data-eye-tracking', 'enabled');
  // Change preference while a feature batch is pending or entering.
  await page.locator('#tinh-nang article').first().evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(hero).toHaveAttribute('data-eye-tracking', 'static');
  for (const selector of ['#hero-title', '[class*="heroActions"]', '[class*="monitorPreview"]', '#tinh-nang article', '[class*="rolesGrid"] > article', '[class*="finalCta"]']) {
    await expect(page.locator(selector).first()).toHaveCSS('opacity', '1');
    await expect(page.locator(selector).first()).toHaveCSS('transform', 'none');
  }
  const snapshot = await hero.locator('[data-eye-beam="left"]').getAttribute('d');
  await page.mouse.move(200, 400);
  await page.waitForTimeout(200);
  expect(await hero.locator('[data-eye-beam="left"]').getAttribute('d')).toBe(snapshot);
  for (const card of await page.locator('#tinh-nang article').all()) {
    await expect(card).toHaveCSS('opacity', '1');
    await expect(card).toHaveCSS('transform', 'none');
  }
});

test('mobile artwork, feature cards and final CTA reveal when reached, only once', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 520 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect(page.locator('#trang-chu')).toHaveAttribute('data-eye-tracking', 'static');
  await page.evaluate(() => document.fonts.ready);
  const artwork = page.locator('[data-owl]');
  const preview = page.locator('[class*="monitorPreview"]');
  await expect(page.locator('#hero-title')).toHaveCSS('opacity', '1');
  await expect(artwork).toHaveCSS('opacity', '0');
  await expect(preview).toHaveCSS('opacity', '0');
  await page.locator('#trang-chu figure').evaluate(node => scrollTo(0, node.getBoundingClientRect().top + scrollY - innerHeight * .75));
  await expect(artwork).toHaveCSS('opacity', '1');
  await expect(preview).toHaveCSS('opacity', '1');

  const cards = page.locator('#tinh-nang article');
  await cards.first().evaluate(node => scrollTo(0, node.getBoundingClientRect().top + scrollY - innerHeight * .5));
  await expect(cards.first()).toHaveCSS('opacity', '1');
  await expect(cards.last()).toHaveCSS('opacity', '0');
  await cards.last().scrollIntoViewIfNeeded();
  await expect(cards.last()).toHaveCSS('opacity', '1');
  const cta = page.locator('[class*="finalCta"]');
  await expect(cta).toHaveCSS('opacity', '0');
  await cta.scrollIntoViewIfNeeded();
  await expect(cta).toHaveCSS('opacity', '1');
  await expect(cta).toHaveCSS('transform', 'none');

  await page.evaluate(() => scrollTo(0, 0));
  await expect(artwork).toHaveCSS('opacity', '1');
  await expect(cards.first()).toHaveCSS('opacity', '1');
  await expect(cta).toHaveCSS('opacity', '1');
});

test('CTA trigger follows layout changes when FAQ answers expand', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect(page.locator('#trang-chu')).toHaveAttribute('data-eye-tracking', 'enabled');
  await page.evaluate(() => document.fonts.ready);
  const cta = page.locator('[class*="finalCta"]');
  const oldTop = await cta.evaluate(node => node.getBoundingClientRect().top + scrollY);
  await page.locator('#ho-tro details').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
  await expect.poll(() => cta.evaluate(node => node.getBoundingClientRect().top + scrollY)).toBeGreaterThan(oldTop + 50);
  await page.evaluate(top => scrollTo(0, top - innerHeight * .85), oldTop);
  await expect(cta).toHaveCSS('opacity', '0');
  await cta.scrollIntoViewIfNeeded();
  await expect(cta).toHaveCSS('opacity', '1');
});

for (const width of [390, 768, 1440]) test(`settled hero layout and content match reduced motion at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect(page.locator('#trang-chu')).toHaveAttribute('data-eye-tracking', width > 600 ? 'enabled' : 'static');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[class*="heroTrust"]')).toHaveCSS('transform', 'none');
  await expect(page.locator('[class*="monitorPreview"]')).toHaveCSS('opacity', '1');
  const layout = () => page.locator('#trang-chu, #hero-title, [class*="heroDescription"], [class*="heroActions"], [data-owl], [class*="monitorPreview"]').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, text: node.textContent };
  }));
  const animated = await layout();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('#trang-chu')).toHaveAttribute('data-eye-tracking', 'static');
  expect(await layout()).toEqual(animated);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test('owl painting stops offscreen and tracking resumes on return', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const hero = page.locator('#trang-chu');
  await expect(hero).toHaveAttribute('data-eye-tracking', 'enabled');
  await page.mouse.move(300, 400);
  await page.locator('#ho-tro').scrollIntoViewIfNeeded();
  await expect.poll(async () => (await hero.boundingBox())!.y + (await hero.boundingBox())!.height).toBeLessThan(0);
  await expect.poll(() => hero.evaluate(async node => {
    let count = 0;
    const observer = new MutationObserver(records => { count += records.length; });
    observer.observe(node, { attributes: true, subtree: true });
    node.dispatchEvent(new PointerEvent('pointerenter', { clientX: 500, clientY: 300, pointerType: 'mouse' }));
    node.dispatchEvent(new PointerEvent('pointermove', { clientX: 600, clientY: 400, pointerType: 'mouse' }));
    await new Promise(resolve => setTimeout(resolve, 200));
    observer.disconnect();
    return count;
  })).toBe(0);
  await page.evaluate(() => scrollTo(0, 0));
  const idle = await hero.locator('[data-eye-beam="left"]').getAttribute('d');
  const box = (await hero.boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 300);
  await expect.poll(() => hero.locator('[data-eye-beam="left"]').getAttribute('d')).not.toBe(idle);
  await expect(hero.locator('[data-eye-spotlights]')).toHaveCSS('opacity', '1');
});
