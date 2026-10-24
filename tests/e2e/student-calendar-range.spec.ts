import { expect, test, type Page } from '@playwright/test';
import { fixtureUser, uiSession } from './ui-fixtures';
import { mapCalendarEvents, calendarEventStatus, type CalendarExam } from '../../lib/student-calendar';
import { calendarDayEntries } from '../../lib/student-calendar-presentation';
import { readCalendarWindow } from '../../lib/calendar-collection';

test.use({ timezoneId: 'Asia/Ho_Chi_Minh' });
const rangeExam: CalendarExam = { id: 'range', title: 'Khai phá dữ liệu — Kiểm tra kiến thức nền tảng', status: 'published',
  start_time: '2026-10-11T23:30:00+07:00', end_time: '2026-10-15T23:30:00+07:00', duration_minutes: 30 };

test('cross-week windows retain their opening and closing calendar dates', () => {
  const events = mapCalendarEvents([{ ...rangeExam, start_time: new Date(2026,9,11,23,30).toISOString(), end_time: new Date(2026,9,15,23,30).toISOString() }],[]);
  const days = Array.from({length:14},(_,i)=>new Date(2026,9,5+i));
  const entries = days.flatMap(day=>calendarDayEntries(day,events,days[0],new Date(2026,9,1)).map(entry=>({day:day.getDate(),kind:entry.kind})));
  expect(entries).toEqual([{day:11,kind:'open'},{day:15,kind:'close'}]);
});

test('mapping never derives the window from duration and retains only valid dates', () => {
  const events = mapCalendarEvents([rangeExam, { ...rangeExam, id: 'unknown-end', end_time: null },
    { ...rangeExam, id: 'bad-start', start_time: 'invalid' }, { ...rangeExam, id: 'reversed', end_time: '2026-10-10T00:00:00Z' }], []);
  expect(events).toHaveLength(3);
  expect(events[0].end?.toISOString()).toBe('2026-10-15T16:30:00.000Z');
  expect(events[1].end).toBeNull(); expect(events[2].end).toBeNull();
  expect(events[0].durationMinutes).toBe(30);
});

test('day view treats dates with a time component as whole calendar days', () => {
  const start = new Date(2026, 9, 13, 9), end = new Date(2026, 9, 13, 10);
  const events = mapCalendarEvents([{ ...rangeExam, start_time: start.toISOString(), end_time: end.toISOString() }], []);
  expect(calendarDayEntries(new Date(2026,9,13,8),events,new Date(2026,9,13,8),new Date(2026,9,13))).toHaveLength(1);
  expect(calendarDayEntries(new Date(2026,9,13,8),events,new Date(2026,9,13,8),new Date(2026,9,13))[0].kind).toBe('single');
});

test('student submission overrides an open exam without inheriting foreign attempts', () => {
  const now = Date.parse('2026-10-13T08:00:00+07:00');
  const events = mapCalendarEvents([{ ...rangeExam, attempt: { id: 'mine', exam_id: 'range', student_id: fixtureUser.id, status: 'submitted' } },
    { ...rangeExam, id: 'foreign', attempt: { id: 'other', exam_id: 'foreign', student_id: 'another-student', status: 'submitted' } }], []);
  expect(calendarEventStatus(events[0], fixtureUser.id, now)).toEqual({ status: 'submitted', label: 'Đã nộp' });
  expect(calendarEventStatus(events[1], fixtureUser.id, now)).toEqual({ status: 'open', label: 'Đang diễn ra' });
});

test('calendar reads all pages of the bounded window', async () => {
  const calls: Record<string, unknown>[] = [];
  const rows = await readCalendarWindow<{ id: number }>(async params => {
    calls.push(params);
    return { data: Array.from({ length: params.page === 1 ? 100 : 1 }, (_, index) => ({ id: params.page === 1 ? index : 100 })), meta: { total: 101 } };
  }, new Date('2026-10-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z'), () => true);
  expect(rows).toHaveLength(101); expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({ page: 2, limit: 100, from_time: '2026-10-01T00:00:00.000Z', to_time: '2026-11-01T00:00:00.000Z' });
});

async function setupRanges(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-13T08:00:00+07:00'));
  await uiSession(page);
  const exams: CalendarExam[] = [rangeExam,
    { ...rangeExam, id: 'same-week', title: 'Khoảng cùng tuần', start_time: '2026-10-12T09:00:00+07:00', end_time: '2026-10-15T18:00:00+07:00' },
    { ...rangeExam, id: 'one-day', title: 'Bài thi một ngày', start_time: '2026-10-14T23:30:00+07:00', end_time: '2026-10-14T23:59:00+07:00' },
    { ...rangeExam, id: 'submitted', title: 'Bài thi đã nộp còn mở', attempt: { id: 'done', exam_id: 'submitted', student_id: fixtureUser.id, status: 'submitted' } },
    { ...rangeExam, id: 'old-start', title: 'Mở từ tháng trước', start_time: '2026-08-20T08:00:00+07:00', end_time: '2026-10-14T08:00:00+07:00' },
    { ...rangeExam, id: 'cross-month', title: 'Qua tháng mới', start_time: '2026-10-30T23:30:00+07:00', end_time: '2026-11-03T23:30:00+07:00' },
    { ...rangeExam, id: 'ended', title: 'Bài thi đã kết thúc', start_time: '2026-10-09T23:30:00+07:00', end_time: '2026-10-10T23:30:00+07:00' },
    { ...rangeExam, id: 'unknown-end', title: 'Chưa có hạn đóng', end_time: null },
  ];
  const headers = { 'access-control-allow-origin': process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type' };
  await page.route('**/api/v1/exams?**', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const params = new URL(route.request().url()).searchParams;
    const from = Date.parse(params.get('from_time')!), to = Date.parse(params.get('to_time')!);
    const data = exams.filter(exam => Date.parse(exam.end_time ?? exam.start_time) >= from && Date.parse(exam.start_time) < to);
    return route.fulfill({ headers, json: { data, meta: { total: data.length } } });
  });
  await page.route('**/api/v1/exams/*', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const id = new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({ headers, json: { data: { ...exams.find(exam => exam.id === id), require_camera: false } } });
  });
}

