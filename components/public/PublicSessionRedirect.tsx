'use client';

import { useEffect, useLayoutEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthContext';

// Only the homepage decides where to go. Session restoration stays in AuthProvider.
export function PublicSessionRedirect() {
  const { user, authReady } = useAuth();
  const router = useRouter();
  useLayoutEffect(() => {
    // Also covers client-side visits, where the initial document script may not run.
    if (user || (!authReady && sessionStorage.getItem('ai-proctoring-current-user'))) {
      document.documentElement.dataset.publicHomeAuth = 'pending';
    }
    if (authReady && !user) delete document.documentElement.dataset.publicHomeAuth;
  }, [authReady, user]);
  useEffect(() => {
    if (!authReady || !user) return;
    router.replace(user.role === 'student' ? '/student' : user.role === 'admin' ? '/admin' : '/dashboard');
  }, [authReady, user, router]);
  useEffect(() => () => { delete document.documentElement.dataset.publicHomeAuth; }, []);
  return null;
}
