import {expect,test} from '@playwright/test';
import {uiSession} from './ui-fixtures';

const exam='33333333-3333-4333-8333-333333333333',attempt='22222222-2222-4222-8222-222222222222';
test.use({launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}});
for(const width of [375,768,1440])test(`monitor timeline and realtime camera controls remain accessible at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await uiSession(page,'teacher');await page.routeWebSocket('**/api/v1/ws/call/**',()=>{});
  await page.routeWebSocket('**/api/v1/proctoring/ws',socket=>socket.onMessage(()=>socket.send(JSON.stringify({type:'ready'}))));
  await page.routeWebSocket('**/api/v1/ws/monitor/**',socket=>socket.onMessage(()=>socket.send(JSON.stringify({type:'ready'}))));
  const headers={'access-control-allow-origin':process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000','access-control-allow-credentials':'true','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,OPTIONS'};
  await page.route('**/api/v1/config/webrtc',route=>route.fulfill({headers,json:{data:{ice_servers:[]}}}));
  const student={id:'44444444-4444-4444-8444-444444444444',full_name:'Sinh viên giám sát',student_code:'MON001'};
  await page.route('**/api/v1/attempts?**',route=>route.fulfill({headers,json:{data:[{id:attempt,status:'in_progress',student}],meta:{total:1,page:1,limit:30}}}));
  await page.route('**/api/v1/proctoring/**',route=>{
    const url=new URL(route.request().url());let json:unknown;
    if(url.pathname.endsWith('/health'))json={data:{modules:[],simulator_enabled:false}};
    else if(url.pathname.endsWith('/timeline'))json={data:{attempt_id:attempt,exam_id:exam,student,status:'in_progress',entries:[{id:'started',kind:'started',at:new Date().toISOString(),label:'Bắt đầu bài thi'}],recording_url:null,total_events:0,truncated:false}};
    else json={data:[],meta:{total:0,page:1,limit:30,summary:{total:0,new:0,reviewed:0,dismissed:0,confirmed:0,high_priority:0,total_students:1,taking:1,submitted:0},exam:{id:exam,title:'Phiên kiểm thử camera',status:'ongoing',start_time:new Date(Date.now()-60000).toISOString(),end_time:new Date(Date.now()+3600000).toISOString()}}};
    return route.fulfill({headers,json});
  });
  await page.goto(`/dashboard/monitor/${exam}`);
  await expect(page.getByRole('heading',{name:'Luồng cảnh báo'})).toBeVisible({timeout:45_000});
  if(width<1024)await page.locator('details').filter({has:page.locator('summary', {hasText:'Phiên làm bài'})}).locator('summary').click();
  const card=page.getByRole('button',{name:/Sinh viên giám sát/});await expect(card).toBeVisible();await card.focus();await page.keyboard.press('Enter');
  const detail=page.getByRole('dialog',{name:'Dòng thời gian sinh viên',exact:true});await expect(detail.getByRole('button',{name:'Đóng',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(detail).toHaveCount(0);await expect(card).toBeFocused();
  await page.keyboard.press('Enter');await detail.getByRole('button',{name:'Xem camera realtime'}).click();
  const camera=page.getByRole('dialog',{name:'Camera realtime Sinh viên giám sát',exact:true});await expect(camera).toBeVisible();
  const close=camera.getByRole('button',{name:'Đóng',exact:true});expect(await close.evaluate(button=>{const box=button.getBoundingClientRect();return button.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));})).toBe(true);
  const box=(await camera.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath(`monitor-camera-${width}.png`)});await close.click();await expect(camera).toHaveCount(0);
});
