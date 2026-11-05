import type { Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';

export const designBanks = [
  { id: 'bank-testing', name: 'Yêu cầu và kiểm thử phần mềm', description: 'Câu hỏi ôn tập và đánh giá yêu cầu và kiểm thử phần mềm.', subject: 'Kỹ thuật phần mềm', questions_count: 10 },
  { id: 'bank-git', name: 'Kiến trúc ứng dụng và Git', description: 'Câu hỏi ôn tập và đánh giá kiến trúc ứng dụng và Git.', subject: 'Kỹ thuật phần mềm', questions_count: 10 },
  { id: 'bank-web', name: 'HTML và CSS nền tảng', description: 'Câu hỏi ôn tập và đánh giá HTML và CSS nền tảng.', subject: 'Lập trình Web', questions_count: 10 },
  { id: 'bank-api', name: 'JavaScript và REST API', description: 'Câu hỏi ôn tập và đánh giá JavaScript và REST API.', subject: 'Lập trình Web', questions_count: 10 },
  { id: 'bank-network', name: 'Quản trị mạng', description: null, subject: null, questions_count: 0 },
  { id: 'bank-project', name: 'PBL6', description: null, subject: null, questions_count: 1 },
].map((bank, index) => ({ ...bank, updated_at: `2026-10-${26 - index}T08:00:00Z` }));

export async function questionBankDesignSession(page: Page) {
  await uiSession(page, 'teacher');
  const state = { banks: structuredClone(designBanks), status: 200, requests: [] as string[] };
  await page.route('**/api/v1/question-banks**', route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    state.requests.push(route.request().url());
    if (state.status !== 200) return route.fulfill({ headers, status: state.status, json: { error: { message: 'Không tải được danh sách.' } } });
    const params = new URL(route.request().url()).searchParams;
    const rows = state.banks.filter(bank => !params.get('q') || `${bank.name} ${bank.description ?? ''}`.toLowerCase().includes(params.get('q')!.toLowerCase()));
    if (params.get('sort') === 'name') rows.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    if (params.get('sort') === 'oldest') rows.reverse();
    return route.fulfill({ headers, json: { data: rows, meta: { total: rows.length, page: 1, limit: 20 } } });
  });
  return state;
}
