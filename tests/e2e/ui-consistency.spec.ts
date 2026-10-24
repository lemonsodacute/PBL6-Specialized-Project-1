import {test,expect,type Page} from '@playwright/test';
import {uiSession} from './ui-fixtures';
const cors={'access-control-allow-origin':process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000','access-control-allow-credentials':'true','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,PATCH,PUT,DELETE,OPTIONS'};
async function setup(page:Page,role:string){
  const state=await uiSession(page,role);state.user.full_name='Giảng viên kiểm tra giao diện';state.user.email='long-name-for-responsive-layout-verification@example.edu.vn';
  await page.context().addCookies([{name:'auth_token',value:`fixture.${Buffer.from(JSON.stringify({role})).toString('base64url')}.signature`,url:process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000'}]);
  await page.route('**/api/v1/teacher/reports*',route=>route.fulfill({headers:cors,json:{data:{exam_id:null,exams:[],completed_statuses:['submitted','auto_submitted','terminated'],results:[],meta:{total:0,page:1,limit:20},summary:{completed_attempts:0,scored_attempts:0,percentage_attempts:0,average_percentage:null,average_score:null,max_score:null,total_violations:0,browser_violation_count:0,detection_count:0,average_risk_score:null,risk_scored_attempts:0,attempt_count:0}}}}));
  await page.route('**/api/v1/users?**',route=>route.fulfill({headers:cors,json:{data:[{...state.user,id:'sample',role:'student',is_active:true,student_code:'UX123',identity_profile_status:'PENDING'}],meta:{total:1,page:1,limit:20}}}));
  await page.route('**/api/v1/attempts/mine?**',route=>route.fulfill({headers:cors,json:{data:[{id:'attempt',exam_id:'exam',exam_title:'Khai phá dữ liệu — một tên đề dài cần hiển thị rõ trên điện thoại',status:'submitted',score:'0.00',max_score:'10.00',classes:[],submitted_at:'2026-10-10T01:20:00Z'}],meta:{total:1,page:1,limit:20}}}));
  return state;
}
const routes={
  student:['/student','/student/classes','/student/exams','/student/grades','/student/live-classes','/student/profile','/student/settings','/student/help','/notifications'],
  teacher:['/dashboard','/dashboard/classes','/dashboard/exams','/dashboard/question-banks','/dashboard/reports','/dashboard/monitor','/dashboard/live-classes','/teacher/profile','/teacher/settings','/teacher/help','/notifications'],
  admin:['/dashboard','/dashboard/users','/admin/classes','/admin/student-cards','/dashboard/exams','/dashboard/reports','/dashboard/action-logs','/admin/settings','/admin/help','/notifications'],
};
for(const role of ['student','teacher','admin'] as const)for(const width of [375,768,1440])test(`${role} shared UI stays inside ${width}px across role routes`,async({page},info)=>{
  test.setTimeout(360_000);await page.setViewportSize({width,height:900});await setup(page,role);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  for(const route of routes[role]){
    await page.goto(route);await expect(page.locator('main')).toBeVisible({timeout:45_000});await expect(page.locator('main .ui-card').first()).toBeVisible({timeout:45_000});
    await expect(page.locator('main .page-header, main .page-intro')).toHaveCount(0);
    if(role==='student'&&route==='/student') await expect(page.getByRole('heading',{level:1,name:'Hôm nay bạn có gì?'})).toBeVisible();
    else await expect(page.locator('main h1')).toHaveCount(role==='student'&&route.startsWith('/student/')?1:0);
    await expect(page.locator('main .eyebrow').filter({hasText:/Khu vực/i})).toHaveCount(0);
    const content=page.locator('.workspace-page').first();
    expect(await content.evaluate(node=>getComputedStyle(node).paddingTop),route).toBe(role==='student'?(width<768?'20px':'24px'):(width<768?'16px':'28px'));
    await expect(page.getByRole('button',{name:/^Tài khoản của/})).toBeVisible();
    await expect(page.getByRole('button',{name:/^Thông báo/})).toBeVisible();
    await expect(page.locator('main .loading-skeleton')).toHaveCount(0,{timeout:45_000});
    const overflow=await page.evaluate(()=>Array.from(document.querySelectorAll('main *')).filter(node=>node.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(node=>({tag:node.tagName,className:node.className,width:node.getBoundingClientRect().width,minWidth:getComputedStyle(node).minWidth})));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth),`${route}: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(width);
    for(const toolbar of await page.getByRole('search').all())expect(await toolbar.evaluate(node=>node.scrollWidth<=node.clientWidth+1),route).toBe(true);
    if(route==='/dashboard/users'||route==='/student/grades'||route==='/teacher/profile')await page.screenshot({path:info.outputPath(`${role}-${width}-${route.replaceAll('/','_')}.png`),fullPage:true});
  }
  await page.getByRole('button',{name:/^Tài khoản của/}).click();const menu=page.getByRole('menu',{name:'Tài khoản'});await expect(menu).toBeVisible();const box=(await menu.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});
test('mobile results use readable cards without a horizontal action scroll',async({page})=>{
  await page.setViewportSize({width:375,height:812});await setup(page,'student');await page.goto('/student/grades');
  const region=page.getByRole('region',{name:'Điểm số / Kết quả'});await expect(region.getByRole('cell',{name:'0 / 10'})).toBeVisible({timeout:45_000});
  expect(await region.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);await expect(region.getByRole('link',{name:'Xem kết quả',exact:true})).toBeVisible();
});
test('user overflow menu and confirmation preserve API action timing and focus',async({page})=>{
  await setup(page,'admin');let calls=0;await page.route('**/api/v1/users/sample',route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});expect(route.request().method()).toBe('DELETE');calls++;return route.fulfill({headers:cors,json:{data:{}}});});await page.goto('/dashboard/users');
  const row=page.getByRole('row').filter({hasText:'UX123'});await expect(row).toBeVisible({timeout:45_000});expect(await row.getByRole('button').count()).toBe(2);
  const trigger=row.getByRole('button',{name:/^Thao tác tài khoản/});await trigger.click();await page.getByRole('menuitem',{name:'Khóa',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Khóa tài khoản?'});await expect(dialog).toBeVisible();expect(calls).toBe(0);await dialog.getByRole('button',{name:'Hủy',exact:true}).click();await expect(trigger).toBeFocused();expect(calls).toBe(0);
  await trigger.click();await page.getByRole('menuitem',{name:'Khóa',exact:true}).click();await dialog.getByRole('button',{name:'Khóa',exact:true}).click();await expect.poll(()=>calls).toBe(1);
});
test('mobile chat fits the viewport and dark menus remain above page content',async({page},info)=>{
  await page.setViewportSize({width:375,height:812});await setup(page,'admin');await page.goto('/dashboard/users');
  const row=page.getByRole('row').filter({hasText:'UX123'});await expect(row).toBeVisible({timeout:45_000});
  const chat=page.getByRole('button',{name:'Mở tin nhắn hỗ trợ'});await expect(chat).toBeVisible();const box=(await chat.boundingBox())!;expect(box.y).toBeGreaterThanOrEqual(72);expect(box.y+box.height).toBeLessThanOrEqual(796);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(375);
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await row.getByRole('button',{name:/^Thao tác tài khoản/}).click();await expect(page.getByRole('menuitem').first()).toBeFocused();
  await expect.poll(async()=>{
    if(!await chat.isVisible())return true;
    const launcher=await chat.boundingBox(),menu=await page.getByRole('menu').boundingBox();
    return !!launcher&&!!menu&&!(launcher.x<menu.x+menu.width&&launcher.x+launcher.width>menu.x&&launcher.y<menu.y+menu.height&&launcher.y+launcher.height>menu.y);
  }).toBeTruthy();
  await page.screenshot({path:info.outputPath('admin-375-dark-menu.png'),fullPage:true});await page.keyboard.press('Escape');await expect(chat).toBeVisible();
  await chat.click();await expect(page).toHaveURL(/\/admin\/messages$/);await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Nội dung hỏi trợ lý'})).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole('button',{name:'Mở menu',exact:true}).click();await expect(page.getByRole('dialog',{name:'Menu điều hướng'})).toBeVisible();await page.setViewportSize({width:1024,height:812});await expect(page.getByRole('dialog',{name:'Menu điều hướng'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Đóng menu',exact:true})).toBeHidden();expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
});
