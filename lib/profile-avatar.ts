import { getSessionToken } from './api';

export async function fetchProfileAvatar(path: string, signal: AbortSignal): Promise<Blob> {
  if (!/^\/api\/v1\/(users|teachers)\/[0-9a-f-]+\/avatar\/[0-9a-f-]+$/.test(path)) throw new Error('Ảnh hồ sơ không hợp lệ.');
  const base = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
  const token = getSessionToken();
  const response = await fetch(`${base}${path}`, { signal, credentials: 'include', cache: 'no-store',
    headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/jpeg')) throw new Error('Ảnh hồ sơ không còn khả dụng.');
  return response.blob();
}