test('month endpoints, ongoing windows, completion status and true availability remain accessible',async({page})=>{
  await setupRanges(page);await page.goto('/student');
  const grid=page.locator('.calendar-grid.month');
  const open=grid.locator('[data-event-id="exam-range"][data-marker="open"]');
  const close=grid.locator('[data-event-id="exam-range"][data-marker="close"]');
  await expect(open).toContainText('MỞ 23:30');await expect(close).toContainText('ĐÓNG 23:30');
  await expect(open.locator('..').locator('..')).toHaveAttribute('data-date','11/10/2026');
  await expect(close.locator('..').locator('..')).toHaveAttribute('data-date','15/10/2026');
  await expect(grid.locator('.calendar-day.today > span')).toHaveText('13');
  const ongoing=grid.locator('.today [data-event-id="exam-range"]');await expect(ongoing).toHaveAttribute('data-marker','ongoing');
  await close.hover();
  const popover=page.getByRole('dialog',{name:'Chi tiết sự kiện'});
  await expect(popover).toContainText('Mở: 11/10/2026 · 23:30');await expect(popover).toContainText('Đóng: 15/10/2026 · 23:30');
  await expect(popover).toContainText('Thời lượng làm bài: 30 phút');await expect(popover).toContainText('Trạng thái: Đang diễn ra');
  await page.keyboard.press('Escape');await expect(popover).toHaveCount(0);
  await expect(grid.locator('[data-event-id="exam-one-day"]')).toContainText('23:30–23:59');
  await expect(grid.locator('[data-event-id="exam-one-day"]')).toHaveCount(1);
  await expect(grid.locator('[data-event-id="exam-ended"]').first()).toHaveAttribute('data-status','ended');
  await grid.locator('[data-event-id="exam-submitted"]').first().click();await expect(popover).toContainText('Trạng thái: Đã nộp');
  await page.keyboard.press('Escape');
  const upcoming=page.getByRole('region',{name:'Sắp diễn ra',exact:true});
  await expect(upcoming).not.toContainText('Bài thi đã nộp còn mở');
  await expect(upcoming).toContainText('Mở: 11/10/2026 · 23:30');await expect(upcoming).toContainText('Đóng: 15/10/2026 · 23:30');
  await open.click();await popover.getByRole('link',{name:'Xem chi tiết'}).click();
  await expect(page).toHaveURL(/\/student\/exams\/range\/verify$/,{timeout:45000});
  await expect(page.locator('main')).toContainText('Thời gian mở: 23:30 11/10/2026');
  await expect(page.locator('main')).toContainText('Hạn làm bài: 23:30 15/10/2026');
  await expect(page.locator('main')).toContainText('Thời lượng làm bài: 30 phút');
});

test('cross-month endpoints and week/day ongoing views remain visible',async({page})=>{
  await setupRanges(page);await page.goto('/student');
  const calendar=page.locator('#student-calendar');await calendar.getByRole('button',{name:'Lịch tiếp theo'}).click();
  const entries=calendar.locator('.calendar-grid [data-event-id="exam-cross-month"]');await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toHaveAttribute('data-marker','open');await expect(entries.nth(1)).toHaveAttribute('data-marker','close');
  await calendar.getByRole('button',{name:'Hôm nay',exact:true}).click();await calendar.getByRole('combobox').selectOption('week');
  await expect(calendar.locator('.calendar-grid [data-event-id="exam-range"][data-marker="close"]')).toHaveCount(1);
  await expect(calendar.locator('.calendar-grid [data-event-id="exam-range"][data-marker="ongoing"]')).toHaveCount(2);
  await calendar.getByRole('combobox').selectOption('day');await expect(calendar.locator('.calendar-day')).toHaveCount(1);
  await expect(calendar.locator('.calendar-grid [data-event-id="exam-range"]')).toHaveCount(1);
});

test('mobile agenda retains endpoints, today and unknown availability without fabricated times',async({page})=>{
  await page.setViewportSize({width:390,height:1000});await setupRanges(page);await page.goto('/student');
  const calendar=page.locator('#student-calendar');await expect(calendar.locator('.calendar-grid')).toBeHidden();
  const agenda=calendar.locator('[class*="mobileAgenda"]');
  await expect(agenda.locator('[data-event-id="exam-range"][data-marker="open"]')).toBeVisible();
  await expect(agenda.locator('[data-event-id="exam-range"][data-marker="close"]')).toBeVisible();
  const unknown=agenda.locator('[data-event-id="exam-unknown-end"]');await expect(unknown).toHaveCount(1);await unknown.click();
  const dialog=page.getByRole('dialog',{name:'Chi tiết sự kiện'});await expect(dialog).toContainText('Đóng: Chưa có thông tin');await expect(dialog).toContainText('Thời lượng làm bài: 30 phút');
  await page.keyboard.press('Escape');
  await agenda.locator('[data-event-id="exam-submitted"]').first().click();await expect(dialog).toContainText('Đã nộp');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

