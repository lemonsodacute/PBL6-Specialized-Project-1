/** Real services + isolated QA data. Output contains timings/counts, never credentials or bodies. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';

const args = Object.fromEntries(process.argv.slice(2).map(part => part.replace(/^--/, '').split('=')));
const label = args.label || 'before';
const mode = args.mode || 'api';
const apiOrigin = 'http://localhost:8001';
const base = args.base || 'http://localhost:3000';
const demo = JSON.parse(fs.readFileSync('backend/private/release-qa/demo-accounts.json', 'utf8'));
const directory = path.resolve('artifacts/performance'); fs.mkdirSync(directory, { recursive: true });
const output = { label, mode, base, measured_at: new Date().toISOString(), memory: { total_mb: Math.round(os.totalmem()/1048576), free_mb: Math.round(os.freemem()/1048576) }, records: [] };
const save = () => fs.writeFileSync(path.join(directory, `${label}-${mode}.json`), JSON.stringify(output, null, 2));
const round = n => Math.round(n * 100) / 100;
function timing(value = '') {
  return { app_ms: Number(value.match(/app;dur=([\d.]+)/)?.[1] || 0), db_ms: Number(value.match(/db;dur=([\d.]+)/)?.[1] || 0), queries: Number(value.match(/desc="(\d+) queries"/)?.[1] || 0) };
}
async function login(role) {
  const actor = demo.actors[role];
  const response = await fetch(`${apiOrigin}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: actor.email, password: actor.password }) });
  if (!response.ok) throw new Error(`QA login failed: ${response.status}`);
  return response.json();
}
async function apiBench() {
  for (const role of ['teacher', 'student', 'admin']) {
    const session = await login(role);
    const routes = role === 'teacher' ? [
      ['profile', '/auth/me'], ['classes_5', '/classes?page=1&limit=5'], ['classes_20', '/classes?page=1&limit=20'],
      ['banks_5', '/question-banks?page=1&limit=5'], ['banks_20', '/question-banks?page=1&limit=20'], ['exams', '/exams?limit=20'],
      ['class_detail', `/classes/${demo.class_id}?include_students=false`], ['enrollments', `/classes/${demo.class_id}/enrollments`],
      ['available_students', `/classes/${demo.class_id}/enrollments/available`], ['notifications', '/notifications/unread-count'], ['support_count', '/chat/unread-count'],
    ] : role === 'student' ? [['profile', '/auth/me'], ['exams', '/exams?limit=20'], ['history', '/attempts/mine?limit=20'], ['notifications', '/notifications?limit=8']]
      : [['users', '/users?limit=20'], ['support_inbox', '/chat/conversations'], ['cards', '/admin/student-cards?limit=20']];
    for (const [name, route] of routes) {
      for (let sample = 0; sample < 6; sample++) {
        const started = performance.now();
        const response = await fetch(`${apiOrigin}/api/v1${route}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
        const payload = await response.json();
        output.records.push({ role, name, sample, warmup: sample === 0, status: response.status, total_ms: round(performance.now()-started), ...timing(response.headers.get('server-timing') || ''), items: Array.isArray(payload.data) ? payload.data.length : undefined });
        if (!response.ok) throw new Error(`QA endpoint failed: ${role}/${name}/${response.status}`);
      }
    }
    save();
  }
}

async function browserBench() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const role of ['teacher', 'student', 'admin']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
      const actor = demo.actors[role];
      const authentication = await context.request.post(`${apiOrigin}/api/v1/auth/login`, { data: { email: actor.email, password: actor.password } });
      if (!authentication.ok()) throw new Error(`Browser QA login failed: ${authentication.status()}`);
      const session = await authentication.json();
      // The existing production build points at port 8000. Rewrite only this
      // benchmark context to the real isolated QA API, for HTTP and WebSocket.
      await context.addInitScript(({ session, apiOrigin }) => {
        sessionStorage.setItem('ai-proctoring-current-user', JSON.stringify(session.user));
        sessionStorage.setItem('ai-proctoring-access-token', session.access_token);
        const rewrite = value => String(value).replace(/^http:\/\/localhost:8000(?=\/)/, apiOrigin).replace(/^ws:\/\/localhost:8000(?=\/)/, apiOrigin.replace('http:', 'ws:'));
        const nativeFetch = window.fetch.bind(window);
        window.__perf = { time_origin_ms: performance.timeOrigin, click: 0, feedback: null, requests: [], longTasks: [] };
        const observer = new MutationObserver(() => {
          if (window.__perf.click && window.__perf.feedback === null && document.querySelector('[data-navigation-pending], main .loading-skeleton')) {
            requestAnimationFrame(() => { if (window.__perf.feedback === null) window.__perf.feedback = performance.now(); });
          }
        });
        const observe = () => observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        if (document.documentElement) observe(); else document.addEventListener('DOMContentLoaded', observe, { once: true });
        window.fetch = async (input, options) => {
          const url = typeof input === 'string' || input instanceof URL ? rewrite(input) : input;
          const record = { path: typeof url === 'string' ? new URL(url, location.href).pathname : 'request', started: performance.now() };
          window.__perf.requests.push(record);
          try { const response = await nativeFetch(url, options); record.response = performance.now(); record.status = response.status; return response; }
          catch (cause) { record.failed = true; throw cause; }
        };
        const NativeSocket = window.WebSocket;
        window.WebSocket = class extends NativeSocket { constructor(url, protocols) { super(rewrite(url), protocols); } };
        document.addEventListener('click', () => { window.__perf.click = performance.now(); }, true);
        document.addEventListener('input', () => { window.__perf.click = performance.now(); }, true);
        try { new PerformanceObserver(list => window.__perf.longTasks.push(...list.getEntries().map(item => ({ start: item.startTime, duration: item.duration })))).observe({ type: 'longtask', buffered: true }); } catch {}
      }, { session, apiOrigin });
      const page = await context.newPage(); const network = []; const sockets = []; const byRequest = new Map();
      page.on('request', request => {
        if (!request.url().includes('/api/v1/')) return;
        const at = performance.now();
        const record = { method: request.method(), path: new URL(request.url()).pathname, at, started_epoch_ms: round(performance.timeOrigin+at) };
        network.push(record); byRequest.set(request, record);
      });
      page.on('response', async response => {
        if (!response.url().includes('/api/v1/')) return;
        const record = byRequest.get(response.request());
        if (record) {
          const received = performance.now();
          const headers = await response.allHeaders();
          record.response_ms = round(received-record.at); record.response_received_epoch_ms=round(performance.timeOrigin+received); record.status = response.status();
          Object.assign(record, timing(headers['server-timing'] || ''), headers['x-development-timing'] ? JSON.parse(headers['x-development-timing']) : {});
        }
      });
      page.on('websocket', socket => sockets.push({ path: new URL(socket.url()).pathname }));
      const home = role === 'student' ? '/student' : role === 'admin' ? '/admin' : '/dashboard';
      const open = async route => { await page.goto(base+route, { waitUntil: 'domcontentloaded', timeout: 180000 }); await page.locator('main').waitFor({ timeout: 120000 }); };
      const ready = async locator => { await locator.first().waitFor({ timeout: 120000 }); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
      const flow = async (name, act, done, expectedPath) => {
        const offset = network.length; const started = performance.now();
        await page.evaluate(() => { window.__perf.click=0; window.__perf.feedback=null; window.__perf.requests=[]; window.__perf.longTasks=[]; });
        await act(); if (expectedPath) await page.waitForURL(url => url.pathname === expectedPath, { timeout: 120000 }); await ready(done);
        const data = await page.evaluate(() => ({ ...window.__perf, painted: performance.now() }));
        output.records.push({ role, name, elapsed_ms: round(performance.now()-started), handler_to_paint_ms: data.click ? round(data.painted-data.click) : null,
          feedback_ms: data.feedback !== null ? round(data.feedback-data.click) : null,
          requests: network.slice(offset).map(({at,...row})=>row), browser: data, sockets_total: sockets.length });
        save(); console.info(JSON.stringify({ role, name, ms: output.records.at(-1).handler_to_paint_ms, requests: network.length-offset }));
      };
      await open(home); await ready(page.getByRole('button', { name: /^Tài khoản của/ }));
      // Capture the full initial request burst after settling, including ready/focus events.
      await page.waitForTimeout(1200);
      output.records.push({ role, name: 'initial_requests', requests: network.map(({at,...row})=>row), sockets_total: sockets.length }); save();
      for (let sample=0; sample<3; sample++) {
        await flow(`account_menu_${sample}`, () => page.getByRole('button', { name: /^Tài khoản của/ }).click(), page.getByRole('menu', { name: 'Tài khoản', exact: true }));
        await page.keyboard.press('Escape');
      }
      if (role === 'teacher') {
        await flow('sidebar_question_banks_first', () => page.getByRole('link', { name: 'Ngân hàng câu hỏi', exact: true }).click(), page.getByRole('link', { name: 'PERF QA 00', exact: true }), '/dashboard/question-banks');
        const bankHref = await page.getByRole('link', { name: 'PERF QA 00', exact: true }).getAttribute('href');
        await flow('bank_detail_first', () => page.getByRole('link', { name: 'PERF QA 00', exact: true }).click(), page.getByRole('heading', { name: 'Câu hỏi trong ngân hàng', exact: true }), bankHref);
        await page.getByRole('link', { name: 'Ngân hàng câu hỏi', exact: true }).first().click(); await ready(page.getByRole('link', { name: 'PERF QA 00', exact: true }));
        await flow('search_banks', () => page.getByRole('searchbox').first().fill('PERF QA 00'), page.getByRole('status').filter({ hasText: /trên 1 kết quả/ }));
        await flow('sidebar_exam_list_first', () => page.getByRole('link', { name: 'Đề thi', exact: true }).click(), page.getByRole('searchbox').first(), '/dashboard/exams');
        await flow('sidebar_classes_first', () => page.getByRole('link', { name: 'Lớp học', exact: true }).click(), page.getByRole('link', { name: 'PERF QA 00', exact: true }), '/dashboard/classes');
        await open(`/dashboard/classes/${demo.class_id}`); await ready(page.getByRole('heading', { name: 'Danh sách học sinh' }));
        await flow('remove_student_dialog', () => page.getByRole('row').filter({ hasText: demo.actors.student.email }).getByRole('button', { name: 'Xoá khỏi lớp' }).click(), page.getByRole('dialog', { name: 'Xóa sinh viên khỏi lớp?' }));
        await flow('remove_student', () => page.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click(), page.getByText('Đã xóa sinh viên khỏi lớp.', { exact: true }));
        const select=page.getByRole('combobox', { name: 'Sinh viên để thêm' }); await select.selectOption(demo.actors.student.id, { timeout: 30000 });
        await flow('add_student', () => page.getByRole('button', { name: 'Thêm thành viên', exact: true }).click(), page.getByText('Đã thêm sinh viên vào lớp.', { exact: true }));
        await open('/teacher/profile'); await ready(page.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true }));
        await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true }).click();
        const phone = page.locator('#teacher-phone'); await phone.fill((await phone.inputValue()) === '0901234568' ? '0901234567' : '0901234568');
        await flow('save_profile', () => page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click(), page.getByText('Cập nhật hồ sơ thành công.', { exact: true }));
        for (let sample=0; sample<3; sample++) {
          await flow(`warm_banks_${sample}`, () => page.locator('aside.sidebar').getByRole('link', { name: 'Ngân hàng câu hỏi', exact: true }).click(), page.getByRole('link', { name: 'PERF QA 00', exact: true }), '/dashboard/question-banks');
          await flow(`warm_bank_detail_${sample}`, () => page.getByRole('link', { name: 'PERF QA 00', exact: true }).click(), page.getByRole('heading', { name: 'Câu hỏi trong ngân hàng', exact: true }), bankHref);
          await flow(`warm_classes_${sample}`, () => page.locator('aside.sidebar').getByRole('link', { name: 'Lớp học', exact: true }).click(), page.getByRole('link', { name: 'PERF QA 00', exact: true }), '/dashboard/classes');
          await flow(`warm_exams_${sample}`, () => page.locator('aside.sidebar').getByRole('link', { name: 'Đề thi', exact: true }).click(), page.getByRole('searchbox').first(), '/dashboard/exams');
        }
      }
      if (role === 'student') {
        await page.getByRole('button', { name: 'Bài kiểm tra', exact: true }).click();
        await flow('student_exam_list_first', () => page.getByRole('link', { name: 'Làm kiểm tra', exact: true }).click(), page.locator('.student-exam-section h2').first(), '/student/exams');
        await flow('notification_open', () => page.getByRole('button', { name: /^Thông báo/ }).click(), page.getByRole('region', { name: 'Thông báo', exact: true }));
        await page.keyboard.press('Escape');
        await flow('support_open', () => page.getByRole('button', { name: 'Mở tin nhắn hỗ trợ', exact: true }).click(), page.getByRole('log').filter({ has: page.locator('[class*="message"]') }));
      }
      if (role === 'admin') {
        await page.getByRole('button', { name: 'Quản lý người dùng', exact: true }).click();
        await flow('admin_users_first', () => page.getByRole('link', { name: 'Danh sách người dùng', exact: true }).click(), page.getByRole('searchbox').first(), '/dashboard/users');
      }
      await context.close();
    }
  } finally { await browser.close(); }
}
try { if (mode === 'api') await apiBench(); else await browserBench(); save(); }
catch (cause) { output.failure = { name: cause.name, message: String(cause.message).replace(/Bearer\s+\S+/g, 'Bearer [redacted]').slice(0,1500) }; save(); console.error(output.failure.message); process.exitCode=1; }
