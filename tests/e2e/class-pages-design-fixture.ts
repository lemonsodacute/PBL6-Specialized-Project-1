import type { Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';

const teacher = { id: 'teacher-1', full_name: 'Nguyễn Minh Anh', email: 'teacher@example.com' };
export const classDesignRows = [
  { id: 'class-software', name: 'Công nghệ phần mềm - Nhóm 1 · HK1 2026/2027', description: 'Học phần Công nghệ phần mềm, kết hợp kiến thức nền tảng, bài tập thực hành và đánh giá theo tiến độ.', students_count: 15 },
  { id: 'class-web', name: 'Lập trình Web - Nhóm 2 · HK1 2026/2027', description: 'Học phần Lập trình Web, kết hợp kiến thức nền tảng, bài tập thực hành và đánh giá theo tiến độ.', students_count: 7 },
  { id: 'class-code', name: 'JavaScript và REST API', description: 'Thực hành xây dựng và kiểm thử ứng dụng.', students_count: 7 },
  { id: 'class-ai', name: 'AI Proctoring Demo Class', description: null, students_count: 10 },
].map(row => ({ ...row, teacher, exams_count: 2, created_at: '2026-10-01T01:00:00Z' }));
export const liveDesignRows = [
  { id: 'live-scheduled', title: 'Ôn tập và giải đáp Công nghệ phần mềm', class_id: 'class-software', class_name: classDesignRows[0].name, status: 'scheduled', scheduled_start: '2026-10-28T11:00:00Z', scheduled_end: '2026-10-28T12:00:00Z' },
  { id: 'live-ongoing', title: 'Thực hành xây dựng giao diện Web', class_id: 'class-web', class_name: classDesignRows[1].name, status: 'ongoing', scheduled_start: '2026-10-28T10:00:00Z', scheduled_end: '2026-10-28T11:00:00Z' },
  { id: 'live-ended', title: 'Ôn tập REST API trước kỳ thi', class_id: 'class-code', class_name: classDesignRows[2].name, status: 'ended', scheduled_start: '2026-10-26T03:15:00Z', scheduled_end: '2026-10-26T04:15:00Z' },
  { id: 'live-cancelled', title: 'Buổi học đã hủy theo lịch lớp', class_id: 'class-web', class_name: classDesignRows[1].name, status: 'cancelled', scheduled_start: '2026-10-25T03:15:00Z', scheduled_end: '2026-10-25T04:15:00Z' },
].map(row => ({ ...row, teacher_id: teacher.id, teacher_name: teacher.full_name, description: 'Trao đổi bài tập và củng cố kiến thức học phần.', actual_start: null, actual_end: null, meeting_url: null, recording_url: null, deleted_at: null, created_at: '2026-10-01T01:00:00Z', updated_at: '2026-10-01T01:00:00Z' }));

export async function classPagesSession(page: Page, role = 'teacher') {
  await uiSession(page, role);
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.fixture`, url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' }]);
  const state = { classes: structuredClone(classDesignRows), sessions: structuredClone(liveDesignRows), status: 200, actionStatus: 200, requests: [] as { method: string; url: string; body: Record<string, unknown> | null }[] };
  await page.route(/\/api\/v1\/(classes|live-classes)(\?|\/|$)/, route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    const method = route.request().method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const url = new URL(route.request().url()), p = url.searchParams;
    const body = method === 'GET' ? null : route.request().postDataJSON() ?? {};
    state.requests.push({ method, url: url.href, body });
    if (state.status !== 200 || (method !== 'GET' && state.actionStatus !== 200)) return route.fulfill({ headers, status: method !== 'GET' ? state.actionStatus : state.status, json: { error: { message: 'Không thực hiện được thao tác.' } } });
    if (url.pathname.startsWith('/api/v1/classes')) {
      if (url.pathname !== '/api/v1/classes') return route.fulfill({ headers, json: { data: { ...state.classes.find(row => url.pathname.endsWith(row.id)), students: [] } } });
      const rows = state.classes.filter(row => !p.get('q') || `${row.name} ${row.description}`.toLowerCase().includes(p.get('q')!.toLowerCase()));
      if (p.get('sort') === 'name') rows.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      return route.fulfill({ headers, json: { data: rows, meta: { total: rows.length, page: 1, limit: 20 } } });
    }
    if (method === 'POST') {
      if (url.pathname === '/api/v1/live-classes') state.sessions.push({ ...liveDesignRows[0], ...body, id: 'live-created', status: 'scheduled' } as typeof liveDesignRows[number]);
      else { const current = state.sessions.find(row => url.pathname.includes(`/${row.id}/`)); if (current) current.status = url.pathname.endsWith('/start') ? 'ongoing' : 'ended'; }
      return route.fulfill({ headers, json: { data: state.sessions.at(-1) } });
    }
    const rows = state.sessions.filter(row => (!p.get('q') || `${row.title} ${row.class_name}`.toLowerCase().includes(p.get('q')!.toLowerCase())) && (!p.get('status') || row.status === p.get('status')) && (!p.get('class_id') || row.class_id === p.get('class_id')));
    if (p.get('sort') === 'oldest') rows.reverse();
    return route.fulfill({ headers, json: { data: rows, meta: { total: rows.length, page: 1, limit: 20 } } });
  });
  return state;
}
