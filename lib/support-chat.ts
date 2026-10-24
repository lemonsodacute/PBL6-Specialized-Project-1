import { apiFetch } from './api';

export type SupportOwner = { id: string; full_name: string; email: string; role: 'student' | 'teacher'; student_code: string | null };
export type SupportCase = { id: string; status: 'AI_ACTIVE' | 'RESOLVED_BY_AI' | 'ESCALATED' | 'ADMIN_ACTIVE' | 'CLOSED'; category: string | null; closed_at?: string | null; closed_by?: string | null; summary: { user_name?: string; role?: string; student_code?: string | null; category?: string; subcategory?: string | null; articles?: { id: string; title: string; route: string }[]; issue?: string; steps?: string[]; result?: string; confirmed_unresolved?: boolean } };
export type SupportMessage = { id: string; conversation_id: string; sender_id: string; client_id: string; body: string; created_at: string; read_at: string | null; kind: 'message' | 'case_summary' | 'system' };
export type SupportConversation = { id: string; owner: SupportOwner; created_at: string; last_message_at: string | null; last_message: SupportMessage | null; unread_count: number; support_case: SupportCase | null };
export type ChatPage<T> = { data: T[]; meta: { next_cursor: string | null } };
export const supportChat = {
  open: () => apiFetch<{ data: SupportConversation }>('/chat/support', { method: 'POST' }),
  get: (id: string) => apiFetch<{ data: SupportConversation }>(`/chat/conversations/${encodeURIComponent(id)}`),
  list: (q: string, filter: string, cursor?: string) => apiFetch<ChatPage<SupportConversation>>(`/chat/conversations?${new URLSearchParams({ q, filter, ...(cursor ? { cursor } : {}) })}`),
  messages: (id: string, before?: string) => apiFetch<ChatPage<SupportMessage>>(`/chat/conversations/${encodeURIComponent(id)}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  send: (id: string, body: string, client_id: string) => apiFetch<{ data: SupportMessage }>(`/chat/conversations/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { body, client_id } }),
  read: (id: string, through_message_id: string) => apiFetch(`/chat/conversations/${encodeURIComponent(id)}/read`, { method: 'POST', body: { through_message_id } }),
};
export function chatSocketUrl() {
  const url = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000', window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/api/v1/chat/ws`;
  return url.toString();
}
export function supportRole(owner: SupportOwner) {
  return `${owner.role === 'student' ? 'Sinh viên' : 'Giảng viên'} · ${owner.student_code || owner.email}`;
}
export function chatDay(value: string) {
  const date = new Date(value), now = new Date();
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d);
  if (day(date) === day(now)) return 'Hôm nay';
  if (day(date) === day(new Date(now.getTime() - 86400000))) return 'Hôm qua';
  return date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}
export function chatTime(value: string) {
  return new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
}
