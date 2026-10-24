'use client';

import { useId, type Ref } from 'react';
import { MessageCircle, X } from 'lucide-react';
import styles from './SupportChatButton.module.css';

export function SupportChatButton({ open = false, count = 0, onClick, controls, hidden, buttonRef }: {
  open?: boolean; count?: number; onClick: () => void; controls?: string; hidden?: boolean; buttonRef?: Ref<HTMLButtonElement>;
}) {
  const tooltipId = useId();
  return <button ref={buttonRef} type="button" hidden={hidden} data-camera-avoid={!open || undefined}
    className={`${styles.button} ${open ? styles.close : styles.floating}`}
    onClick={onClick} aria-label={open ? 'Đóng chat hỗ trợ' : 'Mở tin nhắn hỗ trợ'}
    aria-controls={controls} aria-expanded={controls ? open : undefined}
    aria-describedby={!open ? tooltipId : undefined}>
    {open ? <X size={22} aria-hidden="true" /> : <MessageCircle size={22} aria-hidden="true" />}
    {!open && count > 0 && <span className={styles.badge} aria-label={`${count} tin nhắn chưa đọc`}>{count > 9 ? '9+' : count}</span>}
    {!open && <span id={tooltipId} role="tooltip" className={styles.tooltip}>Tin nhắn hỗ trợ</span>}
  </button>;
}
