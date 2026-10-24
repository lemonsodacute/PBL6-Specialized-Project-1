'use client';

import { ChevronRight } from 'lucide-react';
import { NavigationIcon } from './NavigationIcon';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SidebarHint } from './SidebarHint';
import styles from './Sidebar.module.css';

export function SidebarNavGroup({ label, active, pathname, compact = false, children }: {
  label: string; active: boolean; pathname: string; compact?: boolean; children: ReactNode;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(active);
  const [flyout, setFlyout] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusFirst = useRef(false);

  // Opening an active child (including a hard reload) reveals its navigation.
  // A manual collapse remains possible until the next route change.
  useEffect(() => { if (active) setExpanded(true); }, [active, pathname]);
  useEffect(() => { setFlyout(false); }, [pathname, compact]);
  useLayoutEffect(() => {
    if (!flyout || !compact || !trigger.current || !panel.current) return;
    const rect = trigger.current.getBoundingClientRect();
    setPosition({ left: rect.right + 12, top: Math.max(12, Math.min(rect.top, innerHeight - panel.current.offsetHeight - 12)) });
    if (focusFirst.current) { panel.current.querySelector<HTMLElement>('a[href]')?.focus(); focusFirst.current = false; }
  }, [flyout, compact]);
  useEffect(() => {
    if (!flyout || !compact) return;
    const outside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setFlyout(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setFlyout(false); trigger.current?.focus(); }
    };
    const close = () => setFlyout(false);
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close); window.removeEventListener('scroll', scroll, true);
    };
  }, [flyout, compact]);

  const reveal = () => { focusFirst.current = true; setFlyout(true); };
  const disclosure = compact ? flyout : expanded;

  return <div className="sidebar-nav-section">
    <SidebarHint label={label} enabled={compact} suppressed={flyout}>
    <button ref={trigger} type="button" className={`student-nav-group ${disclosure ? 'expanded' : ''} ${active ? 'is-active' : ''}`}
      onClick={() => { if (compact) { if (flyout) setFlyout(false); else reveal(); } else setExpanded(value => !value); }}
      onKeyDown={event => { if (compact && ['ArrowRight', 'ArrowDown'].includes(event.key)) { event.preventDefault(); reveal(); } }}
      aria-expanded={disclosure} aria-controls={id}>
      <NavigationIcon label={label} /><span className="nav-label">{label}</span>
      <ChevronRight className="sidebar-nav-chevron" size={16} aria-hidden="true" />
    </button>
    </SidebarHint>
    {!compact && <div id={id} className="student-nav-children" hidden={!expanded}>{children}</div>}
    {compact && !flyout && <div id={id} hidden />}
    {compact && flyout && createPortal(<div ref={panel} id={id} className={styles.flyout} style={position} role="region" aria-label={label} data-student-presentation={pathname.startsWith('/student') || undefined}
      onClick={event => { if ((event.target as Element).closest('a[href]')) setFlyout(false); }}
      onKeyDown={event => {
        const links = Array.from(panel.current?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? []);
        const index = links.indexOf(document.activeElement as HTMLAnchorElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
          links[next]?.focus();
        } else if (event.key === 'Tab' && ((event.shiftKey && index === 0) || (!event.shiftKey && index === links.length - 1))) {
          event.preventDefault(); setFlyout(false);
          const controls = Array.from(trigger.current?.closest('aside')?.querySelectorAll<HTMLElement>('a[href],button') ?? []).filter(node => node.getClientRects().length > 0);
          const next = controls[controls.indexOf(trigger.current!) + 1];
          (event.shiftKey ? trigger.current : next ?? trigger.current)?.focus();
        }
      }}>
      <p className={styles.flyoutHeading}>{label}</p>{children}
    </div>, document.body)}
  </div>;
}
