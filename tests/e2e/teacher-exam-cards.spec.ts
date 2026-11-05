import { expect, test, type Page, type Route } from '@playwright/test';
import { uiSession } from './ui-fixtures';

test.setTimeout(90000);
const classes = [
  { id: 'class-a', name: 'CNTT K22A' }, { id: 'class-b', name: 'CNTT K22B' },
  { id: 'class-c', name: 'Khoa học dữ liệu K23' },
  { id: 'class-d', name: 'Lớp liên ngành phân tích dữ liệu có tên dài để kiểm tra bố cục' },
];
const titles = ['Kiểm tra Công nghệ phần mềm', 'Đề nháp Lập trình Web', 'Đánh giá Cơ sở dữ liệu',
  'Kiểm tra đang diễn ra', 'Đề thi đã đóng với tên rất dài để kiểm tra cách căn chỉnh đồng nhất giữa các card đề thi'];
const rows = Array.from({ length: 23 }, (_, i) => ({
  id: `11111111-1111-4111-8111-${String(i + 1).padStart(12, '0')}`,
  title: titles[i] ?? `Đề thi học phần ${i + 1}`, description: 'Mô tả dài không tạo thêm một hàng trên card.',
  status: i === 1 ? 'draft' : i === 3 ? 'ongoing' : i === 4 ? 'closed' : 'published',
  start_time: i === 3 ? new Date(Date.now() - 3600000).toISOString() : '2099-01-01T01:00:00Z',
  end_time: i === 3 ? new Date(Date.now() + 3600000).toISOString() : '2099-01-01T02:00:00Z',
  duration_minutes: 60, questions_count: 20 + i, require_camera: i !== 1, require_mic: i !== 1 && i !== 2,
  classes: i === 0 ? classes : i === 1 ? [] : i === 3 ? classes.slice(0, 2) : i === 4 ? [classes[3]] : [classes[0]],
  attempt_count: i === 1 || i === 2 ? 0 : 2, completed_attempt_count: i === 1 || i === 2 || i === 3 ? 0 : 1,
}));

async function respond(route: Route, data: unknown, status = 200) {
  const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3100',
    'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
  return route.fulfill({ status: route.request().method() === 'OPTIONS' ? 204 : status, headers,
    ...(route.request().method() === 'OPTIONS' ? {} : { json: data }) });
}

