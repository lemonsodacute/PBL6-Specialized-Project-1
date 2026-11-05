import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { uiSession } from './ui-fixtures';
import { tagTone } from '../../lib/tagColors';
import { activitySample } from './ai-activity-fixture';

test.use({ timezoneId: 'Asia/Ho_Chi_Minh', locale: 'vi-VN' });
const articles = [
  { id: 'guide-student', title: 'Sai lớp hoặc không đọc được thông tin trên thẻ', role: 'student', category: 'student-card', content: 'Mở hồ sơ sinh viên và kiểm tra thông tin trên thẻ.', keywords: ['thẻ', 'lớp'], route: '/student/identity', is_active: true, requires_admin: false, updated_at: '2026-10-17T09:28:41Z', updated_by: null },
  { id: 'guide-paused', title: 'Không nhận diện khuôn mặt trên thẻ', role: 'student', category: 'student-card', content: 'Kiểm tra ánh sáng và ảnh thẻ trước khi gửi yêu cầu.', keywords: ['khuôn mặt'], route: '/student/identity', is_active: false, requires_admin: true, updated_at: '2026-10-18T09:28:41Z', updated_by: null },
  { id: 'guide-teacher', title: 'Xem lại các sự kiện giám sát trong kỳ thi', role: 'teacher', category: 'monitoring', content: 'Mở giám sát, chọn kỳ thi và xem lại sự kiện được ghi nhận.', keywords: ['giám sát'], route: '/dashboard/monitor', is_active: true, requires_admin: false, updated_at: '2026-10-18T09:28:41Z', updated_by: null },
];

async function knowledgeSession(page: Page) {
  await uiSession(page, 'admin');
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role: 'admin' })).toString('base64url')}.fixture`, url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' }]);
  const state = { articles: structuredClone(articles), requests: [] as { method: string; url: string; body: Record<string, unknown> | null }[], status: 200 };
  await page.route('**/api/v1/admin/ai-support/articles**', async route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS' };
    const method = route.request().method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const url = new URL(route.request().url());
    const body = method === 'GET' ? null : route.request().postDataJSON();
    state.requests.push({ method, url: url.href, body });
    if (state.status !== 200) return route.fulfill({ status: state.status, headers, json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Không tải được bài hướng dẫn.' } } });
    if (method === 'POST' || method === 'PUT') {
      const saved = { ...body, id: method === 'POST' ? 'new-guide' : url.pathname.split('/').at(-1), updated_at: '2026-10-28T00:00:00Z', updated_by: null } as typeof articles[number];
      state.articles = method === 'POST' ? [...state.articles, saved] : state.articles.map(a => a.id === saved.id ? saved : a);
      return route.fulfill({ headers, json: { data: saved } });
    }
    const p = url.searchParams;
    const filtered = state.articles.filter(a => (!p.get('q') || `${a.title} ${a.content}`.toLowerCase().includes(p.get('q')!.toLowerCase())) && (!p.get('role') || p.get('role') === a.role) && (!p.get('category') || p.get('category') === a.category) && (!p.get('active') || p.get('active') === String(a.is_active)));
    await route.fulfill({ headers, json: { data: { articles: filtered, categories: { student: [{ id: 'student-card', label: 'Thẻ sinh viên' }, { id: 'other', label: 'Vấn đề khác' }], teacher: [{ id: 'monitoring', label: 'Giám sát' }, { id: 'other', label: 'Vấn đề khác' }] }, routes: { student: ['/student/identity'], teacher: ['/dashboard/monitor'] } } } });
  });
  return state;
}

for (const width of [320, 390, 768, 1024, 1440]) for (const theme of ['light', 'dark'] as const) {
  test(`knowledge HTML design ${width}px ${theme} preserves route links, records and responsive cards`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await knowledgeSession(page);
    await page.goto('/admin/ai-support/knowledge');
    await expect(page.getByRole('heading', { level: 1, name: 'Kho tri thức' })).toBeVisible();
    expect(await page.getByRole('heading', { level: 1 }).evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/nunito/i);
    await expect(page.locator('main article')).toHaveCount(3);
    await expect(page.getByRole('combobox', { name: 'Vai trò', exact: true })).toHaveValue('');
    await expect(page.locator('main article').first()).toContainText('Sinh viên');
    await expect(page.locator('main article').nth(1)).toContainText('Đã tạm ngưng');
    await expect(page.locator('main article').nth(2)).toContainText('Giảng viên');
    const tabs = page.getByRole('navigation', { name: 'Phân hệ hỗ trợ AI' });
    await expect(tabs.getByRole('tab', { name: 'Kho tri thức', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(tabs.getByRole('tab', { name: 'Hoạt động AI', exact: true })).toHaveAttribute('href', '/admin/ai-support/activity');
    expect(await tabs.getByRole('tab', { name: 'Kho tri thức', exact: true }).evaluate(el => getComputedStyle(el).borderRadius)).toBe('999px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: info.outputPath(`knowledge-${width}-${theme}.png`), fullPage: true, style: 'nextjs-portal{display:none!important}' });
    await page.getByRole('button', { name: `Sửa ${articles[0].title}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Sửa bài hướng dẫn', exact: true });
    await expect(dialog.getByLabel('Tiêu đề', { exact: true })).toHaveValue(articles[0].title);
    await expect(dialog.getByRole('combobox', { name: 'Vai trò bài viết', exact: true })).toHaveValue('student');
    await expect(dialog.getByRole('checkbox', { name: 'Đang sử dụng', exact: true })).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`editor-${width}-${theme}.png`), style: 'nextjs-portal{display:none!important}' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
}

