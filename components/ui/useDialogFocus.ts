'use client';

import { useEffect, useRef, type RefObject } from 'react';

let activeLocks=0;let originalOverflow='';

/** Shared keyboard and scroll behavior for modal dialogs and navigation drawers. */
export function useDialogFocus(open: boolean, container: RefObject<HTMLElement>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open || !container.current) return;
    const element = container.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if(activeLocks===0)originalOverflow=document.body.style.overflow;
    activeLocks++;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(element.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
      .filter(item => item.getClientRects().length > 0 && !item.closest('[inert]'));
    // A drawer can still be visibility:hidden in the click's style frame.
    const frame = requestAnimationFrame(() => (focusable()[0] ?? element).focus());
    const handleKey = (event: KeyboardEvent) => {
      if(event.defaultPrevented||(event.target instanceof Element&&event.target.closest('[role="menu"]')))return;
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).filter(item => item.getClientRects().length > 0);
      if (dialogs.length && dialogs[dialogs.length - 1] !== element) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0]; const last = items[items.length - 1];
      if (!first) { event.preventDefault(); element.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      cancelAnimationFrame(frame);
      activeLocks--;
      if(activeLocks===0)document.body.style.overflow=originalOverflow;
      document.removeEventListener('keydown', handleKey, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, container]);
}
