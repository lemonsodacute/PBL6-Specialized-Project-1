import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';

type Role = 'admin' | 'teacher' | 'student';
async function visit(page: Page, role: Role, path: string, populated = false) {
  const state = await uiSession(page, role);
  if (populated) state.exams = [{ id: 'mascot-exam', title: 'Đề thi kiểm thử phần mềm', description: 'Kiểm tra bố cục với dữ liệu',
    status: 'draft', start_time: '2026-10-23T01:00:00Z', end_time: '2026-10-24T01:00:00Z',
    duration_minutes: 60, questions_count: 10, require_camera: false, require_mic: false, classes: [], attempt_count: 0, completed_attempt_count: 0 }];
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`, url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' }]);
  await page.goto(path);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('main .loading-skeleton')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  return state;
}

async function checkDecoration(page: Page) {
  for (const owl of await page.locator('main [data-mascot]:visible').all()) {
    await expect(owl).toHaveAttribute('aria-hidden', 'true');
    await expect(owl).toHaveAttribute('focusable', 'false');
    await expect(owl).toHaveCSS('pointer-events', 'none');
    expect(await owl.evaluate(el => el.querySelectorAll('a,button,[tabindex]').length)).toBe(0);
    const controls = await page.locator('main button:visible, main a:visible, main input:visible, main select:visible').all();
    const box = (await owl.boundingBox())!;
    for (const control of controls) {
      const rect = (await control.boundingBox())!;
      const overlap = Math.min(box.x + box.width, rect.x + rect.width) > Math.max(box.x, rect.x)
        && Math.min(box.y + box.height, rect.y + rect.height) > Math.max(box.y, rect.y);
      expect(overlap, `Owl overlaps ${await control.getAttribute('aria-label') ?? await control.textContent()}`).toBe(false);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expect(page.locator('main [data-eye-beam]')).toHaveCount(0);
}

for (const width of [1440, 1024, 390]) test(`Admin exams ${width}px: use only available space and keep controls/table geometry`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await visit(page, 'admin', '/dashboard/exams', true);
  const owl = page.locator('[data-mascot="peek"]');
  if (width === 1440) {
    await expect(owl).toBeVisible();
    const height = (await owl.boundingBox())!.height;
    expect(height).toBeGreaterThanOrEqual(80); expect(height).toBeLessThanOrEqual(120);
  } else await expect(owl).toBeHidden();
  await checkDecoration(page);
  const geometry = () => page.locator('main fieldset, main .table-wrap, main button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
  const before = await geometry();
  await owl.evaluate(el => { el.style.display = 'none'; });
  expect(await geometry()).toEqual(before);
  await owl.evaluate(el => el.style.removeProperty('display'));
  await page.screenshot({ path: `artifacts/mascot/admin-exams-${width}.png`, animations: 'disabled' });
  await page.getByRole('button', { name: 'Tải lại danh sách', exact: true }).click({ trial: true });
  await page.getByRole('button', { name: '+ Tạo đề thi', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Tạo đề thi', exact: true })).toBeVisible();
});

for (const role of ['teacher', 'student'] as const) test(`${role}: one shared owl in a real empty state, including mobile/dark`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const path = role === 'teacher' ? '/dashboard/question-banks' : '/student/grades';
  await visit(page, role, path);
  const owl = page.locator('main [data-mascot="empty-state"]');
  await expect(owl).toHaveCount(1); await expect(owl).toBeVisible();
  await checkDecoration(page);
  await page.screenshot({ path: `artifacts/mascot/${role}-empty-1440.png`, animations: 'disabled' });
  await page.setViewportSize({ width: 1024, height: 900 });
  await checkDecoration(page);
  await page.screenshot({ path: `artifacts/mascot/${role}-empty-1024.png`, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(owl).toBeVisible(); await checkDecoration(page);
  await page.screenshot({ path: `artifacts/mascot/${role}-empty-mobile-dark.png`, animations: 'disabled' });
});

test('Student greeting uses the open desktop space and disappears when it is needed by content', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page, 'student', '/student');
  const owl = page.locator('main header [data-mascot="corner"]');
  await expect(owl).toBeVisible(); await checkDecoration(page);
  await page.screenshot({ path: 'artifacts/mascot/student-dashboard-1440.png', animations: 'disabled' });
  const copy = page.locator('header[class*="welcome"] > div').first();
  await copy.evaluate(el => { el.style.width = '850px'; });
  await expect(owl).toBeHidden();
  await copy.evaluate(el => el.style.removeProperty('width'));
  await expect(owl).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'artifacts/mascot/student-dashboard-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(owl).toBeHidden(); await checkDecoration(page);
  await page.screenshot({ path: 'artifacts/mascot/student-dashboard-1024.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(owl).toBeHidden(); await checkDecoration(page);
});

test('Admin exam decoration remains legible in dark mode; expanded filters stay usable', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await visit(page, 'admin', '/dashboard/exams', true);
  await expect(page.locator('[data-mascot="peek"]')).toBeVisible();
  await page.getByRole('button', { name: 'Thêm bộ lọc', exact: true }).click();
  await checkDecoration(page);
  await page.screenshot({ path: 'artifacts/mascot/admin-exams-dark.png', animations: 'disabled' });
});

test('Populated question banks keep their data space undecorated', async ({ page }) => {
  await uiSession(page, 'teacher');
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role: 'teacher' })).toString('base64url')}.signature`, url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' }]);
  await page.route('**/api/v1/question-banks?**', route => route.fulfill({ json: { data: [{ id: 'bank-1', name: 'Ngân hàng đã có câu hỏi', questions_count: 10 }] } }));
  await page.goto('/dashboard/question-banks');
  await expect(page.getByRole('link', { name: 'Ngân hàng đã có câu hỏi', exact: true })).toBeVisible();
  await expect(page.locator('main [data-mascot]')).toHaveCount(0);
});
