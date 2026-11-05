import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';

const examId = '33333333-3333-4333-8333-333333333333';
const attemptId = '22222222-2222-4222-8222-222222222222';
const student = { id: '44444444-4444-4444-8444-444444444444', full_name: 'Lê Nguyễn Châu Anh', student_code: '102230057' };
const baseTime = '2026-11-05T08:38:22Z';
const id = (n: number) => `55555555-5555-4555-8555-${String(n).padStart(12,'0')}`;

async function mockFeed(page: Page) {
  await uiSession(page, 'teacher');
  const now = Date.now();
  const exam = {id:examId,title:'Kiểm thử luồng cảnh báo',status:'ongoing',
    start_time:new Date(now-60_000).toISOString(),end_time:new Date(now+3_600_000).toISOString()};
  const types = ['object_phone','object_book','face_not_detected'] as const;
  const events = types.map((type,index)=>({
    id:id(index+1),exam_id:examId,attempt_id:attemptId,student_id:student.id,student,
    source:'OBJECT',provider:'test_model',event_type:type,severity:index===2?'low':'medium',
    confidence:index===2?null:.67, max_confidence:index===2?null:.67,
    occurred_at:baseTime,received_at:baseTime,first_seen:baseTime,last_seen:baseTime,
    duration_ms:index===2?2100:6500,occurrence_count:1,
    message:'',metadata:null,evidence:null,has_snapshot:false,status:'NEW',is_simulated:false,
    reviewed_at:null,reviewed_by:null,review_note:null,review_version:0,
  }));
  const patches:string[] = [];
  const headers = {
    'access-control-allow-origin':process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000',
    'access-control-allow-credentials':'true',
    'access-control-allow-headers':'authorization,content-type',
    'access-control-allow-methods':'GET,POST,OPTIONS,PATCH',
  };
  await page.route(`**/api/v1/exams/${examId}`,route=>route.fulfill({headers,json:{data:exam}}));
  await page.route('**/api/v1/attempts?**',route=>route.fulfill({headers,json:{data:[{id:attemptId,student,status:'submitted'}],meta:{total:1,page:1,limit:30}}}));
  await page.route('**/api/v1/proctoring/**',route=>{
    const request=route.request();const url=new URL(request.url()),pathname=url.pathname;
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(pathname.endsWith('/health'))return route.fulfill({headers,json:{data:{modules:[],simulator_enabled:false,message:null}}});
    if(pathname.endsWith('/events'))return route.fulfill({headers,json:{
      data:events,meta:{total:events.length,page:1,limit:30,event_types:[...types],
        summary:{total:events.length,new:events.filter(item=>item.status==='NEW').length,reviewed:0,dismissed:0,confirmed:0,high_priority:0,total_students:1,taking:0,submitted:1},exam}
    }});
    const event=events.find(item=>pathname.includes(item.id));
    if(event && request.method()==='PATCH') {
      const body=request.postDataJSON() as {status:string};
      patches.push(body.status);event.status=body.status;event.review_version++;
      return route.fulfill({headers,json:{data:{...event,history:[],exam}}});
    }
    if(event)return route.fulfill({headers,json:{data:{...event,history:[],exam}}});
    return route.fulfill({status:404,headers,json:{error:{message:'Not found'}}});
  });
  await page.routeWebSocket('**/api/v1/proctoring/ws',socket=>socket.onMessage(()=>socket.send(JSON.stringify({type:'ready'}))));
  await page.routeWebSocket('**/api/v1/ws/monitor/**',socket=>socket.onMessage(()=>socket.send(JSON.stringify({type:'ready'}))));
  return {events,patches};
}

for(const width of [1440,1024,390])test(`monitoring feed is compact and responsive at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await mockFeed(page);
  await page.goto(`/dashboard/monitor/${examId}`);
  await expect(page.getByRole('heading',{name:'Luồng cảnh báo'})).toBeVisible({timeout:45_000});
  const rows=page.locator('[data-proctor-event]');
  await expect(rows).toHaveCount(3);
  const row=rows.first();
  await expect(row).toContainText('Lê Nguyễn Châu Anh');
  await expect(row).toContainText('102230057');
  await expect(row).toContainText('Phát hiện điện thoại');
  await expect(row).toContainText('Trung bình');
  await expect(row).toContainText('Độ tin cậy 67%');
  await expect(row).toContainText('6,5 giây');
  for(const label of ['Xem','Bỏ qua','Xác nhận'])await expect(row.getByRole('button',{name:label,exact:true})).toBeVisible();
  await expect.poll(async()=>row.evaluate(node=>Math.round(node.getBoundingClientRect().height)))
    .toBeLessThanOrEqual(width>=1200?112:width>=768?150:190);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
});

test('condensed monitoring row retains the existing review and detail actions',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const {patches}=await mockFeed(page);
  await page.goto(`/dashboard/monitor/${examId}`);
  const row=page.locator(`[data-proctor-event="${id(1)}"]`);
  await expect(row).toBeVisible({timeout:45_000});
  await row.getByRole('button',{name:'Xem',exact:true}).click();
  const detail=page.getByRole('dialog',{name:'Chi tiết cảnh báo'});
  await expect(detail).toBeVisible();
  await detail.getByRole('button',{name:'Đóng',exact:true}).click();
  await expect(detail).toHaveCount(0);
  await row.getByRole('button',{name:'Bỏ qua',exact:true}).click();
  await expect.poll(()=>patches.includes('DISMISSED')).toBe(true);
  await expect(row).toContainText('Đã bỏ qua');
  await row.getByRole('button',{name:'Xác nhận',exact:true}).click();
  await expect.poll(()=>patches.includes('CONFIRMED')).toBe(true);
  await expect(row).toContainText('Đã xác nhận');
});
