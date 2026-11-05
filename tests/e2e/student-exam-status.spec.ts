import {test,expect,type Page} from '@playwright/test';
import {uiSession,fixtureUser} from './ui-fixtures';
import {getStudentExamState,getStudentFinalScore,groupStudentActionableExams,studentExamActionTarget,type ExamLike,type AttemptLike} from '../../lib/studentExamStatus';

const now=Date.parse('2026-10-12T12:00:00Z');
const base:ExamLike={id:'A',status:'published',start_time:'2026-10-12T00:00:00Z',end_time:'2026-10-13T00:00:00Z',allow_review:false,max_attempts:1};
test('first start never depends on review permission and absence never means submitted',()=>{
  for(const allow_review of [false,true]){const state=getStudentExamState({...base,allow_review,attempt:null,attempts:[]},'student',now);expect(state.status).toBe('open');expect(state.action).toBe('start');expect(state.actionLabel).toBe('Bắt đầu làm bài');}
});
test('status rather than score or timestamp determines in-progress and terminal states',()=>{
  const scores=[null,0,9];for(const score of scores){const state=getStudentExamState({...base,attempt:{id:'working',status:'in_progress',score,submitted_at:'2026-10-12T01:00:00Z'}},'student',now);expect(state.action).toBe('resume');expect(state.status).toBe('in_progress');}
  for(const status of ['submitted','auto_submitted','completed','graded','finalized','terminated']){const state=getStudentExamState({...base,attempt:{id:'done',status,score:null,submitted_at:null}},'student',now);expect(state.action).toBe('result');expect(state.status).toBe(status);expect(state.group).toBe('completed');expect(state.actionLabel).toBe('Xem bài đã nộp');}
});
test('foreign exam/student and clone histories are excluded without mutating the source',()=>{
  const attempts:AttemptLike[]=[{id:'foreign-exam',exam_id:'B',student_id:'student',status:'submitted'},{id:'foreign-student',exam_id:'A',student_id:'other',status:'submitted'}];
  const state=getStudentExamState({...base,attempts,attempt:attempts[0]},'student',now);expect(state.attempt).toBeNull();expect(state.action).toBe('start');expect(attempts).toHaveLength(2);
});
test('latest attempt number wins over older submission and array order',()=>{
  const attempts:AttemptLike[]=[{id:'old',exam_id:'A',status:'submitted',attempt_number:1},{id:'new',exam_id:'A',status:'in_progress',attempt_number:2}];
  const state=getStudentExamState({...base,attempts},'student',now);expect(state.attempt?.id).toBe('new');expect(state.action).toBe('resume');expect(attempts[0].id).toBe('old');
});
test('closed/upcoming/draft with no attempt never render a submitted fallback',()=>{
  const closed=getStudentExamState({...base,status:'closed'},'student',now);expect(closed.action).toBe('none');expect(closed.actionLabel).toBe('Bỏ lỡ');
  expect(getStudentExamState(base,'student',Date.parse('2026-10-11T00:00:00Z')).actionLabel).toBe('Chưa đến giờ bắt đầu');
  expect(getStudentExamState({...base,status:'draft'},'student',now).action).toBe('none');
});
test('not_started and unknown states are not treated as submitted',()=>{
  expect(getStudentExamState({...base,max_attempts:2,attempt:{id:'reserved',status:'not_started',score:8}},'student',now).action).toBe('start');
  const unknown=getStudentExamState({...base,attempt:{id:'unknown',status:'unexpected',score:10}},'student',now);expect(unknown.action).toBe('none');expect(unknown.status).toBe('unavailable');
});
test('completed attempts retain results while eligible retry is a separate action',()=>{
  const attempt={id:'done',status:'submitted',attempt_number:1};const state=getStudentExamState({...base,max_attempts:2,allow_review:true,attempt},'student',now);
  expect(state.action).toBe('result');expect(state.canRetry).toBe(true);expect(studentExamActionTarget(base,state)).toBe('/student/attempts/done/result');
  const hiddenAnswers=getStudentExamState({...base,max_attempts:2,allow_review:false,attempt},'student',now);
  expect(hiddenAnswers.canRetry).toBe(true);
  expect(hiddenAnswers.group).toBe('open');
  expect(hiddenAnswers.action).toBe('result');
  expect(getStudentExamState({...base,max_attempts:1,attempt},'student',now).canRetry).toBe(false);
  expect(getStudentExamState({...base,max_attempts:2,attempt,status:'closed'},'student',now).canRetry).toBe(false);
  expect(getStudentExamState({...base,max_attempts:2,attempt},'student',Date.parse('2026-10-14T00:00:00Z')).canRetry).toBe(false);
});

