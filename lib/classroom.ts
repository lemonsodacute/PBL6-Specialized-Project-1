import type { LiveClass } from '@/types';

export type ClassroomSession = LiveClass & { class_name?: string; teacher_name?: string; provider_close_pending?: boolean };
export type RoomToken = { provider: 'livekit'; url: string; server_url?: string; room_name: string; token: string };
export type ConnectionState = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED' | 'ERROR';
export type ClassroomDevices = { camera: boolean; microphone: boolean; videoDevice?: string; audioDevice?: string };
export type ClassroomMedia = { attach(element: HTMLMediaElement): HTMLMediaElement; detach(element: HTMLMediaElement): HTMLMediaElement };
export type ClassroomParticipant = { id: string; sid: string; name: string; local: boolean; mic: boolean; camera: boolean; speaking: boolean; video?: ClassroomMedia; audio?: ClassroomMedia };
export type ClassroomChat = { id: string; sender: string; name: string; text: string; time: number };
export type AttendanceRow = { student_id: string; full_name: string; joined_at: string | null; left_at: string | null; duration_sec: number; status: string };
export interface ClassroomTransport {
  subscribe(listener: () => void): () => void;
  connect(token: RoomToken): Promise<void>;
  publish(devices: ClassroomDevices): Promise<void>;
  disconnect(): Promise<void>;
  participants(): ClassroomParticipant[];
  connectionState(): ConnectionState;
  localSid(): string;
  messages(): ClassroomChat[];
  microphone(enabled: boolean): Promise<void>;
  camera(enabled: boolean): Promise<void>;
  chat(text: string): Promise<void>;
  startAudio(): Promise<void>;
  audioBlocked(): boolean;
}

export const classroomListPath = (role?: string) => role === 'student' ? '/student/live-classes' : '/dashboard/live-classes';
export const classroomDate = (value?: string | null) => value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
export const classroomDuration = (seconds: number) => `${Math.floor(seconds / 60)} phút ${seconds % 60} giây`;

export async function createClassroomTransport(provider: RoomToken['provider']): Promise<ClassroomTransport> {
  if (provider !== 'livekit') throw new Error('Dịch vụ phòng học không được hỗ trợ.');
  const { LiveKitClassroom } = await import('./classroom-livekit');
  return new LiveKitClassroom();
}
