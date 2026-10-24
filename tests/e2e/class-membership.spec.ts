import {test,expect,type Page} from '@playwright/test';
import {uiSession} from './ui-fixtures';

const headers={'access-control-allow-origin':'http://localhost:3000','access-control-allow-credentials':'true',
  'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,DELETE,OPTIONS'};
const fold=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').replace(/đ/gi,'d').toLowerCase().trim();
async function setup(page:Page,role='teacher',empty=false){
  await uiSession(page,role);
  await page.context().addCookies([{name:'auth_token',value:`fixture.${Buffer.from(JSON.stringify({role})).toString('base64url')}.signature`,url:'http://localhost:3000'}]);
  const users=Array.from({length:25},(_,i)=>({id:`student-${i+1}`,full_name:`Nguyễn Minh Ngọc ${String(i+1).padStart(2,'0')}`,email:`student${i+1}@example.test`,student_code:`SV${String(i+1).padStart(3,'0')}`}));
  const state={members:new Set(users.slice(0,empty?25:23).map(user=>user.id)),posts:[] as string[],availableQueries:[] as URLSearchParams[],
    availableFail:false,postStatus:200,postGate:null as Promise<void>|null,
    slowQuery:null as string|null,slowGate:null as Promise<void>|null};
  await page.route('**/api/v1/classes/class-1**',async route=>{
    const request=route.request(),url=new URL(request.url()),params=url.searchParams,path=url.pathname.replace('/api/v1','');
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(path==='/classes/class-1')return route.fulfill({headers,json:{data:{id:'class-1',name:'Lớp kiểm chứng thành viên',description:'Dữ liệu kiểm thử',homeroom_teacher_id:'teacher',teacher:{id:'teacher',full_name:'Giảng viên',email:'teacher@example.test'},students_count:state.members.size}}});
    if(path.endsWith('/available')){
      state.availableQueries.push(params);
      if(state.availableFail)return route.fulfill({status:500,headers,json:{error:{code:'INTERNAL',message:'PRIVATE_SQL_ERROR'}}});
      const q=fold(params.get('q')||''),rows=users.filter(user=>!state.members.has(user.id)&&(!q||fold(`${user.full_name} ${user.student_code} ${user.email}`).includes(q)));
      const data=rows.slice(0,Number(params.get('limit')||20));
      if(state.slowQuery===params.get('q')&&state.slowGate)await state.slowGate;
      return route.fulfill({headers,json:{data,meta:{total:rows.length,page:1,limit:Number(params.get('limit')||20)}}});
    }
    if(path==='/classes/class-1/enrollments'&&request.method()==='POST'){
      const id=request.postDataJSON().student_id;state.posts.push(id);
      if(state.postGate)await state.postGate;
      if(state.postStatus===409){state.members.add(id);return route.fulfill({status:409,headers,json:{error:{code:'STUDENT_ALREADY_ENROLLED',message:'PRIVATE_SQL_ERROR'}}});}
      if(state.postStatus!==200)return route.fulfill({status:state.postStatus,headers,json:{error:{code:'INTERNAL',message:'PRIVATE_SQL_ERROR'}}});
      state.members.add(id);return route.fulfill({headers,json:{data:{id:`enrollment-${id}`,student_id:id,class_id:'class-1'}}});
    }
    if(request.method()==='DELETE'){state.members.delete(path.split('/').at(-1)!);return route.fulfill({headers,json:{data:{deleted:true}}});}
    const q=fold(params.get('q')||''),rows=users.filter(user=>state.members.has(user.id)&&(!q||fold(`${user.full_name} ${user.student_code} ${user.email}`).includes(q)));
    const n=Number(params.get('page')||1),limit=Number(params.get('limit')||20);
    return route.fulfill({headers,json:{data:rows.slice((n-1)*limit,n*limit).map(user=>({id:`enrollment-${user.id}`,student_id:user.id,student:user,enrolled_at:'2026-10-12T00:00:00Z'})),meta:{total:rows.length,page:n,limit}}});
  });
  return state;
}
async function open(page:Page,role='teacher',query=''){
  await page.goto(`${role==='admin'?'/admin':'/dashboard'}/classes/class-1${query}`);
  if(role==='admin')await page.getByRole('button',{name:/^Sinh viên \(/}).click();
  await expect(page.getByRole('combobox',{name:'Sinh viên để thêm'})).toBeVisible({timeout:45_000});
}
const candidates=(page:Page)=>page.getByRole('combobox',{name:'Sinh viên để thêm'});
const addButton=(page:Page,role='teacher')=>page.getByRole('button',{name:role==='admin'?'Thêm':'Thêm thành viên',exact:true});

for(const role of ['teacher','admin'])test(`${role}: add/remove refresh candidates beyond the first roster page without reload`,async({page})=>{
  await setup(page,role);await open(page,role,'?page=2');
  const select=candidates(page);await expect(select).toBeEnabled();
  await expect(select.locator('option')).toHaveCount(3);await expect(select.locator('option').first()).toHaveText('Chọn sinh viên');
  await expect(select.locator('option[value="student-21"]')).toHaveCount(0);
  await select.selectOption('student-24');await addButton(page,role).click();
  await expect(page.getByText('Đã thêm sinh viên vào lớp.',{exact:true})).toBeVisible();
  await expect(page.getByRole('row').filter({hasText:'SV024'})).toBeVisible();
  await expect(select).toHaveValue('');await expect(select).toBeEnabled();
  await expect(select.locator('option[value="student-24"]')).toHaveCount(0);
  await expect(select.locator('option[value="student-25"]')).toHaveCount(1);
  await page.getByRole('row').filter({hasText:'SV021'}).getByRole('button',{name:'Xoá khỏi lớp'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Xác nhận',exact:true}).click();
  await expect(page.getByRole('row').filter({hasText:'SV021'})).toHaveCount(0);
  await expect(select.locator('option[value="student-21"]')).toHaveCount(1);
  await expect(select.locator('option[value="student-24"]')).toHaveCount(0);
  await expect(page).toHaveURL(/page=2/);
});

test('candidate search uses only available students by name, student code and email',async({page})=>{
  const state=await setup(page);await open(page);const select=candidates(page);await expect(select).toBeEnabled();
  await page.getByRole('button',{name:'Tìm sinh viên để thêm',exact:true}).click();const search=page.getByRole('searchbox',{name:'Tìm sinh viên để thêm',exact:true});
  for(const query of ['minh ngoc 24','SV024','student24@example.test']){
    await search.fill(query);await expect(select.locator('option[value="student-24"]')).toHaveCount(1);
    await expect.poll(()=>state.availableQueries.at(-1)?.get('q')).toBe(query);
    await expect(select.locator('option[value="student-1"]')).toHaveCount(0);
  }
  await search.fill('SV001');await expect(page.getByText('Không tìm thấy sinh viên phù hợp.',{exact:true}).last()).toBeVisible();
  await expect(select.locator('option[value="student-1"]')).toHaveCount(0);await expect(addButton(page)).toBeDisabled();
});

for(const role of ['teacher','admin'])test(`${role}: duplicate race clears selection, repairs both lists and shows the field error`,async({page})=>{
  const state=await setup(page,role);await open(page,role);const select=candidates(page);await expect(select).toBeEnabled();
  state.postStatus=409;await select.selectOption('student-24');await addButton(page,role).click();
  await expect(page.getByText('Sinh viên này đã thuộc lớp.',{exact:true})).toBeVisible();
  await expect(select).toHaveValue('');await expect(select).toBeEnabled();
  await expect(select.locator('option[value="student-24"]')).toHaveCount(0);
  await expect(page.getByText('PRIVATE_SQL_ERROR')).toHaveCount(0);
  await page.getByRole('searchbox',{name:'Tìm theo tên, MSSV hoặc email...',exact:true}).fill('SV024');
  await expect(page.getByRole('row').filter({hasText:'SV024'})).toBeVisible();
  expect(state.posts).toEqual(['student-24']);
});

test('pending add is disabled and a late candidate response cannot restore an enrolled option',async({page})=>{
  const state=await setup(page);await open(page);const select=candidates(page);await expect(select).toBeEnabled();await select.selectOption('student-24');
  let releaseOld!:()=>void,releasePost!:()=>void;
  state.slowQuery='SV024';state.slowGate=new Promise<void>(resolve=>releaseOld=resolve);state.postGate=new Promise<void>(resolve=>releasePost=resolve);
  await page.getByRole('button',{name:'Tìm sinh viên để thêm',exact:true}).click();
  const oldRequest=page.waitForRequest(request=>request.url().includes('/available')&&new URL(request.url()).searchParams.get('q')==='SV024');
  await page.getByRole('searchbox',{name:'Tìm sinh viên để thêm',exact:true}).fill('SV024');await oldRequest;
  await addButton(page).click();await expect(page.getByRole('button',{name:'Đang thêm...',exact:true})).toBeDisabled();await expect(select).toBeDisabled();
  state.slowQuery=null;releasePost();await expect(page.getByText('Đã thêm sinh viên vào lớp.',{exact:true})).toBeVisible();
  await expect(select.locator('option[value="student-24"]')).toHaveCount(0);releaseOld();
  await expect(page.getByText('Không tìm thấy sinh viên phù hợp.',{exact:true}).last()).toBeVisible();
  await expect(select.locator('option[value="student-24"]')).toHaveCount(0);expect(state.posts).toEqual(['student-24']);
});

test('empty candidates and loading failure never expose stale students or an all option',async({page})=>{
  await page.setViewportSize({width:375,height:900});const state=await setup(page,'teacher',true);await open(page);
  const select=candidates(page);await expect(page.getByText('Không còn sinh viên để thêm.',{exact:true}).last()).toBeVisible();
  await expect(select).toBeDisabled();await expect(addButton(page)).toBeDisabled();await expect(select.locator('option')).toHaveCount(1);
  state.members.delete('student-24');state.availableFail=true;await page.reload();
  await expect(page.getByText('Không tải được lựa chọn.')).toBeVisible({timeout:45_000});await expect(select).toBeDisabled();
  await expect(select.locator('option[value="student-24"]')).toHaveCount(0);await expect(select.locator('option').filter({hasText:'Tất cả'})).toHaveCount(0);
  state.availableFail=false;await page.getByRole('button',{name:'Thử lại',exact:true}).click();await expect(select).toBeEnabled();
  await expect(select.locator('option[value="student-24"]')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('failed add preserves selection and the existing roster for a safe retry',async({page})=>{
  const state=await setup(page);await open(page);const select=candidates(page);await expect(select).toBeEnabled();state.postStatus=500;
  await select.selectOption('student-24');await addButton(page).click();await expect(page.getByText('Không thể thêm học sinh vào lớp.',{exact:true})).toBeVisible();
  await expect(select).toHaveValue('student-24');await expect(page.getByRole('row').filter({hasText:'SV001'})).toBeVisible();
  state.postStatus=200;await addButton(page).click();await expect(page.getByText('Đã thêm sinh viên vào lớp.',{exact:true})).toBeVisible();
  await expect(select.locator('option[value="student-24"]')).toHaveCount(0);
});

test('admin bulk membership refreshes candidates and reports duplicate input',async({page})=>{
  const state=await setup(page,'admin');await open(page,'admin');const select=candidates(page);await expect(select).toBeEnabled();
  await page.getByRole('textbox',{name:'Dán email hoặc họ tên, mỗi dòng một tài khoản...'}).fill('student24@example.test\nstudent24@example.test\nstudent25@example.test');
  await page.getByRole('button',{name:'Thêm hàng loạt',exact:true}).click();
  await expect(page.getByText('Đã xử lý 2/3 dòng.',{exact:true})).toBeVisible();await expect(page.getByText('Không còn sinh viên để thêm.',{exact:true}).last()).toBeVisible();
  expect(state.posts).toEqual(['student-24','student-25']);await expect(select).toBeDisabled();await expect(addButton(page,'admin')).toBeDisabled();
});
