import { test,expect } from '@playwright/test';
import { activitySample,activitySession } from './ai-activity-fixture';

test.use({timezoneId:'Asia/Ho_Chi_Minh',locale:'vi-VN'});

for(const width of [390,768,1024,1440])for(const theme of ['light','dark'] as const) {
  test(`AI analytics ${width}px ${theme}: real aggregates, responsive hierarchy and details`,async({page})=>{
    await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
    await activitySession(page);await page.goto('/admin/ai-support/activity');
    await expect(page.getByRole('heading',{level:1,name:'Hoạt động AI',exact:true})).toBeVisible();
    const kpis=page.getByRole('region',{name:'Chỉ số hoạt động AI'});
    await expect(kpis.locator('article')).toHaveCount(4);
    await expect(kpis).toContainText('83,3%');await expect(kpis).toContainText('22');await expect(kpis).toContainText('50%');
    await expect(page.getByRole('progressbar',{name:'Xử lý thành công',exact:true})).toHaveAttribute('aria-valuetext','83,3% · 5 / 6');
    await expect(page.getByRole('progressbar',{name:'Đáp ứng số câu yêu cầu',exact:true})).toHaveAttribute('aria-valuetext','73,3% · 22 / 30');
    await expect(page.getByRole('progressbar',{name:'Đạt kiểm tra nguồn',exact:true})).toHaveAttribute('aria-valuetext','100% · 22 / 22');
    await expect(page.getByRole('progressbar',{name:'Truy xuất KB thành công',exact:true})).toHaveAttribute('aria-valuetext','50% · 1 / 2');
    await expect(page.getByRole('region',{name:'Tình trạng provider'})).toContainText('Lần gọi gần nhất không khả dụng');
    await expect(page.getByRole('region',{name:'Sự cố gần đây'})).toContainText('AI_PROVIDER_UNAVAILABLE');
    await expect(page.getByText('gemini-openai-compatible',{exact:true})).toBeHidden();
    await page.evaluate(()=>document.fonts.ready);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const columns=await kpis.locator('article').evaluateAll(nodes=>nodes.map(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y})));
    if(width===1440){expect(new Set(columns.map(p=>p.y)).size).toBe(1);expect((await kpis.boundingBox())!.y+(await kpis.boundingBox())!.height).toBeLessThan(1000);}
    if(width===390)expect(new Set(columns.map(p=>p.x)).size).toBe(1);
    if(width===768||width===1024)expect(new Set(columns.map(p=>p.x)).size).toBe(2);
    await expect(page.locator('.sidebar')).toHaveCSS('background-color','rgb(0, 109, 119)');
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    const launcher=page.getByRole('button',{name:'Mở tin nhắn hỗ trợ',exact:true});
    await expect.poll(()=>launcher.evaluate(button=>{
      const a=button.getBoundingClientRect();
      return [...document.querySelectorAll('main [data-chat-avoid]')].filter(el=>{
        const b=el.getBoundingClientRect();return b.width>0&&b.height>0&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
      }).length;
    })).toBe(0);
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    if(width===1440)await page.screenshot({path:`artifacts/ai-activity-redesign/viewport-${width}-${theme}.png`,style:'nextjs-portal{display:none!important}'});
    await page.screenshot({path:`artifacts/ai-activity-redesign/activity-${width}-${theme}.png`,fullPage:true,style:'nextjs-portal{display:none!important}'});
    const technical=page.locator('#ai-technical-details');
    await technical.locator('summary').click();await expect(page.getByText('gemini-openai-compatible',{exact:true})).toBeVisible();
    await expect(technical).toContainText('1.250 ms');
    await expect(technical).not.toContainText(/API key|Bearer|credentials|token usage/i);
    await technical.locator('summary').focus();await page.keyboard.press('Enter');await expect(technical).not.toHaveAttribute('open','');
  });
}

