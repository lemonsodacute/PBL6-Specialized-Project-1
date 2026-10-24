import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';
import { adminDashboardAPI } from './admin-analytics-fixture';
import { scoreDistribution } from '../../lib/admin-analytics';
import type { ReportsOverview } from '../../lib/teacher-reports';

function reportData(): ReportsOverview {
  return {
    exam_id: null, exams: [{id:'exam-1',title:'Cơ sở dữ liệu',classes:[]},{id:'exam-2',title:'Lập trình Web',classes:[]}], completed_statuses: ['submitted','auto_submitted','terminated'],
    meta: { total: 4, page: 1, limit: 20 },
    summary: { attempt_count:4,completed_attempts:4,scored_attempts:4,percentage_attempts:4,average_percentage:'50',average_score:null,max_score:null,total_violations:0,browser_violation_count:0,detection_count:0,average_risk_score:null,risk_scored_attempts:0 },
    results: [0,20,80,100].map((percentage,index) => ({ attempt_id:`attempt-${index}`,exam_id:index<2?'exam-1':'exam-2',exam_title:index<2?'Cơ sở dữ liệu':'Lập trình Web',student_id:`student-${index}`,student_code:`SV00${index}`,full_name:`Sinh viên ${index}`,attempt_number:1,status:'submitted',score:String(percentage / 100 * (index % 2 ? 20 : 10)),max_score:index % 2 ? '20' : '10',percentage:String(percentage),started_at:`2026-10-${16+index}T01:00:00Z`,submitted_at:`2026-10-${16+index}T02:00:00Z`,violation_count:0,browser_violation_count:0,detection_count:0,risk_score:null })),
  };
}

