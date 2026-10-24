import { apiFetch } from './api';
import type { AIError } from './ai-provider';
import type { SupportCase } from './support-chat';

export type SupportSource = { id: string; title: string; route: string; steps: string[] };
export type AssistantSession = {
  id: string; status: SupportCase['status']; phase: 'CATEGORY' | 'DETAIL' | 'FEEDBACK' | 'ESCALATE' | 'UNAVAILABLE';
  provider_configured: boolean;
  provider_error?: AIError | null;
  ai_error?: AIError | null;
  support_error?: { code: 'SUPPORT_KNOWLEDGE_NOT_FOUND'; message: string } | null;
  category: string | null; conversation_id: string | null; greeting: string;
  title?: string; topic?: string | null; created_at?: string; updated_at?: string;
  closed_at?: string | null; closed_by?: string | null;
  categories: { id: string; label: string }[]; topics: { id: string; label: string }[];
  messages: { id: string; user_text: string; assistant_text: string; sources: SupportSource[]; used_provider: boolean; created_at: string; action?: string }[];
};
export type SupportHistoryItem = { id: string; status: AssistantSession['status']; title: string; created_at: string; updated_at: string; closed_at: string | null; unread_count?: number };
export type SupportCommand = { client_id: string; action: 'category' | 'topic' | 'message' | 'clarify' | 'retry' | 'resolved' | 'unresolved' | 'escalate' | 'close' | 'reopen'; text?: string; value?: string; route?: string };
export const supportAssistant = {
  start: (fresh = false, client_id?: string) => apiFetch<{ data: AssistantSession }>('/support-assistant/sessions', { method: 'POST', body: { new: fresh, ...(client_id ? { client_id } : {}) } }),
  history: (cursor?: string) => apiFetch<{ data: SupportHistoryItem[]; meta: { next_cursor: string | null } }>(`/support-assistant/sessions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  get: (id: string) => apiFetch<{ data: AssistantSession }>(`/support-assistant/sessions/${encodeURIComponent(id)}`),
  act: (id: string, command: SupportCommand) => apiFetch<{ data: AssistantSession }>(`/support-assistant/sessions/${encodeURIComponent(id)}/turns`, { method: 'POST', body: command, timeoutMs: 75_000 }),
};
