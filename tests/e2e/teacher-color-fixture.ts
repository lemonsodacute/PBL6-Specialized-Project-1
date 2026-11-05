import type { Page } from '@playwright/test';
import { questionBankDesignSession, designBanks } from './question-bank-design-fixture';
import { classDesignRows, liveDesignRows } from './class-pages-design-fixture';

export const teacherAuditPages = [
  ['overview', '/dashboard'], ['banks', '/dashboard/question-banks'], ['exams', '/dashboard/exams'],
  ['monitor', '/dashboard/monitor'], ['classes', '/dashboard/classes'], ['live', '/dashboard/live-classes'],
  ['reports', '/dashboard/reports'], ['profile', '/teacher/profile'], ['settings', '/teacher/settings'], ['help', '/teacher/help'],
  ['bank-detail', '/dashboard/question-banks/bank-testing'], ['documents', '/dashboard/question-banks/bank-testing/documents'],
  ['exam-detail', '/dashboard/exams/exam-a'], ['class-detail', '/dashboard/classes/class-software'],
  ['report-detail', '/dashboard/reports/attempts/attempt-a'],
] as const;

export async function teacherColorSession(page: Page) {
  await questionBankDesignSession(page);
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role: 'teacher' })).toString('base64url')}.fixture`, url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' }]);
  const questions = [{ id: 'question-a', question_bank_id: 'bank-testing', content: 'Mục tiêu của kiểm thử phần mềm là gì?', type: 'mcq_single', difficulty: 'easy', topic: 'Kiểm thử', is_active: true, default_points: 2, options_json: { options: ['Phát hiện lỗi', 'Thay thế lập trình'] }, correct_answer_json: { answer: 'Phát hiện lỗi' }, explanation: null }];
  const now = Date.now();
  const exams = ['ongoing', 'published', 'closed', 'draft'].map((status, i) => ({ id: i ? `exam-${i}` : 'exam-a', title: ['Kiểm tra Công nghệ phần mềm', 'Đánh giá Lập trình Web', 'Ôn tập REST API', 'Đề nháp học phần'][i], description: 'Đánh giá kiến thức và kỹ năng thực hành của học phần.', status, start_time: new Date(now + (i === 1 ? 86400000 : -3600000)).toISOString(), end_time: new Date(now + (i === 2 ? -1000 : 172800000)).toISOString(), duration_minutes: 60, questions_count: 10, classes: [{ id: classDesignRows[0].id, name: classDesignRows[0].name }], require_camera: true, require_mic: false, attempt_count: 12, completed_attempt_count: 8, questions: questions.map(q => ({ ...q, points: 2 })) }));
  const result = { attempt_id: 'attempt-a', exam_id: 'exam-a', exam_title: exams[0].title, student_id: 'student-a', student_code: 'SV2026001', full_name: 'Trần Minh Anh', attempt_number: 1, status: 'submitted', score: '8', max_score: '10', percentage: '80', started_at: '2026-10-28T01:00:00Z', submitted_at: '2026-10-28T02:00:00Z', violation_count: 2, browser_violation_count: 1, detection_count: 1, risk_score: '28' };
  const report = { exam_id: null, exams, completed_statuses: ['submitted', 'auto_submitted', 'terminated'], results: [result], summary: { completed_attempts: 1, scored_attempts: 1, percentage_attempts: 1, average_percentage: '80', average_score: null, max_score: null, total_violations: 2, browser_violation_count: 1, detection_count: 1, average_risk_score: '28', risk_scored_attempts: 1, attempt_count: 1 } };
  await page.route(/\/api\/v1\/(classes|live-classes|exams|attempts|teacher\/reports|reports\/attempts|question-banks\/|dashboard\/stats)/, route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const url = new URL(route.request().url()), path = url.pathname.replace('/api/v1', '');
    let data: unknown = [], meta: unknown;
    if (path === '/classes') data = classDesignRows;
    else if (path.endsWith('/enrollments')) data = [{ id: 'enroll-a', student_id: 'student-a', enrolled_at: '2026-10-01T00:00:00Z', student: { id: 'student-a', full_name: result.full_name, student_code: result.student_code, email: 'student@example.com' } }];
    else if (path.startsWith('/classes/')) data = { ...classDesignRows[0], students: [] };
    else if (path === '/live-classes') data = liveDesignRows;
    else if (path === '/exams') data = exams.filter(exam => !url.searchParams.get('status') || exam.status === url.searchParams.get('status'));
    else if (path.startsWith('/exams/')) data = exams[0];
    else if (path === '/attempts') { data = []; meta = { total: 12, page: 1, limit: 20, summary: { working: 4, submitted: 8, not_started: 0, violations: 2 } }; }
    else if (path === '/teacher/reports') data = report;
    else if (path.startsWith('/reports/attempts/')) data = { ...result, events: [{ id: 'event-a', source: 'browser', type: 'tab_switch', severity: 'low', occurred_at: result.started_at, confidence: null }] };
    else if (path.endsWith('/questions')) data = questions;
    else if (path.startsWith('/question-banks/')) data = { ...designBanks[0], questions };
    else if (path === '/dashboard/stats') data = { ongoing_exams: 1, active_attempts: 4, classes: 4, recent_violations: 2, recent_window_minutes: 5, as_of: '2026-10-28T01:00:00Z' };
    if (Array.isArray(data) && !meta) meta = { total: data.length, page: 1, limit: 20 };
    return route.fulfill({ headers, json: { data, ...(meta ? { meta } : {}) } });
  });
}
