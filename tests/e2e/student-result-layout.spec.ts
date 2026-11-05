import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { uiSession } from './ui-fixtures';

const attemptId = 'result-layout-test';
const path = `/student/attempts/${attemptId}/result`;
const artifact = 'artifacts/student-result-layout';

async function resultSession(page: Page, options: { count?: number; longText?: boolean; pending?: boolean } = {}) {
  await uiSession(page);
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role: 'student' })).toString('base64url')}.fixture`, url: test.info().project.use.baseURL! }]);
  const long = options.longText ? 'chuoi_khong_ngat_'.repeat(24) : '';
  const questions = Array.from({ length: options.count ?? 15 }, (_, index) => ({
    question_id: `question-${index + 1}`, order_index: index, type: 'mcq_single',
    content: `Nội dung câu ${index + 1} từ kết quả bài thi. ${long}`,
    options_json: { options: ['Đáp án A', 'Đáp án B'] },
    student_answer: index % 3 === 2 ? null : index % 3 === 0 ? 'Đáp án A' : 'Đáp án B',
    correct_answer: 'Đáp án A', is_correct: index % 3 === 2 ? null : index % 3 === 0,
    points_awarded: index % 3 === 0 ? 1 : 0, points: 1, explanation: `Giải thích câu ${index + 1}. ${long}`,
  }));
  if (options.longText) questions.at(-1)!.student_answer = long;
  if (options.pending) Object.assign(questions.at(-1)!, { type: 'essay', student_answer: 'Bài tự luận đã nộp',
    points_awarded: null, is_correct: null, correct_answer: null, explanation: null, options_json: null });
  const data = { id: attemptId, exam_id: 'exam-result-layout', exam_title: 'Bài kiểm tra kết quả', status: 'submitted',
    score: 5, max_score: questions.length, grading_pending: !!options.pending,
    started_at: '2026-10-29T01:00:00Z', submitted_at: '2026-10-29T01:30:00Z', show_answers: !options.pending, questions };
  await page.route(`**/api/v1/attempts/${attemptId}/result`, route => route.fulfill({
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000',
      'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,OPTIONS' },
    status: route.request().method() === 'OPTIONS' ? 204 : 200,
    ...(route.request().method() === 'OPTIONS' ? {} : { json: { data } }),
  }));
  return data;
}

async function geometry(page: Page) {
  return page.locator('.result-layout').evaluate(layout => {
    const nav = layout.querySelector('.result-question-nav')!, detail = layout.querySelector('.result-question-detail')!, grid = nav.querySelector('div')!;
    const bounds = (el: Element) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const style = getComputedStyle(nav);
    return { nav: bounds(nav), detail: bounds(detail), buttons: [...nav.querySelectorAll('button')].map(bounds),
      paddingLeft: parseFloat(style.paddingLeft), paddingRight: parseFloat(style.paddingRight),
      navOverflow: nav.scrollWidth > nav.clientWidth, gridOverflow: grid.scrollWidth > grid.clientWidth,
      detailOverflow: detail.scrollWidth > detail.clientWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth };
  });
}

function assertContained(values: Awaited<ReturnType<typeof geometry>>, width: number) {
  expect(values.pageOverflow).toBe(false);
  expect(values.navOverflow).toBe(false);
  expect(values.gridOverflow).toBe(false);
  expect(values.detailOverflow).toBe(false);
  for (const button of values.buttons) {
    expect(button.left).toBeGreaterThanOrEqual(values.nav.left + values.paddingLeft - 1);
    expect(button.right).toBeLessThanOrEqual(values.nav.right - values.paddingRight + 1);
    expect(button.top).toBeGreaterThanOrEqual(values.nav.top);
    expect(button.bottom).toBeLessThanOrEqual(values.nav.bottom);
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(44);
  }
  if (width >= 1024) {
    expect(values.detail.left - values.nav.right).toBeCloseTo(24, 0);
    expect(values.nav.top).toBeCloseTo(values.detail.top, 0);
    expect(values.detail.width).toBeGreaterThan(values.nav.width);
  } else {
    expect(values.detail.top - values.nav.bottom).toBeCloseTo(24, 0);
    expect(values.nav.width).toBeCloseTo(values.detail.width, 0);
  }
}

test.use({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
for (const [width, theme] of [[1440, 'light'], [1024, 'light'], [768, 'light'], [390, 'light'], [1440, 'dark'], [390, 'dark']] as const) {
  test(`result navigator stays inside its card and selection preserves answers at ${width}px ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await resultSession(page);
    await page.goto(path);
    const nav = page.locator('.result-question-nav'), detail = page.locator('.result-question-detail');
    await expect(nav.getByRole('button')).toHaveCount(15);
    await expect(page.locator('.result-summary-grid strong')).toHaveText(['5 / 15', '5', '5', '5']);
    const values = await geometry(page);
    fs.mkdirSync(artifact, { recursive: true });
    const stage = process.env.RESULT_LAYOUT_CAPTURE_STAGE ?? 'after';
    fs.writeFileSync(`${artifact}/${stage}-${width}-${theme}.json`, JSON.stringify(values, null, 2));
    await page.screenshot({ path: `${artifact}/${stage}-${width}-${theme}.png`, fullPage: true, timeout: 90000 });
    assertContained(values, width);
    const fifth = nav.getByRole('button', { name: '5', exact: true });
    await fifth.click();
    await expect(fifth).toHaveClass(/active.*wrong/);
    await expect(detail.getByRole('heading', { level: 2 })).toContainText('Câu 5. Nội dung câu 5');
    await expect(detail.locator('.result-answer-row strong')).toHaveText(['Đáp án B', 'Đáp án A']);
    await expect(detail.locator('.result-explanation')).toContainText('Giải thích câu 5.');
    await expect(detail.locator('.result-wrong')).toHaveText('Sai');
    await nav.getByRole('button', { name: '10', exact: true }).press('Enter');
    await expect(nav.getByRole('button', { name: '10', exact: true })).toHaveClass(/active.*correct/);
    await expect(fifth).not.toHaveClass(/active/);
    await expect(detail.locator('.result-correct')).toHaveText('Đúng');
    await nav.getByRole('button', { name: '15', exact: true }).click();
    await expect(detail.locator('.result-answer-row strong').first()).toHaveText('Chưa trả lời');
    await expect(page.locator('.result-summary-grid strong')).toHaveText(['5 / 15', '5', '5', '5']);
  });
}

for (const width of [1440, 390]) test(`long answers and three-digit question numbers fit at ${width}px`, async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width, height: 1000 });
  await resultSession(page, { count: 120, longText: true });
  await page.goto(path);
  const last = page.locator('.result-question-nav').getByRole('button', { name: '120', exact: true });
  await last.click();
  await expect(last).toHaveClass(/active/);
  await expect(page.locator('.result-question-detail h2')).toContainText('Câu 120.');
  assertContained(await geometry(page), width);
});

test('pending essay score and unpublished correct answers keep their existing display', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await resultSession(page, { pending: true });
  await page.goto(path);
  await expect(page.locator('.result-summary-grid strong').first()).toHaveText('Đang chờ chấm');
  await page.locator('.result-question-nav').getByRole('button', { name: '15', exact: true }).click();
  await expect(page.locator('.result-pending')).toHaveText('Chờ giáo viên chấm');
  await expect(page.locator('.result-answer-row')).toHaveCount(1);
  await expect(page.locator('.result-answer-row strong')).toHaveText('Bài tự luận đã nộp');
  await expect(page.locator('.result-note')).toContainText('Đáp án đúng sẽ hiển thị');
});
