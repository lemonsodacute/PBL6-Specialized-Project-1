'use client';
import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from './useDialogFocus';
export function Modal({ open, title, children, onClose, className = '', size = 'medium' }: { open: boolean; title: string; children: ReactNode; onClose: () => void; className?: string; size?: 'small' | 'medium' | 'large' | 'extra-large' }) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  useDialogFocus(open, dialog, onClose);
  useLayoutEffect(() => {
    if (!open) return;
    const fit = () => {
      const viewport = window.visualViewport;
      overlay.current?.style.setProperty('--dialog-viewport-height', `${viewport?.height ?? innerHeight}px`);
      if (overlay.current) overlay.current.style.top = `${viewport?.offsetTop ?? 0}px`;
    };
    fit();
    window.visualViewport?.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('scroll', fit);
    window.addEventListener('resize', fit);
    return () => {
      window.visualViewport?.removeEventListener('resize', fit);
      window.visualViewport?.removeEventListener('scroll', fit);
      window.removeEventListener('resize', fit);
    };
  }, [open]);
  if (!open) return null;
  return createPortal(<div ref={overlay} className="ui-overlay"><div ref={dialog} tabIndex={-1} className={`ui-modal ui-modal-${size} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="modal-heading"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} aria-hidden="true" /></button></div><div className="modal-body">{children}</div></div></div>, document.body);
}
