import { test, expect, type Page, type Route, type Locator } from '@playwright/test';
import { uiSession } from './ui-fixtures';

const base = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const longTitle = 'Đồ án học phần — Kiểm tra kiến thức và đánh giá kết quả học tập '.repeat(3);
const longEmail = `${'student-with-a-long-university-address'.repeat(5)}@university.example.edu.vn`;
async function respond(route: Route, data: unknown, meta?: unknown) {
  const headers = { 'access-control-allow-origin': route.request().headers().origin ?? base, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  return route.fulfill({ status: route.request().method() === 'OPTIONS' ? 204 : 200, headers,
    ...(route.request().method() === 'OPTIONS' ? {} : { json: { data, ...(meta ? { meta } : {}) } }) });
}
async function setup(page: Page, role = 'teacher') {
  const state = await uiSession(page, role);
  state.user.full_name = 'Nguyễn Thị Minh Anh — tên hiển thị dài để kiểm tra giao diện';
  state.user.email = longEmail;
  state.classes[0].name = longTitle;
  state.classes[0].description = longTitle;
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`, url: base }]);
  await page.routeWebSocket('**/api/v1/chat/ws', socket => socket.onMessage(() => socket.send(JSON.stringify({ type: 'ready' }))));
  await page.route('**/api/v1/users?**', route => respond(route, [0, 1].map(index => ({ ...state.user, id: `sample-${index}`, role: 'student', student_code: `UX00${index}`, identity_profile_status: 'PENDING' })), { total: 63, page: 1, limit: 20 }));
  await page.route('**/api/v1/attempts/mine?**', route => respond(route, [{ id: 'attempt', exam_id: 'exam', exam_title: longTitle, status: 'submitted', score: 8, max_score: 10, classes: [], submitted_at: '2026-10-20T01:00:00Z' }], { total: 63, page: 1, limit: 20 }));
  await page.route('**/api/v1/teacher/reports*', route => respond(route, { exams: [], results: [], meta: { total: 0, page: 1, limit: 20 }, summary: {} }));
  await page.route('**/api/v1/question-banks**', route => respond(route,
    new URL(route.request().url()).pathname.endsWith('/questions') ? [
      { id: 'question-1', content: longTitle, type: 'mcq_single', difficulty: 'easy', topic: 'Kiến thức nền tảng', is_active: true, default_points: 1, options_json: { options: ['A', 'B'] }, correct_answer_json: { answer: 'A' } },
    ] : [{ id: 'bank-1', name: longTitle, description: longTitle, questions_count: 1 }]));
  await page.route('**/api/v1/chat/conversations?**', route => respond(route, [], { next_cursor: null }));
  await page.route('**/api/v1/admin/ai-support/articles**', route => respond(route, { articles: [], categories: { student: [], teacher: [] }, routes: { student: [], teacher: [] } }));
  return state;
}
async function fits(page: Page, region?: Locator) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if (region) {
    const rect = (await region.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1);
    expect(await region.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  }
}

const routes = {
  student: ['/student', '/student/classes', '/student/exams', '/student/grades', '/student/profile', '/student/settings', '/student/help'],
  teacher: ['/dashboard', '/dashboard/classes', '/dashboard/exams', '/dashboard/question-banks', '/dashboard/monitor', '/teacher/profile', '/teacher/help'],
  admin: ['/admin', '/dashboard/users', '/admin/classes', '/admin/student-cards', '/admin/messages', '/admin/ai-support/knowledge', '/admin/settings'],
};
for (const role of ['student', 'teacher', 'admin'] as const) for (const width of [360, 390, 430, 768, 820, 1024]) {
  test(`${role}: long content, tables and pagination fit ${width}px in both themes`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 820 }); await setup(page, role);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    for (const path of routes[role]) {
      await page.goto(path); await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('main .loading-skeleton')).toHaveCount(0);
      await fits(page);
      const overflow = await page.locator('main .ui-button').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length && node.scrollWidth > node.clientWidth + 1).map(node => node.textContent));
      expect(overflow, path).toEqual([]);
      if (width >= 768) {
        const narrowColumns = await page.locator('.table-wrap .ui-table:has(> thead > tr > :nth-child(6)) tbody tr:first-child > td').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().width < 127).map(node => node.getAttribute('data-label')));
        expect(narrowColumns, `${path}: dense table columns remain readable`).toEqual([]);
      }
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await fits(page);
      if (path === '/student/grades' || path === '/dashboard/users') await page.screenshot({ path: info.outputPath(`${role}-${width}-dark.png`), fullPage: true });
      await page.emulateMedia({ colorScheme: 'light' });
      if (await page.locator('main').evaluate(node => node.getBoundingClientRect().height > innerHeight)) {
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        expect(await page.locator('.topbar').evaluate(node => Math.abs(node.getBoundingClientRect().top))).toBeLessThanOrEqual(1);
      }
    }
    await page.setViewportSize({ width, height: 360 });
    await page.getByRole('button', { name: /^Tài khoản của/ }).click();
    const menu = page.getByRole('menu', { name: 'Tài khoản' }); await expect(menu).toBeVisible();
    const panel = menu.locator('..'); await fits(page, panel);
    expect((await panel.boundingBox())!.height).toBeLessThanOrEqual(360 - 64);
    await menu.getByRole('menuitem', { name: 'Đăng xuất', exact: true }).scrollIntoViewIfNeeded();
    await expect(menu.getByRole('menuitem', { name: 'Đăng xuất', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });
}

for (const width of [360, 430, 768, 1024]) test(`launcher leaves visible actions clickable while scrolling at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 640 }); await setup(page);
  await page.goto('/dashboard'); await expect(page.locator('main .loading-skeleton')).toHaveCount(0);
  const trigger = page.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }); await expect(trigger).toBeVisible();
  for (const y of [0, 220, 440, 10000, 0]) {
    await page.evaluate(top => scrollTo(0, top), y);
    await expect.poll(() => trigger.evaluate(button => {
      const a = button.getBoundingClientRect();
      return Array.from(document.querySelectorAll<HTMLElement>('main button, main a[href], main input, main select')).filter(node => {
        const b = node.getBoundingClientRect(); return node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && b.width && b.height && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      }).map(node => node.textContent?.trim());
    })).toEqual([]);
    const box = (await trigger.boundingBox())!; expect(box.y).toBeGreaterThanOrEqual(64);
  }
  await page.screenshot({ path: info.outputPath(`launcher-${width}.png`), fullPage: true });
});