test('exam groups retain completed exams even after attempts are exhausted',()=>{
  const exams:ExamLike[]=[
    {...base,id:'open-later'},
    {...base,id:'working-later',attempt:{id:'w1',status:'in_progress',server_deadline_at:'2026-10-12T14:00:00Z'}},
    {...base,id:'upcoming-later',start_time:'2026-10-12T16:00:00Z'},
    {...base,id:'open-sooner',end_time:'2026-10-12T13:00:00Z'},
    {...base,id:'working-sooner',attempt:{id:'w2',status:'in_progress',server_deadline_at:'2026-10-12T13:00:00Z'}},
    {...base,id:'upcoming-sooner',start_time:'2026-10-12T15:00:00Z'},
    ...['SUBMITTED','AUTO_SUBMITTED','COMPLETED','GRADED','FINALIZED','TERMINATED'].map(status=>({...base,id:status,attempt:{id:status,status}})),
    {...base,id:'retry',max_attempts:3,allow_review:false,attempt:{id:'attempt-retry',exam_id:'retry',status:'submitted',attempt_number:1}},
    {...base,id:'ended',end_time:'2026-10-11T00:00:00Z'},
    {...base,id:'draft',status:'draft'},
  ];
  const groups=groupStudentActionableExams(exams,'student',now);
  expect(groups.current.map(row=>row.exam.id)).toEqual(['working-sooner','working-later']);
  expect(groups.open.map(row=>row.exam.id)).toEqual(['open-sooner','open-later','retry']);
  expect(groups.upcoming.map(row=>row.exam.id)).toEqual(['upcoming-sooner','upcoming-later']);
  expect(groups.completed.map(row=>row.exam.id).sort()).toEqual(['AUTO_SUBMITTED','COMPLETED','FINALIZED','GRADED','SUBMITTED','TERMINATED'].sort());
  expect(exams[0].id).toBe('open-later');
});

test('final score preserves zero and hides partial or missing scores',()=>{
  expect(getStudentFinalScore({id:'zero',status:'submitted',score:0})).toBe(0);
  expect(getStudentFinalScore({id:'partial',status:'submitted',score:3,final_score:null,grading_pending:true})).toBeNull();
  expect(getStudentFinalScore({id:'missing',status:'submitted'})).toBeNull();
  expect(getStudentFinalScore({id:'working',status:'in_progress',score:10})).toBeNull();
});