test('draft dates apply together; both CSV exports use applied window; invalid ranges do not fetch',async({page})=>{
  const state=await activitySession(page);await page.goto('/admin/ai-support/activity');
  await expect(page.getByRole('region',{name:'Chỉ số hoạt động AI'})).toBeVisible();
  expect(state.requests.some(url=>url.includes('start=2026-10-16&end=2026-10-22'))).toBe(true);
  const initial=state.requests.length;
  await page.getByRole('combobox',{name:'Khoảng thời gian',exact:true}).selectOption('30');
  expect(state.requests.length).toBe(initial);
  await page.getByRole('button',{name:'Áp dụng',exact:true}).click();
  await expect.poll(()=>state.requests.some(url=>url.includes('start=2026-09-23&end=2026-10-22'))).toBe(true);
  await expect(page.getByRole('region',{name:'Chỉ số hoạt động AI'})).toBeVisible();
  await page.getByLabel('Từ ngày',{exact:true}).fill('2026-10-20');
  for(const [feature,label] of [['question','Xuất CSV tạo câu hỏi'],['support','Xuất CSV hỗ trợ']]){
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();
    expect((await pending).suggestedFilename()).toBe(`ai-${feature}-2026-09-23-2026-10-22.csv`);
    expect(state.requests.some(url=>url.includes(`/export/${feature}?start=2026-09-23&end=2026-10-22`))).toBe(true);
  }
  await page.getByLabel('Từ ngày',{exact:true}).fill('2026-10-24');
  const beforeInvalid=state.requests.length;await page.getByRole('button',{name:'Áp dụng',exact:true}).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('Chọn khoảng ngày hợp lệ');expect(state.requests.length).toBe(beforeInvalid);
});

test('zero denominators stay unknown; no false healthy state, NaN, infinity or invented metrics',async({page})=>{
  const data=structuredClone(activitySample);
  for(const metrics of [data.question,data.support])for(const [key,value]of Object.entries(metrics)){
    metrics[key]=typeof value==='object'&&value?{numerator:0,denominator:0,rate:null}:typeof value==='number'?0:typeof value==='boolean'?value:null;
  }
  Object.assign(data.question,{average_teacher_rating:null,average_latency_ms:null});
  data.support.average_response_latency_ms=null;
  Object.assign(data.health,{last_success_at:null,last_error_at:null,last_error_code:null});
  await activitySession(page,data);await page.goto('/admin/ai-support/activity');
  await expect(page.getByText('Chưa có dữ liệu trong khoảng thời gian này.',{exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'Tình trạng provider'})).toContainText('Chưa có hoạt động');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(/NaN|Infinity|83,3%|22 \/ 30/);
  await page.locator('summary').filter({hasText:'Đánh giá chất lượng'}).click();
  await expect(page.getByText(/Chưa có đánh giá sao/)).toBeVisible();
});

test('request errors are visible and retryable without revealing raw diagnostic secrets',async({page})=>{
  const state=await activitySession(page);state.status=503;await page.goto('/admin/ai-support/activity');
  await expect(page.locator('main').getByRole('alert')).toContainText('Không tải được hoạt động AI');
  await expect(page.locator('main').getByRole('alert')).toContainText('AI_PROVIDER_UNAVAILABLE');await expect(page.locator('main').getByRole('alert')).toContainText('503');
  await page.locator('#ai-technical-details summary').click();
  expect(await page.locator('main').textContent()).not.toContain('fixture-only-secret');
  expect(await page.locator('main').textContent()).not.toContain('password=');
  state.status=200;await page.getByRole('button',{name:'Thử lại',exact:true}).click();
  await expect(page.getByRole('region',{name:'Chỉ số hoạt động AI'})).toBeVisible();await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
  state.exportFailure=true;await page.getByRole('button',{name:'Xuất CSV hỗ trợ',exact:true}).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('Chưa xuất được CSV');
  await expect(page.getByRole('region',{name:'Chỉ số hoạt động AI'})).toBeVisible();
});

test('health respects event recency and configuration; route tabs preserve Knowledge Base',async({page})=>{
  const data=structuredClone(activitySample);data.health.last_success_at='2026-10-20T14:09:00Z';
  const state=await activitySession(page,data);await page.goto('/admin/ai-support/activity');
  const health=page.getByRole('region',{name:'Tình trạng provider'});
  await expect(health).toContainText('Lần gọi gần nhất thành công');
  await expect(page.getByRole('region',{name:'Sự cố gần đây'})).toContainText('AI_PROVIDER_UNAVAILABLE');
  state.data.health.configured=false;await page.getByRole('button',{name:'Áp dụng',exact:true}).click();
  await expect(health).toContainText('Chưa cấu hình');
  const tabs=page.getByRole('navigation',{name:'Phân hệ AI Support'});
  await expect(tabs.getByRole('link',{name:'Hoạt động AI',exact:true})).toHaveAttribute('aria-current','page');
  await tabs.getByRole('link',{name:'Kho tri thức',exact:true}).click();await expect(page).toHaveURL(/\/admin\/ai-support\/knowledge$/);
  await expect(page.getByRole('heading',{level:1,name:'Kho tri thức',exact:true})).toBeVisible();
  await expect(tabs.getByRole('link',{name:'Kho tri thức',exact:true})).toHaveAttribute('aria-current','page');
});
