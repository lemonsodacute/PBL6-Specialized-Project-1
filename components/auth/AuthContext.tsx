'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@/types';
import { api, setSessionToken, clearSessionToken } from '@/lib/api';
import { subscribeVisibleRefresh } from '@/lib/visible-refresh';

type AuthContextValue = { user: User | null; authReady: boolean; login: (user: User, accessToken?: string) => void; logout: () => void; refreshProfile: () => Promise<void>; };
const AuthContext = createContext<AuthContextValue | undefined>(undefined);
// Luu user data vao sessionStorage thay vi localStorage:
// - Moi tab co sessionStorage rieng -> dang nhap 2 tai khoan khac nhau o 2 tab khong bi xung dot.
// - localStorage dung chung -> tab sau dang nhap ghi de user/cookie cua tab truoc.
const STORAGE_KEY = 'ai-proctoring-current-user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const userId = user?.id;
  const profileGeneration = useRef(0);
  const sessionGeneration = useRef(0);
  const restoredProfileFor = useRef<string | null>(null);
  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    const generation = ++profileGeneration.current;
    let fresh;
    try { fresh = (await api.auth.me()).user; }
    catch (cause) {
      // A failed avatar refresh must not display a potentially revoked photo or
      // turn a successful card confirmation into an identity error.
      setUser(current => {
        if (!current || current.id !== userId || current.role !== 'student' || generation !== profileGeneration.current) return current;
        const fallback = { ...current, avatar_url: null, avatar_source: null, avatar_reference_id: null, avatar_updated_at: null };
        if (JSON.stringify(fallback) === JSON.stringify(current)) return current;
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(fallback));
        return fallback;
      });
      throw cause;
    }
    if (fresh.id !== userId || generation !== profileGeneration.current) return;
    setUser(current => {
      if (!current || current.id !== userId) return current;
      const updated = { ...current, ...fresh };
      if (JSON.stringify(updated) === JSON.stringify(current)) return current;
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, [userId]);
  useEffect(() => {
    if (user?.role !== 'student') return;
    let active = true;
    const refresh = () => { if (active && document.visibilityState === 'visible') void refreshProfile().catch(() => undefined); };
    if (restoredProfileFor.current !== user.id) refresh();
    const unsubscribe = subscribeVisibleRefresh(refresh);
    window.addEventListener('student-card-updated', refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => { active = false; unsubscribe(); window.clearInterval(timer); window.removeEventListener('student-card-updated', refresh); };
  }, [user?.role, refreshProfile]);
  useEffect(() => {
    let active = true;
    const generation = sessionGeneration.current;
    const restore = async () => {
      // Dung sessionStorage de tach biet session giua cac tab.
      const saved = window.sessionStorage.getItem(STORAGE_KEY);
      if (!saved) {
        if (active) setAuthReady(true);
        return;
      }
      try {
        const response = await api.auth.me();
        if ((JSON.parse(saved) as User).id !== response.user.id) throw new Error('Session account changed');
        if (active && generation === sessionGeneration.current) {
          const current = response.user as User;
          restoredProfileFor.current = current.id;
          setUser(current);
          window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current));
          // /me already validated the account and role. Token rotation can
          // finish in the background without blocking every workspace route.
          setAuthReady(true);
          // Lam moi token neu co (refresh truoc de co token moi cho tab nay).
          try {
            const refreshed = await api.auth.refresh();
            const refreshedUser = refreshed.user as Pick<User, 'id'> | undefined;
            if (refreshed.access_token && refreshedUser?.id === current.id && active && generation === sessionGeneration.current) setSessionToken(refreshed.access_token);
          } catch {
            // Refresh that bai khong sao; van con token hien tai trong sessionStorage.
          }
        }
      } catch {
        if (active && generation === sessionGeneration.current) {
          // Chi xoa session cua tab nay, khong anh huong den cac tab khac.
          setUser(null);
          window.sessionStorage.removeItem(STORAGE_KEY);
          clearSessionToken();
        }
      } finally {
        if (active && generation === sessionGeneration.current) setAuthReady(true);
      }
    };
    void restore();
    return () => { active = false; };
  }, []);
  const value = useMemo(() => ({
    user, authReady,
    refreshProfile,
    // login nhan them accessToken tuy chon tu response /login va /register.
    login: (nextUser: User, accessToken?: string) => {
      sessionGeneration.current++;
      restoredProfileFor.current = null;
      profileGeneration.current++;
      setUser(nextUser);
      setAuthReady(true);
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(nextUser));
      if (accessToken) setSessionToken(accessToken);
    },
    // Clear this tab's state and the browser's shared authentication cookies.
    logout: () => {
      sessionGeneration.current++;
      restoredProfileFor.current = null;
      // Clear the HttpOnly cookies too; local storage cleanup alone leaves the
      // browser authenticated for direct API requests after logging out.
      void api.auth.logout().catch(() => undefined);
      profileGeneration.current++;
      setUser(null);
      setAuthReady(true);
      window.sessionStorage.removeItem(STORAGE_KEY);
      clearSessionToken();
    },
  }), [authReady, user, refreshProfile]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
