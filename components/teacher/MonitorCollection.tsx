'use client';

import Link from 'next/link';
import { Search, Clock, ArrowRight, TriangleAlert, Play, Check, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useCollectionState, useServerCollection, type ListParams } from '@/lib/collections';
import { Badge, Button, Card, Input, Select, LoadingSkeleton } from '@/components/ui';
import { EmptySearchState } from '@/components/collections/CollectionToolbar';
import { resultDate } from '@/lib/teacher-results';
import { monitoringCount, monitoringLabels, monitoringPage, monitoringPhase, monitoringPhases, readAllPages,
  type MonitoringExam, type MonitoringPhase } from '@/lib/teacher-monitor';
import styles from './MonitorCollection.module.css';

function Icon({ name }: { name: 'search' | 'clock' | 'arrow' | 'warning' | 'play' | 'check' | 'refresh' }) {
  const Glyph = { search: Search, clock: Clock, arrow: ArrowRight, warning: TriangleAlert, play: Play, check: Check, refresh: RefreshCw }[name];
  return <Glyph aria-hidden="true" strokeWidth={1.7} />;
}

function ClassFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(false);
    readAllPages<{ id: string; name: string }>(api.classes.list, { sort: 'name' })
      .then(rows => { if (active) setClasses(rows); }).catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);
  return <div className={styles.classFilter}>
    <Select aria-label="Lớp" value={value} aria-busy={loading} disabled={loading || error} onChange={event => onChange(event.target.value)}>
      <option value="">{loading ? 'Đang tải lớp...' : error ? 'Không tải được lớp' : 'Lớp: Tất cả'}</option>
      {value && !classes.some(cls => cls.id === value) && <option value={value}>Lớp đã chọn</option>}
      {classes.map(cls => <option key={cls.id} value={cls.id}>{cls.name}</option>)}
    </Select>
    {error && <Button variant="ghost" size="sm" onClick={() => setRetry(count => count + 1)}>Tải lại lớp</Button>}
  </div>;
}

type Summary = { working?: number; submitted?: number; violations?: number; total?: number };
function ExamCard({ exam, phase, refreshKey }: { exam: MonitoringExam; phase: MonitoringPhase; refreshKey: number }) {
  const [summary, setSummary] = useState<Summary>(), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true, busy = false;
    setSummary(undefined); setError(false);
    async function load() {
      if (busy) return;
      busy = true;
      try {
        // Full-exam summary, independent of pagination. violations counts
        // attempts with warnings, not individual warning events or unique students.
        const response = await api.attempts.list(exam.id, { page: 1, limit: 1 });
        const meta = (response as unknown as { meta?: { summary?: Summary; total?: number } }).meta;
        const raw = meta?.summary;
        if (active) {
          setSummary({ working: monitoringCount(raw?.working), submitted: monitoringCount(raw?.submitted), violations: monitoringCount(raw?.violations), total: monitoringCount(meta?.total) });
          setError(false);
        }
      } catch { if (active) setError(true); }
      finally { busy = false; }
    }
    void load();
    const timer = phase === 'open' ? window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000) : undefined;
    return () => { active = false; if (timer) window.clearInterval(timer); };
  }, [exam.id, phase, refreshKey, retry]);
  const submitted = summary?.submitted ?? monitoringCount(exam.completed_attempt_count);
  const attempts = summary?.total ?? monitoringCount(exam.attempt_count);
  const classes = exam.classes.map(cls => cls.name).join(' · ') || 'Chưa giao lớp';
  const action = phase === 'ended' ? 'Xem báo cáo' : phase === 'open' ? 'Mở giám sát' : 'Xem chi tiết';
  const href = `/dashboard/monitor/${exam.id}`;
  return <Card borderRole={summary?.violations ? 'warning' : 'exams'} className={`${styles.examCard} ${phase === 'open' ? styles.activeCard : ''}`}>
    <div className={styles.cardStatus}>
      <Badge className={`${styles.status} ${styles[phase]}`}><span className={styles.dot} />{monitoringLabels[phase]}</Badge>
      {attempts !== undefined && <span className={styles.attempts}>{attempts} lượt làm bài</span>}
    </div>
    <div className={styles.examInfo}>
      <h3 title={exam.title}>{exam.title}</h3>
      <p className={styles.className} title={classes}>{classes}</p>
      <div className={styles.schedule}><Icon name="clock" /><span><time dateTime={exam.start_time}>{resultDate(exam.start_time)}</time><span className={styles.dateArrow}> <ArrowRight className="inline-icon" aria-hidden="true" /> </span><time dateTime={exam.end_time}>{resultDate(exam.end_time)}</time></span></div>
    </div>
    <dl className={styles.metrics} aria-label="Số liệu theo lượt làm bài">
      {summary?.working !== undefined && <div className={styles.working}><dt><Icon name="play" />Lượt đang thi</dt><dd>{summary.working}</dd></div>}
      {submitted !== undefined && <div className={styles.submitted}><dt><Icon name="check" />Lượt đã nộp</dt><dd>{submitted}</dd></div>}
      {summary?.violations !== undefined && <div className={summary.violations > 0 ? styles.warning : ''}><dt><Icon name="warning" />Lượt có cảnh báo</dt><dd>{summary.violations}</dd></div>}
    </dl>
    {error && <div className={styles.metricError}><span>Chưa tải được số liệu giám sát.</span><button type="button" onClick={() => setRetry(count => count + 1)}>Thử lại</button></div>}
    <Link className={`ui-button ${phase === 'open' ? 'ui-button-primary' : 'ui-button-outline'} ${styles.cardAction}`} href={href} aria-label={`${action}: ${exam.title}`}>{action}<Icon name="arrow" /></Link>
  </Card>;
}

