'use client';

import { cloneElement, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import styles from './Sidebar.module.css';

/** Portaled hints stay visible outside the sidebar's scroll container. */
export function SidebarHint({ label, enabled, suppressed = false, children }: {
  label: string; enabled: boolean; suppressed?: boolean; children: ReactElement<{ 'aria-describedby'?: string }>;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const cancelHide = () => { if (hideTimer.current) clearTimeout(hideTimer.current); hideTimer.current = null; };
  const scheduleHide = () => {
    cancelHide();
    if (root.current?.contains(document.activeElement)) return;
    hideTimer.current = setTimeout(() => setPosition(null), 180);
  };
  const show = () => {
    cancelHide();
    if (!enabled || suppressed || !root.current) return;
    const rect = root.current.getBoundingClientRect();
    setPosition({ left: rect.right + 12, top: Math.max(40, Math.min(innerHeight - 40, rect.top + rect.height / 2)) });
  };
  useEffect(() => {
    if (!position) return;
    const hide = () => setPosition(null);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('keydown', escape);
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); document.removeEventListener('keydown', escape); };
  }, [position]);
  useEffect(() => { if (!enabled || suppressed) setPosition(null); }, [enabled, suppressed]);
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);
  if (!enabled) return children;
  const visible = !suppressed && position;
  return <div ref={root} className={styles.hintAnchor}
    onPointerEnter={event => { if (event.pointerType !== 'touch') show(); }} onPointerLeave={scheduleHide}
    onFocus={show} onBlur={() => setPosition(null)}>
    {cloneElement(children, { 'aria-describedby': visible ? id : undefined })}
    {visible && createPortal(<div id={id} role="tooltip" className={styles.tooltip} style={position} onPointerEnter={cancelHide} onPointerLeave={scheduleHide}>{label}</div>, document.body)}
  </div>;
}
