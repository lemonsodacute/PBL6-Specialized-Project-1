import { test, expect } from '@playwright/test';
import { uiSession } from './ui-fixtures';
test.use({ trace: 'off' });
test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role: 'admin' })).toString('base64url')}.fixture`, url: test.info().project.use.baseURL! }]);
});

test('Admin manages knowledge articles and sees editor/status metadata', async ({ page }) => {
  await uiSession(page, 'admin');
  const articles: Record<string, unknown>[] = [];
  await page.route('**/api/v1/admin/ai-support/articles**', async route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS' };
    const method = route.request().method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (method !== 'GET') {
      const article = { ...route.request().postDataJSON(), id: 'article-1', updated_at: '2026-10-17T00:00:00Z', updated_by: 'Test Admin' };
      articles.splice(0, articles.length, article); return route.fulfill({ headers, json: { data: article } });
    }
    return route.fulfill({ headers, json: { data: { articles, categories: { student: [{ id: 'other', label: 'Khác' }], teacher: [{ id: 'other', label: 'Khác' }] }, routes: { student: ['/student/help'], teacher: ['/teacher/help'] } } } });
  });
  await page.goto('/admin/ai-support/knowledge');
  await expect(page.getByText('Không có bài hướng dẫn phù hợp.')).toBeVisible();
  await page.getByRole('button', { name: 'Tạo bài hướng dẫn', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tiêu đề', { exact: true }).fill('Hướng dẫn kiểm tra camera');
  await dialog.getByLabel('Nội dung (mỗi bước một dòng)').fill('Cho phép camera trong trình duyệt.');
  await dialog.getByLabel('Keywords (cách nhau bằng dấu phẩy)').fill('camera, microphone');
  await dialog.getByRole('button', { name: 'Lưu bài hướng dẫn' }).click();
  await expect(page.getByText('Hướng dẫn kiểm tra camera', { exact: true })).toBeVisible();
  await expect(page.getByText(/Cập nhật.*Test Admin/)).toBeVisible();
  await page.getByRole('button', { name: 'Sửa', exact: true }).click();
  await dialog.getByLabel('Active', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Lưu bài hướng dẫn' }).click();
  await expect(page.getByText('Student · Khác · Inactive')).toBeVisible();
  expect(articles[0].is_active).toBe(false);
});

test('Admin activity shows real response sample denominators empty state and CSV export', async ({ page }) => {
  await uiSession(page, 'admin');
  let sample = false;
  const requests: string[] = [];
  await page.route('**/api/v1/admin/ai-support/**', async route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    requests.push(route.request().url());
    if (route.request().url().includes('/export/')) return route.fulfill({ headers, contentType: 'text/csv', body: 'timestamp,accepted,edited,rejected\n2026-10-17,7,2,1\n' });
    const ratio = (n: number, d: number) => ({ numerator: n, denominator: d, rate: d ? n / d : null });
    return route.fulfill({ headers, json: { data: { question: { requests: sample ? 2 : 0, acceptance_rate: ratio(sample ? 7 : 0, sample ? 10 : 0), edit_rate: ratio(sample ? 2 : 0, sample ? 10 : 0), reject_rate: ratio(sample ? 1 : 0, sample ? 10 : 0), reviewed: sample ? 10 : 0, insufficient_reviewed_samples: true, average_teacher_rating: sample ? 4.3 : null, teacher_rating_count: sample ? 28 : 0 },
      support: { sessions: sample ? 10 : 0, escalation_rate: ratio(sample ? 4 : 0, sample ? 10 : 0) }, rate_limit_errors: 0,
      health: { provider: 'gemini-openai-compatible', configured: true, question_model: 'configured', support_model: 'configured', last_success_at: null, last_error_at: null, last_error_code: null, provider_tier: 'configured externally' } } } });
  });
  await page.goto('/admin/ai-support/activity');
  await expect(page.getByText(/Chưa có dữ liệu trong khoảng thời gian này/)).toBeVisible();
  await page.locator('summary').filter({hasText:'Đánh giá chất lượng'}).click();
  await expect(page.getByText(/Chưa có đánh giá sao · 0 mẫu/)).toBeVisible();
  sample = true;
  await page.getByLabel('Khoảng thời gian').selectOption('30');
  await page.getByRole('button',{name:'Áp dụng',exact:true}).click();
  await expect(page.getByRole('progressbar',{name:'Tỷ lệ chuyển quản trị viên',exact:true})).toHaveAttribute('aria-valuetext','40% · 4 / 10');
  await page.locator('summary').filter({hasText:'Đánh giá chất lượng'}).click();
  await expect(page.getByRole('progressbar',{name:'Được chấp nhận',exact:true})).toHaveAttribute('aria-valuetext','70% · 7 / 10');
  await expect(page.getByText(/4,3 \/ 5 · 28 đánh giá sao/)).toBeVisible();
  await expect(page.getByText(/Chưa đủ 30 mẫu đánh giá/)).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất CSV tạo câu hỏi' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toContain('ai-question-');
  expect(requests.some(url => url.includes('/export/question?start='))).toBe(true);
});
