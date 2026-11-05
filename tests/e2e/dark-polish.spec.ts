import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';
import { adminDashboardAPI } from './admin-analytics-fixture';

const cors = { 'access-control-allow-origin':'http://localhost:3000','access-control-allow-credentials':'true','access-control-allow-headers':'authorization,content-type' };
async function dashboard(page:Page, role:string) {
  await page.clock.setFixedTime(new Date('2026-10-26T10:00:00+07:00'));
  const state=await uiSession(page,role);
  state.exams=[{id:'exam-dark',title:'Kiểm tra giữa kỳ Lập trình Web',status:'published',start_time:'2026-10-25T01:00:00Z',end_time:'2026-10-28T14:00:00Z',duration_minutes:60,require_camera:true,require_mic:true,classes:[{id:'class-1',name:'Lập trình Web - Nhóm 1'}]}];
  if(role==='admin')await adminDashboardAPI(page);
  await page.route('**/api/v1/teacher/reports**',route=>route.fulfill({headers:cors,json:{data:{exam_id:null,exams:[],completed_statuses:['submitted','auto_submitted','terminated'],meta:{page:1,limit:20,total:4},summary:{completed_attempts:4,scored_attempts:4,percentage_attempts:4,average_percentage:'75',average_score:null,max_score:null,total_violations:2,browser_violation_count:2,detection_count:0,average_risk_score:null,risk_scored_attempts:0,attempt_count:4},results:Array.from({length:4},(_,i)=>({attempt_id:`attempt-${i}`,exam_id:'exam-dark',exam_title:'Lập trình Web',student_id:`student-${i}`,student_code:`SV00${i}`,full_name:`Sinh viên kiểm thử ${i}`,attempt_number:1,status:'submitted',score:'7.5',max_score:'10',percentage:'75',started_at:`2026-10-${22+i}T01:00:00Z`,submitted_at:`2026-10-${22+i}T02:00:00Z`,violation_count:0,browser_violation_count:0,detection_count:0,risk_score:null}))}}}));
}
for(const role of ['student','teacher','admin']) for(const theme of ['light','dark'] as const) for(const width of [390,768,1440]) {
  test(`${role} dashboard hierarchy ${theme} at ${width}px`,async({page},info)=>{
    await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});await dashboard(page,role);
    await page.goto(role==='student'?'/student':role==='teacher'?'/dashboard':'/admin');
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    await expect(page.locator('.loading-skeleton')).toHaveCount(0);
    await expect(page.locator('#main-content')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if(theme==='dark'){
      const colors=await page.evaluate(()=>{const s=getComputedStyle(document.documentElement);return ['--dark-bg','--dark-surface-1','--dark-surface-2','--dark-surface-3'].map(key=>s.getPropertyValue(key).trim());});
      expect(new Set(colors).size).toBe(4);
      await expect(page.locator('.sidebar')).toHaveCSS('background-color','rgb(11, 24, 31)');
      if(role==='student'){
        if(width===1440)await expect(page.locator('.student-nav-group')).toHaveCSS('color','rgb(181, 203, 208)');
        const hero=page.getByRole('region',{name:'Kỳ thi ưu tiên'});
        await expect(hero).toBeVisible();
        await expect(hero.getByRole('complementary',{name:'Chuẩn bị trước giờ thi'})).toHaveCSS('background-color','rgb(33, 61, 68)');
        await hero.getByRole('link',{name:'Chuẩn bị',exact:true}).focus();
        await expect(hero.getByRole('link',{name:'Chuẩn bị',exact:true})).toHaveCSS('outline-width','2px');
        await expect(hero.getByRole('link',{name:'Chuẩn bị',exact:true})).toHaveCSS('color','rgb(255, 255, 255)');
      }
    }
    await page.screenshot({path:info.outputPath(`${role}-${theme}-${width}.png`),fullPage:true});
  });
}
for(const theme of ['light','dark'] as const) for(const width of [390,768,1440])test(`login form ${theme} at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:960});await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
  await page.route('**/api/v1/**',route=>route.fulfill({status:401,headers:cors,json:{error:{message:'Unauthenticated'}}}));
  await page.goto('/login');await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await page.locator('input[type="email"]').focus();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath(`login-${theme}-${width}.png`),fullPage:true});
});
for(const theme of ['light','dark'] as const) for(const width of [390,768,1440])test(`register form ${theme} at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:960});await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
  await page.route('**/api/v1/**',route=>route.fulfill({status:401,headers:cors,json:{error:{message:'Unauthenticated'}}}));
  await page.goto('/login?mode=register');await expect(page.getByRole('heading',{name:'Đăng ký',exact:true})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath(`register-${theme}-${width}.png`),fullPage:true});
});
