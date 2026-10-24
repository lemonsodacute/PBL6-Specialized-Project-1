import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';
import { calendarDayEntries, calendarEventAppearance } from '../../lib/student-calendar-presentation';
import { mapCalendarEvents, type CalendarExam } from '../../lib/student-calendar';

test.use({ timezoneId: 'Asia/Ho_Chi_Minh' });
const exams: CalendarExam[] = [
  { id: 'web-window', title: 'Kiểm tra giữa kỳ', status: 'published', classes: [{id:'web',name:'Lập trình Web'}], start_time:'2026-10-22T08:00:00+07:00', end_time:'2026-10-25T23:30:00+07:00', duration_minutes:60 },
  { id: 'database-one-day', title: 'Cơ sở dữ liệu', status: 'published', start_time:'2026-10-22T09:00:00+07:00', end_time:'2026-10-22T11:30:00+07:00', duration_minutes:45 },
  { id: 'math-one-day', title: 'Giải tích', status: 'published', start_time:'2026-10-23T08:00:00+07:00', end_time:'2026-10-23T10:00:00+07:00', duration_minutes:60 },
];

async function setup(page: Page, rows = exams) {
  await page.clock.setFixedTime(new Date('2026-10-21T08:00:00+07:00'));
  const state = await uiSession(page); state.exams = rows;
  await page.route('**/api/v1/live-classes?**', route => route.fulfill({ headers: {
    'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials':'true',
  }, json:{data:[{id:'discussion', class_id:'software-engineering', title:'Thảo luận đồ án', class_name:'Công nghệ phần mềm', scheduled_start:'2026-10-23T14:00:00+07:00',scheduled_end:'2026-10-23T15:30:00+07:00',status:'scheduled'}]}}));
  await page.goto('/student');
  await expect(page.locator('#student-calendar .loading-skeleton')).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Sắp diễn ra',exact:true})).toContainText(rows[0].title);
  await page.evaluate(() => document.fonts.ready);
  return state;
}

test('availability endpoints use local dates, not attempt duration, and retain ongoing windows', () => {
  const start = new Date(2026,9,22,8), end = new Date(2026,9,25,23,30), today = new Date(2026,9,24);
  const events = mapCalendarEvents([{...exams[0],start_time:start.toISOString(),end_time:end.toISOString()}],[]);
  expect(calendarDayEntries(start,events,start,today).map(x=>x.kind)).toEqual(['open']);
  expect(calendarDayEntries(end,events,start,today).map(x=>x.kind)).toEqual(['close']);
  expect(calendarDayEntries(new Date(2026,9,23),events,start,today)).toHaveLength(0);
  expect(calendarDayEntries(today,events,start,today).map(x=>x.kind)).toEqual(['ongoing']);
  const first = new Date(2026,9,23);
  expect(calendarDayEntries(first,events,first,today).map(x=>x.kind)).toEqual(['ongoing']);
  expect(events[0].end!.getTime()-events[0].start.getTime()).toBeGreaterThan(60*60*1000);
  expect(events[0].durationMinutes).toBe(60);
});

test('single-day and missing-end events create one entry and never invent a close time', () => {
  const day = new Date(2026,9,23), start = new Date(2026,9,23,8), end = new Date(2026,9,23,10);
  const events = mapCalendarEvents([{...exams[2],start_time:start.toISOString(),end_time:end.toISOString()}, {...exams[0],id:'unknown',start_time:start.toISOString(),end_time:null}],[]);
  expect(calendarDayEntries(day,events,day,day).map(x=>x.kind)).toEqual(['single','single']);
  expect(events.find(x=>x.exam?.id==='unknown')!.end).toBeNull();
  expect(events[0].courseNames).toEqual(undefined);
  expect(mapCalendarEvents([exams[0]],[])[0].courseNames).toEqual(['Lập trình Web']);
});

test('sessions from the same course share its color while exams keep their own identity',()=>{
  const sessions=mapCalendarEvents([],['first','second'].map(id=>({id,class_id:'same-course',title:id,scheduled_start:exams[0].start_time!,scheduled_end:exams[0].end_time!})));
  expect(sessions[0].id).not.toBe(sessions[1].id);
  expect(calendarEventAppearance(sessions[0])).toEqual(calendarEventAppearance(sessions[1]));
  const mapped=mapCalendarEvents(exams,[]);
  expect(calendarEventAppearance(mapped[0])).not.toEqual(calendarEventAppearance(mapped[1]));
});

