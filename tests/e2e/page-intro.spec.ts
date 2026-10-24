import {test,expect,type Page} from '@playwright/test';
import {uiSession} from './ui-fixtures';

const headers={'access-control-allow-origin':'http://localhost:3000','access-control-allow-credentials':'true','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS'};
const classId='22222222-2222-4222-8222-222222222222';
const bankId='33333333-3333-4333-8333-333333333333';
const attemptId='44444444-4444-4444-8444-444444444444';
const examId='55555555-5555-4555-8555-555555555555';
async function setup(page:Page,role:string){
  const session=await uiSession(page,role);
  await page.context().addCookies([{name:'auth_token',value:`fixture.${Buffer.from(JSON.stringify({role})).toString('base64url')}.signature`,url:'http://localhost:3000'}]);
  await page.route(`**/api/v1/classes/${classId}?**`,route=>route.fulfill({headers,json:{data:{...session.classes[0],id:classId,homeroom_teacher_id:session.user.id}}}));
  await page.route(url=>url.pathname===`/api/v1/question-banks/${bankId}`,route=>route.fulfill({headers,json:{data:{id:bankId,name:'Khai phá dữ liệu',description:'Câu hỏi cho học phần',questions_count:0,questions:[]}}}));
  await page.route(`**/api/v1/question-banks/${bankId}/document-capabilities`,route=>route.fulfill({headers,json:{data:{generation_available:false,max_file_bytes:10485760,max_questions:100,formats:['pdf','docx']}}}));
  await page.route(`**/api/v1/exams/${examId}`,route=>route.fulfill({headers,json:{data:{id:examId,title:'Kiểm tra khai phá dữ liệu',duration_minutes:30,start_time:'2026-10-12T01:00:00Z',end_time:'2026-10-19T01:00:00Z',require_camera:false,require_mic:false}}}));
  await page.route(`**/api/v1/attempts/${attemptId}/result`,route=>route.fulfill({headers,json:{data:{id:attemptId,exam_id:examId,exam_title:'Kiểm tra khai phá dữ liệu',status:'submitted',submitted_at:'2026-10-12T01:30:00Z',started_at:'2026-10-12T01:00:00Z',score:1,max_score:1,show_answers:true,questions:[{question_id:'question',order_index:1,type:'mcq_single',content:'Phân cụm thuộc nhóm kỹ thuật nào?',options_json:{options:['Không giám sát','Giám sát']},student_answer:'Không giám sát',correct_answer:'Không giám sát',is_correct:true,points_awarded:1,points:1,explanation:null}]}}}));
  return session;
}
async function compact(page:Page,title:string,width:number){
  const heading=page.locator('main .page-context h1');
  await expect(heading).toHaveText(title,{timeout:45_000});
  expect(await heading.evaluate(node=>getComputedStyle(node).fontSize)).toBe('16px');
  await expect(page.locator('main .page-intro, main .page-header')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}
for(const width of [375,1440]){
  test(`student detail and verification preserve context and content at ${width}px`,async({page},info)=>{
    test.setTimeout(120_000);await page.setViewportSize({width,height:900});await setup(page,'student');
    await page.goto(`/student/classes/${classId}`);await compact(page,'Kiểm thử phần mềm',width);
    await expect(page.getByRole('heading',{name:'Đề thi của lớp'})).toBeVisible();
    await expect(page.getByRole('link',{name:'Quay lại danh sách lớp'})).toBeVisible();
    await page.goto(`/student/attempts/${attemptId}/result`);await compact(page,'Kiểm tra khai phá dữ liệu',width);
    await expect(page.getByText('Điểm tổng',{exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{name:/^Câu 1\./})).toBeVisible();
    await page.screenshot({path:info.outputPath(`student-result-${width}.png`),fullPage:true});
    await page.goto(`/student/exams/${examId}/verify`);await compact(page,'Xác minh danh tính',width);
    await expect(page.getByRole('main')).toContainText('Kiểm tra khai phá dữ liệu');
    await expect(page.getByRole('main')).toContainText('Bước 1/');
  });
  test(`teacher detail keeps navigation, actions and document steps at ${width}px`,async({page},info)=>{
    test.setTimeout(120_000);await page.setViewportSize({width,height:900});await setup(page,'teacher');
    await page.goto(`/dashboard/classes/${classId}`);await compact(page,'Kiểm thử phần mềm',width);
    await expect(page.getByRole('heading',{name:'Danh sách học sinh'})).toBeVisible();
    await page.goto(`/dashboard/question-banks/${bankId}`);
    await expect(page.getByRole('navigation',{name:'Đường dẫn ngân hàng'})).toContainText('Khai phá dữ liệu');
    await expect(page.locator('main h1')).toHaveCount(0);
    const create=page.getByRole('button',{name:'+ Thêm câu hỏi',exact:true});
    await expect(create).toBeEnabled();await expect(create.locator('xpath=ancestor::*[contains(@class,"ui-card")]')).toHaveCount(1);
    await create.click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Tạo từ tài liệu',exact:true}).click();
    await expect(page.getByRole('navigation',{name:'Đường dẫn ngân hàng'})).toContainText('Khai phá dữ liệu');
    await expect(page.getByRole('heading',{name:'Bước 1 — Tài liệu',exact:true})).toBeVisible();
    await expect(page.locator('main h1')).toHaveCount(0);
    await expect(page.getByRole('list',{name:'Các bước tạo câu hỏi'})).toBeVisible();
    await expect(page.getByText('Chọn tài liệu',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({path:info.outputPath(`document-wizard-${width}.png`),fullPage:true});
  });
  test(`admin class detail keeps compact context and editable fields at ${width}px`,async({page})=>{
    test.setTimeout(90_000);await page.setViewportSize({width,height:900});await setup(page,'admin');
    await page.goto(`/admin/classes/${classId}`);await compact(page,'Kiểm thử phần mềm',width);
    await expect(page.getByRole('textbox',{name:'Tên lớp'})).toHaveValue('Kiểm thử phần mềm');
    await expect(page.getByRole('button',{name:'Quay lại',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Quay lại',exact:true}).click();
    await expect(page.getByRole('searchbox',{name:'Tìm lớp học...'})).toBeVisible();
    const action=page.getByRole('link',{name:'+ Tạo lớp học',exact:true});
    await expect(action.locator('xpath=ancestor::*[contains(@class,"ui-card")]')).toHaveCount(1);
    await action.click();await compact(page,'Tạo lớp học mới',width);
  });
}