for (const [width, height] of [[360, 480], [430, 650], [768, 512], [1024, 600]]) test(`modal and portal menu fit the ${width}x${height} viewport`, async ({ page }, info) => {
  await page.setViewportSize({ width, height }); const state = await setup(page);
  await page.goto('/dashboard/exams');
  const trigger = page.getByRole('button', { name: '+ Tạo đề thi', exact: true }); await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Tạo đề thi', exact: true });
  await expect(dialog.getByLabel('Tên đề thi', { exact: true })).toBeVisible();
  await fits(page, dialog);
  expect((await dialog.boundingBox())!.height).toBeLessThanOrEqual(height - 24);
  await dialog.locator('.selector-bank-label select').selectOption('bank-1');
  const rowMenu = dialog.getByRole('button', { name: /^Thao tác câu:/ }).first(); await rowMenu.click();
  const menu = page.getByRole('menu'); await expect(menu).toBeVisible(); await fits(page, menu);
  const bounds = (await menu.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
  expect(await menu.evaluate(node => { const b = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); })).toBe(true);
  await page.screenshot({ path: info.outputPath(`modal-menu-${width}.png`) });
  await page.keyboard.press('Escape'); await expect(rowMenu).toBeFocused();
  expect(await dialog.locator('.selection-summary-panel').evaluate(summary => {
    const a = summary.getBoundingClientRect();
    return Array.from(summary.closest('.modal-body')!.querySelectorAll<HTMLElement>('button,input,select,textarea')).filter(control => {
      if (summary.contains(control) || !control.getClientRects().length) return false;
      const b = control.getBoundingClientRect(); return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }).map(control => control.textContent);
  })).toEqual([]);
  await dialog.getByRole('button', { name: 'Lưu nháp', exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: 'Lưu nháp', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  expect(state.requests.filter(request => request.path.startsWith('/exams'))).toEqual([]);
});

for (const role of ['student', 'teacher', 'admin']) test(`${role}: loading, empty and retry states stay readable`, async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 740 }); await setup(page, role);
  let release!: () => void, fail = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/classes?**', async route => {
    if (route.request().method() === 'OPTIONS') return respond(route, {});
    await gate;
    if (fail) return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': route.request().headers().origin ?? base, 'access-control-allow-credentials': 'true' }, json: { error: { code: 'SERVICE_UNAVAILABLE', message: longTitle } } });
    return respond(route, [], { total: 0, page: 1, limit: 20 });
  });
  const path = role === 'student' ? '/student/classes' : role === 'admin' ? '/admin/classes' : '/dashboard/classes';
  await page.goto(path); await expect(page.getByRole('status', { name: 'Đang tải', exact: true })).toBeVisible();
  await fits(page); release();
  await expect(page.locator('.empty-state-box')).toBeVisible(); await fits(page);
  fail = true; await page.reload();
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' }); await fits(page);
  await page.screenshot({ path: info.outputPath(`${role}-feedback-dark.png`), fullPage: true });
  fail = false; await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page.locator('.empty-state-box')).toBeVisible();
});