test('Vietnamese knowledge filters keep existing query values and empty results', async ({ page }) => {
  const state = await knowledgeSession(page);
  await page.goto('/admin/ai-support/knowledge');
  await expect(page.locator('main article')).toHaveCount(3);
  await page.getByRole('combobox', { name: 'Vai trò', exact: true }).selectOption('student');
  await page.getByRole('combobox', { name: 'Danh mục', exact: true }).selectOption('student-card');
  await page.getByRole('combobox', { name: 'Trạng thái', exact: true }).selectOption('false');
  await expect(page.locator('main article')).toHaveCount(1);
  await expect.poll(() => state.requests.some(r => { const p = new URL(r.url).searchParams; return p.get('role') === 'student' && p.get('category') === 'student-card' && p.get('active') === 'false'; })).toBe(true);
  await page.getByRole('combobox', { name: 'Vai trò', exact: true }).selectOption('teacher');
  await expect(page.getByRole('combobox', { name: 'Danh mục', exact: true })).toHaveValue('');
  await page.getByRole('combobox', { name: 'Trạng thái', exact: true }).selectOption('');
  await expect(page.locator('main article')).toHaveCount(1);
  await expect(page.locator('main article')).toContainText(articles[2].title);
  await page.getByRole('searchbox', { name: 'Tìm tiêu đề / nội dung', exact: true }).fill('Không tồn tại');
  await expect(page.getByText('Không có bài hướng dẫn phù hợp.', { exact: true })).toBeVisible();
});

