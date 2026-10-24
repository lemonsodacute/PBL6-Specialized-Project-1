import { apiFetch, getSessionToken } from './api';
import type { AvatarFields } from '@/types';

export type ManagedCardStatus = 'NOT_SUBMITTED' | 'PENDING_CONFIRMATION' | 'VERIFIED' | 'NEEDS_REUPLOAD' | 'REVOKED';
export const cardLabels: Record<ManagedCardStatus, string> = { NOT_SUBMITTED: 'Chưa gửi', PENDING_CONFIRMATION: 'Chờ xác nhận', VERIFIED: 'Đã xác thực', NEEDS_REUPLOAD: 'Yêu cầu cập nhật', REVOKED: 'Đã thu hồi' };
export type CardReference = {
  id: string; status: string; verified_at: string; identity_profile_version: number;
  verification_source: 'STUDENT_SELF_CONFIRM' | 'ADMIN_CONFIRM' | 'SYSTEM_MIGRATION';
  verified_by_user_id: string | null; verified_by_role: string | null; verified_by_name: string | null;
  revoked_at: string | null; revoke_reason: string | null;
  ocr_model_version?: string | null; parser_version?: string | null; matching_version?: string | null;
  face_model_name?: string | null; face_model_version?: string | null; face_preprocessing_version?: string | null;
};
export type ManagedCard = AvatarFields & {
  student_id: string; full_name: string; student_code: string | null; email: string; is_active: boolean;
  class_name?: string | null;
  identity_profile_status: 'VERIFIED' | 'PENDING'; identity_profile_version: number;
  student_card_status: string; management_status: ManagedCardStatus; card_admin_version: number;
  update_reason: string | null; reference: CardReference | null; face_preview_url?: string | null;
};
export type CardEvent = { id: string; action: string; actor_role: string | null; actor_name: string | null; reason: string | null; created_at: string; reference_id: string | null };
type PageResult<T> = { data: T[]; meta: { total: number; page: number; limit: number } };
const root = '/admin/student-cards';
export const adminCards = {
  list: (q: string, status: string, page: number, limit=20) => apiFetch<PageResult<ManagedCard>>(`${root}?${new URLSearchParams({ q, status, page: String(page), limit: String(limit) })}`, { cache: 'no-store' }),
  detail: async (id: string) => (await apiFetch<{ data: ManagedCard }>(`${root}/${encodeURIComponent(id)}`, { cache: 'no-store' })).data,
  history: (id: string, page = 1) => apiFetch<PageResult<CardEvent>>(`${root}/${encodeURIComponent(id)}/history?page=${page}&limit=30`, { cache: 'no-store' }),
  change: async (card: ManagedCard, action: 'request-update' | 'revoke', reason: string) => (await apiFetch<{ data: ManagedCard }>(`${root}/${encodeURIComponent(card.student_id)}/${action}`, { method: 'POST', body: {
    identity_profile_version: card.identity_profile_version, card_admin_version: card.card_admin_version, reference_id: card.reference?.id ?? null, reason,
  } })).data,
  notify: (id: string, title: string, message: string) => apiFetch(`${root}/${encodeURIComponent(id)}/notifications`, { method: 'POST', body: { title, message } }),
  image: async (path: string, signal: AbortSignal) => {
    if (!/^\/api\/v1\/admin\/student-cards\/[0-9a-f-]+\/references\/[0-9a-f-]+\/face$/.test(path)) throw new Error('Ảnh không hợp lệ.');
    const base = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
    const token = getSessionToken();
    const response = await fetch(`${base}${path}`, { signal, cache: 'no-store', credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/jpeg')) throw new Error('Ảnh định danh không còn khả dụng.');
    return response.blob();
  },
};

export function confirmationActor(ref: CardReference | null) {
  if (!ref) return 'Chưa xác nhận';
  if (ref.verification_source === 'STUDENT_SELF_CONFIRM') return 'Sinh viên tự xác nhận';
  if (ref.verification_source === 'ADMIN_CONFIRM') return ref.verified_by_name ? `Admin ${ref.verified_by_name}` : 'Admin (tài khoản không còn khả dụng)';
  return 'Dữ liệu cũ — chưa lưu người xác nhận';
}
