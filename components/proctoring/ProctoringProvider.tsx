'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthContext';
import { connectProctorSocket, type ProctorChange } from '@/lib/proctoring';

const Context = createContext<{ connected: boolean; revision: number; change: ProctorChange | null }>({ connected: false, revision: 0, change: null });
export function ProctoringProvider({ children }: { children: ReactNode }) {
  const { user, authReady } = useAuth();
  const id = authReady && user && ['teacher', 'admin'].includes(user.role) ? user.id : null;
  const [state, setState] = useState({ userId: id, connected: false, revision: 0, change: null as ProctorChange | null });
  useEffect(() => {
    setState({ userId: id, connected: false, revision: 0, change: null });
    if (!id) return;
    return connectProctorSocket(id, {
      state: connected => setState(value => ({ ...value, connected })),
      change: message => {
        setState(value => ({ ...value, revision: value.revision + 1, change: message }));
        if (['proctor_event_created', 'proctor_event_reviewed', 'ready', 'resync'].includes(message.type))
          window.dispatchEvent(new Event('proctor-notifications-updated'));
      },
    });
  }, [id]);
  return <Context.Provider value={state.userId === id ? state : { connected: false, revision: 0, change: null }}>{children}</Context.Provider>;
}
export const useProctorRealtime = () => useContext(Context);
