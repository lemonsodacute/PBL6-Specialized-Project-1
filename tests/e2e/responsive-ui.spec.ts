import { expect, test } from '@playwright/test';
import { uiSession } from './ui-fixtures';

for (const width of [1440, 1024, 768, 375]) {
  test(`student pages and account menu fit ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000); // Eight full page loads plus drawer/keyboard checks.
    await page.setViewportSize({ width, height: 960 });
    await uiSession(page);
    for (const path of ['/student', '/student/classes', '/student/exams', '/student/history', '/student/grades', '/student/profile', '/student/schedule', '/student/identity']) {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
      if(path!=='/login'){await expect(page.locator('main .ui-card').first()).toBeVisible({timeout:45_000});if(path==='/student'||path==='/student/schedule'){await expect(page).toHaveURL(/\/student$/);await expect(page.getByRole('heading',{level:1,name:'Hôm nay bạn có gì?'})).toBeVisible();}else await expect(page.locator('main h1')).toHaveCount(1);}else await expect(page.locator('main h1')).toBeVisible();
      await expect(page.locator('.loading-skeleton')).toHaveCount(0);
      if (path === '/student/identity') {
        await expect(page).toHaveURL(/\/student\/profile$/);
        await expect(page.getByRole('heading', { name: 'Xác minh danh tính', exact: true })).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (path === '/student/profile' || path === '/student/identity' || path === '/student') await page.screenshot({ path: testInfo.outputPath(`${path.split('/').pop()}-${width}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: /^Tài khoản của/ }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    const bounds = await page.getByRole('menu').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    if (width < 1024) {
      await page.getByRole('button', { name: 'Mở menu', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: 'Menu điều hướng' });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Đóng menu', exact: true })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      expect(await drawer.evaluate(element => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Mở menu', exact: true })).toBeFocused();
      await page.getByRole('button', { name: 'Mở menu', exact: true }).click();
      await drawer.getByRole('link', { name: 'Lớp học phần', exact: true }).click();
      await expect(page).toHaveURL(/\/student\/classes$/);
      await expect(drawer).toHaveCount(0);
    }
  });

  test(`auth and teacher pages fit ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await uiSession(page, 'teacher');
    for (const path of ['/login', '/dashboard', '/dashboard/exams', '/dashboard/classes', '/dashboard/question-banks', '/dashboard/reports']) {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
      if(path!=='/login'){await expect(page.locator('main .ui-card').first()).toBeVisible({timeout:45_000});await expect(page.locator('main h1')).toHaveCount(0);}else await expect(page.locator('main h1')).toBeVisible();
      await expect(page.locator('.loading-skeleton')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (path === '/dashboard' || path === '/login') await page.screenshot({ path: testInfo.outputPath(`${path.slice(1)}-${width}.png`), fullPage: true });
    }
    await page.goto('/login'); await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Đăng ký', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`register-${width}.png`), fullPage: true });
  });
}

test('modal traps keyboard focus, restores it and stays inside mobile viewport', async ({ page }, testInfo) => {
  await uiSession(page, 'teacher'); await page.setViewportSize({ width: 375, height: 720 });
  await page.goto('/ui-kit');
  const trigger = page.getByRole('button', { name: 'Mở dialog' });
  await trigger.click(); const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('Kết thúc bài làm này?');
  await expect(dialog.getByRole('button', { name: 'Đóng', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: 'Nộp bài', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: 'Đóng', exact: true })).toBeFocused();
  const bounds = await dialog.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  expect(bounds!.height).toBeLessThanOrEqual(720);
  await page.screenshot({ path: testInfo.outputPath('modal-mobile.png') });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
});

test('results stay readable without overflowing the mobile page', async ({ page }) => {
  const state = await uiSession(page); await page.setViewportSize({ width: 375, height: 812 });
  state.exams = [{ id: 'exam-1', title: 'Kiểm thử phần mềm cuối học kỳ', classes: [{ name: 'Công nghệ thông tin' }] }];
  state.attempts = [{ id: 'attempt-1', exam_id: 'exam-1', submitted_at: '2026-09-01T00:00:00Z', score: 8, max_score: 10, status: 'submitted' }];
  await page.goto('/student/grades');
  const table = page.getByRole('region', { name: 'Điểm số / Kết quả' });
  await expect(table.getByRole('cell', { name: /8 \/ 10/ })).toBeVisible();
  expect(await table.evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('account menu and sidebar support touch interaction', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 375, height: 812 } });
  const page = await context.newPage(); await uiSession(page);
  await page.goto(`${baseURL}/student/profile`);
  await page.getByRole('button', { name: /^Tài khoản của/ }).tap();
  await expect(page.getByRole('menuitem', { name: 'Hồ sơ sinh viên' })).toBeVisible();
  await page.touchscreen.tap(8, 400);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('button', { name: 'Mở menu', exact: true }).tap();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Đóng menu bên ngoài', exact: true }).tap({ position: { x: 350, y: 500 } });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await context.close();
});