async function setup(page: Page) {
  await uiSession(page, 'teacher');
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role: 'teacher' })).toString('base64url')}.signature`, url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' }]);
  const state = { rows: structuredClone(rows), requests: [] as Record<string, string>[],
    mutations: [] as { id: string; method: string; body: unknown }[], reports: [] as string[] };
  await page.route('**/api/v1/exams?**', route => {
    if (route.request().method() === 'OPTIONS') return respond(route, {});
    const params = new URL(route.request().url()).searchParams;
    state.requests.push(Object.fromEntries(params));
    const filtered = state.rows.filter(row => (!params.get('q') || row.title.toLocaleLowerCase('vi').includes(params.get('q')!.toLocaleLowerCase('vi')))
      && (!params.get('status') || row.status === params.get('status')));
    const pageNumber = Number(params.get('page') ?? 1), limit = Number(params.get('limit') ?? 20);
    return respond(route, { data: filtered.slice((pageNumber - 1) * limit, pageNumber * limit), meta: { total: filtered.length, page: pageNumber, limit } });
  });
  await page.route('**/api/v1/exams/*', async route => {
    const request = route.request(), method = request.method();
    if (method === 'OPTIONS') return respond(route, {});
    const id = new URL(request.url()).pathname.split('/').pop()!;
    const row = state.rows.find(item => item.id === id)!;
    if (method === 'PATCH' || method === 'DELETE') {
      const body = method === 'PATCH' ? request.postDataJSON() : null;
      state.mutations.push({ id, method, body });
      if (method === 'PATCH') Object.assign(row, body);
      else state.rows = state.rows.filter(item => item.id !== id);
    }
    return respond(route, { data: row });
  });
  await page.route(/\/api\/v1\/exams\/[^/]+\/report(?:\?|$)/, route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    state.reports.push(id);
    const row = state.rows.find(item => item.id === id)!;
    return respond(route, { data: { exam: { ...row, max_attempts: 1, max_score: row.questions_count },
      summary: { student_count: 0, submitted_count: 0, in_progress_count: 0, not_started_count: 0 }, results: [], meta: { total: 0, page: 1, limit: 20 } } });
  });
  await page.goto('/dashboard/exams');
  await expect(page.getByRole('article')).toHaveCount(20, { timeout: 45000 });
  return state;
}

const card = (page: Page, index: number) => page.getByRole('article', { name: rows[index].title, exact: true });

test('compact cards: two sections keep API details, classes and header actions with consistent height', async ({ page }, info) => {
  await setup(page);
  const first = card(page, 0), draft = card(page, 1), single = card(page, 2), ongoing = card(page, 3);
  const layout = await first.evaluate(element => {
    const header = element.children[0], details = element.children[1];
    return { sections: element.children.length, detailsTag: details.tagName,
      headerHasResults: header.contains(element.querySelector('a[href$="/attempts"]')),
      headerHasMenu: header.contains(element.querySelector('[aria-haspopup="menu"]')),
      headerHasStatus: header.contains(element.querySelector('.ui-badge')),
      separator: getComputedStyle(details).borderTopWidth };
  });
  expect(layout).toEqual({ sections: 2, detailsTag: 'DL', headerHasResults: true, headerHasMenu: true, headerHasStatus: true, separator: '1px' });
  await expect(first.locator('dt')).toHaveText(['Thời gian', 'Số câu hỏi', 'Thiết bị yêu cầu']);
  await expect(first.locator('dl')).toContainText('20');
  expect(await first.locator('time').evaluateAll(nodes => nodes.map(node => node.getAttribute('datetime')))).toEqual([rows[0].start_time, rows[0].end_time]);
  await expect(first.locator('dl').getByText('Camera', { exact: true })).toBeVisible();
  await expect(first.locator('dl').getByText('Microphone', { exact: true })).toBeVisible();
  await expect(first.locator('dl svg')).toHaveCount(2);
  await expect(draft.locator('.ui-badge')).toHaveText('Bản nháp');
  await expect(draft).toContainText('Chưa giao lớp');
  await expect(draft.locator('dl')).toContainText('Không yêu cầu');
  await expect(single).toContainText(`Lớp: ${classes[0].name}`);
  await expect(single.locator('summary')).toHaveCount(0);
  await expect(single.locator('dl svg')).toHaveCount(1);
  await expect(ongoing.getByRole('link', { name: 'Giám sát', exact: true })).toHaveAttribute('href', `/dashboard/monitor/${rows[3].id}`);
  await expect(first).not.toContainText(rows[0].description);
  const heights = await page.getByRole('article').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
  expect(Math.max(...heights)).toBeLessThan(190);
  const summary = first.locator('summary');
  await expect(summary).toHaveText('+3 lớp');
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(first.getByRole('list', { name: 'Các lớp được giao' }).getByRole('listitem')).toHaveText(classes.map(item => item.name));
  await page.keyboard.press('Escape'); await expect(first.locator('details')).not.toHaveAttribute('open');
  await expect(summary).toBeFocused();
  await page.screenshot({ path: info.outputPath('exam-cards-desktop.png') });
});

test('compact cards: result links navigate with each exam ID', async ({ page }) => {
  const state = await setup(page);
  for (const index of [0, 4, 12]) {
    await expect(card(page, index).getByRole('link', { name: 'Xem kết quả', exact: true })).toHaveAttribute('href', `/dashboard/exams/${rows[index].id}/attempts`);
  }
  await card(page, 0).getByRole('link', { name: 'Xem kết quả', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/exams/${rows[0].id}/attempts$`), { timeout: 45000 });
  await expect(page.getByRole('heading', { level: 2, name: rows[0].title, exact: true })).toBeVisible({ timeout: 45000 });
  expect(state.reports).toContain(rows[0].id);
});

