import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';

const examId = '22222222-2222-4222-8222-222222222222';
const previewPath = `/dashboard/exams/${examId}/preview`;
const exam = {
  id: examId, title: 'Thực hành Quản trị mạng', description: 'Đề kiểm tra thử nghiệm',
  status: 'published', duration_minutes: 60, questions_count: 3,
  start_time: '2026-11-01T08:00:00Z', end_time: '2026-11-15T08:00:00Z',
  require_camera: true, require_mic: true, attempt_count: 0, completed_attempt_count: 0,
  shuffle_questions: false, shuffle_options: false, classes: [],
};
const questions = [
  {
    id: '33333333-3333-4333-8333-333333333331', question_bank_id: '44444444-4444-4444-8444-444444444444',
    type: 'mcq_single', content: 'Thiết bị nào chuyển frame dựa trên địa chỉ MAC?', topic: 'Mạng máy tính',
    default_points: 1, points: 1, order_index: 0, is_active: true, options_json: { options: ['Router', 'Switch', 'Modem'] },
    correct_answer_json: { answer: 'Switch' }, explanation: 'Chỉ giáo viên được xem trong quản trị câu hỏi.',
  },
  {
    id: '33333333-3333-4333-8333-333333333332', question_bank_id: '44444444-4444-4444-8444-444444444444',
    type: 'mcq_multi', content: 'Chọn các giao thức tầng ứng dụng', topic: 'Giao thức',
    default_points: 2, points: 2, order_index: 1, is_active: true,
    options_json: { options: [{ id: 'http', text: 'HTTP' }, { id: 'dns', text: 'DNS' }, { id: 'arp', text: 'ARP' }] },
    correct_answer_json: { selected_option_ids: ['http','dns'] },
  },
  {
    id: '33333333-3333-4333-8333-333333333333', question_bank_id: '44444444-4444-4444-8444-444444444444',
    type: 'essay', content: 'Giải thích chức năng của switch trong LAN.', topic: 'Tự luận',
    default_points: 3, points: 3, order_index: 2, is_active: true,
    options_json: null, correct_answer_json: null,
  },
];

async function setup(page: Page, role = 'teacher', status = 200) {
  const state = await uiSession(page, role);
  state.exams = [exam];
  let fetched = 0;
  const reads: string[] = [];
  await page.route(`**/api/v1/exams/${examId}`, route => {
    fetched++;
    reads.push(route.request().method());
    return route.fulfill({
      status,
      headers: {
        'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000',
        'access-control-allow-credentials':'true',
      },
      json: status === 200 ? { data: { ...exam, questions } } : { error: { code:'FORBIDDEN', message:'You do not have access to this exam' } },
    });
  });
  return { state, reads, fetched: () => fetched };
}

test('teacher opens a full read-only exam preview directly from an exam card', async ({ page }) => {
  const { reads } = await setup(page);
  await page.goto('/dashboard/exams');
  const card = page.getByRole('article', { name: 'Thực hành Quản trị mạng' });
  const preview = card.getByRole('link', { name: 'Xem toàn bộ đề thi Thực hành Quản trị mạng' });
  await expect(preview).toHaveAttribute('href', previewPath);
  await card.getByRole('button', { name: 'Thao tác đề Thực hành Quản trị mạng' }).click();
  await expect(page.getByRole('menuitem', { name: 'Xem toàn bộ đề thi' })).toHaveAttribute('href', previewPath);
  await page.getByRole('menuitem', { name: 'Xem toàn bộ đề thi' }).click();

  await expect(page).toHaveURL(new RegExp(`${previewPath}$`));
  await expect(page.getByRole('heading', { name: exam.title, exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: questions[0].content })).toBeVisible();
  await expect(page.getByRole('heading', { name: questions[1].content })).toBeVisible();
  await expect(page.getByRole('heading', { name: questions[2].content })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Các phương án câu 1' }).locator('li')).toHaveCount(3);
  await expect(page.getByRole('list', { name: 'Các phương án câu 2' }).locator('li')).toHaveCount(3);
  await expect(page.getByText('Sinh viên sẽ nhập câu trả lời tự luận ở đây.')).toBeVisible();
  await expect(page.getByText('Chỉ giáo viên được xem trong quản trị câu hỏi.')).toHaveCount(0);
  await expect(page.locator('.answer-option input, .exam-answer-input')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nộp bài' })).toHaveCount(0);
  expect(reads.every(method => method === 'GET')).toBe(true);

  await page.getByRole('button', { name: 'Từng câu' }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: questions[0].content })).toBeVisible();
  await page.getByRole('button', { name: 'Câu tiếp theo' }).click();
  await expect(page.getByRole('heading', { name: questions[1].content })).toBeVisible();
  await expect(page.getByRole('heading', { name: questions[0].content })).toHaveCount(0);
  await page.getByRole('button', { name: 'Đi đến câu 3' }).click();
  await expect(page.getByRole('heading', { name: questions[2].content })).toBeVisible();
  await page.getByRole('button', { name: 'Xem tất cả' }).click();
  await expect(page.getByRole('article')).toHaveCount(3);

  await page.getByRole('link', { name: 'Danh sách đề thi' }).click();
  await expect(page).toHaveURL(/\/dashboard\/exams$/);
});

for (const width of [390, 1024, 1440]) {
  test(`teacher full preview fits ${width}px without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    await page.goto(previewPath);
    await expect(page.getByRole('heading', { name: exam.title })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  });
}

test('students cannot access the teacher exam preview or trigger its question request', async ({ page }) => {
  const { fetched } = await setup(page, 'student');
  await page.goto(previewPath);
  await expect(page).toHaveURL(/\/student(?:\/|$)/);
  expect(fetched()).toBe(0);
  await expect(page.getByText(questions[0].content)).toHaveCount(0);
});

test('a forbidden exam preview shows an error and does not fabricate questions', async ({ page }) => {
  await setup(page, 'teacher', 403);
  await page.goto(previewPath);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
});
