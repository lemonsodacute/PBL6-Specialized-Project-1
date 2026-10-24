import {test,expect,type Page} from '@playwright/test';
import {uiSession} from './ui-fixtures';

const headers={'access-control-allow-origin':'http://localhost:3000','access-control-allow-credentials':'true',
  'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'};
async function session(page:Page,role:string){
  await uiSession(page,role);
  await page.context().addCookies([{name:'auth_token',value:`fixture.${Buffer.from(JSON.stringify({role})).toString('base64url')}.signature`,url:'http://localhost:3000'}]);
}

for(const width of [375,1440])test(`teacher navigation and old grading links retire oral at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:960});await session(page,'teacher');const oralRequests:string[]=[];
  page.on('request',request=>{if(request.url().includes('/api/v1/oral-grading'))oralRequests.push(request.url());});
  await page.goto('/teacher/settings');await expect(page.getByRole('heading',{name:'Cài đặt cá nhân',exact:true})).toBeVisible({timeout:45_000});
  if(width<1024)await page.getByRole('button',{name:'Mở menu',exact:true}).click();
  await expect(page.locator('#workspace-sidebar')).toBeVisible();
  await expect(page.locator('#workspace-sidebar').getByRole('link',{name:'Vấn đáp',exact:true})).toHaveCount(0);
  for(const path of ['/dashboard/oral-grading','/dashboard/oral-grading/old-answer']){
    await page.goto(path);await expect(page).toHaveURL(/\/dashboard\/exams$/,{timeout:45_000});
    await expect(page.getByRole('button',{name:'+ Tạo đề thi',exact:true})).toBeVisible();
  }
  expect(oralRequests).toEqual([]);
});

for(const role of ['teacher','admin'])test(`${role} question editor retains three formats and saves essay without oral settings`,async({page})=>{
  await session(page,role);const bodies:Record<string,unknown>[]=[];
  await page.route('**/api/v1/question-banks**',async route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({headers,status:204});
    const path=new URL(route.request().url()).pathname;
    if(route.request().method()==='POST'){bodies.push(route.request().postDataJSON());return route.fulfill({headers,json:{data:{id:'created'}}});}
    const bank={id:'bank-1',name:'Ngân hàng kiểm chứng',questions_count:0};
    return route.fulfill({headers,json:{data:path.endsWith('/questions')?[]:path.endsWith('/bank-1')?bank:[bank],meta:{total:path.endsWith('/questions')?0:1,page:1,limit:20}}});
  });
  await page.goto('/dashboard/question-banks/bank-1');await page.getByRole('button',{name:'+ Thêm câu hỏi',exact:true}).click();
  const dialog=page.getByRole('dialog');const types=dialog.getByRole('combobox',{name:'Loại câu',exact:true});
  await expect(types.locator('option')).toHaveCount(3);expect(await types.locator('option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value))).toEqual(['mcq_single','mcq_multi','essay']);
  await types.selectOption('essay');await dialog.getByLabel('Nội dung câu hỏi',{exact:true}).fill('Giải thích phương pháp phân cụm dữ liệu.');
  await dialog.getByLabel('Đáp án mẫu / Hướng dẫn trả lời',{exact:true}).fill('Đánh giá cách nhóm đối tượng theo mức độ tương đồng.');
  await expect(dialog.getByLabel('Thời gian chuẩn bị (giây)',{exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Lưu câu hỏi',exact:true}).click();await expect(dialog).toHaveCount(0);
  expect(bodies).toHaveLength(1);expect(bodies[0].type).toBe('essay');expect(bodies[0]).not.toHaveProperty('oral_prep_seconds');expect(bodies[0]).not.toHaveProperty('oral_answer_seconds');
  await page.getByRole('button',{name:'Chọn nhanh / Ngẫu nhiên',exact:true}).click();
  const randomTypes=page.locator('.random-question-picker').getByRole('combobox',{name:'Loại câu hỏi',exact:true});
  await expect(randomTypes.locator('option[value="oral"]')).toHaveCount(0);await expect(randomTypes.locator('option')).toHaveCount(4);
});

for(const legacy of [false,true])test(`old student oral link ${legacy?'blocks a legacy attempt':'returns to the regular exam'} without recording`,async({page})=>{
  await session(page,'student');
  await page.addInitScript(()=>{(window as any).__mediaCalls=0;if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{(window as any).__mediaCalls++;throw new Error('No recording expected');};});
  const question={id:'question-1',question_bank_id:'bank-1',type:legacy?'oral':'mcq_single',content:'Câu hỏi trong bài làm',default_points:1,options_json:{options:['A','B']}};
  await page.route('**/api/v1/attempts/attempt-1',route=>route.fulfill({headers,json:{data:{id:'attempt-1',exam_id:'exam-1',status:'in_progress',started_at:new Date().toISOString(),server_deadline_at:new Date(Date.now()+3_600_000).toISOString(),remaining_seconds:3600,questions:[question],answers:[]}}}));
  await page.route('**/api/v1/exams/exam-1',route=>route.fulfill({headers,json:{data:{id:'exam-1',title:'Bài kiểm tra thường',duration_minutes:60,require_camera:false,require_mic:false,require_fullscreen:false}}}));
  await page.goto('/student/attempts/attempt-1/oral/question-1');await expect(page).toHaveURL(/\/student\/attempts\/attempt-1$/,{timeout:45_000});
  if(legacy){await expect(page.getByText('Hình thức thi này đã ngừng hỗ trợ. Vui lòng dùng câu hỏi trắc nghiệm hoặc tự luận.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Nộp bài',exact:true})).toHaveCount(0);}
  else {await expect(page.getByRole('heading',{name:'Bài kiểm tra thường',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Nộp bài',exact:true})).toBeVisible();}
  await expect(page.getByText('Câu hỏi vấn đáp',{exact:true})).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__mediaCalls)).toBe(0);
});
