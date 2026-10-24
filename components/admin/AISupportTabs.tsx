import Link from 'next/link';
import { Activity, BookOpen } from 'lucide-react';
import styles from './AISupportTabs.module.css';

/** These tabs navigate routes, preserving native link and keyboard behavior. */
export function AISupportTabs({ selected }: { selected: 'activity' | 'knowledge' }) {
  return <nav className={styles.tabs} aria-label="Phân hệ AI Support">
    <Link href="/admin/ai-support/activity" aria-current={selected === 'activity' ? 'page' : undefined}><Activity size={17} aria-hidden="true" />Hoạt động AI</Link>
    <Link href="/admin/ai-support/knowledge" aria-current={selected === 'knowledge' ? 'page' : undefined}><BookOpen size={17} aria-hidden="true" />Kho tri thức</Link>
  </nav>;
}
