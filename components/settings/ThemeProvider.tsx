'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthContext';
import { api } from '@/lib/api';
import type { ThemePreference } from '@/lib/settings';

const ThemeContext = createContext<{ savedTheme: (theme: ThemePreference) => void }>({ savedTheme: () => undefined });
const valid = (theme: unknown): theme is ThemePreference => ['light', 'dark', 'system'].includes(String(theme));
const cacheKey = (id: string) => `ai-proctoring-theme:${id}`;
function apply(theme: ThemePreference) {
  const resolved = theme === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user, authReady } = useAuth();
  const [preference, setPreference] = useState<ThemePreference>('system');
  const currentUser = useRef(user?.id); currentUser.current = user?.id;
  const revision = useRef(0);
  const savedTheme = useCallback((theme: ThemePreference) => {
    if (!valid(theme) || currentUser.current !== user?.id) return;
    revision.current++;
    setPreference(theme); apply(theme);
    if (user?.id) { try { localStorage.setItem(cacheKey(user.id), theme); } catch { /* The server save is authoritative even when storage is unavailable. */ } }
  }, [user?.id]);
  useEffect(() => {
    if (!authReady) return;
    let active = true; const id = user?.id;
    const request = ++revision.current;
    let cached: ThemePreference = 'system';
    if (id) { try { const value = localStorage.getItem(cacheKey(id)); if (valid(value)) cached = value; } catch { /* Storage is optional. */ } }
    setPreference(cached); apply(cached);
    if (id) void api.settings.me().then(settings => { if (active && currentUser.current === id && request === revision.current) savedTheme(settings.theme); }).catch(() => undefined);
    return () => { active = false; };
  }, [authReady, user?.id, savedTheme]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => { if (preference === 'system') apply('system'); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [preference]);
  return <ThemeContext.Provider value={{ savedTheme }}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);

