import { test, expect as baseExpect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

type Actor = { token: string; user: { id: string; full_name: string; email: string; role: string } };
type Fixture = { teacher: Actor; student: Actor; second: Actor; outsider: Actor; other: Actor; class_id: string; other_class_id: string };
const backend = process.env.CLASSROOM_API_URL || 'http://localhost:8000/api/v1';
let fixture: Fixture;
const expect = baseExpect.configure({ timeout: 15000 });
test.use({ trace: 'off', launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });
const headers = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });
async function signIn(context: BrowserContext, actor: Actor, denied = false, delay = 0, denyPublish = false) {
  context.on('page', page => page.on('console', message => {
    if (message.text().startsWith('[classroom]')) console.info(actor.user.role, message.text());
    if (process.env.CLASSROOM_DIAGNOSTICS === '1' && message.text().startsWith('[qa-rtc]')) console.info(actor.user.role, message.text());
  }));
  if (process.env.CLASSROOM_DIAGNOSTICS === '1') await context.addInitScript(() => {
    const NativePeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        for (const event of ['connectionstatechange', 'iceconnectionstatechange']) {
          this.addEventListener(event, () => console.info('[qa-rtc]', this.connectionState, this.iceConnectionState));
        }
      }
    };
  });
  await context.addInitScript(({ user, token, denied, delay, denyPublish }) => {
    sessionStorage.setItem('ai-proctoring-current-user', JSON.stringify(user));
    sessionStorage.setItem('ai-proctoring-access-token', token);
    // Real MediaStreamTracks, deterministic sources. The SFU/ICE/WebRTC and
    // every API request remain real; Windows native fake cameras can stall on
    // the second capture after a device preview is stopped.
    const getMedia = async (constraints: MediaStreamConstraints = {}) => {
      const stream = new MediaStream();
      if (constraints.video) {
        const canvas = Object.assign(document.createElement('canvas'), { width: 640, height: 480 });
        const drawing = canvas.getContext('2d')!;
        const draw = () => { drawing.fillStyle = '#006D77'; drawing.fillRect(0, 0, 640, 480); drawing.fillStyle = 'white'; drawing.fillText(String(Date.now()), 30, 30); };
        draw(); const timer = window.setInterval(draw, 100);
        const [track] = canvas.captureStream(10).getVideoTracks();
        const stop = track.stop.bind(track);
        track.stop = () => { window.clearInterval(timer); stop(); };
        stream.addTrack(track);
      }
      if (constraints.audio) {
        const audio = new AudioContext(); await audio.resume();
        const destination = audio.createMediaStreamDestination();
        const oscillator = audio.createOscillator(), gain = audio.createGain();
        gain.gain.value = 0.01; oscillator.connect(gain).connect(destination); oscillator.start();
        const [track] = destination.stream.getAudioTracks();
        const stop = track.stop.bind(track);
        track.stop = () => { stop(); oscillator.stop(); if (audio.state !== 'closed') void audio.close().catch(() => undefined); };
        stream.addTrack(track);
      }
      return stream;
    };
    const tracks: MediaStreamTrack[] = [];
    const captures = { audio: 0, video: 0 };
    (window as unknown as { classroomTestTracks: MediaStreamTrack[] }).classroomTestTracks = tracks;
    navigator.mediaDevices.getUserMedia = async constraints => {
      const repeated = Boolean((constraints?.audio && ++captures.audio > 1) || (constraints?.video && ++captures.video > 1));
      if (denied || (denyPublish && repeated && constraints?.video)) throw new DOMException('Permission denied for test', 'NotAllowedError');
      const stream = await getMedia(constraints); tracks.push(...stream.getTracks());
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      return stream;
    };
    navigator.mediaDevices.getDisplayMedia = async () => {
      const stream = await getMedia({ video: true }); tracks.push(...stream.getTracks()); return stream;
    };
  }, { ...actor, denied, delay, denyPublish });
}
async function createSession(request: APIRequestContext, title: string) {
  const response = await request.post(`${backend}/live-classes`, { headers: headers(fixture.teacher), data: { class_id: fixture.class_id, title, description: 'Real SFU integration test', scheduled_start: new Date().toISOString(), scheduled_end: new Date(Date.now() + 3600000).toISOString() } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).data.id as string;
}
async function start(request: APIRequestContext, id: string) { const response = await request.post(`${backend}/live-classes/${id}/start`, { headers: headers(fixture.teacher) }); expect(response.ok(), await response.text()).toBeTruthy(); }
async function enter(page: Page, id: string, devicesOff = false) {
  await page.bringToFront();
  await page.goto(`/live-class/${id}`);
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await expect(page.getByRole('heading', { name: 'Cài đặt thiết bị' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Camera hoạt động' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Microphone hoạt động' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vào phòng', exact: true })).toBeEnabled();
  if (devicesOff) {
    await page.getByRole('button', { name: 'Tắt camera', exact: true }).click();
    await page.getByRole('button', { name: 'Tắt mic', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Vào phòng', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Đã kết nối' })).toBeVisible({ timeout: 25000 });
  const role = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ai-proctoring-current-user')!).role as string);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-role', role);
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.locator('.meeting-context')).toContainText(role === 'student' ? 'Khu vực sinh viên' : 'Khu vực giảng dạy');
  const room = (await page.locator('.classroom-meeting-page').boundingBox())!;
  expect(room.x).toBe(0); expect(room.y).toBe(0);
  expect(room.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
}
async function allTracksStopped(page: Page) { return page.evaluate(() => (window as unknown as { classroomTestTracks: MediaStreamTrack[] }).classroomTestTracks.every(t => t.readyState === 'ended')); }

test.describe('Online classroom over a real LiveKit SFU', () => {
  test.skip(process.env.CLASSROOM_REAL_E2E !== '1', 'Opt-in real SFU tests: seed the private fixture and start FastAPI + LiveKit.');
  test.beforeEach(() => {
    const fixturePath = path.resolve(process.env.CLASSROOM_FIXTURE_PATH || 'backend/private/classroom-e2e.json');
    const backendPath = path.resolve('backend');
    const python = path.join(backendPath, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    // These long media checks must not reuse an access token from a previous
    // rehearsal. Refresh fixture credentials privately; API/SFU calls stay real.
    const refreshArgs = process.env.CLASSROOM_RELEASE_QA === '1'
      ? ['scripts/release_qa_runtime.py', 'run', '--', 'python', '-m', 'scripts.classroom_e2e_fixture', '--refresh']
      : ['-m', 'scripts.classroom_e2e_fixture', '--refresh'];
    execFileSync(python, refreshArgs,
      { cwd: backendPath, env: { ...process.env, CLASSROOM_FIXTURE_PATH: fixturePath }, stdio: 'pipe', timeout: 30000 });
    fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  });

  test('actual video/audio, participants, track controls, chat, refresh, end and attendance', async ({ browser, request }) => {
    test.setTimeout(300000);
    const id = await createSession(request, 'E2E Classroom media and closure');
    const teacherContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const studentContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const secondContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
    await signIn(teacherContext, fixture.teacher); await signIn(studentContext, fixture.student); await signIn(secondContext, fixture.second);
    const teacher = await teacherContext.newPage(); const student = await studentContext.newPage(); const second = await secondContext.newPage();
    try {
      await start(request, id);
      const concurrentTokens = await Promise.all(Array.from({ length: 8 }, () => request.post(`${backend}/live-classes/${id}/token`, { headers: headers(fixture.student) })));
      for (const response of concurrentTokens) expect(response.status()).toBe(200);
      const teacherToken = teacher.waitForResponse(response => response.url().endsWith(`/live-classes/${id}/token`));
      await enter(teacher, id);
      expect((await teacherToken).status()).toBe(200);
      const teacherRoom = (await (await teacherToken).json()).data.room_name;
      expect(teacherRoom).toBe(`classroom-${id}`);
      await expect(teacher.getByText('1 người đang tham gia', { exact: true })).toBeVisible();
      await expect(teacher.locator(`[data-participant-id="${fixture.teacher.user.id}"]`)).toHaveCount(1);
      const studentToken = student.waitForResponse(response => response.url().endsWith(`/live-classes/${id}/token`));
      await enter(student, id);
      expect((await studentToken).status()).toBe(200);
      expect((await (await studentToken).json()).data.room_name).toBe(teacherRoom);
      await expect(teacher.getByText('2 người đang tham gia', { exact: true })).toBeVisible();
      const refreshedToken = teacher.waitForResponse(response => response.url().endsWith(`/live-classes/${id}/token`));
      await teacher.reload();
      await expect(teacher.getByRole('status').filter({ hasText: 'Đã kết nối' })).toBeVisible({ timeout: 25000 });
      expect((await refreshedToken).status()).toBe(200);
      expect((await (await refreshedToken).json()).data.room_name).toBe(teacherRoom);
      await expect(teacher.getByText('2 người đang tham gia', { exact: true })).toBeVisible();
      await expect(teacher.locator('.classroom-page')).toHaveAttribute('data-connection-state', 'CONNECTED');
      console.info('Classroom acceptance', { provider: 'livekit', token_endpoint_status: 200, session_status: 'ongoing', room_name: teacherRoom, server_url_configured: true, connection_state: 'CONNECTED', participants: 2, teacher_refresh_same_room: true });
      await enter(second, id, true);
      await expect(teacher.getByText('3 người đang tham gia', { exact: true })).toBeVisible();
      await expect(student.getByText('3 người đang tham gia', { exact: true })).toBeVisible();
      await expect(student.locator('.classroom-tile')).toHaveCount(3);
      await expect.poll(() => student.locator(`[data-participant-id="${fixture.teacher.user.id}"] video`).evaluate((video: HTMLVideoElement) => video.videoWidth > 0 && Boolean(video.srcObject))).toBeTruthy();
      await expect.poll(() => teacher.locator(`[data-audio-participant-id="${fixture.student.user.id}"] audio`).evaluate((audio: HTMLAudioElement) => Boolean(audio.srcObject) && !audio.paused)).toBeTruthy();
      await student.getByRole('button', { name: 'Tắt mic', exact: true }).click();
      await expect(teacher.locator(`[data-participant-id="${fixture.student.user.id}"] [aria-label="Mic tắt"]`)).toBeVisible();
      await student.getByRole('button', { name: 'Tắt camera', exact: true }).click();
      await expect(teacher.locator(`[data-participant-id="${fixture.student.user.id}"] .classroom-avatar`)).toBeVisible();
      await student.getByRole('button', { name: 'Bật camera', exact: true }).click();
      await student.getByRole('button', { name: 'Bật mic', exact: true }).click();
      await teacher.getByRole('button', { name: 'Chat', exact: true }).click();
      await student.getByRole('button', { name: 'Chat', exact: true }).click();
      await student.getByRole('textbox', { name: 'Tin nhắn', exact: true }).fill('Xin chào giảng viên');
      await student.getByRole('button', { name: 'Gửi', exact: true }).click();
      await expect(teacher.getByRole('log').getByText('Xin chào giảng viên', { exact: true })).toBeVisible();
      await teacher.getByRole('button', { name: /Người tham gia \(/ }).click();
      await teacher.screenshot({ path: path.join(process.env.CLASSROOM_SCREENSHOTS || 'C:/Users/MSI GAMING/AppData/Local/Temp/codex-classroom-review', 'teacher-room-desktop.png'), fullPage: true });
      await studentContext.setOffline(true);
      await expect(student.getByRole('button', { name: 'Rời phòng', exact: true })).toBeVisible();
      await studentContext.setOffline(false);
      await student.reload();
      await expect(student.getByRole('status').filter({ hasText: 'Đã kết nối' })).toBeVisible({ timeout: 25000 });
      await expect(teacher.getByText('3 người đang tham gia', { exact: true })).toBeVisible();
      await expect(student.locator('.classroom-tile')).toHaveCount(3);
      await expect(student.getByRole('button', { name: 'Kết thúc buổi', exact: true })).toHaveCount(0);
      await second.getByRole('button', { name: 'Rời phòng', exact: true }).click();
      await expect(second).toHaveURL(/\/student\/live-classes/); await expect.poll(() => allTracksStopped(second)).toBeTruthy();
      await expect(teacher.getByText('2 người đang tham gia', { exact: true })).toBeVisible();
      await teacher.getByRole('button', { name: 'Kết thúc buổi', exact: true }).click();
      await expect(teacher.getByRole('dialog', { name: 'Kết thúc buổi học?' })).toBeVisible();
      await teacher.getByRole('button', { name: 'Hủy', exact: true }).click();
      await expect(student).toHaveURL(new RegExp(`/live-class/${id}`));
      const oldTokenResponse = await request.post(`${backend}/live-classes/${id}/token`, { headers: headers(fixture.student) });
      const oldToken = (await oldTokenResponse.json()).data;
      await teacher.getByRole('button', { name: 'Kết thúc buổi', exact: true }).click();
      await teacher.getByRole('button', { name: 'Kết thúc buổi học', exact: true }).click();
      await expect(teacher).toHaveURL(/\/dashboard\/live-classes\?notice=ended/);
      await expect(student).toHaveURL(/\/student\/live-classes\?notice=ended/);
      await expect.poll(async () => {
        const stopped = await allTracksStopped(student);
        if (!stopped && process.env.CLASSROOM_DIAGNOSTICS === '1') console.info('Student live tracks after end', await student.evaluate(() => (window as unknown as { classroomTestTracks: MediaStreamTrack[] }).classroomTestTracks.filter(track => track.readyState === 'live').map(track => ({ kind: track.kind, enabled: track.enabled }))));
        return stopped;
      }).toBeTruthy();
      await expect.poll(() => allTracksStopped(teacher)).toBeTruthy();
      expect((await request.post(`${backend}/live-classes/${id}/token`, { headers: headers(fixture.student) })).status()).toBe(409);
      // Direct SDK attempt bypasses FastAPI using a still-valid pre-END token.
      await student.addScriptTag({ path: path.resolve('node_modules/livekit-client/dist/livekit-client.umd.js') });
      const staleJoinRejected = await student.evaluate(async token => {
        const sdk = (window as unknown as { LivekitClient: { Room: new () => { connect: (url: string, jwt: string) => Promise<void>; disconnect: () => Promise<void> } } }).LivekitClient;
        const room = new sdk.Room();
        try { await room.connect(token.url, token.token); return false; }
        catch { return true; }
        finally { await room.disconnect(); }
      }, oldToken);
      expect(staleJoinRejected).toBeTruthy();
      await teacher.goto(`/live-class/${id}`);
      await expect(teacher.getByRole('heading', { name: 'Buổi học đã kết thúc' })).toBeVisible();
      await expect(teacher.getByRole('heading', { name: 'Điểm danh buổi học' })).toBeVisible();
      const rows = (await (await request.get(`${backend}/live-classes/${id}/attendance`, { headers: headers(fixture.teacher) })).json()).data;
      expect(rows).toHaveLength(2); for (const row of rows) { expect(row.joined_at).toBeTruthy(); expect(row.left_at).toBeTruthy(); expect(row.duration_sec).toBeGreaterThanOrEqual(0); }
      await teacher.screenshot({ path: path.join(process.env.CLASSROOM_SCREENSHOTS || 'C:/Users/MSI GAMING/AppData/Local/Temp/codex-classroom-review', 'ended-attendance.png'), fullPage: true });
    } finally {
      await request.post(`${backend}/live-classes/${id}/end`, { headers: headers(fixture.teacher) }).catch(() => {});
      await teacherContext.close(); await studentContext.close(); await secondContext.close();
    }
  });

  test('three roles: admission, hand, reaction, screen share, host policy, mute and removal', async ({ browser, request }) => {
    test.setTimeout(240000);
    const id = await createSession(request, 'E2E upgraded classroom controls');
    const contexts = await Promise.all([fixture.teacher, fixture.student, fixture.second].map(async actor => { const context = await browser.newContext({ permissions: ['camera', 'microphone'] }); await signIn(context, actor); return context; }));
    const [teacher, student, second] = await Promise.all(contexts.map(context => context.newPage()));
    const policy = async (key: string, checked: boolean) => {
      await teacher.getByRole('button', { name: 'Điều khiển lớp học', exact: true }).click();
      const dialog = teacher.getByRole('dialog', { name: 'Điều khiển lớp học', exact: true });
      const updated = teacher.waitForResponse(response => response.url().endsWith(`/live-classes/${id}/policy`) && response.request().method() === 'POST');
      await dialog.getByRole('checkbox', { name: key, exact: true }).setChecked(checked);
      expect((await updated).status()).toBe(200);
      await expect(dialog.getByRole('checkbox', { name: key, exact: true })).toBeEnabled();
      await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    };
    try {
      await start(request, id); await enter(teacher, id);
      await policy('Phòng chờ', true);
      for (const page of [student, second]) {
        await page.goto(`/live-class/${id}`);
        await expect(page.getByRole('button', { name: 'Vào phòng', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: 'Vào phòng', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Đang chờ giảng viên cho vào lớp' })).toBeVisible();
        await expect(page.locator('.student-topbar')).toBeVisible();
        await expect(page.locator('.student-sidebar a[href="/student/live-classes"]')).toHaveAttribute('aria-current', 'page');
        await expect.poll(() => allTracksStopped(page)).toBeTruthy();
      }
      await expect(teacher.getByRole('heading', { name: 'Đang chờ (2)' })).toBeVisible();
      await teacher.getByRole('button', { name: 'Cho tất cả vào', exact: true }).click();
      await expect(student.locator('.classroom-page')).toHaveAttribute('data-connection-state', 'CONNECTED', {timeout:45000});
      await expect(second.locator('.classroom-page')).toHaveAttribute('data-connection-state', 'CONNECTED', {timeout:45000});
      await expect(teacher.locator('.classroom-tile')).toHaveCount(3);
      await teacher.screenshot({ path: path.join(process.env.CLASSROOM_SCREENSHOTS || 'artifacts/classroom-upgrade', 'three-participants.png'), fullPage: true });
      const studentTile = teacher.locator(`[data-participant-id="${fixture.student.user.id}"]`);
      await student.getByRole('button', { name: 'Giơ tay', exact: true }).click();
      await expect(studentTile.getByLabel('Đang giơ tay', { exact: true })).toBeVisible();
      await teacher.getByLabel(`Thao tác với ${fixture.student.user.full_name}`, { exact: true }).click();
      await teacher.getByRole('button', { name: 'Hạ tay', exact: true }).click();
      await expect(studentTile.getByLabel('Đang giơ tay', { exact: true })).toHaveCount(0);
      await teacher.getByLabel(`Thao tác với ${fixture.student.user.full_name}`, { exact: true }).click();
      await student.getByRole('button', { name: 'Cảm xúc', exact: true }).click();
      await student.getByRole('button', { name: 'Gửi 👍', exact: true }).click();
      await expect(studentTile.getByLabel(`Cảm xúc ${fixture.student.user.full_name}`, { exact: true })).toHaveText('👍');
      await teacher.getByRole('button', { name: 'Chia sẻ màn hình', exact: true }).click();
      await expect(student.getByText(`${fixture.teacher.user.full_name} đang chia sẻ màn hình`, { exact: true })).toBeVisible();
      await expect.poll(() => student.locator('.meeting-shared-screen video').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
      await student.screenshot({ path: path.join(process.env.CLASSROOM_SCREENSHOTS || 'artifacts/classroom-upgrade', 'screen-sharing.png'), fullPage: true });
      await teacher.getByRole('button', { name: 'Dừng chia sẻ', exact: true }).click();
      await expect(student.locator('.meeting-shared-screen')).toHaveCount(0);
      await policy('Cho phép sinh viên chia sẻ màn hình', true);
      await expect(student.getByRole('button', { name: 'Chia sẻ màn hình', exact: true })).toBeEnabled();
      await student.getByRole('button', { name: 'Chia sẻ màn hình', exact: true }).click();
      await expect(teacher.getByText(`${fixture.student.user.full_name} đang chia sẻ màn hình`, { exact: true })).toBeVisible();
      await policy('Cho phép sinh viên chia sẻ màn hình', false);
      await expect(student.getByRole('button', { name: 'Giảng viên chưa cho phép chia sẻ màn hình', exact: true })).toBeDisabled();
      await expect(teacher.locator('.meeting-shared-screen')).toHaveCount(0);
      await student.getByRole('button', { name: 'Chat', exact: true }).click();
      await policy('Cho phép trò chuyện', false);
      await expect(student.getByRole('textbox', { name: 'Tin nhắn', exact: true })).toBeDisabled();
      await policy('Cho phép trò chuyện', true);
      await student.getByRole('textbox', { name: 'Tin nhắn', exact: true }).fill('Realtime upgrade acceptance');
      await student.getByRole('button', { name: 'Gửi', exact: true }).click();
      await teacher.getByRole('button', { name: 'Chat', exact: true }).click();
      await expect(teacher.getByRole('log').getByText('Realtime upgrade acceptance', { exact: true })).toBeVisible();
      await teacher.getByRole('button', { name: /Người tham gia \(/ }).click();
      await teacher.getByLabel(`Thao tác với ${fixture.second.user.full_name}`, { exact: true }).click();
      await teacher.getByRole('button', { name: 'Tắt micro', exact: true }).click();
      await expect(second.getByRole('button', { name: 'Bật mic', exact: true })).toBeVisible();
      await teacher.getByRole('button', { name: 'Yêu cầu bật micro', exact: true }).click();
      await expect(second.getByRole('dialog', { name: 'Giảng viên yêu cầu bật micro' })).toBeVisible();
      await second.getByRole('button', { name: 'Hủy', exact: true }).click();
      await expect(second.getByRole('button', { name: 'Bật mic', exact: true })).toBeVisible();
      // Apply the real host action, then lose its HTTP response. The dialog
      // must release the room controls even though the client sees an error.
      await teacher.route(`**/live-classes/${id}/actions`,async route=>{
        if(route.request().method()==='POST'&&route.request().postDataJSON().action==='remove'){
          await route.fetch();await route.abort('failed');
        }else await route.continue();
      });
      await teacher.getByRole('button', { name: 'Đưa ra khỏi lớp', exact: true }).click();
      await teacher.getByRole('dialog').getByRole('button', { name: 'Đưa ra khỏi lớp', exact: true }).click();
      await expect(second).toHaveURL(/notice=removed/);
      await expect.poll(() => allTracksStopped(second)).toBeTruthy();
      await expect(teacher.getByRole('dialog')).toHaveCount(0);
      expect((await request.post(`${backend}/live-classes/${id}/token`, { headers: headers(fixture.second) })).status()).toBe(409);
      await teacher.getByRole('button', { name: 'Kết thúc buổi', exact: true }).click();
      await teacher.getByRole('button', { name: 'Kết thúc buổi học', exact: true }).click();
      await expect(student).toHaveURL(/notice=ended/);
      const rows = (await (await request.get(`${backend}/live-classes/${id}/attendance`, { headers: headers(fixture.teacher) })).json()).data;
      expect(rows).toHaveLength(2); for (const row of rows) { expect(row.joined_at).toBeTruthy(); expect(row.left_at).toBeTruthy(); }
      console.info('Host control acceptance completed');
    } finally {
      await request.post(`${backend}/live-classes/${id}/end`, { headers: headers(fixture.teacher) }).catch(() => {});
      for (const context of contexts) await context.close();
    }
  });

  test('devices, speaker preference, fullscreen dialogs, duplicate tab and responsive panels', async ({ browser, request }) => {
    test.setTimeout(120000);
    const id = await createSession(request, 'E2E devices and responsive controls'); await start(request, id);
    const context = await browser.newContext({ permissions: ['camera', 'microphone'] }); await signIn(context, fixture.teacher);
    const page = await context.newPage();
    try {
      await enter(page, id);
      await page.getByRole('button', { name: 'Thêm', exact: true }).click();
      await page.getByRole('button', { name: 'Chế độ người nói', exact: true }).click();
      expect(await page.evaluate(() => localStorage.getItem('classroom-view'))).toBe('speaker');
      await page.getByRole('button', { name: 'Toàn màn hình', exact: true }).click();
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBeTruthy();
      await expect(page.getByRole('dialog', { name: 'Tùy chọn lớp học' })).toBeVisible();
      await page.getByRole('button', { name: 'Thiết bị', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Thiết bị trong lớp' });
      for (const kind of ['videoinput', 'audioinput']) {
        const selector = dialog.getByRole('combobox', { name: `Đổi ${kind}`, exact: true });
        await expect.poll(() => selector.locator('option').count()).toBeGreaterThan(1);
        const device = await selector.locator('option').nth(1).getAttribute('value');
        await selector.selectOption(device!); await expect(selector).toHaveValue(device!);
        await expect(selector).toBeEnabled();
      }
      await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
      await expect(page.locator('.meeting-speaker')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Tắt mic', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Tắt camera', exact: true })).toBeEnabled();
      await page.evaluate(() => document.exitFullscreen());
      const duplicate = await context.newPage(); await duplicate.goto(`/live-class/${id}`);
      await duplicate.getByRole('button', { name: 'Vào phòng', exact: true }).click();
      await expect(duplicate.locator('[data-error-code="DUPLICATE_TAB"]')).toBeVisible();
      await expect(page.locator('.classroom-page')).toHaveAttribute('data-connection-state', 'CONNECTED');
      await expect(page.locator('.classroom-tile')).toHaveCount(1); await duplicate.close();
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.getByRole('button', { name: /Người tham gia \(/ }).click();
      await expect(page.getByRole('dialog', { name: 'Bảng lớp học' })).toBeVisible();
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'Chat', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Bảng lớp học' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await page.screenshot({ path: path.join(process.env.CLASSROOM_SCREENSHOTS || 'artifacts/classroom-upgrade', 'mobile-chat-sheet.png'), fullPage: true });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Bảng lớp học' })).toHaveCount(0);
    } finally { await request.post(`${backend}/live-classes/${id}/end`, { headers: headers(fixture.teacher) }).catch(() => {}); await context.close(); }
  });

  test('own-session list, scheduled/foreign access, mobile preview and navigation cleanup', async ({ browser, request }) => {
    test.setTimeout(90000);
    const title = `E2E scheduled and mobile classroom ${Date.now()}`;
    const id = await createSession(request, title);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera', 'microphone'] });
    await signIn(context, fixture.student); const page = await context.newPage();
    try {
      await page.goto('/student/live-classes'); await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await page.goto(`/live-class/${id}`); await expect(page.getByRole('heading', { name: 'Buổi học sắp diễn ra' })).toBeVisible();
      expect(await page.locator('video').count()).toBe(0);
      expect((await request.post(`${backend}/live-classes/${id}/token`, { headers: headers(fixture.outsider) })).status()).toBe(404);
      expect((await request.post(`${backend}/live-classes/${id}/start`, { headers: headers(fixture.student) })).status()).toBe(403);
      await start(request, id);
      await page.goto(`/live-class/${id}`); await expect(page.getByRole('button', { name: 'Vào phòng', exact: true })).toBeEnabled();
      await expect.poll(() => page.evaluate(() => (window as unknown as { classroomTestTracks: MediaStreamTrack[] }).classroomTestTracks.length)).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
      await page.screenshot({ path: path.join(process.env.CLASSROOM_SCREENSHOTS || 'C:/Users/MSI GAMING/AppData/Local/Temp/codex-classroom-review', 'device-setup-mobile.png'), fullPage: true });
      await page.getByRole('button', { name: 'Quay lại danh sách', exact: true }).click();
      await expect(page).toHaveURL(/\/student\/live-classes/); await expect.poll(() => allTracksStopped(page)).toBeTruthy();
      await enter(page, id, true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
      await page.screenshot({ path: path.join(process.env.CLASSROOM_SCREENSHOTS || 'C:/Users/MSI GAMING/AppData/Local/Temp/codex-classroom-review', 'student-room-mobile.png'), fullPage: true });
      await page.getByRole('button', { name: 'Rời phòng', exact: true }).click();
      await expect(page).toHaveURL(/\/student\/live-classes/); await expect.poll(() => allTracksStopped(page)).toBeTruthy();
      await expect(page.locator('.student-topbar')).toBeVisible();
      await expect(page.locator('.student-sidebar a[href="/student/live-classes"]')).toHaveAttribute('aria-current', 'page');
    } finally { await request.post(`${backend}/live-classes/${id}/end`, { headers: headers(fixture.teacher) }).catch(() => {}); await context.close(); }
  });

  test('denied devices allow listen-only join; logout closes room tracks and attendance', async ({ browser, request }) => {
    const id = await createSession(request, 'E2E denied devices and logout');
    await start(request, id);
    const context = await browser.newContext(); await signIn(context, fixture.student, true);
    const page = await context.newPage();
    try {
      await page.goto(`/live-class/${id}`);
      await expect(page.getByRole('heading', { name: 'Cài đặt thiết bị' })).toBeVisible();
      await expect(page.getByText('Bạn chưa cấp quyền. Có thể tham gia với thiết bị này tắt.')).toHaveCount(2);
      await page.getByRole('button', { name: 'Vào phòng', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Đã kết nối' })).toBeVisible({ timeout: 25000 });
      await expect(page.locator('[data-error-code="DEVICE_PERMISSION_ERROR"]')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Bật mic', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Bật camera', exact: true })).toBeVisible();
      await page.getByRole('button', { name: /Tài khoản của E2E Student/ }).click();
      await page.getByRole('menuitem', { name: 'Đăng xuất', exact: true }).click();
      await expect(page).toHaveURL(/\/login/);
      await expect.poll(async () => (await (await request.get(`${backend}/live-classes/${id}/attendance`, { headers: headers(fixture.teacher) })).json()).data.find((row: { student_id: string }) => row.student_id === fixture.student.user.id).left_at).toBeTruthy();
    } finally { await request.post(`${backend}/live-classes/${id}/end`, { headers: headers(fixture.teacher) }).catch(() => {}); await context.close(); }
  });

  test('navigation while acquiring devices stops late camera and microphone tracks', async ({ browser, request }) => {
    const id = await createSession(request, 'E2E pending device cleanup'); await start(request, id);
    const context = await browser.newContext({ permissions: ['camera', 'microphone'] }); await signIn(context, fixture.student, false, 2500);
    const page = await context.newPage();
    try {
      await page.goto(`/live-class/${id}`);
      await expect(page.getByRole('heading', { name: 'Cài đặt thiết bị' })).toBeVisible();
      await page.getByRole('button', { name: 'Quay lại danh sách', exact: true }).click();
      await expect(page).toHaveURL(/\/student\/live-classes/);
      await expect.poll(() => page.evaluate(() => (window as unknown as { classroomTestTracks: MediaStreamTrack[] }).classroomTestTracks.length)).toBeGreaterThan(0);
      await expect.poll(() => allTracksStopped(page)).toBeTruthy();
    } finally { await request.post(`${backend}/live-classes/${id}/end`, { headers: headers(fixture.teacher) }).catch(() => {}); await context.close(); }
  });

  test('camera denial during publish preserves the real room and its participants', async ({ browser, request }) => {
    test.setTimeout(90000);
    const id = await createSession(request, 'E2E denied publish after connection'); await start(request, id);
    const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
    await signIn(context, fixture.teacher, false, 0, true);
    const page = await context.newPage();
    try {
      await enter(page, id);
      await expect(page.locator('[data-error-code="DEVICE_PERMISSION_ERROR"]')).toBeVisible();
      await expect(page.locator('.classroom-page')).toHaveAttribute('data-connection-state', 'CONNECTED');
      await expect(page.getByText('1 người đang tham gia', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Tắt mic', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Thử lại', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Bật camera', exact: true }).click();
      await expect(page.locator('[data-error-code="DEVICE_PERMISSION_ERROR"]')).toBeVisible();
      await expect(page.locator('.classroom-page')).toHaveAttribute('data-connection-state', 'CONNECTED');
      await page.getByRole('button', { name: 'Rời phòng', exact: true }).click();
      await expect.poll(() => allTracksStopped(page)).toBeTruthy();
    } finally { await request.post(`${backend}/live-classes/${id}/end`, { headers: headers(fixture.teacher) }).catch(() => {}); await context.close(); }
  });

  test('provider failure and WebSocket failure retry with fresh token requests without double joins', async ({ browser, request }) => {
    test.setTimeout(120000);
    const id = await createSession(request, 'E2E classified failures and retry'); await start(request, id);
    const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
    await signIn(context, fixture.teacher); const page = await context.newPage();
    let tokenRequests = 0;
    await page.route(`**/live-classes/${id}/token`, async route => {
      tokenRequests++;
      if (tokenRequests === 1) {
        await route.fulfill({ status: 503, json: { error: { code: 'REALTIME_CONFIG_MISSING', message: 'server detail must not leak' } } });
      } else if (tokenRequests === 2) {
        const response = await route.fetch(); const payload = await response.json();
        payload.data.url = payload.data.server_url = 'ws://127.0.0.1:7999';
        await route.fulfill({ response, json: payload });
      } else await route.continue();
    });
    try {
      await page.goto(`/live-class/${id}`);
      await page.getByRole('button', { name: 'Vào phòng', exact: true }).click();
      await expect(page.locator('[data-error-code="REALTIME_CONFIG_MISSING"]')).toBeVisible();
      await expect(page.locator('.classroom-page')).toHaveAttribute('data-connection-state', 'ERROR');
      await expect.poll(() => allTracksStopped(page)).toBeTruthy();
      await page.getByRole('button', { name: 'Thử lại', exact: true }).dblclick();
      await expect(page.locator('[data-error-code="REALTIME_CONNECTION_FAILED"]')).toBeVisible({ timeout: 45000 });
      expect(tokenRequests).toBe(2);
      await page.getByRole('button', { name: 'Thử lại', exact: true }).dblclick();
      await expect(page.locator('.classroom-page')).toHaveAttribute('data-connection-state', 'CONNECTED', { timeout: 25000 });
      expect(tokenRequests).toBe(3);
      await expect(page.getByText('1 người đang tham gia', { exact: true })).toBeVisible();
      await expect(page.locator('.classroom-tile')).toHaveCount(1);
      await expect(page.getByText('server detail must not leak', { exact: true })).toHaveCount(0);
    } finally { await request.post(`${backend}/live-classes/${id}/end`, { headers: headers(fixture.teacher) }).catch(() => {}); await context.close(); }
  });

  test('recording: opt-in, late notice, review, publish, protected playback and revoke', async ({ browser, request }) => {
    test.skip(process.env.CLASSROOM_RECORDING_E2E !== '1', 'Requires the optional real Egress worker.');
    test.setTimeout(240000);
    const listenOnlyStudents = process.env.CLASSROOM_RECORDING_LOW_RESOURCE === '1';
    const id = await createSession(request, `E2E recording ${Date.now()}`);
    const contexts = await Promise.all([fixture.teacher, fixture.student, fixture.second, fixture.outsider].map(async actor => {
      const context = await browser.newContext({ permissions: ['camera', 'microphone'] }); await signIn(context, actor); return context;
    }));
    const [teacher, student, late, outsider] = await Promise.all(contexts.map(context => context.newPage()));
    let recordingId = '';
    const recordings = async () => (await (await request.get(`${backend}/live-classes/${id}/recordings`, { headers: headers(fixture.teacher) })).json()).data;
    try {
      await start(request, id);
      await expect.poll(async () => (await recordings()).available, { timeout: 15000 }).toBe(true);
      const initial = await recordings();
      expect(initial.available).toBe(true); expect(initial.recordings).toEqual([]);
      expect((await request.post(`${backend}/live-classes/${id}/recording/start`, { headers: headers(fixture.student) })).status()).toBe(403);
      await enter(teacher, id); await enter(student, id, listenOnlyStudents);
      await teacher.bringToFront();
      console.info('Recording control ready', { enabled: await teacher.getByRole('button', { name: 'Bắt đầu ghi hình', exact: true }).isEnabled(), bounds: await teacher.getByRole('button', { name: 'Bắt đầu ghi hình', exact: true }).boundingBox() });
      await teacher.screenshot({ path: path.join(process.env.CLASSROOM_SCREENSHOTS!, 'before-recording.png') });
      await teacher.getByRole('button', { name: 'Bắt đầu ghi hình', exact: true }).click({ timeout: 10000 });
      console.info('Recording confirmation requested');
      await expect(teacher.getByRole('dialog', { name: 'Ghi lại buổi học?' })).toBeVisible();
      await teacher.getByRole('button', { name: 'Hủy', exact: true }).click();
      console.info('Recording confirmation cancelled');
      expect((await recordings()).recordings).toEqual([]);
      await teacher.getByRole('button', { name: 'Bắt đầu ghi hình', exact: true }).click();
      await teacher.getByRole('button', { name: 'Bắt đầu ghi', exact: true }).click();
      await expect(teacher.getByLabel('Đang ghi hình', { exact: true })).toBeVisible({ timeout: 60000 });
      await expect(student.getByLabel('Đang ghi hình', { exact: true })).toBeVisible();
      recordingId = (await recordings()).recordings[0].id;
      expect((await request.get(`${backend}/recordings/${recordingId}`, { headers: headers(fixture.student) })).status()).toBe(404);
      await late.goto(`/live-class/${id}`);
      await expect(late.locator('.classroom-recording-prejoin')).toContainText('Buổi học này đang được ghi hình.');
      if (listenOnlyStudents) {
        await late.getByRole('button', { name: 'Tắt camera', exact: true }).click();
        await late.getByRole('button', { name: 'Tắt mic', exact: true }).click();
      }
      await late.getByRole('button', { name: 'Vào phòng', exact: true }).click();
      await expect(late.getByRole('status').filter({ hasText: 'Đã kết nối' })).toBeVisible({ timeout: 45000 });
      await expect(late.getByLabel('Đang ghi hình', { exact: true })).toBeVisible();
      await teacher.getByRole('button', { name: 'Chia sẻ màn hình', exact: true }).click();
      await expect(student.locator('.meeting-shared-screen')).toBeVisible();
      await teacher.waitForTimeout(4000);
      await teacher.getByRole('button', { name: 'Dừng ghi', exact: true }).click();
      await expect(student.getByLabel('Đang ghi hình', { exact: true })).toBeHidden();
      await expect.poll(async () => (await recordings()).recordings[0].status, { timeout: 90000 }).toBe('READY');
      expect((await request.get(`${backend}/recordings/${recordingId}/playback`, { headers: headers(fixture.student) })).status()).toBe(404);
      await teacher.getByRole('button', { name: 'Kết thúc buổi', exact: true }).click();
      await teacher.getByRole('button', { name: 'Kết thúc buổi học', exact: true }).click();
      await expect(student).toHaveURL(/\/student\/live-classes/);
      await teacher.goto(`/live-class/${id}`);
      await teacher.getByRole('link', { name: 'Xem lại', exact: true }).click();
      const preview = teacher.locator('video');
      await expect.poll(() => preview.evaluate((video: HTMLVideoElement) => video.duration > 0 && video.videoWidth > 0)).toBe(true);
      await preview.evaluate((video: HTMLVideoElement) => video.play());
      await expect.poll(() => preview.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(.5);
      await preview.evaluate((video: HTMLVideoElement) => { video.currentTime = video.duration * .8; });
      await teacher.screenshot({ path: path.join(process.env.CLASSROOM_SCREENSHOTS!, 'teacher-recording-preview.png'), fullPage: true });
      await teacher.getByRole('link', { name: 'Quay lại buổi học', exact: true }).click();
      await teacher.getByRole('button', { name: 'Công khai cho sinh viên', exact: true }).click();
      await expect(teacher.getByRole('dialog', { name: 'Công khai bản ghi?' })).toBeVisible();
      await teacher.getByRole('button', { name: 'Công khai', exact: true }).click();
      await expect(teacher.getByRole('dialog', { name: 'Công khai bản ghi?' })).toBeHidden();
      await expect(teacher.locator('.classroom-recording-row')).toContainText('Đã công khai cho sinh viên');
      await expect.poll(async () => {
        const notifications = await (await request.get(`${backend}/notifications?limit=100`, { headers: headers(fixture.student) })).json();
        return notifications.data.some((item: { title: string }) => item.title === 'Bản ghi buổi học đã sẵn sàng');
      }).toBe(true);
      await student.reload();
      await student.getByRole('link', { name: 'Xem lại buổi học', exact: true }).first().click();
      await expect(student).toHaveURL(new RegExp(`/live-class/${id}/recordings/${recordingId}$`));
      await expect(student.locator('.student-topbar')).toBeVisible();
      const player = student.locator('video');
      await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.readyState >= 2 && video.duration > 0)).toBe(true);
      await player.evaluate((video: HTMLVideoElement) => video.play());
      await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(1);
      await student.getByLabel('Tốc độ phát', { exact: true }).selectOption('1.5');
      expect(await player.evaluate((video: HTMLVideoElement) => video.playbackRate)).toBe(1.5);
      expect(await player.getAttribute('controlslist')).toContain('nodownload');
      await player.evaluate((video: HTMLVideoElement) => { video.currentTime = Math.min(5, video.duration / 2); });
      await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(2);
      await player.evaluate((video: HTMLVideoElement) => video.pause());
      const resumePosition = await player.evaluate((video: HTMLVideoElement) => Math.floor(video.currentTime));
      await student.reload();
      await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThanOrEqual(resumePosition);
      const protectedUrl = await player.getAttribute('src');
      expect(protectedUrl).toContain(`/api/v1/recordings/${recordingId}/media?`);
      await student.setViewportSize({ width: 390, height: 844 });
      expect(await student.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await student.screenshot({ path: path.join(process.env.CLASSROOM_SCREENSHOTS!, 'recording-playback-mobile.png'), fullPage: true });
      await outsider.goto(`/live-class/${id}/recordings/${recordingId}`);
      await expect(outsider.locator('.classroom-playback-page').getByRole('alert')).toContainText('không có quyền');
      await expect(outsider.locator('video')).toHaveCount(0);
      await teacher.getByRole('button', { name: 'Ẩn khỏi sinh viên', exact: true }).click();
      await expect(student.locator('video')).toHaveCount(0, { timeout: 10000 });
      expect((await request.get(protectedUrl!)).status()).toBeGreaterThanOrEqual(400);
      await teacher.getByRole('button', { name: 'Xóa bản ghi', exact: true }).click();
      await teacher.getByRole('dialog', { name: 'Xóa bản ghi?' }).getByRole('button', { name: 'Xóa bản ghi', exact: true }).click();
      await expect(teacher.locator('.classroom-recording-row')).toHaveCount(0);
    } finally {
      await request.post(`${backend}/live-classes/${id}/end`, { headers: headers(fixture.teacher) }).catch(() => {});
      if (recordingId) await request.delete(`${backend}/recordings/${recordingId}`, { headers: headers(fixture.teacher) }).catch(() => {});
      await Promise.all(contexts.map(context => context.close()));
    }
  });

  test('recording: ending a live class stops and finalizes Egress automatically', async ({ browser, request }) => {
    test.skip(process.env.CLASSROOM_RECORDING_E2E !== '1', 'Requires the optional real Egress worker.');
    test.setTimeout(150000);
    const id = await createSession(request, 'E2E recording automatic end');
    const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const studentContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
    await signIn(context, fixture.teacher); const teacher = await context.newPage();
    await signIn(studentContext, fixture.student); const student = await studentContext.newPage();
    let recordingId = '';
    try {
      await start(request, id); await enter(teacher, id); await enter(student, id, process.env.CLASSROOM_RECORDING_LOW_RESOURCE === '1');
      await teacher.bringToFront();
      await teacher.getByRole('button', { name: 'Bắt đầu ghi hình', exact: true }).click();
      await teacher.getByRole('button', { name: 'Bắt đầu ghi', exact: true }).click();
      await expect(teacher.getByLabel('Đang ghi hình', { exact: true })).toBeVisible({ timeout: 60000 });
      const result = await (await request.get(`${backend}/live-classes/${id}/recordings`, { headers: headers(fixture.teacher) })).json();
      recordingId = result.data.recordings[0].id;
      await teacher.waitForTimeout(2500);
      await teacher.getByRole('button', { name: 'Kết thúc buổi', exact: true }).click();
      await teacher.getByRole('button', { name: 'Kết thúc buổi học', exact: true }).click();
      await expect(teacher).toHaveURL(/\/dashboard\/live-classes\?notice=ended/);
      await expect.poll(async () => {
        const result = await (await request.get(`${backend}/recordings/${recordingId}`, { headers: headers(fixture.teacher) })).json();
        return result.data?.status;
      }, { timeout: 90000 }).toBe('READY');
      const state = await (await request.get(`${backend}/live-classes/${id}`, { headers: headers(fixture.teacher) })).json();
      expect(state.data.status).toBe('ended'); expect(state.data.recording.active).toBe(false);
      await expect.poll(() => allTracksStopped(teacher)).toBe(true);
    } finally {
      await request.post(`${backend}/live-classes/${id}/end`, { headers: headers(fixture.teacher) }).catch(() => {});
      if (recordingId) await request.delete(`${backend}/recordings/${recordingId}`, { headers: headers(fixture.teacher) }).catch(() => {});
      await context.close();
      await studentContext.close();
    }
  });
});
