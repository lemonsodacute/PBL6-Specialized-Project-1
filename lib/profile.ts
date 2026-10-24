import type { User } from '@/types';

/** Public fields returned by /auth/me; never includes password_hash. */
export type UserProfile = Pick<User,
  'id' | 'full_name' | 'email' | 'role' | 'phone' | 'avatar_url' | 'avatar_source' | 'avatar_reference_id' | 'avatar_updated_at' | 'is_active' | 'created_at' |
  'student_code' | 'class_name' | 'identity_profile_status' | 'identity_profile_version' | 'identity_verified_at' | 'student_card_status'
>;

export function userInitials(name?: string | null): string {
  return name?.trim().split(/\s+/).map((part) => part[0]).slice(-2).join('').toUpperCase() || 'SV';
}

export function profilePhotoUrl(value?: string | null): string | null {
  if (!value?.trim()) return null;
  try {
    const base = `${(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')}/`;
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