export default function MonitorCollection() {
  const state = useCollectionState({ class_id: '', exam_id: '', period: '' }, 'start_time');
  const cache = useRef<{ key: string; promise: Promise<MonitoringExam[]> }>();
  const [now, setNow] = useState(Date.now()), [refreshKey, setRefreshKey] = useState(0);
  async function load(params: ListParams) {
    // Search/class filters stay server-side; grouping precedes UI pagination.
    const filters = { q: params.q, class_id: params.class_id, exam_id: params.exam_id, sort: 'start_time' };
    const key = JSON.stringify(filters);
    if (cache.current?.key !== key) {
      const promise = Promise.all(['published', 'ongoing', 'closed'].map(status => readAllPages<MonitoringExam>(api.exams.list, { ...filters, status })))
        .then(groups => [...new Map(groups.flat().map(exam => [exam.id, exam])).values()]);
      cache.current = { key, promise };
      promise.catch(() => { if (cache.current?.promise === promise) cache.current = undefined; });
    }
    const exams = await cache.current!.promise;
    const snapshot = Date.now();
    setNow(snapshot);
    return monitoringPage(exams, params, snapshot);
  }
  const result = useServerCollection<MonitoringExam>(state, load);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setNow(Date.now());
      void result.reload(true);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [result.reload]);
  const refresh = () => { cache.current = undefined; setRefreshKey(count => count + 1); setNow(Date.now()); void result.reload(); };
  const page = Number(state.values.page), limit = Number(state.values.limit), total = result.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));
  const pageNumbers = [...new Set([1, page - 1, page, page + 1, pages].filter(value => value >= 1 && value <= pages))].sort((a, b) => a - b);
  return <div className={`workspace-page an-page ${styles.page}`}>
    <div className={styles.toolbar} role="search" aria-label="Tìm kiếm và lọc đề thi giám sát">
      <div className={styles.search}><Icon name="search" /><Input aria-label="Tìm đề thi" type="search" placeholder="Tìm đề thi..." value={state.values.q} onChange={event => state.set('q', event.target.value)} /></div>
      <ClassFilter value={state.values.class_id} onChange={value => state.set('class_id', value)} />
      <Select aria-label="Trạng thái" value={state.values.period} onChange={event => state.set('period', event.target.value)}><option value="">Trạng thái: Tất cả</option>{monitoringPhases.filter(phase => phase !== 'unknown').map(phase => <option key={phase} value={phase}>{monitoringLabels[phase]}</option>)}</Select>
      <Select aria-label="Sắp xếp" value={state.values.sort} onChange={event => state.set('sort', event.target.value)}><option value="start_time">Sắp xếp: Gần nhất</option><option value="name">Tên đề: A–Z</option></Select>
      <Button variant="outline" className={styles.refresh} aria-label="Làm mới giám sát" title="Làm mới giám sát" disabled={result.loading} onClick={refresh}><Icon name="refresh" /></Button>
    </div>
    {state.active && <div className={styles.filterSummary}><span>Đang áp dụng bộ lọc</span><Button variant="ghost" size="sm" onClick={state.clear}>Xóa bộ lọc</Button></div>}
    {result.loading && <LoadingSkeleton rows={3} />}
    {result.error && <Card role="alert" className={styles.error}><p>{result.error}</p><Button onClick={refresh}>Thử lại</Button></Card>}
    {!result.loading && !result.error && <div className={styles.results}>
      {result.rows.length ? monitoringPhases.map(phase => {
        const exams = result.rows.filter(exam => monitoringPhase(exam, now) === phase);
        return exams.length ? <section key={phase} className={styles.section} aria-labelledby={`monitor-${phase}`}>
          <div className={styles.sectionHeading}><h2 id={`monitor-${phase}`}>{phase === 'open' && <span className={styles.liveDot} />}{monitoringLabels[phase]}</h2><span>{exams.length} đề{pages > 1 ? ' trên trang này' : ''}</span></div>
          <div className={styles.grid}>{exams.map(exam => <ExamCard key={exam.id} exam={exam} phase={phase} refreshKey={refreshKey} />)}</div>
        </section> : null;
      }) : <Card><EmptySearchState state={state} /></Card>}
      <footer className={styles.footer}>
        <span role="status">{result.total === null ? `Đã tải ${result.rows.length} kết quả` : `Hiển thị ${result.rows.length ? (page - 1) * limit + 1 : 0}–${result.rows.length ? (page - 1) * limit + result.rows.length : 0} trên ${total} kết quả`}</span>
        {(total > 20 || limit > 20) && <label className={styles.pageSize}><Select aria-label="Số kết quả mỗi trang" value={state.values.limit} onChange={event => state.set('limit', event.target.value)}>{[20, 50, 100].map(size => <option key={size} value={size}>{size} / trang</option>)}</Select></label>}
        {pages > 1 && <nav className={styles.pagination} aria-label="Phân trang"><Button variant="outline" aria-label="Trang trước" disabled={page <= 1} onClick={() => state.set('page', String(page - 1))}>‹</Button>{pageNumbers.map((number, index) => <span key={number}>{index > 0 && number - pageNumbers[index - 1] > 1 && <span className={styles.ellipsis}>…</span>}<Button variant={number === page ? 'primary' : 'outline'} aria-label={`Trang ${number}`} aria-current={number === page ? 'page' : undefined} onClick={() => state.set('page', String(number))}>{number}</Button></span>)}<Button variant="outline" aria-label="Trang sau" disabled={page >= pages} onClick={() => state.set('page', String(page + 1))}>›</Button></nav>}
      </footer>
    </div>}
  </div>;
}
