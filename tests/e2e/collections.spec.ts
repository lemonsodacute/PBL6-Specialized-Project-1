import {test,expect,type Page} from '@playwright/test';
import {uiSession} from './ui-fixtures';

const headers={'access-control-allow-origin':process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000','access-control-allow-credentials':'true','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,PATCH,OPTIONS'};
async function session(page:Page,role:string){
  await uiSession(page,role);
  await page.context().addCookies([{name:'auth_token',value:`fixture.${Buffer.from(JSON.stringify({role})).toString('base64url')}.signature`,url:process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000'}]);
}
const users=Array.from({length:45},(_,index)=>({id:`user-${index}`,full_name:`Nguyễn Thiên Đức ${String(index).padStart(2,'0')}`,email:`user${index}@example.com`,student_code:`SV${String(index).padStart(3,'0')}`,role:'student',is_active:index%2===0,identity_profile_status:index%3===0?'VERIFIED':'PENDING',created_at:'2026-10-01T00:00:00Z'}));
const fold=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').replace(/đ/gi,'d').toLowerCase().trim();
test('admin class table keeps fragment columns unique across reloads',async({page})=>{
  const keyErrors:string[]=[];
  page.on('console',message=>{if(/same key|unique.*key/i.test(message.text()))keyErrors.push(message.text());});
  await session(page,'admin');
  await page.goto('/admin/classes');
  const table=page.getByRole('table');
  await expect(table.getByRole('columnheader')).toHaveText(['Tên lớp','Giảng viên','Sinh viên','Đề thi','Ngày tạo','Thao tác']);
  const row=table.getByRole('row').filter({hasText:'Kiểm thử phần mềm'});
  await expect(row.getByRole('cell')).toHaveCount(6);
  for(const [index,label] of ['Tên lớp','Giảng viên','Sinh viên','Đề thi','Ngày tạo','Thao tác'].entries()){
    await expect(row.getByRole('cell').nth(index)).toHaveAttribute('data-label',label);
  }
  await page.reload();
  await expect(table.getByRole('columnheader')).toHaveCount(6);
  await expect(row.getByRole('cell')).toHaveCount(6);
  expect(keyErrors).toEqual([]);
});

async function userAPI(page:Page){
  const queries:URLSearchParams[]=[];const state={fail:false};
  await page.route('**/api/v1/users?**',async route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    const params=new URL(route.request().url()).searchParams;queries.push(params);
    if(state.fail)return route.fulfill({status:500,headers,json:{error:{message:'PRIVATE_SQL_ERROR'}}});
    const q=fold(params.get('q')||'');
    const rows=users.filter(item=>(!q||fold(`${item.full_name} ${item.email} ${item.student_code}`).includes(q))&&(!params.get('role')||item.role===params.get('role'))&&(!params.get('is_active')||String(item.is_active)===params.get('is_active'))&&(!params.get('identity_profile_status')||item.identity_profile_status===params.get('identity_profile_status')));
    const pageNumber=Number(params.get('page')||1),limit=Number(params.get('limit')||20);
    if(q==='sv000')await new Promise(resolve=>setTimeout(resolve,800));
    return route.fulfill({headers,json:{data:rows.slice((pageNumber-1)*limit,pageNumber*limit),meta:{total:rows.length,page:pageNumber,limit}}});
  });return {queries,state};
}
test('users combine filters, debounce, real pagination and preserve URL on reload',async({page})=>{
  test.setTimeout(90_000);await session(page,'admin');const {queries}=await userAPI(page);
  await page.goto('/dashboard/users');await expect(page.getByText('Hiển thị 1–20 trên 45 kết quả')).toBeVisible({timeout:30_000});
  await page.getByRole('button',{name:'Trang sau',exact:true}).click();await expect(page.getByText('Hiển thị 21–40 trên 45 kết quả')).toBeVisible();await expect(page).toHaveURL(/page=2/);
  const search=page.getByRole('searchbox').first();await search.fill(' thien duc ');
  await page.getByRole('combobox',{name:'Vai trò',exact:true}).selectOption('student');
  await page.getByRole('combobox',{name:'Trạng thái tài khoản',exact:true}).selectOption('true');
  await page.getByRole('combobox',{name:'Hồ sơ sinh viên',exact:true}).selectOption('VERIFIED');
  await expect(page.getByText('Hiển thị 1–8 trên 8 kết quả')).toBeVisible();
  const last=queries.at(-1)!;expect(last.get('q')).toBe('thien duc');expect(last.get('role')).toBe('student');expect(last.get('is_active')).toBe('true');expect(last.get('identity_profile_status')).toBe('VERIFIED');expect(last.get('page')).toBe('1');
  await page.reload();await expect(search).toHaveValue('thien duc');await expect(page.getByText('Hiển thị 1–8 trên 8 kết quả')).toBeVisible();
  await page.getByRole('button',{name:'Xóa bộ lọc',exact:true}).first().click();await expect(page.getByText('Hiển thị 1–20 trên 45 kết quả')).toBeVisible();
  const before=queries.length;await search.fill('S');await search.fill('SV');await search.fill('SV001');
  await expect(page.getByText('Hiển thị 1–1 trên 1 kết quả')).toBeVisible();expect(queries.length-before).toBe(1);
});
test('latest search wins; empty and API error never display stale data',async({page})=>{
  await session(page,'admin');const {state}=await userAPI(page);await page.goto('/dashboard/users');await expect(page.getByText('Hiển thị 1–20 trên 45 kết quả')).toBeVisible({timeout:30_000});
  const search=page.getByRole('searchbox').first();const slow=page.waitForRequest(req=>new URL(req.url()).searchParams.get('q')==='SV000');await search.fill('SV000');await slow;await search.fill('SV044');
  await expect(page.getByRole('row').filter({hasText:'SV044'})).toBeVisible();await expect(page.getByRole('row').filter({hasText:'SV000'})).toHaveCount(0);
  await search.fill('không có kết quả');await expect(page.getByText('Không tìm thấy kết quả phù hợp.')).toBeVisible();await expect(page.getByRole('table')).toHaveCount(0);
  state.fail=true;await search.fill('SV');await expect(page.locator('main').getByRole('alert')).toBeVisible();await expect(page.getByText('PRIVATE_SQL_ERROR')).toHaveCount(0);await expect(page.getByRole('table')).toHaveCount(0);
  state.fail=false;await page.getByRole('button',{name:'Tải lại danh sách'}).click();await expect(page.getByRole('table')).toBeVisible();
});
test('toolbar and pagination fit narrow mobile screens',async({page})=>{
  await page.setViewportSize({width:375,height:900});await session(page,'admin');await userAPI(page);await page.goto('/dashboard/users');await expect(page.getByText('Hiển thị 1–20 trên 45 kết quả')).toBeVisible({timeout:30_000});
  const toolbar=page.getByRole('search',{name:'Tìm kiếm và lọc danh sách'});expect(await toolbar.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
test('notification filters paginate independently from page filters and badge stays global',async({page})=>{
  await session(page,'student');const rows=Array.from({length:45},(_,i)=>({id:`notice-${i}`,type:i%2===0?'student_card_notice':'exam_summary',title:`Thông báo ${i}`,message:'Nội dung đã lưu',is_read:i%3===0,created_at:'2026-10-12T00:00:00Z',severity:null}));
  await page.route('**/api/v1/notifications?**',route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    const params=new URL(route.request().url()).searchParams;const filtered=rows.filter(row=>(!params.get('type')||row.type===params.get('type'))&&(!params.get('is_read')||String(row.is_read)===params.get('is_read')));const n=Number(params.get('page')||1),size=Number(params.get('limit')||20);
    return route.fulfill({headers,json:{data:filtered.slice((n-1)*size,n*size),meta:{total:filtered.length,page:n,limit:size}}});
  });await page.route('**/api/v1/notifications/unread-count',route=>route.fulfill({headers,json:{data:{count:30}}}));
  await page.goto('/student/classes?q=lop&page=2');await page.getByRole('button',{name:'Thông báo, 30 chưa đọc'}).click();
  const panel=page.getByRole('region',{name:'Thông báo',exact:true});await expect(panel.locator('button:has(time)')).toHaveCount(8);await expect(panel.getByRole('combobox')).toHaveCount(0);
  await expect(page).toHaveURL(/q=lop&page=2/);await panel.getByRole('link',{name:'Xem tất cả thông báo'}).click();
  const main=page.getByRole('main');await expect(main.getByText('Hiển thị 1–20 trên 45 kết quả')).toBeVisible({timeout:45_000});await main.getByRole('button',{name:'Trang sau',exact:true}).click();await expect(main.getByText('Hiển thị 21–40 trên 45 kết quả')).toBeVisible();
  await main.getByRole('combobox',{name:'Trạng thái đọc'}).selectOption('false');await main.getByRole('combobox',{name:'Loại thông báo'}).selectOption('student_card_notice');await expect(main.getByText('Hiển thị 1–15 trên 15 kết quả')).toBeVisible();
  await expect(page).toHaveURL(/\/notifications\?/);await expect(page.getByRole('button',{name:'Thông báo, 30 chưa đọc'})).toBeVisible();
});
test('student can find an older result beyond the first hundred without an exam lookup',async({page})=>{
  await session(page,'student');const calls:URLSearchParams[]=[];
  const rows=Array.from({length:125},(_,i)=>({id:`attempt-${i}`,exam_id:`exam-${i}`,exam_title:i===124?'Khai phá dữ liệu cũ':`Bài thi ${i}`,classes:[],status:'submitted',score:i===124?'0.00':'1.00',max_score:'10.00',submitted_at:'2026-10-10T01:20:00Z'}));
  await page.route('**/api/v1/attempts/mine?**',route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    const params=new URL(route.request().url()).searchParams;calls.push(params);const q=fold(params.get('q')||'');const filtered=rows.filter(row=>!q||fold(row.exam_title).includes(q));const n=Number(params.get('page')||1),limit=Number(params.get('limit')||20);
    return route.fulfill({headers,json:{data:filtered.slice((n-1)*limit,n*limit),meta:{total:filtered.length,page:n,limit}}});
  });await page.goto('/student/grades');await expect(page.getByText('Hiển thị 1–20 trên 125 kết quả')).toBeVisible({timeout:30_000});
  await page.getByRole('searchbox',{name:'Tìm đề thi...'}).fill('khai pha');const row=page.getByRole('row').filter({hasText:'Khai phá dữ liệu cũ'});await expect(row).toContainText('0 / 10');await expect(row.getByRole('link')).toHaveAttribute('href','/student/attempts/attempt-124/result');
  expect(calls.at(-1)!.get('completed_only')).toBe('true');expect(calls.at(-1)!.get('limit')).toBe('20');
});
