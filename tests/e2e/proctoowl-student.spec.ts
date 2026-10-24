import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';
import { writeFileSync } from 'node:fs';

test.use({ timezoneId:'Asia/Ho_Chi_Minh' });
const routes = [
  ['/student','dashboard'], ['/student/classes','classes'], ['/student/live-classes','live-classes'],
  ['/student/exams','exams'], ['/student/history','history'], ['/student/grades','results'],
] as const;

async function studentData(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-22T08:00:00+07:00'));
  const state = await uiSession(page);
  Object.assign(state.user,{identity_profile_status:'VERIFIED',student_card_status:'VERIFIED'});
  state.exams = [
    {id:'working',title:'Kiểm tra kiến thức học phần',status:'published',duration_minutes:45,start_time:'2026-10-22T07:00:00+07:00',end_time:'2026-10-22T10:00:00+07:00',require_camera:true,require_mic:true,classes:[{id:'class-1',name:'Kiểm thử phần mềm'}],attempt:{id:'active-attempt',status:'in_progress',started_at:'2026-10-22T07:50:00+07:00',server_deadline_at:'2026-10-22T08:35:00+07:00'}},
    {id:'future',title:'Đánh giá cuối học phần',status:'published',duration_minutes:60,start_time:'2026-10-24T08:00:00+07:00',end_time:'2026-10-26T10:30:00+07:00',require_camera:true,require_mic:false},
  ];
  state.attempts = [
    {id:'graded-attempt',exam_id:'finished',exam_title:'Bài kiểm tra đã chấm',classes:[{id:'class-1',name:'Kiểm thử phần mềm'}],status:'graded',final_score:8,max_score:10,attempt_number:1,started_at:'2026-10-20T08:00:00+07:00',submitted_at:'2026-10-20T08:45:00+07:00'},
    {id:'pending-attempt',exam_id:'awaiting',exam_title:'Bài kiểm tra đang chờ chấm',classes:[],status:'submitted',score:null,max_score:10,attempt_number:1,started_at:'2026-10-21T08:00:00+07:00',submitted_at:'2026-10-21T08:30:00+07:00'},
  ];
  await page.route('**/api/v1/live-classes?**',route => route.fulfill({headers:{'access-control-allow-origin':route.request().headers().origin??'http://localhost:3000','access-control-allow-credentials':'true','access-control-allow-headers':'authorization,content-type'},json:{data:[
    {id:'live-session',title:'Trao đổi nội dung học phần',class_id:'class-1',class_name:'Kiểm thử phần mềm',teacher_name:'Trần Thị Mai',status:'ongoing',scheduled_start:'2026-10-22T08:00:00+07:00',scheduled_end:'2026-10-22T09:30:00+07:00'},
    {id:'scheduled-session',title:'Ôn tập học phần',class_id:'class-1',class_name:'Kiểm thử phần mềm',teacher_name:'Trần Thị Mai',status:'scheduled',scheduled_start:'2026-10-23T14:00:00+07:00',scheduled_end:'2026-10-23T15:30:00+07:00'},
  ]}}));
  return state;
}

