'use client';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthContext';
import { Button, Card, Input, LoadingSkeleton } from '@/components/ui';

import { api } from '@/lib/api';
import { helpContent } from '@/lib/help-content';
import styles from './SettingsHelp.module.css';

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLocaleLowerCase('vi').trim();
export function HelpPage({ role }: { role: 'student' | 'teacher' | 'admin' }) {
  const { user, authReady } = useAuth(); const [query, setQuery] = useState(''); const [support, setSupport] = useState(''); const [supportError, setSupportError] = useState(false); const [loadingSupport, setLoadingSupport] = useState(true);
  const allowed = authReady && user?.role === role;
  const loadSupport = useCallback(async () => {
    setLoadingSupport(true); setSupportError(false);
    try { setSupport((await api.settings.support()).support_text); }
    catch { setSupportError(true); }
    finally { setLoadingSupport(false); }
  }, []);
  useEffect(() => { if (allowed) void loadSupport(); }, [allowed, loadSupport]);
  if (!authReady) return <LoadingSkeleton rows={4} />;
  if (!allowed) return <Card role="alert">Bạn không có quyền truy cập trang trợ giúp này.</Card>;
  const content = helpContent[role]; const term = normalize(query);
  const guides = content.guides.filter(item => normalize(item.title + ' ' + item.body).includes(term));
  const faq = content.faq.filter(item => normalize(item.question + ' ' + item.answer).includes(term));
  return <div className={`workspace-page ${styles.help}`}>
    <label className={styles.field}>Tìm kiếm hướng dẫn<Input type="search" placeholder="Tìm kiếm hướng dẫn..." value={query} onChange={event => setQuery(event.target.value)} /></label>
    <section aria-labelledby="quick-guides"><h2 id="quick-guides" className={styles.groupHeading}>Truy cập nhanh</h2><div className={styles.quickGrid}>{content.quick.map(item => <Link key={item.href} href={item.href} className={styles.quickLink}>{item.label}<span aria-hidden="true"><ArrowRight className="inline-icon" aria-hidden="true" /></span></Link>)}</div></section>
    <section aria-labelledby="help-guides"><h2 id="help-guides" className={styles.groupHeading}>Hướng dẫn sử dụng</h2><div className={styles.guides}>{guides.map(item => <Card key={item.title} className={styles.guide}><h3>{item.title}</h3><p>{item.body}</p><Link className="table-link" href={item.href}>{item.linkLabel} <ArrowRight className="inline-icon" aria-hidden="true" /></Link></Card>)}</div>{!guides.length && <p>Không tìm thấy hướng dẫn phù hợp.</p>}</section>
    <section aria-labelledby="help-faq"><h2 id="help-faq" className={styles.groupHeading}>Câu hỏi thường gặp</h2><div className={styles.faq}>{faq.map(item => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div>{!faq.length && <p>Không tìm thấy câu hỏi phù hợp.</p>}</section>
    <Card className={styles.section}><h2>Liên hệ hỗ trợ</h2>{loadingSupport ? <p role="status">Đang tải thông tin hỗ trợ...</p> : supportError ? <><p className={styles.support}>Liên hệ quản trị viên hệ thống để được hỗ trợ.</p><p role="alert" className={styles.muted}>Chưa tải được thông tin hỗ trợ hiện tại.</p><Button variant="outline" onClick={() => void loadSupport()}>Tải lại thông tin hỗ trợ</Button></> : <p className={styles.support}>{support}</p>}</Card>
  </div>;
}
