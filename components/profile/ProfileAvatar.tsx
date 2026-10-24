'use client';
import { useEffect, useState } from 'react';
import { profilePhotoUrl, userInitials } from '@/lib/profile';
import { fetchProfileAvatar } from '@/lib/profile-avatar';
import type { AvatarFields } from '@/types';

export type AvatarUser = AvatarFields & { full_name: string; role?: string };
export function ProfileAvatar({ user, className = '', fallbackClassName, alt, decorative = false }: {
  user: AvatarUser; className?: string; fallbackClassName?: string; alt?: string; decorative?: boolean;
}) {
  const [photo, setPhoto] = useState<{ path: string; url: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const privatePath = user.avatar_source === 'STUDENT_CARD' || (user.role === 'teacher' && user.avatar_source === 'TEACHER_UPLOAD') ? user.avatar_url : null;
  // Students have identity-derived photos only; other roles keep existing photos.
  const publicUrl = user.role !== 'student' && !privatePath ? profilePhotoUrl(user.avatar_url) : null;
  useEffect(() => {
    if (!privatePath) return;
    const controller = new AbortController(); let url = '';
    fetchProfileAvatar(privatePath, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setPhoto({ path: privatePath, url });
    }).catch(() => { if (!controller.signal.aborted) setPhoto(null); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [privatePath, retry]);
  useEffect(() => {
    if (!privatePath || (photo?.path === privatePath && photo.url !== failed)) return;
    const refresh = () => { if (document.visibilityState === 'visible') setRetry(value => value + 1); };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer); };
  }, [privatePath, photo, failed]);
  const src = privatePath ? photo?.path === privatePath ? photo.url : null : publicUrl;
  return src && src !== failed ? <img className={className} src={src} alt={decorative ? '' : alt ?? `Ảnh hồ sơ của ${user.full_name}`}
    aria-hidden={decorative || undefined} referrerPolicy="no-referrer" style={{ objectFit: 'cover' }} onError={() => setFailed(src)} />
    : <span className={fallbackClassName ?? className} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : 'Chưa có ảnh hồ sơ'} aria-hidden={decorative || undefined}>{userInitials(user.full_name)}</span>;
}