test('compact cards: menus preserve restrictions, publish, close and delete actions', async ({ page }) => {
  const state = await setup(page);
  await card(page, 0).getByRole('button', { name: `Thao tác đề ${rows[0].title}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Đóng đề', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Xóa đề', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Xem kết quả', exact: true })).toHaveAttribute('href', `/dashboard/exams/${rows[0].id}/attempts`);
  await expect(page.getByRole('menuitem', { name: 'Xem giám sát', exact: true })).toHaveAttribute('href', `/dashboard/monitor/${rows[0].id}`);
  await page.keyboard.press('Escape');
  const trigger = card(page, 1).getByRole('button', { name: `Thao tác đề ${rows[1].title}` });
  await trigger.click();
  await expect(page.getByRole('menuitem')).toHaveText(['Xem / Sửa', 'Xuất bản', 'Xóa đề']);
  await page.getByRole('menuitem', { name: 'Xuất bản', exact: true }).click();
  await expect(card(page, 1).locator('.ui-badge')).toHaveText('Đã xuất bản');
  await trigger.click(); await page.getByRole('menuitem', { name: 'Đóng đề', exact: true }).click();
  const close = page.getByRole('dialog', { name: 'Đóng đề thi?' });
  expect(state.mutations).toHaveLength(1);
  await close.getByRole('button', { name: 'Đóng đề', exact: true }).click();
  await expect(card(page, 1).locator('.ui-badge')).toHaveText('Đã đóng');
  await trigger.click(); await page.getByRole('menuitem', { name: 'Xóa đề', exact: true }).click();
  const remove = page.getByRole('dialog', { name: 'Xóa đề thi?' });
  expect(state.mutations).toHaveLength(2);
  await remove.getByRole('button', { name: 'Xóa', exact: true }).click();
  await expect(card(page, 1)).toHaveCount(0);
  expect(state.mutations).toEqual([{ id: rows[1].id, method: 'PATCH', body: { status: 'published' } },
    { id: rows[1].id, method: 'PATCH', body: { status: 'closed' } }, { id: rows[1].id, method: 'DELETE', body: null }]);
});

test('compact cards: search, filters, page size and all 23 records remain available', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(3);
  await expect(card(page, 22)).toBeVisible();
  expect(state.requests.at(-1)?.page).toBe('2');
  await page.getByRole('combobox', { name: 'Số kết quả mỗi trang', exact: true }).selectOption('50');
  await expect(page.getByRole('article')).toHaveCount(23);
  expect(state.requests.at(-1)?.limit).toBe('50');
  await page.getByRole('searchbox', { name: 'Tìm đề thi...', exact: true }).fill(rows[1].title);
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(card(page, 1)).toBeVisible();
  expect(state.requests.at(-1)?.q).toBe(rows[1].title);
  await page.getByRole('button', { name: 'Xóa từ khóa tìm kiếm', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(23);
  await page.getByRole('combobox', { name: 'Trạng thái', exact: true }).selectOption('draft');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(card(page, 1)).toBeVisible();
  await page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(20);
  await expect(page.getByRole('button', { name: 'Trang sau', exact: true })).toBeEnabled();
});

for (const width of [320, 375, 768, 1024, 1440]) test(`compact cards: header controls and menus fit ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await setup(page);
  const first = card(page, 0);
  await first.evaluate(element => element.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => scrollBy(0, -100));
  await expect(first.getByRole('link', { name: 'Xem kết quả', exact: true })).toBeVisible();
  const overflowing = await page.getByRole('article').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.getAttribute('aria-labelledby')));
  expect(overflowing).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const controlsFit = await first.evaluate(element => {
    const header = element.firstElementChild!, rect = header.getBoundingClientRect();
    return Array.from(header.querySelectorAll('a.ui-button,button.action-menu-trigger')).every(node => {
      const box = node.getBoundingClientRect();
      return box.left >= rect.left - 1 && box.right <= rect.right + 1 && box.top >= rect.top - 1 && box.bottom <= rect.bottom + 1;
    });
  });
  expect(controlsFit).toBe(true);
  await first.locator('summary').click();
  const classList = first.getByRole('list', { name: 'Các lớp được giao' });
  await expect(classList).toBeVisible();
  const classesBox = (await classList.boundingBox())!;
  expect(classesBox.x).toBeGreaterThanOrEqual(0); expect(classesBox.x + classesBox.width).toBeLessThanOrEqual(width);
  await page.keyboard.press('Escape');
  const trigger = first.getByRole('button', { name: `Thao tác đề ${rows[0].title}` });
  await trigger.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  expect(await menu.evaluate(element => element.parentElement === document.body)).toBe(true);
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.x).toBeGreaterThanOrEqual(0); expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await page.screenshot({ path: info.outputPath(`exam-cards-${width}.png`) });
});
