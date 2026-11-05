import { expect,test,type Page } from '@playwright/test';
import {uiSession} from './ui-fixtures';
const examId='22222222-2222-4222-8222-222222222222',attemptId='33333333-3333-4333-8333-333333333333',eventId='44444444-4444-4444-8444-444444444444';
const cors={'access-control-allow-origin':'http://localhost:3000','access-control-allow-credentials':'true','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,PATCH,OPTIONS'};
async function setup(page:Page){
  const state=await uiSession(page,'teacher');
  const exam={id:examId,title:'Kiểm tra giữa kỳ Cơ sở dữ liệu',status:'closed',start_time:'2026-10-12T01:00:00Z',end_time:'2026-10-13T10:00:00Z',duration_minutes:45,teacher_name:'Giảng viên kiểm thử',classes:[{id:'class-1',name:'Cơ sở dữ liệu - Nhóm 1'}]};
  state.exams=[exam];
  const student={id:'student-1',full_name:'Nguyễn Minh Anh',student_code:'102220001'};
  const event={id:eventId,exam_id:examId,attempt_id:attemptId,student_id:student.id,student,source:'BROWSER',provider:'browser',event_type:'tab_switched',severity:'low',confidence:null,max_confidence:null,occurred_at:'2026-10-12T01:15:00Z',received_at:'2026-10-12T01:15:00Z',first_seen:'2026-10-12T01:15:00Z',last_seen:'2026-10-12T01:15:05Z',duration_ms:5000,occurrence_count:2,message:'Chuyển thẻ trình duyệt',metadata:null,evidence:null,has_snapshot:false,status:'NEW',is_simulated:false,reviewed_at:null,reviewed_by:null,review_note:null as string|null,review_version:0,exam:{id:examId,title:exam.title},history:[] as object[]};
  const summary=()=>({total:1,new:event.status==='NEW'?1:0,reviewed:event.status==='REVIEWED'?1:0,confirmed:event.status==='CONFIRMED'?1:0,dismissed:event.status==='DISMISSED'?1:0,high_priority:0,total_students:2,taking:0,submitted:2});
  await page.route(`**/api/v1/exams/${examId}`,route=>route.fulfill({headers:cors,json:{data:exam}}));
  await page.route(`**/api/v1/proctoring/exams/${examId}/report**`,route=>route.fulfill({headers:cors,json:{data:{exam_id:examId,exam_title:exam.title,exam,is_simulated:false,summary:summary(),types:[{event_type:'tab_switched',count:1}],students_requiring_review:[],participating_students:2,students_with_alerts:1,total_attempts:2,pagination:{page:1,limit:30,total:2},attempts:[{id:attemptId,student,attempt_number:1,status:'submitted',highest_severity:'low',...summary()},{id:'55555555-5555-4555-8555-555555555555',student:{id:'student-2',full_name:'Trần Gia Huy',student_code:'102220002'},attempt_number:1,status:'submitted',total:0,highest_severity:null,new:0,reviewed:0,confirmed:0,dismissed:0}]}}}));
  await page.route(`**/api/v1/proctoring/attempts/${attemptId}/timeline**`,route=>route.fulfill({headers:cors,json:{data:{attempt_id:attemptId,exam_id:examId,student,status:'submitted',started_at:'2026-10-12T01:00:00Z',submitted_at:'2026-10-12T01:40:00Z',recording_url:null,total_events:1,truncated:false,summary:{...summary(),highest_severity:'low'},entries:[{id:'started',kind:'started',at:'2026-10-12T01:00:00Z',label:'Bắt đầu bài thi'},{id:eventId,kind:'event',at:event.occurred_at,event},{id:'submitted',kind:'submitted',at:'2026-10-12T01:40:00Z',label:'Nộp bài'}]}}}));
  await page.route(`**/api/v1/proctoring/events/${eventId}**`,async route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
    if(route.request().method()==='PATCH'){
      const update=route.request().postDataJSON();event.status=update.status;event.review_note=update.note;event.review_version++;
      event.history.push({id:`review-${event.review_version}`,at:'2026-10-26T03:00:00Z',status:event.status,actor:'Giảng viên kiểm thử',note:event.review_note});
    }
    return route.fulfill({headers:cors,json:{data:event}});
  });
  return event;
}
for(const width of [390,768,1440])for(const theme of ['light','dark'] as const)test(`exam-specific monitoring report ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:960});await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});await setup(page);
  await page.goto(`/dashboard/monitor/${examId}`);
  await expect(page.getByRole('heading',{name:'Báo cáo giám sát',exact:true})).toBeVisible();
  await expect(page.getByText('Trần Gia Huy',{exact:true})).toBeVisible();
  const active=page.locator('.sidebar a[aria-current="page"]');await expect(active).toHaveAttribute('href','/dashboard/monitor');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath(`monitor-report-${theme}-${width}.png`),fullPage:true});
  await page.getByRole('link',{name:'Xem chi tiết Nguyễn Minh Anh, lần 1'}).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/monitor/${examId}/${attemptId}$`));
  const timeline=page.getByRole('dialog',{name:'Dòng thời gian sinh viên'});await expect(timeline).toContainText('102220001');
  await timeline.getByRole('button',{name:'Chuyển thẻ trình duyệt',exact:true}).click();
  const detail=page.getByRole('dialog',{name:'Chi tiết cảnh báo'});await expect(detail).toContainText('Không có ảnh bằng chứng cho sự kiện này.');
  if(width===390){const bounds=await detail.boundingBox();expect(bounds?.width).toBe(390);expect(bounds?.height).toBe(960);}
  await expect(detail.locator('img')).toHaveCount(0);
  await detail.getByRole('button',{name:'Xác nhận',exact:true}).click();await expect(detail.getByRole('button',{name:'Xác nhận',exact:true})).toBeDisabled();
  await detail.getByRole('button',{name:'Bỏ qua',exact:true}).click();await expect(detail.getByRole('button',{name:'Bỏ qua',exact:true})).toBeDisabled();
  await detail.locator('.modal-body').evaluate(body=>{body.scrollTop=0;});
  await page.screenshot({path:info.outputPath(`monitor-evidence-${theme}-${width}.png`)});
  await page.reload();await expect(timeline).toContainText('Đã bỏ qua');
  await timeline.getByRole('link',{name:'Báo cáo giám sát',exact:false}).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/monitor/${examId}$`));
  await page.getByRole('link',{name:'Quay lại Giám sát'}).click();await expect(page).toHaveURL(/\/dashboard\/monitor$/);
});