const headers={'access-control-allow-origin':process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000','access-control-allow-credentials':'true','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS'};
async function setup(page:Page){
  await uiSession(page,'student');
  const clock=Date.now(),common={status:'published',start_time:new Date(clock-3_600_000).toISOString(),end_time:new Date(clock+86_400_000).toISOString(),duration_minutes:30,questions_count:20,allow_review:false,max_attempts:1,require_camera:false,classes:[]};
  const attempts=(exam_id:string,status:string,id:string)=>({id,exam_id,student_id:fixtureUser.id,status,attempt_number:1,started_at:new Date(clock).toISOString(),submitted_at:status==='submitted'?new Date(clock).toISOString():null,server_deadline_at:new Date(clock+3_600_000).toISOString(),score:status==='in_progress'?8:0,max_score:20});
  const rows=[{...common,id:'A',title:'Đề A chưa làm',attempt:null,attempts:[] as AttemptLike[]},{...common,id:'B',title:'Đề B đang làm',attempt:attempts('B','in_progress','attempt-B'),attempts:[attempts('B','in_progress','attempt-B')]},{...common,id:'C',title:'Đề C đã nộp',attempt:attempts('C','submitted','attempt-C'),attempts:[attempts('C','submitted','attempt-C')]}];
  rows.push({...common,id:'D',title:'Đề D sắp diễn ra',start_time:new Date(clock+3_600_000).toISOString(),attempt:null,attempts:[]});
  const state={rows,requests:0,gate:null as Promise<void>|null};
  await page.route('**/api/v1/exams?**',async route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});state.requests++;
    const data=structuredClone(state.rows);if(state.gate)await state.gate;
    return route.fulfill({headers,json:{data,meta:{total:data.length,page:1,limit:20}}});
  });
  await page.route('**/api/v1/attempts/mine?**',route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    const completed=new URL(route.request().url()).searchParams.get('completed_only')==='true';
    const data=state.rows.flatMap(exam=>exam.attempt?[{...exam.attempt,exam_title:exam.title,classes:exam.classes}]:[]).filter(attempt=>!completed||attempt.status!=='in_progress');
    return route.fulfill({headers,json:{data,meta:{total:data.length,page:1,limit:20}}});
  });
  await page.route('**/api/v1/classes/class-1?**',route=>route.fulfill({headers,json:{data:{id:'class-1',name:'Lớp kiểm chứng',students_count:1,teacher:{full_name:'Giảng viên'}}}}));
  await page.route('**/api/v1/exams/B',route=>route.fulfill({headers,json:{data:{...rows[1],require_fullscreen:false}}}));
  await page.route('**/api/v1/attempts/attempt-B',route=>route.fulfill({headers,json:{data:{...rows[1].attempt,id:'attempt-B',exam_id:'B',remaining_seconds:3600,questions:[{id:'question-B',type:'mcq_single',content:'Câu B',options_json:{options:['A','B']},default_points:1}],answers:[]}}}));
  await page.route('**/api/v1/attempts/attempt-B/submit',route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    state.rows[1].attempt!.status='submitted';state.rows[1].attempts[0].status='submitted';
    return route.fulfill({headers,json:{data:{...state.rows[1].attempt,score:0}}});
  });
  await page.route('**/api/v1/attempts/attempt-B/result',route=>route.fulfill({headers,json:{data:{...state.rows[1].attempt,exam_title:rows[1].title,show_answers:false,questions:[]}}}));
  await page.route('**/api/v1/attempts/attempt-C/result',route=>route.fulfill({headers,json:{data:{...rows[2].attempt,id:'attempt-C',exam_id:'C',exam_title:'Đề C đã nộp',show_answers:false,questions:[{question_id:'question-C',type:'mcq_single',content:'Câu C',student_answer:'A',correct_answer:null,points:1,points_awarded:0,is_correct:false,explanation:null}]}}}));
  return state;
}
const card=(page:Page,title:string)=>page.locator('.student-exam-card').filter({has:page.getByRole('heading',{name:title,exact:true})});
async function acceptance(page:Page,classView=false){
  await expect(card(page,'Đề A chưa làm').getByRole('link',{name:'Bắt đầu làm bài',exact:true})).toBeEnabled({timeout:45_000});
  await expect(card(page,'Đề A chưa làm').getByText('Đã nộp',{exact:true})).toHaveCount(0);
  await expect(card(page,'Đề B đang làm').getByRole('link',{name:'Tiếp tục làm bài',exact:true})).toBeEnabled();
  await expect(card(page,'Đề C đã nộp').getByRole('link',{name:'Xem kết quả',exact:true})).toBeVisible();
  if(!classView){
    await expect(card(page,'Đề C đã nộp')).toContainText('Đã dùng 1/1 lượt');
    await expect(card(page,'Đề C đã nộp')).toContainText('Bạn đã sử dụng hết số lần làm bài');
    await expect(card(page,'Đề C đã nộp').getByRole('button',{name:'Làm lại bài thi'})).toHaveCount(0);
    await expect(page.locator('.student-exam-section h2')).toHaveText(['Đang làm','Đang diễn ra','Sắp diễn ra','Đã làm']);
    await expect(card(page,'Đề D sắp diễn ra').getByRole('button')).toBeDisabled();
  }
}
for(const route of ['/student/exams','/student/classes/class-1'])test(`${route} renders A/B/C per-exam and refresh updates only submitted B`,async({page})=>{
  const classView=route.includes('/classes/');
  const state=await setup(page);await page.goto(route);await acceptance(page,classView);
  state.rows[1].attempt!.status='submitted';state.rows[1].attempts[0].status='submitted';
  await page.evaluate(studentId=>window.dispatchEvent(new CustomEvent('student-exam-updated',{detail:{studentId,examId:'B',attemptId:'attempt-B'}})),fixtureUser.id);
  if(classView)await expect(card(page,'Đề B đang làm').getByRole('link',{name:'Xem kết quả',exact:true})).toBeVisible();
  else await expect(card(page,'Đề B đang làm').getByRole('link',{name:'Xem kết quả'})).toBeVisible();
  await expect(card(page,'Đề A chưa làm').getByRole('link',{name:'Bắt đầu làm bài',exact:true})).toBeEnabled();
  if(classView)await expect(card(page,'Đề C đã nộp').getByRole('link',{name:'Xem kết quả',exact:true})).toBeEnabled();
  await page.reload();
  if(classView)await expect(card(page,'Đề B đang làm').getByRole('link',{name:'Xem kết quả',exact:true})).toBeVisible();
  else{await expect(card(page,'Đề A chưa làm')).toBeVisible();await expect(card(page,'Đề B đang làm').getByRole('link',{name:'Xem kết quả'})).toBeVisible();}
});
test('each action navigates using its exact exam or attempt ID',async({page})=>{
  await setup(page);
  for(const [title,label,path] of [['Đề A chưa làm','Bắt đầu làm bài','/student/exams/A/verify'],['Đề B đang làm','Tiếp tục làm bài','/student/attempts/attempt-B'],['Đề C đã nộp','Xem kết quả','/student/attempts/attempt-C/result']]){
    await page.goto('/student/exams');await acceptance(page);await card(page,title).getByRole('link',{name:label,exact:true}).click();await expect(page).toHaveURL(new RegExp(path+'$'),{timeout:45_000});
  }
});
test('foreign payload and single-attempt fallback do not leak submitted state across exams',async({page})=>{
  const state=await setup(page);state.rows[0].attempts=[{id:'wrong',status:'submitted',exam_id:'C',student_id:fixtureUser.id},{id:'other-user',status:'submitted',exam_id:'A',student_id:'another-student'}];
  state.rows[1].attempts=[];await page.goto('/student/exams');await acceptance(page);
});
test('focus refresh and delayed older responses cannot undo a submitted state',async({page})=>{
  const state=await setup(page);await page.goto('/student/exams');await acceptance(page);
  let release!:()=>void;state.gate=new Promise<void>(resolve=>release=resolve);const before=state.requests;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>state.requests).toBeGreaterThan(before);
  state.gate=null;state.rows[1].attempt!.status='submitted';state.rows[1].attempts[0].status='submitted';
  await page.evaluate(studentId=>window.dispatchEvent(new CustomEvent('student-exam-updated',{detail:{studentId,examId:'B'}})),fixtureUser.id);
  await expect(card(page,'Đề B đang làm').getByRole('link',{name:'Xem kết quả'})).toBeVisible();release();
  await expect(card(page,'Đề B đang làm').getByRole('link',{name:'Tiếp tục làm bài',exact:true})).toHaveCount(0);await expect(card(page,'Đề A chưa làm').getByRole('link',{name:'Bắt đầu làm bài',exact:true})).toBeEnabled();
});

