'use client';
import { WorkspaceShell } from '@/components/layout/AppShell';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthContext';
import { LoadingSkeleton } from '@/components/ui';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname(); const router = useRouter(); const { user, authReady } = useAuth();
  useEffect(() => {
    if (!authReady) return;
    if (!user) router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
    else if (user.role !== 'admin') router.replace(user.role === 'student' ? '/student' : '/dashboard');
  }, [authReady, user, pathname, router]);
  if (!authReady || !user || user.role !== 'admin') return <div className="mx-auto max-w-3xl p-8"><LoadingSkeleton rows={4} /></div>;
  return <WorkspaceShell user={user} contentClassName="workspace-page">{children}</WorkspaceShell>;
}
