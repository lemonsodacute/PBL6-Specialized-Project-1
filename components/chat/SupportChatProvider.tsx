'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthContext';
import { api, apiFetch, getSessionToken, setSessionToken } from '@/lib/api';
import { chatSocketUrl } from '@/lib/support-chat';
import { subscribeVisibleRefresh } from '@/lib/visible-refresh';

type ChatState = { count: number; revision: number; connected: boolean; refresh: () => void };
const Context = createContext<ChatState>({ count: 0, revision: 0, connected: false, refresh: () => {} });

export function SupportChatProvider({ children }: { children: ReactNode }) {
  const { user, authReady } = useAuth();
  const userId = authReady ? user?.id : undefined;
  const [state, setState] = useState({ userId, count: 0, revision: 0, connected: false });
  const active = useRef(userId); active.current = userId;
  const countEpoch = useRef(0);
  const refresh = useCallback((notifyNotifications = true) => {
    if (!userId) return;
    setState(current => current.userId === userId ? { ...current, revision: current.revision + 1 } : current);
    if (notifyNotifications) window.dispatchEvent(new Event('support-chat-updated'));
    const epoch = ++countEpoch.current;
    void apiFetch<{ data: { count: number } }>('/chat/unread-count').then(result => {
      if (active.current === userId && epoch === countEpoch.current && Number.isInteger(result.data.count))
        setState(current => current.count === result.data.count ? current : { ...current, count: result.data.count });
    }).catch(() => {});
  }, [userId]);
  useEffect(() => {
    setState({ userId, count: 0, revision: 0, connected: false });
    if (!userId) return;
    let disposed = false, socket: WebSocket | null = null, failures = 0;
    let reconnect: ReturnType<typeof setTimeout>, watchdog: ReturnType<typeof setTimeout>;
    // Subscribe before the initial snapshot so there is no missing-event gap.
    // A slow/unavailable socket still gets an HTTP snapshot within 500 ms.
    let initialSnapshot: ReturnType<typeof setTimeout>;
    let fallback: ReturnType<typeof setInterval> | undefined;
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(chatSocketUrl());
      const current = socket;
      watchdog = setTimeout(() => current.close(), 8000);
      current.onopen = () => current.send(JSON.stringify({ type: 'auth', token: getSessionToken() }));
      current.onmessage = event => {
        if (disposed || socket !== current) return;
        let data; try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'ping') { current.send('pong'); return; }
        if (data.type === 'ready') {
          clearTimeout(initialSnapshot);
          clearTimeout(watchdog); failures = 0;
          if (fallback) { clearInterval(fallback); fallback = undefined; }
          setState(value => ({ ...value, connected: true }));
        }
        if (['ready', 'message', 'read', 'resync'].includes(data.type)) refresh(data.type !== 'ready');
      };
      current.onerror = () => current.close();
      current.onclose = async event => {
        clearTimeout(watchdog);
        if (disposed || socket !== current) return;
        setState(value => ({ ...value, connected: false }));
        failures++;
        if (failures >= 3 && !fallback) fallback = setInterval(() => { if (document.visibilityState === 'visible') refresh(false); }, 15000);
        if (event.code === 1008) {
          try {
            const result = await api.auth.refresh();
            if (!disposed && result.access_token && (result.user as { id?: string })?.id === userId) setSessionToken(result.access_token);
          } catch {}
        }
        if (!disposed) reconnect = setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(failures, 4)));
      };
    };
    initialSnapshot = setTimeout(() => refresh(false), 500);
    connect();
    const focus = () => { if (document.visibilityState === 'visible') refresh(false); };
    const unsubscribe = subscribeVisibleRefresh(focus);
    return () => {
      disposed = true; countEpoch.current++;
      clearTimeout(initialSnapshot); clearTimeout(reconnect); clearTimeout(watchdog); if (fallback) clearInterval(fallback);
      socket?.close(); unsubscribe();
    };
  }, [userId, refresh]);
  const value = useMemo(() => ({ count: state.userId === userId ? state.count : 0, revision: state.revision,
    connected: state.userId === userId && state.connected, refresh }), [state, userId, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useSupportChat = () => useContext(Context);
