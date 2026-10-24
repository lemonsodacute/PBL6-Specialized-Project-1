'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthContext';
import { WorkspaceShell, teacherNavigation } from '@/components/layout/AppShell';
import { LoadingSkeleton } from '@/components/ui';

const links = [{ href: '/teacher', label: 'Tổng quan' }, ...teacherNavigation.slice(1)];

export default function TeacherLayout({ children }: { children: ReactNode }) {
  const { user, authReady } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!authReady) return;
    if (!user) router.replace('/login');
    else if (user.role !== 'teacher') router.replace(user.role === 'admin' ? '/admin' : '/student');
  }, [authReady, user, router]);
  if (!authReady || !user || user.role !== 'teacher') return <div className="workspace-page"><LoadingSkeleton rows={3} /></div>;
  return <WorkspaceShell user={user} navigation={links} contentClassName="workspace-page">{children}</WorkspaceShell>;
}
