import { expect, test } from '@playwright/test';
import { uiSession } from './ui-fixtures';

test.use({ timezoneId: 'Asia/Ho_Chi_Minh' });
for(const theme of ['light','dark'] as const) test(`public ${theme}: soft frame and branded themed surface`,async({page})=>{
  await page.emulateMedia({colorScheme:theme});await page.goto('/');
  const hero=page.getByRole('heading',{level:1,name:/Giám thị AI/});await expect(hero).toBeVisible();
  const frame=await page.getByRole('banner').locator(':scope > div').evaluate(node=>{const style=getComputedStyle(node);return {border:style.borderTopWidth,shadow:style.boxShadow,radius:parseFloat(style.borderTopLeftRadius)};});
  expect(frame.border).toBe('1px');expect(frame.shadow).not.toBe('none');expect(frame.radius).toBeGreaterThanOrEqual(15);
  expect(await page.locator('main').evaluate(node=>getComputedStyle(node.parentElement!).backgroundColor)).toBe(theme==='light'?'rgb(255, 248, 243)':'rgb(22, 40, 50)');
  await expect(page.locator('figure h2')).toContainText('Lịch sử sự kiện');
});
for (const theme of ['light','dark'] as const) for (const width of [1440,390]) {
  test(`neo student ${width} ${theme}: real data, composition and navigation`, async ({ page }) => {
    await page.setViewportSize({width,height:1000});
    await page.emulateMedia({colorScheme:theme});
    await page.clock.setFixedTime(new Date('2026-10-21T08:00:00+07:00'));
    const state = await uiSession(page);
    state.exams = [
      {id:'neo-exam',title:'Lập trình Web — Kiểm tra giữa kỳ',status:'published',duration_minutes:60,start_time:'2026-10-22T08:00:00+07:00',end_time:'2026-10-22T10:00:00+07:00'},
      {id:'completed',title:'Bài thi đã hoàn tất',status:'submitted',start_time:'2026-10-22T08:00:00+07:00',end_time:'2026-10-22T10:00:00+07:00'},
    ];
    state.attempts=[{id:'neo-attempt',exam_id:'old-exam',exam_title:'Cơ sở dữ liệu — Bài kiểm tra chương 2',status:'graded',score:8,max_score:10,started_at:'2026-10-20T08:00:00+07:00',submitted_at:'2026-10-20T09:00:00+07:00'}];
    await page.route('**/api/v1/live-classes?**', route=>route.fulfill({headers:{'access-control-allow-origin':route.request().headers().origin??'http://localhost:3000','access-control-allow-credentials':'true'},json:{data:[{id:'neo-live',title:'Thảo luận đồ án học phần',status:'scheduled',start_time:'2026-10-23T14:00:00+07:00',end_time:'2026-10-23T15:30:00+07:00'}]}}));
    await page.goto('/student');
    await expect(page.getByRole('heading',{level:1,name:'Hôm nay bạn có gì?'})).toBeVisible();
    await expect(page.locator('main header').first()).toContainText(state.user.full_name);
    await expect(page.locator('main .loading-skeleton')).toHaveCount(0);
    const cards=page.getByRole('navigation',{name:'Không gian học tập'});
    await expect(cards.getByRole('link')).toHaveCount(3);
    await expect(cards.getByRole('link').first()).toContainText('Lớp học trực tuyến');
    await expect(cards.getByRole('link').first()).toHaveAttribute('href','/student/live-classes');
    await expect(page.getByRole('region',{name:'Kỳ thi ưu tiên'}).getByRole('heading',{level:2})).toContainText('Lập trình Web');
    await expect(cards.getByRole('link').nth(1)).toHaveAttribute('href','/student/exams');
    const calendar=page.getByRole('region',{name:'Lịch học và lịch thi',exact:true});
    const upcoming=page.getByRole('region',{name:'Sắp diễn ra',exact:true});
    await expect(upcoming).not.toContainText('Bài thi đã hoàn tất');
    await expect(upcoming.getByRole('link',{name:'Xem Thi: Lập trình Web — Kiểm tra giữa kỳ'})).toBeVisible();
    if(width===1440){const a=(await calendar.boundingBox())!,b=(await upcoming.boundingBox())!;expect(b.x).toBeGreaterThan(a.x+a.width);expect(Math.abs(a.y-b.y)).toBeLessThan(4);expect(a.height).toBeLessThan(700);}
    else await expect(calendar.locator('.calendar-grid')).toBeHidden();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await page.locator('.sidebar').evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgb(0, 109, 119)');
    expect(await calendar.locator('.calendar-card').evaluate(node=>getComputedStyle(node).borderTopWidth)).toBe('1px');
    await page.screenshot({path:`artifacts/neo-education/student-${width}-${theme}.png`,fullPage:true});
    await page.screenshot({path:`artifacts/neo-education/student-overview-${width}-${theme}.png`});
    // The new presentation must disappear when leaving the dashboard.
    await page.goto('/student/exams');
    await expect(page.locator('.neo-dashboard-shell')).toHaveCount(0);
  });
}

for (const role of ['teacher','admin']) test(`${role} keeps its existing workspace presentation`,async({page})=>{
  await uiSession(page,role);await page.context().addCookies([{name:'auth_token',value:`fixture.${Buffer.from(JSON.stringify({role})).toString('base64url')}.signature`,url:'http://localhost:3000'}]);
  await page.goto(role==='teacher'?'/teacher':'/admin');
  await expect(page.locator('main .ui-card').first()).toBeVisible();
  await expect(page.locator('.neo-dashboard-shell')).toHaveCount(0);
  expect(await page.locator('.app-shell').evaluate(node=>getComputedStyle(node).getPropertyValue('--neo-cream').trim())).toBe('');
});