async function setup(page: Page) {
  await uiSession(page,'admin');
  await page.context().addCookies([{ name:'auth_token',value:`fixture.${Buffer.from(JSON.stringify({role:'admin'})).toString('base64url')}.signature`,url:process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' }]);
  const dashboard = await adminDashboardAPI(page);
  const state = { data:reportData(),requests:[] as URLSearchParams[] };
  await page.route('**/api/v1/teacher/reports**',route => {
    const headers = { 'access-control-allow-origin':process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000','access-control-allow-credentials':'true','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,OPTIONS' };
    if (route.request().method()==='OPTIONS') return route.fulfill({status:204,headers});
    const params = new URL(route.request().url()).searchParams; state.requests.push(params);
    const selected = state.data.results.filter(row => (!params.get('exam_id') || row.exam_id === params.get('exam_id')) && (!params.get('status') || row.status === params.get('status')) && (!params.get('q') || `${row.full_name} ${row.student_code} ${row.exam_title}`.toLowerCase().includes(params.get('q')!.toLowerCase())));
    const data = structuredClone(state.data); data.results=selected; data.exam_id=params.get('exam_id') || null;
    data.meta={total:selected.length,page:1,limit:20};
    Object.assign(data.summary,{attempt_count:selected.length,completed_attempts:selected.length,scored_attempts:selected.length,percentage_attempts:selected.length,average_percentage:selected.length?String(selected.reduce((sum,row)=>sum+Number(row.percentage),0)/selected.length):null});
    if (params.get('format')==='csv') return route.fulfill({ headers:{...headers,'content-type':'text/csv'},body:['Exam,MSSV,Score,Max score',...selected.map(row=>`${row.exam_title},${row.student_code},${row.score},${row.max_score}`)].join('\n') });
    return route.fulfill({headers,json:{data}});
  });
  return { dashboard,state };
}

test('score bins use only valid completed percentages and keep boundary values', () => {
  const data=reportData();
  expect(scoreDistribution(data)).toEqual({observed:4,items:[{label:'0–<20%',value:1},{label:'20–<40%',value:1},{label:'40–<60%',value:0},{label:'60–<80%',value:0},{label:'80–100%',value:2}]});
  data.results[0].percentage=null; data.results[1].percentage=''; data.results[2].percentage='101'; data.results[3].status='in_progress';
  expect(scoreDistribution(data).observed).toBe(0);
});

for (const width of [390,1024,1440]) for (const theme of ['light','dark'] as const) test(`Admin presentation ${width}px ${theme}: real KPI sources and compact hierarchy`, async ({page}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({width,height:1000}); await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
  const { dashboard,state } = await setup(page);
  const pageErrors:string[]=[]; page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto('/admin');
  await expect(page.getByRole('heading',{level:1,name:'Tổng quan hệ thống',exact:true})).toBeVisible();
  const kpis=page.getByLabel('Chỉ số tổng quan');
  await expect(kpis.locator('article')).toHaveCount(4);
  const labels=['Tổng người dùng','Lớp học','Đề thi','Thẻ chờ xác nhận'];
  for (const [index,value] of ['30','1','2','2'].entries()) await expect(kpis.locator('article').filter({hasText:labels[index]}).locator(':scope > strong')).toHaveText(value);
  await expect(page.getByRole('region',{name:'Phân bố người dùng'})).toContainText('26');
  await expect(page.getByRole('region',{name:'Cần xử lý'})).toContainText('Nguyễn An');
  await expect(page.getByRole('region',{name:'Hoạt động gần đây'})).toContainText('Tạo đề thi');
  await expect(page.getByRole('region',{name:'Nhịp độ nộp bài'})).toContainText('4 bài làm trên trang 1 / 4 kết quả phù hợp');
  expect(dashboard.requests.filter(url=>url.startsWith('/api/v1/users?'))).toHaveLength(3);
  expect(dashboard.requests.filter(url=>url.startsWith('/api/v1/exams?'))).toHaveLength(1);
  expect(state.requests).toHaveLength(1);
  const positions=await kpis.locator('article').evaluateAll(nodes=>nodes.map(node=>({x:node.getBoundingClientRect().x,y:node.getBoundingClientRect().y,height:node.getBoundingClientRect().height})));
  expect(new Set(positions.map(position=>position.x)).size).toBe(width===1440?4:width===1024?2:1);
  expect(Math.max(...positions.map(position=>position.height))).toBeLessThan(190);
  for (const path of ['/admin','/dashboard/reports']) {
    if(path!=='/admin') await page.goto(path);
    if(path==='/dashboard/reports') {
      await expect(page.getByRole('heading',{level:1,name:'Báo cáo & thống kê',exact:true})).toBeVisible();
      await expect(page.getByLabel('Thống kê báo cáo')).toContainText('50%');
      await expect(page.getByRole('img',{name:'80–100%: 2 bài',exact:true})).toBeVisible();
      await page.getByRole('img',{name:'80–100%: 2 bài',exact:true}).focus();
      await expect(page.getByRole('region',{name:'Phân bố điểm'}).getByRole('status')).toContainText('80–100% · 2 bài');
      await expect(page.getByRole('region',{name:'Báo cáo bài thi',exact:true}).getByRole('table')).toBeVisible();
      if(width===390) {
        const tableRegion=page.getByRole('region',{name:'Báo cáo bài thi',exact:true});
        expect(await tableRegion.evaluate(node=>node.scrollWidth>node.clientWidth)).toBe(true);
        await expect(tableRegion.getByRole('row').nth(1).getByRole('cell').nth(1)).toHaveCSS('white-space','nowrap');
      }
      await expect(page.getByRole('search',{name:'Bộ lọc báo cáo'})).not.toHaveClass(/ui-card/);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await page.locator('h1').evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(28);
    await expect(page.locator('.sidebar')).toHaveCSS('background-color','rgb(0, 109, 119)');
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo(0,0);});
    await page.screenshot({path:`artifacts/admin-analytics-redesign/${path==='/admin'?'dashboard':'reports'}-${width}-${theme}.png`,fullPage:true,animations:'disabled',style:'nextjs-portal{display:none!important}'});
    if(width===1440) await page.screenshot({path:`artifacts/admin-analytics-redesign/${path==='/admin'?'dashboard':'reports'}-viewport-${theme}.png`,style:'nextjs-portal{display:none!important}'});
  }
  expect(pageErrors).toEqual([]);
});

test('Admin missing history uses operational data; missing totals never become row-count KPIs',async({page})=>{
  const {dashboard,state}=await setup(page); state.data.results=state.data.results.slice(0,2);
  dashboard.missingTotals=true;
  await page.goto('/admin');
  await expect(page.getByRole('region',{name:'Hoạt động hệ thống'})).toContainText('Chưa có đủ dữ liệu theo ngày');
  await expect(page.getByRole('region',{name:'Hoạt động hệ thống'})).toContainText('Cơ sở dữ liệu');
  await expect(page.getByRole('group',{name:'Bài đã nộp',exact:true})).toHaveCount(0);
  const kpis=page.getByLabel('Chỉ số tổng quan');
  await expect(kpis.locator('article')).toHaveCount(1);
  await expect(kpis).toContainText('Lớp học');
  await expect(page.getByRole('region',{name:'Phân bố người dùng'}).getByRole('alert')).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/PRIVATE_SQL_ERROR|NaN|Infinity/);
  dashboard.missingTotals=false;
  await page.getByRole('button',{name:'Làm mới',exact:true}).click();
  await expect(kpis.locator('article')).toHaveCount(4);
});

test('Admin report filters preserve URL, use supported fields, and export the applied exam',async({page})=>{
  const {state}=await setup(page);
  await page.goto('/dashboard/reports');
  await expect(page.getByRole('region',{name:'Báo cáo bài thi',exact:true}).getByRole('table')).toBeVisible();
  await page.getByRole('combobox',{name:'Đề thi',exact:true}).selectOption('exam-1');
  await expect(page.getByRole('region',{name:'Báo cáo bài thi',exact:true}).getByRole('table').getByRole('row')).toHaveCount(3);
  await expect(page).toHaveURL(/exam_id=exam-1/);
  await page.getByRole('combobox',{name:'Sắp xếp',exact:true}).selectOption('score_desc');
  await expect.poll(()=>state.requests.at(-1)?.get('sort')).toBe('score_desc');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Xuất CSV',exact:true}).click();
  expect((await pending).suggestedFilename()).toBe('bao-cao-exam-1.csv');
  expect(state.requests.at(-1)?.get('exam_id')).toBe('exam-1');
  await page.reload(); await expect(page.getByRole('combobox',{name:'Đề thi',exact:true})).toHaveValue('exam-1');
  await expect(page.locator('main input[type="date"]')).toHaveCount(0);
});
