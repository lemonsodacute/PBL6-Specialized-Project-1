import { expect, test, type Page, type Route } from '@playwright/test';
import { uiSession } from './ui-fixtures';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });
declare global {
  interface Window {
    examMediaAudit: { tracks: MediaStreamTrack[]; requests: MediaStreamConstraints[]; denied: string; wait: boolean; release: (() => void) | null };
  }
}
const attemptId = 'attempt-ux', examId = 'exam-ux';
const attemptPath = `/student/attempts/${attemptId}`, resultPath = `${attemptPath}/result`;
async function respond(route: Route, json: unknown, status = 200) {
  const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3100', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS' };
  return route.fulfill({ status: route.request().method() === 'OPTIONS' ? 204 : status, headers, ...(route.request().method() === 'OPTIONS' ? {} : { json }) });
}

async function setup(page: Page, devices = true, requireFullscreen = false) {
  await uiSession(page);
  await page.routeWebSocket('**/api/v1/ws/call/**', () => {});
  const questions = [0, 1].map(index => ({ id: `question-${index}`, content: `Câu hỏi ${index + 1}`, type: 'mcq_single', options_json: { options: ['A', 'B'] }, default_points: 1, topic: 'HTML' }));
  const state = { status: 'in_progress', submits: 0, submitStatus: 200, submitCode: '', calls: [] as { path: string; method: string }[], answers: [] as { question_id: string; answer_content: string }[], submitGate: null as Promise<void> | null, saveGate: null as Promise<void> | null, locked: false, deadline: new Date(Date.now() + 3_600_000).toISOString() };
  const attempt = () => ({ id: attemptId, exam_id: examId, status: state.status, remaining_seconds: 3600, started_at: new Date().toISOString(), server_deadline_at: state.deadline, questions, answers: state.answers });
  await page.route('**/api/v1/identity/exams/exam-ux/verify-entry', route => respond(route, { data: { id: 'entry-ux', verified: true, status: 'verified', threshold: .363 } }));
  await page.route('**/api/v1/attempts', route => respond(route, { data: attempt() }));
  await page.route('**/api/v1/exams/exam-ux', route => respond(route, { data: { id: examId, title: 'Bài thi kiểm tra trải nghiệm', duration_minutes: 60, require_camera: devices, require_mic: devices, require_fullscreen: requireFullscreen } }));
  await page.route('**/api/v1/attempts/attempt-ux**', async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method();
    if (method === 'OPTIONS') return respond(route, {});
    state.calls.push({ path, method });
    if (path.endsWith('/submit')) {
      state.submits++; if (state.submitGate) await state.submitGate;
      if (state.submitStatus !== 200) return respond(route, { error: { code: state.submitCode, message: 'Internal error must not reach UI' } }, state.submitStatus);
      state.status = 'submitted'; return respond(route, { data: attempt() });
    }
    if (path.endsWith('/answers')) {
      if (state.saveGate) await state.saveGate;
      state.answers.push(route.request().postDataJSON()); return respond(route, { data: { saved_at: new Date().toISOString() } });
    }
    if (path.endsWith('/violations')) return respond(route, { data: { locked: state.locked } });
    if (path.endsWith('/result')) {
      if (state.status === 'in_progress') return respond(route, { error: { code: 'ATTEMPT_NOT_SUBMITTED', message: 'Not submitted' } }, 409);
      return respond(route, { data: { id: attemptId, exam_id: examId, exam_title: 'Bài thi kiểm tra trải nghiệm', status: state.status, score: 1, max_score: 2, submitted_at: new Date().toISOString(), started_at: new Date().toISOString(), show_answers: false,
        questions: questions.map((question, index) => ({ ...question, question_id: question.id, order_index: index, student_answer: index ? null : 'A', is_correct: !index, points_awarded: index ? 0 : 1, points: 1, explanation: null })) } });
    }
    return respond(route, { data: attempt() });
  });
  await page.route('**/api/v1/proctoring/**', route => respond(route, { data: {} }));
  await page.addInitScript(() => {
    window.examMediaAudit = { tracks: [], requests: [], denied: '', wait: false, release: null };
    // Use real MediaStreamTracks with deterministic sources: Chrome's native fake
    // camera can disconnect intermittently on Windows, independent of the UI.
    const videoSource = () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 640, height: 480 });
      const context = canvas.getContext('2d')!;
      const stream = canvas.captureStream(10);
      const draw = () => { context.fillStyle = '#243746'; context.fillRect(0, 0, 640, 480); };
      draw(); const timer = setInterval(draw, 100);
      const [track] = stream.getVideoTracks(), stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); stop(); };
      return stream;
    };
    const audioSource = () => {
      const context = new AudioContext(), stream = context.createMediaStreamDestination().stream;
      const [track] = stream.getAudioTracks(), stop = track.stop.bind(track);
      track.stop = () => { stop(); if (context.state !== 'closed') void context.close().catch(() => undefined); };
      return stream;
    };
    navigator.mediaDevices.getUserMedia = async (constraints = {}) => {
      const audit = window.examMediaAudit; audit.requests.push(constraints);
      const kind = constraints.video ? 'video' : 'audio';
      if (audit.denied === kind) throw new DOMException('Synthetic technical getUserMedia error', 'NotAllowedError');
      const stream = kind === 'video' ? videoSource() : audioSource();
      stream.getTracks().forEach(track => {
        audit.tracks.push(track);
        const source = track.getSettings.bind(track), config = kind === 'video' ? constraints.video : constraints.audio;
        const requested = config && typeof config === 'object' && config.deviceId && typeof config.deviceId === 'object' ? (config.deviceId as ConstrainDOMStringParameters).exact : '';
        track.getSettings = () => ({ ...source(), deviceId: typeof requested === 'string' ? requested || `${kind}-one` : `${kind}-one` });
      });
      if (audit.wait) await new Promise<void>(resolve => { audit.release = resolve; });
      return stream;
    };
    navigator.mediaDevices.enumerateDevices = async () => [
      { deviceId: 'video-one', kind: 'videoinput', label: 'Integrated Camera' }, { deviceId: 'video-two', kind: 'videoinput', label: 'USB Camera' },
      { deviceId: 'audio-one', kind: 'audioinput', label: 'Microphone Array' }, { deviceId: 'audio-two', kind: 'audioinput', label: 'USB Microphone' },
    ].map(value => ({ ...value, groupId: '', toJSON: () => value })) as MediaDeviceInfo[];
    AnalyserNode.prototype.getByteTimeDomainData = values => values.fill(128);
  });
  return state;
}
async function enter(page: Page) {
  await page.goto(attemptPath);
  const dialog = page.getByRole('dialog', { name: 'Cài đặt thiết bị trước khi thi' });
  await expect(dialog.getByRole('button', { name: 'Vào phòng thi' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await expect(dialog.getByText('Camera đã sẵn sàng', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Microphone đã sẵn sàng', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
  await dialog.getByRole('button', { name: 'Vào phòng thi' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Thiết bị giám sát', exact: true })).toBeVisible();
}
async function submit(page: Page) {
  await page.getByRole('button', { name: 'Nộp bài', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận nộp bài', exact: true }).click();
}
async function stopped(page: Page) {
  await expect.poll(() => page.evaluate(() => window.examMediaAudit.tracks.every(track => track.readyState === 'ended'))).toBe(true);
}

test('silent microphone permits entry and selecting IDs never stops the current stream', async ({ page }) => {
  await setup(page); await enter(page);
  const streamTracks=await page.locator('.proctor-stream-hidden').evaluate(video=>(video as HTMLVideoElement).srcObject instanceof MediaStream?((video as HTMLVideoElement).srcObject as MediaStream).getTracks().map(track=>track.id):[]);
  await expect.poll(() => page.evaluate(() => window.examMediaAudit.tracks.filter(track => track.readyState === 'live').length)).toBe(2);
  await page.getByRole('button', { name: 'Cài đặt thiết bị', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Cài đặt thiết bị', exact: true });
  await expect(dialog.getByRole('button', { name: 'Áp dụng' })).toBeEnabled();
  await expect(dialog.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
  await dialog.getByRole('button', { name: 'Áp dụng' }).click();
  expect(streamTracks).toHaveLength(2);
  await expect.poll(()=>page.locator('.proctor-stream-hidden').evaluate(video=>((video as HTMLVideoElement).srcObject as MediaStream).getTracks().filter(track=>track.readyState==='live').map(track=>track.id))).toEqual(streamTracks);
});

test('submit navigates without reload or waiting for a hanging fullscreen exit and cleans listeners', async ({ page }) => {
  const state = await setup(page); await enter(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.documentElement });
    document.exitFullscreen = () => new Promise<void>(() => {});
  });
  await submit(page);
  await expect(page).toHaveURL(new RegExp(`${resultPath}$`), { timeout: 7000 });
  await expect(page.getByRole('heading',{name:'Bài thi kiểm tra trải nghiệm',exact:true})).toBeVisible();
  expect(state.submits).toBe(1); await stopped(page);
  const count = state.calls.length;
  await page.evaluate(() => { document.dispatchEvent(new Event('copy')); document.dispatchEvent(new Event('paste')); window.dispatchEvent(new Event('blur')); document.dispatchEvent(new Event('fullscreenchange')); });
  expect(state.calls.length).toBe(count);
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').map(item => (item as PerformanceNavigationTiming).type))).toEqual(['navigate']);
  await page.goBack();
  await expect(page).not.toHaveURL(new RegExp(`${attemptPath}$`));
});

test('pending answer completes before one submit and double clicks cannot duplicate submission', async ({ page }) => {
  const state = await setup(page, false); await page.goto(attemptPath);
  let releaseSave!: () => void, releaseSubmit!: () => void;
  state.saveGate = new Promise(resolve => { releaseSave = resolve; }); state.submitGate = new Promise(resolve => { releaseSubmit = resolve; });
  await page.locator('.answer-option').first().click();
  await expect.poll(() => state.calls.filter(call => call.path.endsWith('/answers')).length).toBe(1);
  await submit(page); await expect(page.getByRole('button', { name: 'Đang nộp...', exact: true })).toBeDisabled();
  expect(state.submits).toBe(0); releaseSave();
  await expect.poll(() => state.submits).toBe(1); releaseSubmit();
  await expect(page).toHaveURL(new RegExp(`${resultPath}$`)); expect(state.answers[0].answer_content).toBe('A'); expect(state.submits).toBe(1);
});

for (const status of ['submitted', 'auto_submitted', 'terminated']) {
  test(`${status} attempts opened directly or reloaded skip media setup and redirect`, async ({ page }) => {
    const state = await setup(page); state.status = status;
    await page.goto(attemptPath); await expect(page).toHaveURL(new RegExp(`${resultPath}$`));
    await page.goto(attemptPath); await expect(page).toHaveURL(new RegExp(`${resultPath}$`));
    expect(await page.evaluate(() => window.examMediaAudit.requests.length)).toBe(0);
    await expect(page.getByRole('dialog', { name: 'Cài đặt thiết bị trước khi thi' })).toHaveCount(0);
  });
}

test('submit failure keeps media and retry available; generic conflicts are not treated as success', async ({ page }) => {
  const state = await setup(page); await enter(page); state.submitStatus = 409; state.submitCode = 'SYNTHETIC_CONFLICT';
  await submit(page); await expect(page.getByRole('button', { name: 'Thử lại', exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${attemptPath}$`));
  expect(await page.evaluate(() => window.examMediaAudit.tracks.filter(track => track.readyState === 'live').length)).toBe(2);
  await expect(page.getByText('Internal error must not reach UI', { exact: false })).toHaveCount(0);
  state.submitStatus = 200; await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${resultPath}$`)); await stopped(page);
});

test('HTTP success with an in-progress status never invents a submitted attempt',async({page})=>{
  await setup(page,false);
  await page.route('**/api/v1/attempts/attempt-ux/submit',route=>respond(route,{data:{id:attemptId,exam_id:examId,status:'in_progress'}}));
  await page.goto(attemptPath);await submit(page);
  await expect(page.getByRole('button',{name:'Thử lại',exact:true})).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${attemptPath}$`));
});

test('camera and microphone permissions show separate friendly errors with retry', async ({ page }) => {
  await setup(page); await page.goto(attemptPath);
  await page.evaluate(() => { window.examMediaAudit.denied = 'audio'; });
  const dialog = page.getByRole('dialog', { name: 'Cài đặt thiết bị trước khi thi' });
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await expect(dialog.getByText('Camera đã sẵn sàng', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Chưa thể truy cập microphone. Vui lòng cấp quyền microphone trong trình duyệt.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Vào phòng thi' })).toBeDisabled();
  await page.evaluate(() => { window.examMediaAudit.denied = 'video'; });
  await dialog.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(dialog.getByText('Chưa thể truy cập camera. Vui lòng cấp quyền camera trong trình duyệt.', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Microphone đã sẵn sàng', { exact: true })).toBeVisible();
  await page.evaluate(() => { window.examMediaAudit.denied = ''; });
  await dialog.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Vào phòng thi' })).toBeEnabled();
  await expect(dialog.getByText('Synthetic technical getUserMedia error', { exact: false })).toHaveCount(0);
});

test('device switching stops old tracks and shares one replacement stream with every preview', async ({ page }) => {
  await setup(page); await enter(page);
  await page.getByRole('button', { name: 'Cài đặt thiết bị', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Cài đặt thiết bị', exact: true });
  await dialog.getByRole('combobox', { name: 'Camera', exact: true }).selectOption('video-two');
  await expect(dialog.getByRole('button', { name: 'Áp dụng' })).toBeEnabled();
  await dialog.getByRole('combobox', { name: 'Microphone', exact: true }).selectOption('audio-two');
  await expect(dialog.getByRole('button', { name: 'Áp dụng' })).toBeEnabled();
  const tracks = await page.evaluate(() => window.examMediaAudit.tracks.map(track => ({ state: track.readyState, kind: track.kind, id: track.getSettings().deviceId })));
  expect(tracks).toHaveLength(6); expect(tracks.slice(0, 4).every(track => track.state === 'ended')).toBe(true);
  expect(tracks.slice(4).map(track => track.id)).toEqual(['video-two', 'audio-two']);
  expect(await page.evaluate(() => Array.from(document.querySelectorAll<HTMLVideoElement>('.proctor-stream-hidden, .floating-camera video, .exam-device-preview video')).every(video => video.srcObject === document.querySelector<HTMLVideoElement>('.proctor-stream-hidden')?.srcObject))).toBe(true);
});

test('exit during a pending permission request stops tracks returned after unmount', async ({ page }) => {
  await setup(page); await page.goto(attemptPath); await page.evaluate(() => { window.examMediaAudit.wait = true; });
  await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.examMediaAudit.tracks.length)).toBe(1);
  // Exercise an external SPA navigation while the permission modal is blocking input.
  await page.getByRole('link', { name: 'Trang chủ', exact: true }).dispatchEvent('click');
  await expect(page).toHaveURL(/\/student$/);
  await page.evaluate(() => { window.examMediaAudit.release?.(); }); await stopped(page);
  expect(await page.evaluate(() => window.examMediaAudit.requests.length)).toBe(1);
});

test('server termination while open redirects and stops media', async ({ page }) => {
  const state = await setup(page); await enter(page); state.status = 'terminated';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page).toHaveURL(new RegExp(`${resultPath}$`)); await stopped(page); expect(state.submits).toBe(0);
});

test('timer auto-submits through the same cleanup and navigation path', async ({ page }) => {
  const state = await setup(page, false); state.deadline = new Date(Date.now() + 1500).toISOString();
  await page.goto(attemptPath); await expect(page).toHaveURL(new RegExp(`${resultPath}$`), { timeout: 9000 }); expect(state.submits).toBe(1);
});

for (const width of [320, 375, 768, 1024, 1440]) {
  test(`floating widget fits ${width}px and avoids exam controls`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width <= 375 ? 650 : 900 }); await setup(page); await enter(page);
    const widget = page.getByRole('region', { name: 'Thiết bị giám sát', exact: true });
    await expect.poll(async () => {
      const rect = (await widget.boundingBox())!;
      return rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= page.viewportSize()!.height;
    }).toBe(true);
    if (width < 768) await expect(page.getByRole('button', { name: 'Mở rộng camera giám sát' })).toBeVisible();
    const overlap = await widget.evaluate(element => {
      const a = element.getBoundingClientRect();
      return Array.from(document.querySelectorAll('[data-camera-avoid]')).some(item => { const b = item.getBoundingClientRect(); return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; });
    });
    expect(overlap).toBe(false); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`exam-${width}.png`) });
  });
}

test('desktop dragging, collapse, question navigation and stored position preserve active tracks', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await setup(page); await enter(page);
  const widget = page.getByRole('region', { name: 'Thiết bị giám sát', exact: true }), handle = widget.locator('.floating-camera-handle');
  const before = (await widget.boundingBox())!, start = (await handle.boundingBox())!;
  await page.mouse.move(start.x + 70, start.y + 20); await page.mouse.down(); await page.mouse.move(start.x - 110, start.y - 90, { steps: 8 }); await page.mouse.up();
  const moved = (await widget.boundingBox())!; expect(moved.x).not.toBe(before.x);
  await page.getByRole('button', { name: 'Câu tiếp theo', exact: true }).click();
  expect((await widget.boundingBox())!.x).toBe(moved.x);
  await page.getByRole('button', { name: 'Thu nhỏ camera giám sát' }).click();
  await expect(widget.locator('video')).toHaveCount(0);
  expect(await page.evaluate(() => window.examMediaAudit.tracks.filter(track => track.readyState === 'live').length)).toBe(2);
  await page.getByRole('button', { name: 'Mở rộng camera giám sát' }).click();
  await expect(widget.locator('video')).toBeVisible();
  await handle.focus(); await page.keyboard.press('ArrowRight');
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ai-procto-camera:attempt-ux')!)); expect(saved.x).toBeGreaterThan(moved.x);
  await page.getByRole('link', { name: 'Trang chủ', exact: true }).click(); await stopped(page);
  await enter(page); await expect.poll(async () => (await widget.boundingBox())!.x).toBe(saved.x);
});

for (const width of [360, 390, 430, 820, 1024]) test(`polish: camera leaves navigation and submit clear at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 640 }); await setup(page); await enter(page);
  await expect(page.locator('.sidebar a[href="/student/exams"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.sidebar .student-nav-group')).toHaveAttribute('aria-expanded', 'true');
  const widget = page.getByRole('region', { name: 'Thiết bị giám sát', exact: true });
  const clear = async () => {
    await expect(widget).toBeVisible();
    await expect.poll(() => widget.evaluate(node => {
      const a = node.getBoundingClientRect();
      return Array.from(document.querySelectorAll<HTMLElement>('[data-camera-avoid], .question-index-list, .topbar, .sidebar')).filter(element => {
        if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') return false;
        const b = element.getBoundingClientRect(); return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      }).map(element => element.className);
    })).toEqual([]);
  };
  for (const top of [0, 200, 10000, 0]) {
    await page.evaluate(y => scrollTo(0, y), top); await clear();
  }
  await page.getByRole('button', { name: /^(Mở rộng|Thu nhỏ) camera giám sát$/ }).click();
  await clear();
  await page.screenshot({ path: info.outputPath(`camera-polish-${width}.png`) });
  expect(await page.evaluate(() => window.examMediaAudit.tracks.filter(track => track.readyState === 'live').length)).toBe(2);
});

test('first fullscreen prompt is a requirement, while exit after entry is a violation', async ({ page }) => {
  const state=await setup(page, false, true);
  await page.addInitScript(() => {
    let full = false;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full ? document.documentElement : null });
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: async function () { full = true; document.dispatchEvent(new Event('fullscreenchange')); }
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: async () => { full = false; document.dispatchEvent(new Event('fullscreenchange')); }
    });
  });
  await page.goto(attemptPath);
  const prompt=page.getByRole('dialog', { name: 'Bài thi yêu cầu chế độ toàn màn hình' });
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Để bắt đầu làm bài');
  expect(state.calls.filter(call=>call.path.endsWith('/violations'))).toHaveLength(0);
  await prompt.getByRole('button',{name:'Vào chế độ toàn màn hình',exact:true}).click();
  await expect(prompt).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>Boolean(document.fullscreenElement))).toBe(true);
  expect(state.calls.filter(call=>call.path.endsWith('/violations'))).toHaveLength(0);
  await page.evaluate(()=>document.exitFullscreen());
  const exitPrompt=page.getByRole('dialog',{name:'Bạn đã thoát chế độ toàn màn hình'});
  await expect(exitPrompt).toBeVisible();
  await expect(exitPrompt.getByRole('button',{name:'Vào lại chế độ toàn màn hình'})).toBeVisible();
  await expect.poll(()=>state.calls.filter(call=>call.path.endsWith('/violations')).length).toBe(1);
  await exitPrompt.getByRole('button',{name:'Vào lại chế độ toàn màn hình'}).click();
  await expect(exitPrompt).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>Boolean(document.fullscreenElement))).toBe(true);
  expect(state.calls.filter(call=>call.path.endsWith('/violations'))).toHaveLength(1);
});

test('device entry shows initial fullscreen requirement only after preflight, not an exit warning', async ({ page }) => {
  await setup(page, true, true);
  await page.goto(attemptPath);
  const devices=page.getByRole('dialog',{name:'Cài đặt thiết bị trước khi thi'});
  await expect(devices).toBeVisible();
  await expect(page.locator('.fullscreen-overlay')).toHaveCount(0);
  await devices.getByRole('button',{name:'Tiếp tục',exact:true}).click();
  await devices.getByRole('button',{name:'Vào phòng thi'}).click();
  await expect(devices).toHaveCount(0);
  const prompt=page.getByRole('dialog',{name:'Bài thi yêu cầu chế độ toàn màn hình'});
  await expect(prompt).toBeVisible();
  await expect(page.getByRole('dialog',{name:'Bạn đã thoát chế độ toàn màn hình'})).toHaveCount(0);
});