for (const width of [390,768,1024,1440]) for (const theme of ['light','dark'] as const) {
  test(`Student reference composition ${width} ${theme}`,async({context})=>{
    test.setTimeout(120_000);
    for (const [route,name] of routes) {
      // A fresh page also avoids retaining fixed-sidebar paint tiles after a
      // preceding full-page capture temporarily expands the capture viewport.
      const page=await context.newPage();
      await page.setViewportSize({width,height:1000});
      await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
      await studentData(page);
      await page.goto(route);
      await expect(page.locator('.student-app-shell')).toBeVisible();
      await expect(page.locator('main .loading-skeleton')).toHaveCount(0);
      await page.evaluate(()=>document.fonts.ready);
      await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await expect(page.locator('main h1')).toHaveCount(1);
      await expect(page.locator('.sidebar')).toHaveCSS('background-color','rgb(0, 109, 119)');
      await expect(page.locator('.workspace')).toHaveCSS('background-color',theme==='light'?'rgb(255, 248, 243)':'rgb(16, 30, 37)');
      const fonts = await page.locator('.student-app-shell').evaluate(el=>({body:getComputedStyle(el).fontFamily,display:getComputedStyle(el).getPropertyValue('--font-display')}));
      expect(fonts.body).toContain('Nunito');
      expect(fonts.display).toContain('Baloo 2');
      await expect(page.locator('main')).not.toContainText(/Đồng Thị Thùy Linh|5 học phần|2\/3 bài thi không có cảnh báo/);
      if (name==='dashboard') {
        const hero=page.getByRole('region',{name:'Kỳ thi ưu tiên'});
        await expect(hero.getByRole('heading',{name:'Kiểm tra kiến thức học phần'})).toBeVisible();
        await expect(hero.getByRole('link',{name:'Tiếp tục làm bài'})).toHaveAttribute('href','/student/attempts/active-attempt');
        await expect(hero).toContainText('45 phút');
        await expect(hero).toContainText('10:00');
        await expect(hero).toContainText('Đã xác thực');
        const quick=page.getByRole('navigation',{name:'Không gian học tập'});
        await expect(quick.getByRole('link')).toHaveCount(3);
        expect((await quick.boundingBox())!.y).toBeGreaterThan((await hero.boundingBox())!.y);
        await expect(page.locator('[data-eye-beam]')).toHaveCount(0);
        if(width===1440&&theme==='light') {
          const client=await context.newCDPSession(page);
          await client.send('DOM.enable');await client.send('CSS.enable');
          const {root}=await client.send('DOM.getDocument');
          const {nodeId}=await client.send('DOM.querySelector',{nodeId:root.nodeId,selector:'main h1'});
          const {fonts}=await client.send('CSS.getPlatformFontsForNode',{nodeId});
          expect(fonts.length).toBeGreaterThan(0);
          expect(fonts.every((font:{familyName:string})=>font.familyName.includes('Baloo 2'))).toBe(true);
          writeFileSync('artifacts/proctoowl-student/rendered-fonts.json',JSON.stringify(fonts,null,2));
        }
      }
      if(name==='classes') await expect(page.locator('.student-course-card')).toHaveCount(1);
      // Mobile tables expose their visible field label in the accessible name.
      if(name==='results') {await expect(page.getByRole('cell',{name:/^(Điểm )?8 \/ 10$/})).toBeVisible();await expect(page.getByRole('cell',{name:/^(Điểm )?Đang chờ chấm$/})).toBeVisible();}
      const launcher=page.getByRole('button',{name:'Mở tin nhắn hỗ trợ',exact:true});
      await expect.poll(()=>launcher.evaluate(button=>{
        const b=button.getBoundingClientRect();
        return Array.from(document.querySelectorAll('main [data-chat-avoid]')).filter(el=>{
          const r=el.getBoundingClientRect();
          return r.width>0&&r.height>0&&b.left<r.right&&b.right>r.left&&b.top<r.bottom&&b.bottom>r.top;
        }).length;
      })).toBe(0);
      // Flush the viewport paint before capturing the fixed sidebar over a full page.
      await page.screenshot({path:`artifacts/proctoowl-student/${name}-${width}-${theme}-viewport.png`});
      await page.screenshot({path:`artifacts/proctoowl-student/${name}-${width}-${theme}.png`,fullPage:true});
      if(name==='dashboard') await page.screenshot({path:`artifacts/proctoowl-student/dashboard-top-${width}-${theme}.png`});
      await page.close();
    }
  });
}

test('empty dashboard has no invented next exam or readiness checklist',async({page})=>{
  await uiSession(page); await page.goto('/student');
  await expect(page.getByRole('region',{name:'Kỳ thi ưu tiên'})).toHaveCount(0);
  await expect(page.getByText('Chưa có kỳ thi sắp tới trong khoảng lịch đang xem.',{exact:true})).toBeVisible();
  await expect(page.getByRole('complementary',{name:'Chuẩn bị trước giờ thi'})).toHaveCount(0);
});
