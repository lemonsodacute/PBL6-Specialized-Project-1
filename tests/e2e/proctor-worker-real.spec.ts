import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const bundle = process.env.PROCTOR_WORKER_QA_BUNDLE;
const camera = process.env.PROCTOR_WORKER_QA_CAMERA;
const enabled = Boolean(bundle && camera && process.env.PROCTOR_WORKER_QA === '1');
const front = 'http://localhost:3100', api = 'http://localhost:8001/api/v1';
test.skip(!enabled, 'Requires a fresh isolated PostgreSQL QA fixture, loopback worker and prerecorded QA camera');
test.use({ trace:'off', launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  '--use-file-for-fake-video-capture=' + camera] } });

test('sampled browser camera produces protected real worker events in the teacher console', async ({ browser, request }) => {
  test.setTimeout(150000);
  const f = JSON.parse(fs.readFileSync(path.resolve('backend/private/release-qa/proctor-fixture.json'), 'utf8'));
  const headers = (role: string) => ({ Authorization: 'Bearer ' + f.actors[role].access_token });
  const exam = '/proctoring/exams/' + f.exam_id, base = '/proctoring/sessions/' + f.attempt_id;
  const frame = { frame: { name:'bad.jpg', mimeType:'image/jpeg', buffer: Buffer.from('invalid') } };
  expect((await request.post(api + base + '/frame', { multipart: frame })).status()).toBe(401);
  expect((await request.post(api + '/proctoring/sessions/' + randomUUID() + '/frame', { headers:headers('student'), multipart:frame })).status()).toBe(403);
  expect((await request.post(api + '/proctoring/events', { headers:headers('student'), data:{event_type:'object_phone',severity:'high',confidence:1} })).status()).toBe(401);

  async function signedIn(role: string) {
    const context = await browser.newContext({ permissions:['camera','local-network-access'] });
    const { access_token, ...user } = f.actors[role];
    await context.addCookies([{name:'auth_token',value:access_token,url:front,httpOnly:true,sameSite:'Lax'}]);
    await context.addInitScript(({user, token}) => {
      sessionStorage.setItem('ai-proctoring-current-user', JSON.stringify(user));
      sessionStorage.setItem('ai-proctoring-access-token', token);
    }, { user, token:access_token });
    return context;
  }
  const teacher = await signedIn('teacher'), student = await signedIn('student');
  try {
    const page: Page = await teacher.newPage();
    const events: string[] = [];
    page.on('websocket', ws => {
      if (ws.url().includes('/proctoring/ws')) ws.on('framereceived', ({payload}) => {
        const msg=JSON.parse(String(payload));
        if (msg.type === 'proctor_event_created') events.push(msg.data.id);
      });
    });
    await page.goto(front+'/dashboard/monitor/'+f.exam_id);
    await expect(page.getByText('Realtime đã kết nối',{exact:true})).toBeVisible({timeout:90000});
    const initial = await (await request.get(api + exam + '/events',{headers:headers('teacher')})).json();
    expect(initial.data).toHaveLength(0);
    // Serve only the QA capture page. All backend requests and the teacher page use real services.
    const capture = await student.newPage();
    let accepted=0;
    capture.on('response', async res => {
      if (res.url().endsWith(base+'/frame') && res.ok()) {
        try { if ((await res.json()).data.processed) accepted++; } catch { /* Page closed. */ }
      }
    });
    await capture.route(front+'/__qa_camera', route => route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
    await capture.goto(front+'/__qa_camera#'+f.attempt_id);
    await capture.addScriptTag({path:bundle!});
    await capture.getByRole('button',{name:'Start QA camera'}).click();
    await expect.poll(() => accepted,{timeout:45000}).toBeGreaterThanOrEqual(2);
    const phone = page.locator('[data-proctor-event]').filter({hasText:'Phát hiện điện thoại'}).first();
    await expect(phone).toBeVisible({timeout:45000});
    const id = (await phone.getAttribute('data-proctor-event'))!;
    await expect.poll(() => events.includes(id)).toBe(true);
    await capture.close();
    const detail = async () => (await (await request.get(api+'/proctoring/events/'+id,{headers:headers('teacher')})).json()).data;
    const event = await detail();
    expect(event.provider).toBe('local_yolo');
    expect(event.is_simulated).toBe(false);
    expect(event.event_type).toBe('object_phone');
    expect(event.metadata.frame_count).toBeGreaterThan(1);
    expect(event.evidence.bounding_boxes.length).toBeGreaterThan(0);
    expect((await request.get(api+'/proctoring/events/'+id,{headers:headers('student')})).status()).toBe(403);
    const notes = await (await request.get(api+'/notifications',{headers:headers('teacher')})).json();
    expect(notes.data.some((n: {related_proctor_event_id:string}) => n.related_proctor_event_id===id)).toBe(true);
    for (const status of ['CONFIRMED','DISMISSED']) {
      const reviewed = await request.patch(api+'/proctoring/events/'+id+'/review',{headers:headers('teacher'),
        data:{status,expected_version:(await detail()).review_version}});
      expect(reviewed.ok()).toBe(true);
    }
    const timeline = await (await request.get(api+'/proctoring/attempts/'+f.attempt_id+'/timeline',{headers:headers('teacher')})).json();
    expect(timeline.data.entries.some((e: {event?:{id:string}}) => e.event?.id===id)).toBe(true);
    const submitted = await request.post(api+'/attempts/'+f.attempt_id+'/submit',{headers:headers('student')});
    expect(submitted.ok()).toBe(true);
    await page.goto(front+'/dashboard/monitor/'+f.exam_id+'?view=report');
    await expect(page.getByRole('heading',{name:'Báo cáo giám sát'})).toBeVisible();
    await expect(page.getByText('Phát hiện điện thoại',{exact:true}).first()).toBeVisible();
    const report = await (await request.get(api+exam+'/report',{headers:headers('teacher')})).json();
    expect(report.data.summary.dismissed).toBeGreaterThan(0);
    console.log('Real phone event',id,'confirmed after',event.metadata.frame_count,'observations');
  } finally {
    await student.close();
    await teacher.close();
  }
});
