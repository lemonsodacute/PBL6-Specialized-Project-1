import { expect, test, type Page, type Route } from '@playwright/test';
import { createHash } from 'node:crypto';
import { uiSession } from './ui-fixtures';

const examId = '22222222-2222-4222-8222-222222222222';
const attemptId = '33333333-3333-4333-8333-333333333333';
const proofId = '44444444-4444-4444-8444-444444444444';
const verifyPath = `/student/exams/${examId}/verify`;
const mismatch = 'Không thể xác minh người đang ngồi trước camera là sinh viên đã xác thực.';
async function respond(route: Route, json: unknown, status = 200) {
  const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000',
    'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  return route.fulfill({ status: route.request().method() === 'OPTIONS' ? 204 : status, headers, ...(route.request().method() === 'OPTIONS' ? {} : { json }) });
}
async function setup(page: Page) {
  await uiSession(page);
  await page.routeWebSocket('**/api/v1/**', () => {});
  const state = { starts: [] as Record<string, unknown>[], frames: [] as string[], finalCalls: 0, gate: null as Promise<void> | null, rejectStart: false };
  const attempt = { id: attemptId, exam_id: examId, status: 'in_progress', questions: [], answers: [], remaining_seconds: 1800,
    server_deadline_at: new Date(Date.now() + 1800000).toISOString() };
  await page.route(`**/api/v1/exams/${examId}`, route => respond(route, { data: { id: examId, title: 'Kiểm tra cổng danh tính',
    require_camera: true, require_mic: false, require_fullscreen: false, duration_minutes: 30 } }));
  await page.route('**/api/v1/identity/student-card/status', route => respond(route, { data: { identity_profile_status: 'VERIFIED', has_reference: true } }));
  await page.route(`**/api/v1/identity/exams/${examId}/verify*`, async route => {
    if (route.request().method() === 'OPTIONS') return respond(route, {});
    const form = await new Response(new Uint8Array(route.request().postDataBuffer()!), { headers: { 'content-type': route.request().headers()['content-type'] } }).formData();
    const image = Buffer.from(await (form.get('image') as File).arrayBuffer());
    state.frames.push(createHash('sha256').update(image).digest('hex'));
    const final = route.request().url().endsWith('/verify-entry');
    if (final) {
      state.finalCalls++;
      if (state.gate) await state.gate;
      // Decode the actual uploaded camera pixels; this tests capture freshness,
      // not recognition accuracy (the real YuNet/SFace engine has backend tests).
      const color = await page.evaluate(async bytes => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0); bitmap.close();
        return Array.from(ctx.getImageData(320, 240, 1, 1).data).slice(0, 3);
      }, [...image]);
      const [red, green, blue] = color;
      if (green > 180) return respond(route, { error: { code: 'NO_FACE_DETECTED', message: 'Không phát hiện khuôn mặt. Vui lòng nhìn thẳng vào camera.' } }, 422);
      if (red > 180 && blue > 180) return respond(route, { error: { code: 'MULTIPLE_FACES_DETECTED', message: 'Phát hiện nhiều khuôn mặt. Chỉ một người được phép xuất hiện trước camera.' } }, 422);
      if (red > 180) return respond(route, { data: { id: proofId, verified: false, status: 'rejected', message: mismatch } });
    }
    return respond(route, { data: { id: proofId, verified: true, status: 'verified', reference_version: 'current-reference', threshold: .363 } });
  });
  await page.route('**/api/v1/attempts', route => {
    if (route.request().method() === 'OPTIONS') return respond(route, {});
    state.starts.push(route.request().postDataJSON());
    return state.rejectStart ? respond(route, { error: { code: 'FINAL_IDENTITY_VERIFICATION_REQUIRED', message: 'Vui lòng xác minh lại khuôn mặt ngay trước khi vào bài thi.' } }, 403) : respond(route, { data: attempt });
  });
  await page.route(`**/api/v1/attempts/${attemptId}**`, route => respond(route, { data: attempt }));
  await page.route('**/api/v1/proctoring/**', route => respond(route, { data: {} }));
  await page.addInitScript(() => {
    Object.assign(window, { entryPerson: 'A', entryFrame: 0 });
    navigator.mediaDevices.enumerateDevices = async () => [];
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 640, height: 480 });
      const ctx = canvas.getContext('2d')!;
      const stream = canvas.captureStream(15);
      const draw = () => {
        const state = window as unknown as { entryPerson: string; entryFrame: number };
        ctx.fillStyle = ({ A: '#0000ff', B: '#ff0000', none: '#00ff00', multiple: '#ff00ff' } as Record<string, string>)[state.entryPerson];
        ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = 'white'; ctx.fillText(String(++state.entryFrame), 12, 24);
      };
      draw(); const timer = setInterval(draw, 60);
      const track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); stop(); };
      return stream;
    };
  });
  return state;
}
async function reachFinalDevices(page: Page) {
  await page.goto(verifyPath);
  await page.getByRole('button', { name: 'Kiểm tra thiết bị', exact: true }).click();
  const capture = page.getByRole('button', { name: 'Chụp ảnh', exact: true });
  await expect(capture).toBeEnabled(); await capture.click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Xác minh khuôn mặt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Xác minh danh tính thành công', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bắt đầu làm bài', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Cài đặt thiết bị trước khi thi', exact: true });
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await expect(dialog.getByText('Camera đã sẵn sàng', { exact: true })).toBeVisible();
  return dialog;
}
for (const [person, message] of [
  ['B', mismatch],
  ['none', 'Không phát hiện khuôn mặt. Vui lòng nhìn thẳng vào camera.'],
  ['multiple', 'Phát hiện nhiều khuôn mặt. Chỉ một người được phép xuất hiện trước camera.'],
]) test(`final camera frame blocks ${person} after initial verification`, async ({ page }) => {
  const state = await setup(page);
  const dialog = await reachFinalDevices(page);
  expect(state.starts).toHaveLength(0);
  await page.evaluate(value => { (window as unknown as { entryPerson: string }).entryPerson = value; }, person);
  // Wait for the chosen synthetic camera source to produce the next live frame.
  await page.waitForTimeout(100);
  await dialog.getByRole('button', { name: 'Vào phòng thi', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(message);
  await expect(dialog.getByRole('button', { name: 'Thử xác minh lại', exact: true })).toBeEnabled();
  expect(state.finalCalls).toBe(1);
  expect(state.starts).toHaveLength(0);
  expect(new Set(state.frames).size).toBe(2);
  await expect(page).toHaveURL(verifyPath);
});

test('valid current frame starts once, disables repeat clicks, and transfers live camera', async ({ page }) => {
  const state = await setup(page);
  let release!: () => void;
  state.gate = new Promise<void>(resolve => { release = resolve; });
  const dialog = await reachFinalDevices(page);
  await dialog.getByRole('button', { name: 'Vào phòng thi', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Đang xác minh danh tính...', exact: true })).toBeDisabled();
  expect(state.starts).toHaveLength(0);
  release();
  await expect(page).toHaveURL(`/student/attempts/${attemptId}`);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Thiết bị giám sát', exact: true })).toBeVisible();
  expect(state.starts).toEqual([{ exam_id: examId, entry_verification_id: proofId }]);
  expect(new Set(state.frames).size).toBe(2);
  expect(await page.locator('.proctor-stream-hidden').evaluate(el => ((el as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0].readyState)).toBe('live');
});

test('expired proof permits a retry with a new frame and no earlier successful attempt', async ({ page }) => {
  const state = await setup(page);
  state.rejectStart = true;
  const dialog = await reachFinalDevices(page);
  await dialog.getByRole('button', { name: 'Vào phòng thi', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Thử xác minh lại', exact: true })).toBeEnabled();
  await expect(page).toHaveURL(verifyPath);
  state.rejectStart = false;
  await dialog.getByRole('button', { name: 'Thử xác minh lại', exact: true }).click();
  await expect(page).toHaveURL(`/student/attempts/${attemptId}`);
  expect(state.finalCalls).toBe(2);
  expect(new Set(state.frames).size).toBe(3);
});

test('a direct reload of an existing attempt rechecks before dismissing device setup', async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/student/attempts/${attemptId}`);
  const dialog = page.getByRole('dialog', { name: 'Cài đặt thiết bị trước khi thi', exact: true });
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await page.evaluate(() => { (window as unknown as { entryPerson: string }).entryPerson = 'B'; });
  await page.waitForTimeout(100);
  await dialog.getByRole('button', { name: 'Vào phòng thi', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(mismatch);
  expect(state.starts).toHaveLength(0);
  await expect(dialog).toBeVisible();
});
