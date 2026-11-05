'use client';

import Link from 'next/link';
import { useRef, type KeyboardEvent } from 'react';
import { Activity, BookOpen } from 'lucide-react';
import styles from './AISupportTabs.module.css';

export const supportTabId = (tab: 'activity' | 'knowledge') => `ai-support-tab-${tab}`;
export const supportPanelId = (tab: 'activity' | 'knowledge') => `ai-support-panel-${tab}`;

/** Manual-activation tabs: arrows move focus; Enter/Space follow existing routes. */
export function AISupportTabs({ selected }: { selected: 'activity' | 'knowledge' }) {
  const list = useRef<HTMLDivElement>(null);
  const keyDown = (event: KeyboardEvent<HTMLAnchorElement>) => {
    const tabs = Array.from(list.current?.querySelectorAll<HTMLAnchorElement>('[role="tab"]') ?? []);
    const index = tabs.indexOf(event.currentTarget);
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next]?.focus();
    } else if (event.key === ' ') { event.preventDefault(); event.currentTarget.click(); }
  };
  const inactive = selected === 'activity' ? 'knowledge' : 'activity';
  return <><nav aria-label="Phân hệ hỗ trợ AI"><div ref={list} className={styles.tabs} role="tablist" aria-label="Phân hệ hỗ trợ AI">
    {(['activity', 'knowledge'] as const).map(tab => {
      const active = selected === tab, Icon = tab === 'activity' ? Activity : BookOpen;
      return <Link key={tab} href={`/admin/ai-support/${tab}`} role="tab" id={supportTabId(tab)} aria-controls={supportPanelId(tab)}
        aria-selected={active} aria-current={active ? 'page' : undefined} tabIndex={active ? 0 : -1} onKeyDown={keyDown}>
        <Icon size={17} aria-hidden="true" />{tab === 'activity' ? 'Hoạt động AI' : 'Kho tri thức'}
      </Link>;
    })}
  </div></nav><div role="tabpanel" id={supportPanelId(inactive)} aria-labelledby={supportTabId(inactive)} hidden /></>;
}
