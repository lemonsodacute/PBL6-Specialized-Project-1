import { test, expect } from '@playwright/test';
import { uiSession, fixtureUser } from './ui-fixtures';

test('student grades use compact rows, one-line submitted dates, and page-scoped topbar', async ({page}) => {
  await page.setViewportSize({width: 1500, height: 900});
  const fixture = await uiSession(page, 'student');
  fixture.attempts = [
    {
      id: 'attempt-graded', exam_id: 'exam-1', exam_title: 'Đề kiểm tra học phần',
      student_id: fixtureUser.id, status: 'submitted', attempt_number: 1,
      score: 8, max_score: 10, submitted_at: '2026-11-05T10:04:00Z',
      started_at: '2026-11-05T09:35:00Z', classes: [{id:'class-1',name:'Lớp kiểm thử'}],
    },
    {
      id: 'attempt-pending', exam_id: 'exam-2', exam_title: 'Đề tự luận chờ chấm',
      student_id: fixtureUser.id, status: 'submitted', attempt_number: 1,
      score: 3, final_score: null, grading_pending: true, max_score: 10,
      submitted_at: '2026-11-05T10:04:00Z',
      started_at: '2026-11-05T09:35:00Z', classes: [],
    },
  ];
  await page.goto('/student/grades');
  await expect(page.getByRole('heading',{name:'Điểm số / Kết quả'})).toBeVisible();
  const summary = page.getByRole('region',{name:'Thống kê kết quả trên trang hiện tại'});
  await expect(summary).toContainText('Bài thi hiển thị2');
  await expect(summary).toContainText('Đã có điểm1');
  await expect(summary).toContainText('Chờ chấm1');
  const resultTable = page.getByRole('region',{name:'Điểm số / Kết quả'});
  const rows = resultTable.locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('05/11/2026 · 17:04');
  await expect(rows.first().getByRole('link',{name:'Xem kết quả'})).toBeVisible();
  await expect.poll(async()=>rows.first().evaluate(node=>Math.round(node.getBoundingClientRect().height))).toBeLessThanOrEqual(72);
  await expect.poll(async()=>page.locator('.student-topbar').evaluate(node=>Math.round(node.getBoundingClientRect().height))).toBe(58);
  await page.goto('/student/history');
  await expect(page.getByRole('heading',{name:'Điểm số / Kết quả'})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Thống kê kết quả trên trang hiện tại'})).toHaveCount(0);
  await expect.poll(async()=>page.locator('.student-topbar').evaluate(node=>Math.round(node.getBoundingClientRect().height))).toBeGreaterThan(58);
});

test('student grades remain usable on narrow screens without cutting off results', async ({page}) => {
  await page.setViewportSize({width: 390, height: 780});
  const fixture=await uiSession(page,'student');
  fixture.attempts=[{
    id:'attempt-mobile', exam_id:'exam-mobile', exam_title:'Bài kiểm tra hiển thị trên điện thoại',
    student_id:fixtureUser.id,status:'submitted',attempt_number:1,
    score:0,max_score:10,submitted_at:'2026-11-05T10:04:00Z',
    started_at:'2026-11-05T09:00:00Z',classes:[],
  }];
  await page.goto('/student/grades');
  await expect(page.getByRole('heading',{name:'Điểm số / Kết quả'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Xem kết quả'})).toBeVisible();
  await expect(page.getByRole('region',{name:'Thống kê kết quả trên trang hiện tại'})).toBeVisible();
});
