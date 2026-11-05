'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthContext';
import { SupportAssistant } from '@/components/chat/SupportAssistant';
import { useSupportChat } from '@/components/chat/SupportChatProvider';
import { useDialogFocus } from './useDialogFocus';
import { SupportChatButton } from './SupportChatButton';
import styles from '@/components/chat/SupportChat.module.css';

/** Retains the existing floating entry point and opens real support chat. */
export function AIChatbox() {
  const { user } = useAuth(); const router = useRouter(); const params = useSearchParams(); const pathname = usePathname();
  const { count } = useSupportChat(); const id = useId();
  const [open, setOpen] = useState(false);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  useEffect(() => { setPortalRoot(document.body); }, []);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeChat = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  useDialogFocus(open, dialog, closeChat);
  const target = params.get('chat');
  useEffect(() => { setOpen(false); }, [user?.id]);
  useEffect(() => { if (target && user?.role !== 'admin') setOpen(true); }, [target, user?.role]);
  if (!user || !portalRoot) return null;
  const closeButton = <SupportChatButton open controls={id} onClick={closeChat} />;
  // Keep both entry point and drawer outside transformed or scrolling shells.
  return createPortal(<><SupportChatButton buttonRef={trigger} hidden={open} count={count} controls={user.role === 'admin' ? undefined : id}
    onClick={() => user.role === 'admin' ? router.push('/admin/messages') : setOpen(true)} />{open && <div className={styles.overlay} data-student-presentation={user.role === 'student' || undefined}>
    <button className={styles.backdrop} aria-label="Đóng chat hỗ trợ bên ngoài" tabIndex={-1} onClick={closeChat} />
    <div id={id} className={styles.drawer} ref={dialog} role="dialog" aria-modal="true" aria-label="ProctoOwl Support" tabIndex={-1}>
      <SupportAssistant key={user.id} headerAction={closeButton} initialConversationId={target} onInitialConversationHandled={() => {
        const next = new URLSearchParams(params.toString()); next.delete('chat');
        router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
      }} />
    </div>
  </div>}</>, portalRoot);
}