test('tag colors come from role, category and status and survive reordering/filtering', async ({ page }) => {
  const state = await knowledgeSession(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/admin/ai-support/knowledge');
  await expect(page.locator('main article')).toHaveCount(3);
  const first = page.locator('main article').filter({ has: page.getByRole('heading', { name: articles[0].title, exact: true }) });
  const second = page.locator('main article').filter({ has: page.getByRole('heading', { name: articles[1].title, exact: true }) });
  for (const article of [first, second]) {
    await expect(article).toHaveCSS('border-left-color', 'rgb(245, 158, 11)');
    await expect(article.locator('[data-tag-kind="category"]')).toHaveCSS('background-color', 'rgb(254, 240, 211)');
    await expect(article.locator('[data-tag-kind="role"]')).toHaveCSS('background-color', 'rgb(229, 229, 251)');
  }
  await expect(first.locator('[data-tag-kind="status"]')).toHaveAttribute('data-tag-tone', 'green');
  await expect(second.locator('[data-tag-kind="status"]')).toHaveAttribute('data-tag-tone', 'gray');
  const teacher = page.locator('main article').filter({ has: page.getByRole('heading', { name: articles[2].title, exact: true }) });
  await expect(teacher.locator('[data-tag-kind="role"]')).toHaveCSS('background-color', 'rgb(217, 243, 241)');
  const unknownColor = await teacher.evaluate(el => getComputedStyle(el).borderLeftColor);
  state.articles.reverse();
  await page.reload();
  await expect(page.locator('main article')).toHaveCount(3);
  await expect(first).toHaveCSS('border-left-color', 'rgb(245, 158, 11)');
  await expect(teacher).toHaveCSS('border-left-color', unknownColor);
  await page.getByRole('combobox', { name: 'Vai trò', exact: true }).selectOption('teacher');
  await expect(page.locator('main article')).toHaveCount(1);
  await expect(teacher).toHaveCSS('border-left-color', unknownColor);
  await expect(page.getByRole('group', { name: 'Chú giải màu tag' })).toContainText('Quản trị viên');
  expect(tagTone('Admin', 'role')).toBe('red');
  expect(tagTone('Thẻ sinh viên', 'category')).toBe('orange');
  expect(tagTone('Thiết bị', 'category')).toBe(tagTone('THIET BI', 'category'));
  expect(['orange', 'teal', 'purple', 'red', 'green']).toContain(tagTone('__proto__', 'category'));
});

test('route tabs support arrow/Home/End, Enter/Space and correctly labelled panels', async ({ page }) => {
  await knowledgeSession(page);
  await page.route('**/api/v1/admin/ai-support/activity?**', route => route.fulfill({
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,OPTIONS' },
    status: route.request().method() === 'OPTIONS' ? 204 : 200, json: { data: activitySample },
  }));
  await page.goto('/admin/ai-support/knowledge');
  const tabs = page.getByRole('tablist', { name: 'Phân hệ hỗ trợ AI' });
  const knowledge = tabs.getByRole('tab', { name: 'Kho tri thức', exact: true });
  const activity = tabs.getByRole('tab', { name: 'Hoạt động AI', exact: true });
  await expect(knowledge).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', await knowledge.getAttribute('id') as string);
  await knowledge.focus(); await page.keyboard.press('Home');
  await expect(activity).toBeFocused();
  await page.keyboard.press('End'); await expect(knowledge).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await expect(activity).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page).toHaveURL(/\/admin\/ai-support\/activity$/, { timeout: 30000 });
  await expect(activity).toHaveAttribute('aria-selected', 'true');
  await activity.focus(); await page.keyboard.press('ArrowRight'); await expect(knowledge).toBeFocused();
  await page.keyboard.press('Space'); await expect(page).toHaveURL(/\/admin\/ai-support\/knowledge$/, { timeout: 30000 });
  await expect(knowledge).toHaveAttribute('aria-selected', 'true');
  const title = page.getByRole('heading', { level: 2, name: 'Kho tri thức', exact: true });
  const create = page.getByRole('button', { name: 'Tạo bài hướng dẫn', exact: true });
  const titleBox = (await title.boundingBox())!, buttonBox = (await create.boundingBox())!;
  expect(Math.abs(titleBox.y - buttonBox.y)).toBeLessThan(20);
});