test('stale pagination and sort parameters cannot hide actionable sections',async({page})=>{
  await setup(page);
  const calls:URLSearchParams[]=[];
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/v1/exams')calls.push(new URL(request.url()).searchParams);});
  await page.goto('/student/exams?page=9&limit=100&sort=oldest');await acceptance(page);
  expect(calls.at(-1)?.get('actionable_only')).toBe('true');
  expect(calls.at(-1)?.get('include_completed')).toBe('true');
  expect(calls.at(-1)?.has('page')).toBe(false);
  await expect(page.getByRole('navigation',{name:'Phân trang',exact:true})).toHaveCount(0);
});

test('submitted exams appear only in results while history describes individual attempts',async({page})=>{
  await setup(page);await page.goto('/student/grades');
  const row=page.getByRole('row').filter({hasText:'Đề C đã nộp'});
  await expect(row).toContainText('0 / 20');
  await expect(row.getByRole('link',{name:'Xem kết quả',exact:true})).toHaveAttribute('href','/student/attempts/attempt-C/result');
  await expect(page.getByRole('row').filter({hasText:'Đề B đang làm'})).toHaveCount(0);
  await page.goto('/student/history');
  await expect(page.getByRole('columnheader')).toHaveText(['Đề thi','Lần làm','Bắt đầu lúc','Nộp lúc','Thời lượng','Trạng thái','Thao tác']);
  await expect(page.getByRole('row').filter({hasText:'Đề B đang làm'}).getByRole('link',{name:'Tiếp tục làm bài'})).toBeVisible();
  await expect(page.getByRole('columnheader',{name:'Điểm',exact:true})).toHaveCount(0);
});

