import { expect, test, type Locator } from '@playwright/test';

// The pointer lies along the cone's center line, before its transparent far end.
async function beamAimError(hero: Locator, target: { x: number; y: number }) {
  return hero.locator('[data-eye-beam]').evaluateAll((nodes, target) => Math.max(...nodes.map(el => {
    const p = el.getAttribute('d')!.match(/[-\d.e+]+/g)!.map(Number);
    const rect = el.closest('section')!.getBoundingClientRect();
    const vx = (p[2] + p[6]) / 2 - p[0], vy = (p[3] + p[7]) / 2 - p[1];
    const dx = target.x - rect.left - p[0], dy = target.y - rect.top - p[1];
    const length = Math.hypot(vx, vy);
    const along = (vx * dx + vy * dy) / length;
    return along < 0 || along > length - 20 ? Infinity : Math.abs(vx * dy - vy * dx) / length;
  })), target);
}

for (const width of [1440, 1920, 1024]) test(`eye light crosses internal hero boundaries at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 960 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await page.goto('/');
  const hero = page.locator('#trang-chu');
  const lights = hero.locator('[data-eye-spotlights]');
  await expect(hero).toHaveAttribute('data-eye-tracking', 'enabled');
  await page.evaluate(() => document.fonts.ready);
  // Both layers must paint independently of the owl and monitoring card.
  const box = (await hero.boundingBox())!;
  const viewport = await page.evaluate(() => document.documentElement.clientWidth);
  expect(box.x).toBe(0);
  expect(box.width).toBe(viewport);
  expect((await lights.boundingBox())!.width).toBe(viewport);
  await expect(lights).toHaveCSS('overflow', 'visible');
  const owl = (await hero.locator('[data-owl]').boundingBox())!;
  const figure = (await hero.locator('figure').boundingBox())!;
  const card = (await hero.locator('[class*="monitorPreview"]').boundingBox())!;
  const cta = (await hero.locator('[class*="heroActions"] a').first().boundingBox())!;
  const targets = [
    { name: 'top-left', x: box.x + 12, y: box.y + 12 },
    { name: 'left', x: box.x + 12, y: box.y + box.height * .5 },
    { name: 'bottom-left', x: cta.x + cta.width / 2, y: cta.y + cta.height / 2 },
    { name: 'right', x: box.x + box.width - 12, y: box.y + 20 },
    { name: 'top', x: box.x + box.width * .5, y: box.y + 8 },
    { name: 'bottom', x: figure.x + 60, y: box.y + box.height - 10 },
    { name: 'text', x: box.x + 140, y: box.y + 250 },
    { name: 'card', x: card.x + card.width * .6, y: card.y + 120 },
    { name: 'center', x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { name: 'near-owl', x: owl.x + owl.width / 2, y: owl.y + owl.height * .35 },
    { name: 'bottom-right', x: box.x + box.width - 12, y: box.y + box.height - 12 },
  ];
  await expect(lights).toHaveCSS('pointer-events', 'none');
  expect(await lights.evaluate(el => el.parentElement?.id)).toBe('trang-chu');
  await expect(lights).toHaveCSS('opacity', '0.78');
  await expect(hero.locator('[data-eye-ambient]')).toHaveCount(2);
  await expect(hero.locator('[data-eye-beam="left"]')).toHaveAttribute('d', /^M /);

  for (const target of targets) {
    await page.mouse.move(target.x, target.y);
    await expect.poll(() => beamAimError(hero, target)).toBeLessThan(.25);

    const origins = await hero.locator('[data-eye-beam]').evaluateAll(nodes => nodes.map(el => {
      const path = el.getAttribute('d')!.match(/[-\d.]+/g)!.map(Number);
      const pupil = document.querySelector(`[data-eye-origin="${el.getAttribute('data-eye-beam')}"]`)!.getBoundingClientRect();
      const rect = el.closest('section')!.getBoundingClientRect();
      return { x: path[0] + rect.left, y: path[1] + rect.top, pupilX: pupil.left + pupil.width / 2, pupilY: pupil.top + pupil.height / 2 };
    }));
    for (const origin of origins) expect(Math.hypot(origin.x - origin.pupilX, origin.y - origin.pupilY)).toBeLessThan(.1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport);
    for (const transform of await hero.locator('[data-pupil]').evaluateAll(nodes => nodes.map(el => el.getAttribute('transform')!))) {
      const [x, y] = transform.match(/[-\d.]+/g)!.map(Number);
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(9.01);
    }
    const beams = await hero.locator('[data-eye-beam], [data-eye-ambient]').evaluateAll(nodes => nodes.map(el => {
      const p = el.getAttribute('d')!.match(/[-\d.e+]+/g)!.map(Number);
      return { ambient: el.hasAttribute('data-eye-ambient'),
        length: Math.hypot((p[2] + p[6]) / 2 - p[0], (p[3] + p[7]) / 2 - p[1]),
        width: Math.hypot(p[2] - p[6], p[3] - p[7]) };
    }));
    for (const beam of beams) {
      expect(beam.length).toBeGreaterThanOrEqual(179.9);
      expect(beam.length).toBeLessThanOrEqual(Math.hypot(box.width, box.height) * 1.2 + .1);
      expect(beam.width / beam.length).toBeGreaterThan(.5);
    }
    expect(beams[0].length).toBeGreaterThanOrEqual(beams[2].length);
    expect(beams[0].width).toBeGreaterThan(beams[2].width);

    if (['left', 'right', 'top', 'bottom'].includes(target.name)) {
      const origin = origins[0];
      const samples = [.45, .6, .7, .8, .9, .95, .98].map(t => ({ x: origin.x + (target.x - origin.x) * t, y: origin.y + (target.y - origin.y) * t }));
      const sample = samples.find(p => {
        const outside = (r: typeof box) => p.x + 8 < r.x || p.x - 8 > r.x + r.width || p.y + 8 < r.y || p.y - 8 > r.y + r.height;
        return outside(owl) && outside(card)
          && (target.name !== 'left' || p.x + 8 < figure.x)
          && (target.name !== 'right' || p.x - 8 > owl.x + owl.width)
          && (target.name !== 'bottom' || p.y - 8 > card.y + card.height);
      });
      expect(sample, `Need a visible background sample beyond the ${target.name} boundary`).toBeTruthy();
      const clip = { x: Math.floor(sample!.x - 8), y: Math.floor(sample!.y - 8), width: 16, height: 16 };
      const illuminated = await page.screenshot({ clip });
      await lights.evaluate(el => { el.style.visibility = 'hidden'; });
      const unlit = await page.screenshot({ clip });
      await lights.evaluate(el => { el.style.removeProperty('visibility'); });
      expect(illuminated.equals(unlit), `Cone must paint beyond the ${target.name} boundary`).toBe(false);
    }
    await page.screenshot({ path: info.outputPath(`${target.name}.png`) });
  }

  // Foreground card/text remain above the decorative light and clickable.
  const layers = await hero.evaluate(root => ['[data-eye-spotlights]', '[class*="heroCopy"]', '[class*="monitorPreview"]'].map(selector => Number(getComputedStyle(root.querySelector(selector)!).zIndex)));
  expect(layers[0]).toBeLessThan(layers[1]);
  expect(layers[0]).toBeLessThan(layers[2]);
  await hero.getByRole('link', { name: 'Bắt đầu ngay', exact: true }).click({ trial: true });
  await hero.getByRole('link', { name: 'Tìm hiểu tính năng', exact: true }).click({ trial: true });

  // A settled pointer must stop scheduling frames; scrolling keeps coordinates aligned.
  await page.mouse.move(box.x + 100, box.y + 350);
  await expect.poll(() => lights.evaluate(el => Number(el.style.opacity))).toBeGreaterThan(.99);
  await page.evaluate(() => scrollTo(0, 40));
  await expect.poll(() => beamAimError(hero, { x: box.x + 100, y: box.y + 350 })).toBeLessThan(.3);
  await expect.poll(async () => {
    const settled = await hero.locator('[data-eye-beam="left"]').getAttribute('d');
    await page.waitForTimeout(150);
    return await hero.locator('[data-eye-beam="left"]').getAttribute('d') === settled;
  }).toBe(true);

  await page.mouse.move(5, 5);
  await expect.poll(() => lights.evaluate(el => Number(el.style.opacity))).toBeLessThan(.79);
  await expect.poll(() => lights.evaluate(el => Number(el.style.opacity))).toBeGreaterThan(.77);
  // No perpetual painting once the idle direction has settled.
  await expect.poll(async () => lights.evaluate(async el => {
    let mutations = 0;
    const observer = new MutationObserver(records => { mutations += records.length; });
    observer.observe(el, { attributes: true, subtree: true });
    await new Promise(resolve => setTimeout(resolve, 160));
    observer.disconnect();
    return mutations;
  })).toBe(0);
});

test('light reaches both viewport edges outside the centered content without a clipping ancestor', async ({ page }, info) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await page.goto('/');
  const hero = page.locator('#trang-chu');
  const lights = hero.locator('[data-eye-spotlights]');
  await expect(hero).toHaveAttribute('data-eye-tracking', 'enabled');
  await expect(hero.locator('[class*="heroTrust"]')).toHaveCSS('transform', 'none');
  const ancestors = await lights.evaluate(node => {
    const result = [];
    for (let el: Element | null = node; el; el = el.parentElement) {
      const css = getComputedStyle(el);
      result.push({ tag: el.tagName, overflowX: css.overflowX, overflowY: css.overflowY,
        contain: css.contain, clipPath: css.clipPath, mask: css.maskImage, radius: css.borderRadius });
    }
    return result;
  });
  for (const ancestor of ancestors) {
    expect(['hidden', 'clip']).not.toContain(ancestor.overflowX);
    expect(['hidden', 'clip']).not.toContain(ancestor.overflowY);
    expect(ancestor.contain).not.toMatch(/paint|strict|content/);
    expect(ancestor.clipPath).toBe('none');
    expect(ancestor.mask).toBe('none');
    expect(ancestor.radius).toBe('0px');
  }
  const centered = (await hero.locator('[class*="heroContent"]').boundingBox())!;
  expect(centered.x).toBeGreaterThan(300);
  const box = (await hero.boundingBox())!;
  for (const [name, x] of [['left', 4], ['right', 1916]] as const) {
    const target = { x, y: box.y + 180 };
    await page.mouse.move(target.x, target.y);
    await expect.poll(() => beamAimError(hero, target)).toBeLessThan(.1);
    const clip = { x: name === 'left' ? 0 : 1908, y: Math.floor(target.y - 10), width: 12, height: 20 };
    const lit = await page.screenshot({ clip });
    await lights.evaluate(el => { el.style.visibility = 'hidden'; });
    const unlit = await page.screenshot({ clip });
    await lights.evaluate(el => { el.style.removeProperty('visibility'); });
    expect(lit.equals(unlit), `Visible light at the far ${name} viewport edge`).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1920);
    await page.screenshot({ path: info.outputPath(`full-width-${name}.png`) });
  }
});

for (const width of [768, 390]) test(`static touch spotlight remains contained at ${width}px`, async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width, height: 1400 }, hasTouch: true,
    isMobile: width === 390, colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto('/');
  const hero = page.locator('#trang-chu');
  await expect(hero).toHaveAttribute('data-eye-tracking', 'static');
  const beam = hero.locator('[data-eye-beam="left"]');
  await expect(beam).toHaveAttribute('d', /^M /);
  const lights = hero.locator('[data-eye-spotlights]');
  await expect(lights).toBeVisible();
  expect(await lights.evaluate(el => Number(el.style.opacity))).toBeGreaterThan(.5);
  const initial = await beam.getAttribute('d');
  await page.mouse.move(100, 200);
  await page.waitForTimeout(200);
  expect(await beam.getAttribute('d')).toBe(initial);
  const length = await beam.evaluate(el => {
    const p = el.getAttribute('d')!.match(/[-\d.]+/g)!.map(Number);
    return Math.hypot((p[2] + p[6]) / 2 - p[0], (p[3] + p[7]) / 2 - p[1]);
  });
  expect(length).toBeLessThan(340);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await hero.getByRole('link', { name: 'Bắt đầu ngay', exact: true }).click({ trial: true });
  await page.screenshot({ path: info.outputPath(`${width}-static.png`), fullPage: true });
  await context.close();
});

test('reduced motion keeps a visible static beam and responds to preference changes', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const hero = page.locator('#trang-chu');
  const lights = hero.locator('[data-eye-spotlights]');
  const beam = hero.locator('[data-eye-beam="left"]');
  await expect(hero).toHaveAttribute('data-eye-tracking', 'static');
  await expect(beam).toHaveAttribute('d', /^M /);
  await expect(lights).toHaveCSS('opacity', '0.78');
  await expect(lights).toBeVisible();
  const initial = await beam.getAttribute('d');
  await page.mouse.move(300, 400);
  await page.waitForTimeout(200);
  expect(await beam.getAttribute('d')).toBe(initial);
  await page.screenshot({ path: info.outputPath('reduced-motion.png') });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(hero).toHaveAttribute('data-eye-tracking', 'enabled');
  await page.mouse.move(150, 450);
  await expect.poll(() => beam.getAttribute('d')).not.toBe(initial);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(hero).toHaveAttribute('data-eye-tracking', 'static');
  await expect(lights).toHaveCSS('opacity', '0.78');
});

for (const colorScheme of ['light', 'dark'] as const) test(`spotlight visibly illuminates the left headline and CTA in ${colorScheme} mode`, async ({ page }, info) => {
  await page.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });
  await page.goto('/');
  const hero = page.locator('#trang-chu');
  const lights = hero.locator('[data-eye-spotlights]');
  await expect(hero).toHaveAttribute('data-eye-tracking', 'enabled');
  await expect(hero.locator('[class*="heroTrust"]')).toHaveCSS('transform', 'none');
  for (const [name, locator] of [
    ['headline', hero.locator('#hero-title')],
    ['cta', hero.locator('[class*="heroActions"] a').first()],
  ] as const) {
    const rect = (await locator.boundingBox())!;
    const target = { x: rect.x + 60, y: rect.y + rect.height / 2 };
    await page.mouse.move(target.x, target.y);
    await expect.poll(() => beamAimError(hero, target)).toBeLessThan(.1);
    // Include surrounding background: the opaque button and text stay above the light.
    const clip = { x: Math.floor(rect.x), y: Math.floor(rect.y - 12), width: 160, height: Math.ceil(rect.height + 24) };
    const lit = await page.screenshot({ clip });
    await lights.evaluate(el => { el.style.visibility = 'hidden'; });
    const unlit = await page.screenshot({ clip });
    await lights.evaluate(el => { el.style.removeProperty('visibility'); });
    const delta = await page.evaluate(async ([lit, unlit]) => {
      const pixels = async (base64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${base64}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(img, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const [a, b] = await Promise.all([pixels(lit), pixels(unlit)]);
      let difference = 0;
      for (let i = 0; i < a.length; i += 4) for (let channel = 0; channel < 3; channel++) difference += Math.abs(a[i + channel] - b[i + channel]);
      return difference / (a.length / 4 * 3);
    }, [lit.toString('base64'), unlit.toString('base64')]);
    expect(delta, `Visible lighting at ${name}, beyond the right column`).toBeGreaterThan(colorScheme === 'dark' ? 4 : 1.5);
    await page.screenshot({ path: info.outputPath(`${name}-${colorScheme}.png`) });
  }
});

test('beam shortens near the eyes, grows across the hero and caches pointer geometry', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const hero = page.locator('#trang-chu');
  await expect(hero).toHaveAttribute('data-eye-tracking', 'enabled');
  await expect(hero.locator('[class*="heroTrust"]')).toHaveCSS('transform', 'none');
  const eye = await hero.locator('[data-eye-origin="left"]').evaluate(node => {
    const circle = node as SVGCircleElement;
    const matrix = node.closest('svg')!.getScreenCTM()!;
    const point = new DOMPoint(circle.cx.baseVal.value, circle.cy.baseVal.value).matrixTransform(matrix);
    return { x: point.x - 16, y: point.y + 8 };
  });
  await page.mouse.move(eye.x, eye.y);
  await expect.poll(() => beamAimError(hero, eye)).toBeLessThan(.25);
  const length = () => hero.locator('[data-eye-beam="left"]').evaluate(el => {
    const p = el.getAttribute('d')!.match(/[-\d.e+]+/g)!.map(Number);
    return Math.hypot((p[2] + p[6]) / 2 - p[0], (p[3] + p[7]) / 2 - p[1]);
  });
  await expect.poll(length).toBeLessThan(190);
  const nearLength = await length();
  const box = (await hero.boundingBox())!;
  const far = { x: box.x + 20, y: box.y + box.height * .5 };
  // Count geometry reads after entry/resize observers have settled.
  await page.waitForTimeout(200);
  await hero.evaluate(node => {
    const owl = node.querySelector<SVGSVGElement>('[data-owl]')!;
    const heroRect = node.getBoundingClientRect.bind(node), owlMatrix = owl.getScreenCTM.bind(owl);
    const audit = { reads: 0 };
    Object.assign(window, { spotlightGeometryAudit: audit });
    node.getBoundingClientRect = () => { audit.reads++; return heroRect(); };
    owl.getScreenCTM = () => { audit.reads++; return owlMatrix(); };
  });
  await page.mouse.move(far.x, far.y, { steps: 30 });
  await page.waitForTimeout(450);
  // Read the audit before our own alignment helper measures the hero rectangle.
  expect(await page.evaluate(() => (window as unknown as { spotlightGeometryAudit: { reads: number } }).spotlightGeometryAudit.reads)).toBe(0);
  await expect.poll(() => beamAimError(hero, far)).toBeLessThan(.25);
  expect(await length()).toBeGreaterThan(nearLength * 4);
  await page.setViewportSize({ width: 1024, height: 960 });
  const resized = (await hero.boundingBox())!;
  const target = { x: resized.x + 25, y: resized.y + resized.height * .7 };
  await page.mouse.move(target.x, target.y);
  await expect.poll(() => beamAimError(hero, target)).toBeLessThan(.25);
});
