import { api, apiFetch, ApiError } from './api';
import type { LiveClass, Notification } from '@/types';


export type StudentClassDetail = {
  id: string;
  name: string;
  description: string | null;
  students_count: number;
  teacher: { id?: string; full_name: string; email?: string } | null;
};

export type StudentExam = {
  id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  status: string;
  max_attempts: number;
  allow_review: boolean;
  require_camera: boolean;
  require_mic?: boolean;
  require_fullscreen: boolean;
  questions_count?: number;
  classes?: { id: string; name: string }[];
};

const unwrap = <T,>(response: unknown): T => (response as { data: T }).data;

export async function getStudentClass(classId: string): Promise<StudentClassDetail> {
  return unwrap<StudentClassDetail>(await api.classes.get(classId));
}

export async function getStudentExamsByClass(classId: string): Promise<StudentExam[]> {
  const response = unwrap<StudentExam[]>(await api.exams.list({ limit: 100 }));
  // TODO: switch to api.exams.list({ class_id: classId }) once the backend supports it.
  return response.filter((exam) => exam.classes?.some((item) => item.id === classId));
}

export async function getLiveClassesByClass(classId: string): Promise<{ items: LiveClass[]; usedMockFallback: boolean }> {
  const response = await apiFetch<{ data: LiveClass[] }>(`/classes/${encodeURIComponent(classId)}/live-classes`);
  return { items: response.data ?? [], usedMockFallback: false };
}

export async function getNotificationUnreadCount(): Promise<number> {
  const response = await apiFetch<{ data: { count: number } }>('/notifications/unread-count');
  return response.data.count;
}

export async function getNotifications(limit = 8): Promise<Notification[]> {
  const response = await apiFetch<{ data: Notification[] }>(`/notifications?page=1&limit=${limit}`);
  return response.data;
}

export async function markNotificationRead(id: string): Promise<Notification | null> {
  const response = await apiFetch<{ data: Notification }>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
  return response.data;
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiFetch('/notifications/read-all', { method: 'PATCH' });
}

export async function getWebRtcIceServers(): Promise<RTCIceServer[]> {
  try {
    const response = await apiFetch<{ data: { ice_servers: RTCIceServer[] } }>('/config/webrtc');
    return response.data?.ice_servers ?? [{ urls: 'stun:stun.l.google.com:19302' }];
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return [{ urls: 'stun:stun.l.google.com:19302' }];
    throw error;
  }
}
