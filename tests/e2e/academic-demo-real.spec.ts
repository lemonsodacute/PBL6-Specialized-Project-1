import {test,expect,type BrowserContext} from '@playwright/test';
import fs from 'node:fs';
import {eventLabels} from '../../lib/proctoring';

type Actor={user:{id:string;role:string;full_name:string};token:string};
type Fixture={actors:Record<string,Actor>;requested_exam_id:string;attempt_id:string;event_id:string;teacher_exam_id?:string;teacher_attempt_id?:string};
const file='backend/private/academic-demo-validation.json';
const api='http://localhost:8000/api/v1';
test.skip(process.env.ACADEMIC_DEMO_E2E!=='1','Requires existing-account private validation fixture and the real PostgreSQL-backed app.');
const fixture=()=>JSON.parse(fs.readFileSync(file,'utf-8')) as Fixture;
async function signIn(context:BrowserContext,actor:Actor){
  await context.addInitScript(({user,token})=>{sessionStorage.setItem('ai-proctoring-current-user',JSON.stringify(user));sessionStorage.setItem('ai-proctoring-access-token',token);},{...actor});
}
const routes:Record<string,string[]>={student:['/student','/student/classes','/student/live-classes','/student/exams','/student/history','/student/grades','/student/schedule','/student/profile','/student/settings','/student/help'],teacher:['/dashboard','/dashboard/classes','/dashboard/question-banks','/dashboard/exams','/dashboard/live-classes','/dashboard/monitor','/dashboard/reports'],admin:['/admin','/admin/classes','/dashboard/users','/admin/student-cards','/dashboard/exams','/dashboard/reports','/admin/ai-support/knowledge','/admin/ai-support/activity','/dashboard/action-logs','/admin/settings']};
for(const role of ['student','teacher','admin'])test(`existing ${role} sees connected academic data`,async({browser},info)=>{
  test.setTimeout(150000);const context=await browser.newContext();const actor=fixture().actors[role];await signIn(context,actor);const page=await context.newPage();
  try{
    const data=fixture();const pages=[...routes[role]];
    if(role==='teacher'&&data.teacher_exam_id&&data.teacher_attempt_id)pages.push(`/dashboard/exams/${data.teacher_exam_id}/grade/${data.teacher_attempt_id}`,`/dashboard/reports/attempts/${data.teacher_attempt_id}`);
    for(const route of pages){
      await page.goto(route);await expect(page.locator('#main-content')).toBeVisible();
      await expect(page.locator('.loading-skeleton')).toHaveCount(0);
      await expect(page.locator('#main-content')).not.toContainText('Không kết nối được API');
      await expect(page.locator('#main-content')).not.toContainText('SQL internal');
      if(['/student','/dashboard','/admin'].includes(route))await page.screenshot({path:info.outputPath(`${role}-real-dashboard.png`),fullPage:true});
      if(route.endsWith('/classes'))await expect(page.getByText(/HK1 2026\/2027/).first()).toBeVisible();
      if(route.endsWith('/live-classes'))await expect(page.getByText(/Ôn tập|Chữa bài/).first()).toBeVisible();
      if(route.endsWith('/question-banks'))await expect(page.getByText(/HTML|Xác thực|Mật mã/).first()).toBeVisible();
    }
  }finally{await context.close();}
});

test('requested ended exam opens its real proctor report and persists a human dismissal',async({browser,request},info)=>{
  test.setTimeout(120000);const data=fixture();const actor=data.actors.proctor_teacher;const headers={Authorization:`Bearer ${actor.token}`};
  const context=await browser.newContext();await signIn(context,actor);const page=await context.newPage();
  try{
    await page.goto('/dashboard/monitor');
    const reportLink=page.locator(`a[href="/dashboard/monitor/${data.requested_exam_id}"]`);await expect(reportLink).toContainText('Xem báo cáo');await reportLink.click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/monitor/${data.requested_exam_id}$`));
    await expect(page.getByRole('heading',{name:'Báo cáo giám sát',exact:true})).toBeVisible();
    await expect(page.locator('.sidebar a[aria-current="page"]')).toHaveAttribute('href','/dashboard/monitor');
    await page.screenshot({path:info.outputPath('real-exam-report.png'),fullPage:true});
    await page.locator(`a[href="/dashboard/monitor/${data.requested_exam_id}/${data.attempt_id}"]`).click();
    const timeline=page.getByRole('dialog',{name:'Dòng thời gian sinh viên'});await expect(timeline).toBeVisible();
    const response=await request.get(`${api}/proctoring/events/${data.event_id}`,{headers});expect(response.status()).toBe(200);const event=(await response.json()).data;
    await timeline.getByRole('button',{name:eventLabels[event.event_type]||event.message,exact:true}).first().click();
    const detail=page.getByRole('dialog',{name:'Chi tiết cảnh báo'});await expect(detail).toContainText('Không có ảnh bằng chứng cho sự kiện này.');
    await detail.getByLabel(/Ghi chú giám thị/).fill('Kiểm thử luồng xem xét: tín hiệu trình duyệt lịch sử, không tự động kết luận vi phạm hoặc thay đổi điểm.');
    if(await detail.getByRole('button',{name:'Bỏ qua',exact:true}).isEnabled())await detail.getByRole('button',{name:'Bỏ qua',exact:true}).click();
    await expect(detail.getByRole('button',{name:'Bỏ qua',exact:true})).toBeDisabled();
    await page.reload();await timeline.getByRole('button',{name:eventLabels[event.event_type]||event.message,exact:true}).first().click();
    await expect(detail).toContainText('Kiểm thử luồng xem xét');
    await expect(detail.getByRole('button',{name:'Bỏ qua',exact:true})).toBeDisabled();
    await page.screenshot({path:info.outputPath('real-event-reviewed.png'),fullPage:true});
    await detail.getByRole('button',{name:'Đóng',exact:true}).click();
    await timeline.getByRole('link',{name:/Báo cáo giám sát/}).click();
    await page.getByRole('link',{name:'Quay lại Giám sát'}).click();await expect(page).toHaveURL(/\/dashboard\/monitor$/);
    expect((await request.get(`${api}/proctoring/exams/${data.requested_exam_id}/report`,{headers:{Authorization:`Bearer ${data.actors.student.token}`}})).status()).toBe(403);
    const saved=(await (await request.get(`${api}/proctoring/events/${event.id}`,{headers})).json()).data;expect(saved.status).toBe('DISMISSED');
  }finally{await context.close();}
});