for (const width of [1440,390]) for (const theme of ['light','dark'] as const) {
  test(`calendar endpoints, identity colors and full popover at ${width}px ${theme}`, async({page})=>{
    await page.setViewportSize({width,height:1000}); await page.emulateMedia({colorScheme:theme}); await setup(page);
    const calendar = page.locator('#student-calendar');
    const surface = width===1440 ? calendar.locator('.calendar-grid') : calendar.locator('[class*="mobileAgenda"]');
    const multi = surface.locator('[data-event-id="exam-web-window"]');
    await expect(multi).toHaveCount(2);
    const open = surface.locator('[data-event-id="exam-web-window"][data-marker="open"]');
    const close = surface.locator('[data-event-id="exam-web-window"][data-marker="close"]');
    await expect(open).toBeVisible(); await expect(close).toBeVisible();
    await expect(open).toHaveAttribute('data-marker','open'); await expect(close).toHaveAttribute('data-marker','close');
    const contrast = await open.evaluate(el=>{
      const luminance = (color:string) => (color.match(/[\d.]+/g)??[]).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      const ratio = (a:number,b:number) => (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      const style=getComputedStyle(el),bg=luminance(style.backgroundColor);
      return {text:ratio(luminance(style.color),bg),marker:ratio(luminance(getComputedStyle(el.querySelector('i')!).backgroundColor),bg)};
    });
    expect(contrast.text).toBeGreaterThanOrEqual(4.5);expect(contrast.marker).toBeGreaterThanOrEqual(3);
    const accent = (node: typeof open) => node.evaluate(el=>getComputedStyle(el).getPropertyValue('--event-accent').trim());
    expect(await accent(close)).toBe(await accent(open));
    const single = surface.locator('[data-event-id="exam-math-one-day"]');
    await expect(single).toHaveCount(1); await expect(single).toHaveAttribute('data-marker','single');
    await expect(single).toContainText(width===1440 ? '08:00–10:00' : '08:00 → 10:00'); await expect(single).not.toContainText('MỞ'); await expect(single).not.toContainText('ĐÓNG');
    for (const entry of [open,close,single]) expect(await entry.locator('[class*="entryTiming"]').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    expect(await accent(surface.locator('[data-event-id="exam-database-one-day"]'))).not.toBe(await accent(open));
    expect(await page.getByRole('region',{name:'Sắp diễn ra',exact:true}).locator('[data-event-id="exam-web-window"]').evaluate(el=>getComputedStyle(el).getPropertyValue('--event-accent').trim())).toBe(await accent(open));
    const compact = page.getByRole('region',{name:'Sắp diễn ra',exact:true}).locator('[data-event-id="exam-database-one-day"]');
    await expect(compact).toContainText('22/10/2026'); await expect(compact).toContainText('09:00 → 11:30'); await expect(compact).not.toContainText('Mở:');
    await expect(calendar.getByLabel('Ký hiệu lịch')).toContainText('Ngày mở'); await expect(calendar.getByLabel('Ký hiệu lịch')).toContainText('Ngày đóng');
    await page.screenshot({path:`artifacts/student-calendar-refactor/student-${width}-${theme}.png`,fullPage:true});
    await calendar.screenshot({path:`artifacts/student-calendar-refactor/calendar-${width}-${theme}.png`});
    await open.click();
    const dialog = page.getByRole('dialog',{name:'Chi tiết sự kiện'});
    await expect(dialog).toContainText('Lập trình Web');
    await expect(dialog).toContainText('Mở: 22/10/2026 · 08:00'); await expect(dialog).toContainText('Đóng: 25/10/2026 · 23:30');
    await expect(dialog).toContainText('Thời lượng làm bài: 60 phút'); await expect(dialog).toContainText('Sắp diễn ra');
    await expect(dialog.getByRole('link',{name:'Xem chi tiết'})).toHaveAttribute('href','/student/exams/web-window/verify');
    expect(await accent(dialog.locator('[data-event-id="exam-web-window"]'))).toBe(await accent(open));
    await dialog.screenshot({path:`artifacts/student-calendar-refactor/popover-${width}-${theme}.png`});
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(open).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

for (const width of [1440,390]) test(`overlapping events are bounded and day details expose all records at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  const crowded = Array.from({length:7},(_,index)=>({...exams[1],id:`overlap-${index}`,title:`Bài kiểm tra đầy đủ số ${index+1} — Tên dài phải đọc được trong chi tiết ngày`}));
  await setup(page,crowded);
  const calendar = page.locator('#student-calendar');
  const surface = width===1440 ? calendar.locator('.calendar-grid') : calendar.locator('[class*="mobileAgenda"]');
  await expect(surface.locator('[data-event-id^="exam-overlap-"]')).toHaveCount(3);
  const more = surface.getByRole('button',{name:'Xem 7 sự kiện ngày 22/10/2026'});
  await expect(more).toContainText('+4 sự kiện khác'); await more.click();
  const dialog=page.getByRole('dialog',{name:'Sự kiện ngày 22/10/2026'});
  await expect(dialog.getByRole('heading',{level:3})).toHaveCount(7);
  await expect(dialog.getByRole('link',{name:'Xem chi tiết'})).toHaveCount(7);
  await expect(dialog).toContainText(crowded[6].title);
  await expect(dialog).toContainText('Đóng: 22/10/2026 · 11:30');
  await expect(dialog).toContainText('Thời lượng làm bài: 45 phút');
  expect(await dialog.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  await dialog.screenshot({path:`artifacts/student-calendar-refactor/day-detail-${width}.png`});
  await dialog.getByRole('link',{name:'Xem chi tiết'}).last().scrollIntoViewIfNeeded(); await expect(dialog).toBeVisible();
  await dialog.screenshot({path:`artifacts/student-calendar-refactor/day-detail-scrolled-${width}.png`});
});

test('pinned details survive a delayed scroll event but dismiss when the page moves',async({page})=>{
  await setup(page);
  await page.locator('.calendar-grid [data-event-id="exam-web-window"][data-marker="open"]').click();
  const dialog=page.getByRole('dialog',{name:'Chi tiết sự kiện'});
  await expect(dialog).toBeVisible();
  await page.evaluate(()=>document.dispatchEvent(new Event('scroll',{bubbles:true})));
  await expect(dialog).toBeVisible();
  await page.evaluate(()=>window.scrollBy(0,100));
  await expect(dialog).toHaveCount(0);
});

test('event colors survive API order changes, month navigation and page refresh',async({page})=>{
  const state=await setup(page); state.exams=[...exams].reverse();
  const color = () => page.locator('.calendar-grid [data-event-id="exam-web-window"][data-marker="open"]').evaluate(el=>getComputedStyle(el).getPropertyValue('--event-accent').trim());
  const original=await color();
  await page.locator('#student-calendar').getByRole('button',{name:'Lịch tiếp theo'}).click();
  await page.locator('#student-calendar').getByRole('button',{name:'Hôm nay',exact:true}).click();
  await expect.poll(color).toBe(original);
  await page.reload(); await expect.poll(color).toBe(original);
});