test('pending grading never presents a partial score as final',async({page})=>{
  await setup(page);
  await page.route('**/api/v1/attempts/mine?**',route=>route.fulfill({headers,json:{data:[{id:'pending',exam_id:'C',exam_title:'Đề chờ chấm',status:'submitted',score:3,max_score:10,final_score:null,grading_pending:true,classes:[]}],meta:{total:1,page:1,limit:20}}}));
  await page.goto('/student/grades');
  const row=page.getByRole('row').filter({hasText:'Đề chờ chấm'});
  await expect(row).toContainText('Đang chờ chấm');
  await expect(row).not.toContainText('3 / 10');
  await expect(row.getByRole('link',{name:'Xem bài đã nộp',exact:true})).toBeVisible();
});

test('successful submission stops the attempt and updates exams/results without F5',async({page})=>{
  await setup(page);await page.goto('/student/exams');await acceptance(page);
  await card(page,'Đề B đang làm').getByRole('link',{name:'Tiếp tục làm bài'}).click();
  await page.getByRole('button',{name:'Nộp bài',exact:true}).click();
  await page.getByRole('button',{name:'Xác nhận nộp bài',exact:true}).click();
  await expect(page).toHaveURL(/\/student\/attempts\/attempt-B\/result$/);
  await page.getByRole('button',{name:'Về Điểm số / Kết quả',exact:true}).click();
  await expect(page.getByRole('row').filter({hasText:'Đề B đang làm'})).toBeVisible();
  await page.getByRole('link',{name:'Làm kiểm tra',exact:true}).click();
  await expect(card(page,'Đề A chưa làm')).toBeVisible();
  await expect(card(page,'Đề B đang làm').getByRole('link',{name:'Xem kết quả'})).toBeVisible();
  await expect(card(page,'Đề C đã nộp').getByRole('link',{name:'Xem kết quả'})).toBeVisible();
  await expect(page.locator('.student-exam-section h2')).toHaveText(['Đang diễn ra','Sắp diễn ra','Đã làm']);
  expect(await page.evaluate(()=>performance.getEntriesByType('navigation').map(item=>(item as PerformanceNavigationTiming).type))).toEqual(['navigate']);
});

test('submitted multi-attempt exam remains actionable on student exam cards and links to a new verification flow',async({page})=>{
  const fixture=await setup(page);
  const original=fixture.rows[2];
  const attempt={...original.attempt!,id:'retry-attempt-1',exam_id:'RETRY',attempt_number:1};
  fixture.rows.push({...original,id:'RETRY',title:'Bài được làm nhiều lần',allow_review:false,max_attempts:3,attempt,attempts:[attempt]});
  await page.goto('/student/exams');
  const retry=card(page,'Bài được làm nhiều lần');
  await expect(retry).toBeVisible();
  await expect(retry).toContainText('Đã dùng 1/3 lượt');
  await expect(retry.getByRole('button',{name:'Làm lại bài thi',exact:true})).toBeEnabled();
  await expect(retry.getByRole('link',{name:'Xem kết quả',exact:true})).toBeEnabled();
  await retry.getByRole('button',{name:'Làm lại bài thi',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Bạn có muốn làm lại bài thi?'});
  await expect(dialog).toContainText('2 lượt làm bài');
  await dialog.getByRole('button',{name:'Tiếp tục làm lại'}).click();
  await expect(page).toHaveURL(/\/student\/exams\/RETRY\/verify$/);
  await page.goto('/student/classes/class-1');
  await expect(card(page,'Bài được làm nhiều lần').getByRole('button',{name:'Làm lại bài thi',exact:true})).toBeEnabled();
});