test('create and edit use the original API contracts and preserve article fields', async ({ page }) => {
  const state = await knowledgeSession(page);
  await page.goto('/admin/ai-support/knowledge');
  await expect(page.locator('main article')).toHaveCount(3);
  await page.getByRole('button', { name: 'Tạo bài hướng dẫn', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Tiêu đề', { exact: true }).fill('Kiểm tra thiết bị trước kỳ thi');
  await form.getByRole('combobox', { name: 'Vai trò bài viết', exact: true }).selectOption('teacher');
  await form.getByRole('combobox', { name: 'Danh mục bài viết', exact: true }).selectOption('monitoring');
  await form.getByLabel('Nội dung (mỗi bước một dòng)', { exact: true }).fill('Kiểm tra camera và microphone trước kỳ thi.');
  await form.getByLabel('Từ khóa (cách nhau bằng dấu phẩy)', { exact: true }).fill('camera, microphone');
  await form.getByRole('combobox', { name: 'Trang liên quan', exact: true }).selectOption('/dashboard/monitor');
  await form.getByRole('checkbox', { name: 'Cần quản trị viên xử lý', exact: true }).check();
  await form.getByRole('button', { name: 'Lưu bài hướng dẫn', exact: true }).click();
  await expect(form).toHaveCount(0);
  const created = state.requests.find(r => r.method === 'POST')!;
  expect(new URL(created.url).pathname).toBe('/api/v1/admin/ai-support/articles');
  expect(created.body).toEqual({ title: 'Kiểm tra thiết bị trước kỳ thi', role: 'teacher', category: 'monitoring', content: 'Kiểm tra camera và microphone trước kỳ thi.', keywords: ['camera', 'microphone'], route: '/dashboard/monitor', is_active: true, requires_admin: true });
  await expect(page.locator('main article')).toHaveCount(4);
  await page.getByRole('button', { name: `Sửa ${articles[0].title}`, exact: true }).click();
  await form.getByLabel('Tiêu đề', { exact: true }).fill('Hướng dẫn kiểm tra thông tin thẻ sinh viên');
  await form.getByRole('button', { name: 'Lưu bài hướng dẫn', exact: true }).click();
  await expect(form).toHaveCount(0);
  const edited = state.requests.find(r => r.method === 'PUT')!;
  expect(new URL(edited.url).pathname).toBe('/api/v1/admin/ai-support/articles/guide-student');
  const { id, updated_at, updated_by, ...fields } = articles[0];
  expect(edited.body).toEqual({ ...fields, title: 'Hướng dẫn kiểm tra thông tin thẻ sinh viên' });
});

test('knowledge errors stay visible and cancelling the editor sends no write', async ({ page }) => {
  const state = await knowledgeSession(page);
  await page.goto('/admin/ai-support/knowledge');
  await expect(page.locator('main article')).toHaveCount(3);
  await page.getByRole('button', { name: 'Tạo bài hướng dẫn', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
  expect(state.requests.every(r => r.method === 'GET')).toBe(true);
  state.status = 503;
  await page.getByRole('searchbox').fill('thẻ');
  await expect(page.locator('main').getByRole('alert')).toBeVisible();
});

for (const role of ['student', 'teacher']) test(`${role} retains the existing admin access guard`, async ({ page }) => {
  test.setTimeout(90000);
  await uiSession(page, role);
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.fixture`, url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' }]);
  let requests = 0;
  await page.route('**/api/v1/admin/ai-support/**', route => { requests++; return route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'Không có quyền truy cập.' } } }); });
  await page.goto('/admin/ai-support/knowledge');
  // The redirect can compile a different workspace on a cold Next.js dev server.
  await expect(page).toHaveURL(role === 'student' ? /\/student$/ : /\/dashboard$/, { timeout: 45000 });
  expect(requests).toBe(0);
});

test('existing admin views real activity and knowledge through unchanged APIs', async ({ browser }, info) => {
  test.skip(process.env.AI_SUPPORT_DESIGN_REAL !== '1', 'Requires local API and an existing-account private fixture.');
  test.setTimeout(90000);
  const fixture = JSON.parse(fs.readFileSync('backend/private/ai-support-design-validation.json', 'utf8'));
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    await context.addCookies([{ name: 'auth_token', value: fixture.token, url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' }]);
    await context.addInitScript(({ user, token }) => {
      sessionStorage.setItem('ai-proctoring-current-user', JSON.stringify(user));
      sessionStorage.setItem('ai-proctoring-access-token', token);
    }, fixture);
    const page = await context.newPage();
    const activityResponse = page.waitForResponse(r => r.url().includes('/api/v1/admin/ai-support/activity?') && r.request().method() === 'GET');
    await page.goto('/admin/ai-support/activity');
    const activity = (await (await activityResponse).json()).data;
    const kpis = page.getByRole('region', { name: 'Chỉ số hoạt động AI' });
    await expect(kpis).toBeVisible();
    await expect(kpis).toContainText(activity.question.generated_questions.toLocaleString('vi-VN'));
    await page.screenshot({ path: info.outputPath('real-activity.png'), style: 'nextjs-portal{display:none!important}' });
    const articlesResponse = page.waitForResponse(r => r.url().includes('/api/v1/admin/ai-support/articles?') && r.request().method() === 'GET');
    await page.getByRole('navigation', { name: 'Phân hệ hỗ trợ AI' }).getByRole('tab', { name: 'Kho tri thức', exact: true }).click();
    const library = (await (await articlesResponse).json()).data;
    await expect(page).toHaveURL(/\/admin\/ai-support\/knowledge$/);
    await expect(page.locator('main article')).toHaveCount(library.articles.length);
    if (fixture.article_title) await expect(page.getByRole('heading', { level: 3, name: fixture.article_title, exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('real-knowledge.png'), style: 'nextjs-portal{display:none!important}' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  } finally { await context.close(); }
});
