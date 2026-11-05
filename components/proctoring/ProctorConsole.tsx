'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, ChevronRight, RefreshCw, ShieldAlert, Wifi, WifiOff, X } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthContext';
import { api, ApiError } from '@/lib/api';
import { readCollection } from '@/lib/collections';
import { Button, Card, EmptyState, Input, LoadingSkeleton, Select } from '@/components/ui';
import { eventLabel, eventLabels, eventTime, proctorApi, statusLabels, connectProctorSocket, uuidPattern,
  type ProctorEvent, type ProctorFeed, type ProctorHealth } from '@/lib/proctoring';
import { useProctorRealtime } from './ProctoringProvider';
import { ProctorEventDetail, SeverityBadge } from './ProctorEventDetail';
import { CallPanel } from './CallPanel';
import styles from './ProctorConsole.module.css';

type SessionRow = { id: string; status: string; student: { id?: string; full_name: string; student_code?: string | null } | null };
const sessionLabels: Record<string, string> = { in_progress: 'Đang làm bài', submitted: 'Đã nộp', auto_submitted: 'Nộp tự động', terminated: 'Đã kết thúc', not_started: 'Chưa bắt đầu' };

export function ProctorConsole(props: { examId: string; linkedAttemptId?: string }) {
  const { user } = useAuth(), search = useSearchParams();
  return <ConsoleBody key={`${user?.id}|${props.examId}|${search.get('simulation')}`} {...props} />;
}

function ConsoleBody({ examId, linkedAttemptId }: { examId: string; linkedAttemptId?: string }) {
  const { user } = useAuth(), realtime = useProctorRealtime(), search = useSearchParams(), router = useRouter();
  const userId = user?.id, valid = uuidPattern.test(examId ?? ''), simulated = search.get('simulation') === '1';
  const [query, setQuery] = useState(search.get('q') ?? ''), [term, setTerm] = useState(query), [filter, setFilter] = useState('all'), [eventType, setEventType] = useState(''), [page, setPage] = useState(1);
  const [data, setData] = useState<ProctorFeed | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [health, setHealth] = useState<ProctorHealth | null>(null), [healthError, setHealthError] = useState(false), [healthRevision, setHealthRevision] = useState(0);
  const [sessions, setSessions] = useState<SessionRow[]>([]), [sessionTotal, setSessionTotal] = useState<number | null>(null), [sessionPage, setSessionPage] = useState(1), [sessionsError, setSessionsError] = useState(false), [studentsOpen, setStudentsOpen] = useState(false);
  const linkedEventId = search.get('event');
  const [selected, setSelected] = useState<string | null>(linkedEventId), [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(linkedAttemptId ?? null);
  const [camera, setCamera] = useState<{ id: string; name: string } | null>(null), [busy, setBusy] = useState<string | null>(null), [toast, setToast] = useState<ProctorEvent | null>(null), [revision, setRevision] = useState(0);
  const epoch = useRef(0), seen = useRef(new Set<string>()), currentScope = useRef('');
  currentScope.current = `${examId}|${simulated}`;
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => { setData(null); setHealth(null); setSessions([]); setSessionTotal(null); setToast(null); setPage(1); setLoading(true); }, [examId, simulated]);
  useEffect(() => { setStudentsOpen(matchMedia('(min-width: 1024px)').matches); }, []);
  useEffect(() => { const timer = setTimeout(() => { setTerm(query); setPage(1); setSessionPage(1); }, 250); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { setSelected(linkedEventId); }, [linkedEventId]);
  useEffect(() => { setSelectedAttemptId(linkedAttemptId ?? null); setPage(1); }, [linkedAttemptId]);
  useEffect(() => {
    if (!valid) { setLoading(false); setError('Mã đề thi không hợp lệ. Hãy chọn một đề thi từ danh sách giám sát.'); return; }
    const version = ++epoch.current;
    setError('');
    void proctorApi.feed(examId, { q: term, simulated, page, limit: 30, event_type: eventType,
      status: filter === 'new' ? 'NEW' : filter === 'reviewed' ? 'REVIEWED' : filter === 'dismissed' ? 'DISMISSED' : filter === 'confirmed' ? 'CONFIRMED' : undefined,
      priority: filter === 'priority', attempt_id: selectedAttemptId ?? undefined }).then(result => { if (version === epoch.current) setData(result); })
      .catch(cause => { if (version === epoch.current) setError(cause instanceof ApiError && [403, 404].includes(cause.status) ? 'Bạn không có quyền truy cập đề thi này hoặc đề thi không còn tồn tại.' : 'Không thể cập nhật cảnh báo. Dữ liệu đã tải được giữ lại; vui lòng thử lại.'); })
      .finally(() => { if (version === epoch.current) setLoading(false); });
    return () => { if (epoch.current === version) epoch.current = version + 1; };
  }, [valid, examId, simulated, term, filter, eventType, selectedAttemptId, page, revision, realtime.revision]);
  useEffect(() => {
    if (!valid) return;
    let active = true; setSessionsError(false);
    void api.attempts.list(examId, { q: term, sort: 'name', page: sessionPage, limit: 30 }).then(response => {
      const result = readCollection<SessionRow>(response);
      if (active) { setSessions(result.data); setSessionTotal(result.meta?.total ?? null); }
    }).catch(() => { if (active) setSessionsError(true); });
    return () => { active = false; };
  }, [valid, examId, term, sessionPage, revision, realtime.revision]);
  useEffect(() => {
    if (!valid) return;
    let active = true;
    void proctorApi.health(examId).then(result => { if (active) { setHealth(result); setHealthError(false); } }).catch(() => { if (active) setHealthError(true); });
    return () => { active = false; };
  }, [valid, examId, revision, realtime.revision, healthRevision]);
  useEffect(() => { const timer = setInterval(() => { if (document.visibilityState === 'visible') setHealthRevision(value => value + 1); }, 30000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!userId || !valid || !realtime.connected) return;
    return connectProctorSocket(userId, { state: () => {}, change: message => {
      if (['attempt_update', 'attempt_started', 'attempt_submitted', 'violation', 'ready', 'resync'].includes(message.type)) refresh();
    } }, examId);
  }, [userId, valid, examId, realtime.connected, refresh]);
  useEffect(() => {
    if (!valid || realtime.connected) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000);
    return () => clearInterval(timer);
  }, [valid, realtime.connected, refresh]);
  useEffect(() => { const focus = () => { if (document.visibilityState === 'visible') refresh(); }; window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus); }, [refresh]);
  useEffect(() => {
    const change = realtime.change, id = change?.data?.id;
    if (change?.type !== 'proctor_event_created' || !id || change.data?.exam_id !== examId || Boolean(change.data?.is_simulated) !== simulated || seen.current.has(id)) return;
    seen.current.add(id); if (seen.current.size > 1000) seen.current.delete(seen.current.values().next().value!);
    const scope = currentScope.current;
    void proctorApi.detail(id).then(event => { if (currentScope.current === scope && event.status === 'NEW' && ['high', 'critical'].includes(event.severity)) setToast(event); }).catch(() => {});
  }, [realtime.change, examId, simulated]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 8000); return () => clearTimeout(timer); }, [toast]);
  async function review(event: ProctorEvent, status: 'DISMISSED' | 'CONFIRMED') {
    if (busy) return; setBusy(event.id); setError('');
    try { await proctorApi.review(event, status); refresh(); window.dispatchEvent(new Event('proctor-notifications-updated')); }
    catch (cause) { setError(cause instanceof ApiError && cause.status === 409 ? 'Giám thị khác đã cập nhật cảnh báo này. Danh sách đang được tải lại.' : 'Chưa lưu được quyết định. Vui lòng thử lại.'); refresh(); }
    finally { setBusy(null); }
  }
  const close = () => { setSelected(null); if (search.has('event')) router.replace(`/dashboard/monitor/${examId}${simulated ? '?simulation=1' : ''}`); };
  const selectAttempt = (id: string | null) => { setSelected(null); setSelectedAttemptId(id); setPage(1); if (search.has('event')) router.replace(`/dashboard/monitor/${examId}${simulated ? '?simulation=1' : ''}`); };
  const openEvent = (id: string) => { setSelected(id); };
  const summary = data?.meta.summary, exam = data?.meta.exam;
  const selectedSession = sessions.find(item => item.id === selectedAttemptId);
  const selectedLabel = selectedSession?.student?.full_name ?? data?.data.find(event => event.attempt_id === selectedAttemptId)?.student.full_name ?? 'Phiên làm bài đã chọn';
  const live = exam && ['published', 'ongoing'].includes(exam.status) && Date.now() >= Date.parse(exam.start_time) && Date.now() <= Date.parse(exam.end_time);
  const pages = Math.max(1, Math.ceil((data?.meta.total ?? 0) / 30));
  const types = [...new Set([eventType, ...(data?.meta.event_types ?? data?.data.map(event => event.event_type) ?? [])].filter(Boolean))];
  const activeModels = health?.modules.some(module => module.status === 'ACTIVE');
  return <div className={`workspace-page ${styles.console}`}>
    <header className={styles.header}><div><Link className={styles.back} href="/dashboard/monitor">← Danh sách giám sát</Link><h1>{exam?.title ?? 'Giám sát phiên thi'}</h1>
      {exam && <p>{live ? 'Kết thúc lúc ' : 'Thời gian kết thúc: '}<time dateTime={exam.end_time}>{new Date(exam.end_time).toLocaleString('vi-VN')}</time></p>}</div>
      <div className={styles.connection}><span className={live ? styles.live : styles.muted}>{live ? '● LIVE' : 'Xem xét phiên thi'}</span>
        <span role="status">{realtime.connected ? <Wifi size={15} aria-hidden="true" /> : <WifiOff size={15} aria-hidden="true" />}{realtime.connected ? 'Realtime đã kết nối' : 'Realtime đang kết nối lại'}</span>
        <Button variant="outline" onClick={refresh} aria-label="Làm mới giám sát"><RefreshCw size={16} aria-hidden="true" /></Button></div>
    </header>
    {simulated && <p className={styles.simulation}>MÔ PHỎNG · Luồng kiểm thử riêng. Số liệu này không nằm trong cảnh báo thực tế.</p>}
    {healthError ? <p role="alert" className={styles.health}>Chưa tải được trạng thái module giám sát. Hãy làm mới để kiểm tra.</p>
      : health && <div className={styles.health}><ShieldAlert size={18} aria-hidden="true" /><div>
        {!health.modules.length || health.modules.every(module => module.status === 'DISABLED') ? <strong>Chưa kết nối module AI giám sát.</strong>
          : health.modules.map(module => <span key={module.provider} className={styles.module}>{module.label}: <strong>{({ ACTIVE: 'Hoạt động', DEGRADED: 'Gián đoạn', UNAVAILABLE: 'Không khả dụng', DISABLED: 'Đã tắt' })[module.status]}</strong></span>)}
        <p>Tín hiệu trình duyệt và cảnh báo AI được phân biệt rõ. Giám thị quyết định sau khi xem xét.</p></div></div>}
    {summary && <section className={styles.metrics} aria-label="Số liệu giám sát thực tế">{[
      ['Sinh viên', summary.total_students], ['Đang thi', summary.taking], ['Chưa xem', summary.new], ['Ưu tiên cao', summary.high_priority], ['Đã nộp', summary.submitted],
    ].map(([label, value]) => <Card key={label} className={styles.metric}><span>{label}</span><strong>{value}</strong></Card>)}</section>}
    {error && <div className={styles.error} role="alert">{error}<Button variant="outline" onClick={refresh}>Thử lại</Button></div>}
    <div className={styles.layout}>
      <section className={styles.feed} aria-labelledby="alert-feed-title">
        <div className={styles.sectionHeading}><div><h2 id="alert-feed-title">Luồng cảnh báo</h2><p>Mới nhất trước · Tín hiệu cần xem xét, không phải kết luận vi phạm.</p></div>{data && <span>{data.meta.total} cảnh báo{selectedAttemptId ? ' trong phiên' : ''}</span>}</div>
        {selectedAttemptId && <div className={styles.attemptFilter}><div><strong>{selectedLabel}</strong><span>Đang lọc theo phiên làm bài{selectedSession?.student?.student_code ? ` · ${selectedSession.student.student_code}` : ''}</span></div><Button variant="outline" size="sm" onClick={() => selectAttempt(null)}>Xem tất cả</Button></div>}
        <div className={styles.filters} role="search" aria-label="Lọc cảnh báo"><label>Tìm sinh viên<Input type="search" placeholder="Tên hoặc MSSV..." value={query} maxLength={120} onChange={event => setQuery(event.target.value)} /></label>
          <label>Nhóm cảnh báo<Select value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }}><option value="all">Tất cả</option><option value="new">Chưa xem</option><option value="priority">Ưu tiên cao</option><option value="reviewed">Đã xem</option><option value="dismissed">Đã bỏ qua</option><option value="confirmed">Đã xác nhận</option></Select></label>
          <label>Loại sự kiện<Select value={eventType} onChange={event => { setEventType(event.target.value); setPage(1); }}><option value="">Tất cả sự kiện</option>{types.map(kind => <option key={kind} value={kind}>{eventLabels[kind] ?? (data?.data.find(event => event.event_type === kind) ? eventLabel(data.data.find(event => event.event_type === kind)!) : kind)}</option>)}</Select></label>
        </div>
        {health?.simulator_enabled && <div className={styles.scopeLinks}><Link aria-current={!simulated ? 'page' : undefined} href={`/dashboard/monitor/${examId}`}>Cảnh báo thực tế</Link><Link aria-current={simulated ? 'page' : undefined} href={`/dashboard/monitor/${examId}?simulation=1`}>Mô phỏng</Link></div>}
        {loading && <LoadingSkeleton rows={4} />}
        {!loading && data && (data.data.length ? <ol className={styles.events}>{data.data.map(event => <li key={event.id} data-proctor-event={event.id} className={`${styles.event} ${event.status === 'NEW' ? styles.unread : ''}`}>
          <div className={styles.eventHeading}><div><strong>{event.student.full_name}</strong>{event.student.student_code && <span className={styles.muted}>{event.student.student_code}</span>}</div><SeverityBadge event={event} /></div>
          <h3>{eventLabel(event)}</h3><div className={styles.eventMeta}><time dateTime={event.occurred_at}>{eventTime(event.occurred_at)}</time><span>{statusLabels[event.status]}</span>
            {event.duration_ms > 0 && <span>{(event.duration_ms / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giây</span>}
            {event.confidence !== null && <span>Độ tin cậy {Math.round(Number(event.confidence) * 100)}%</span>}{event.is_simulated && <strong>Mô phỏng</strong>}
            {['BROWSER', 'TAB_SWITCH'].includes(event.source) && <span>Trình duyệt tự báo cáo</span>}
          </div><div className={styles.eventActions}><Button variant="outline" size="sm" onClick={() => openEvent(event.id)}>Xem</Button>
            <Button variant="ghost" size="sm" disabled={!!busy || event.status === 'DISMISSED'} onClick={() => void review(event, 'DISMISSED')}>Bỏ qua</Button>
            <Button variant="ghost" size="sm" disabled={!!busy || event.status === 'CONFIRMED'} onClick={() => void review(event, 'CONFIRMED')}>Xác nhận</Button></div>
        </li>)}</ol> : <Card><EmptyState mascot title={selectedAttemptId ? 'Phiên làm bài này chưa có cảnh báo phù hợp.' : term || filter !== 'all' || eventType ? 'Không có cảnh báo phù hợp.' : 'Chưa có cảnh báo.'}>
          {selectedAttemptId ? 'Thử thay đổi bộ lọc hoặc chọn Xem tất cả.' : term || filter !== 'all' || eventType ? 'Thử thay đổi bộ lọc để xem các cảnh báo khác.' : activeModels ? 'Chưa ghi nhận tín hiệu cần xem xét trong phiên thi.' : 'Chưa kết nối module AI giám sát. Các tín hiệu trình duyệt vẫn được ghi nhận.'}
        </EmptyState></Card>)}
        {pages > 1 && <nav className={styles.pagination} aria-label="Phân trang cảnh báo"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Trước</Button><span>Trang {page} / {pages}</span><Button variant="outline" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Sau</Button></nav>}
      </section>
      <aside className={styles.students}><details open={studentsOpen} onToggle={event => setStudentsOpen(event.currentTarget.open)}><summary>Phiên làm bài {sessionTotal !== null && <span>{sessionTotal}</span>}</summary>
        {sessionsError ? <p role="alert">Chưa tải được danh sách phiên thi.<Button onClick={refresh}>Thử lại</Button></p> : !sessions.length ? <p className={styles.muted}>{loading ? 'Đang tải phiên thi...' : 'Chưa có phiên làm bài phù hợp.'}</p>
          : <ul className={styles.sessionList}>{sessions.map(item => <li key={item.id} className={selectedAttemptId === item.id ? styles.activeSession : undefined}><button type="button" aria-pressed={selectedAttemptId === item.id} onClick={() => selectAttempt(item.id)}><div><strong>{item.student?.full_name ?? 'Chưa có thông tin sinh viên'}</strong><span>{item.student?.student_code || 'Chưa có MSSV'}</span><small>{sessionLabels[item.status] ?? item.status}</small></div><ChevronRight size={17} aria-hidden="true" /></button>{item.status === 'in_progress' && <button type="button" className={styles.cameraAction} onClick={() => setCamera({ id: item.id, name: item.student?.full_name ?? 'Sinh viên' })}>Xem camera</button>}</li>)}</ul>}
        {sessionTotal !== null && sessionTotal > 30 && <nav className={styles.pagination} aria-label="Phân trang phiên thi"><Button variant="outline" disabled={sessionPage <= 1} onClick={() => setSessionPage(value => value - 1)}>Trước</Button><span>{sessionPage}</span><Button variant="outline" disabled={sessionPage * 30 >= sessionTotal} onClick={() => setSessionPage(value => value + 1)}>Sau</Button></nav>}
      </details><Link className={styles.reportLink} href={`/dashboard/monitor/${examId}?view=report${simulated?'&simulation=1':''}`}>Xem báo cáo và tổng hợp cảnh báo<ChevronRight size={16} aria-hidden="true" /></Link>
        <p className={styles.disclaimer}><CheckCircle2 size={16} aria-hidden="true" />Quyết định của giám thị được lưu cùng thời gian và lịch sử xem xét.</p>
      </aside>
    </div>
    {selected && <ProctorEventDetail key={selected} id={selected} revision={revision + realtime.revision} onClose={close} onReviewed={refresh} onStudent={selectAttempt} />}
    {camera && <CallPanel attemptId={camera.id} studentName={camera.name} mode="monitor" onClose={() => setCamera(null)} />}
    {toast && <aside className={styles.toast} role="status" aria-label="Cảnh báo mới"><ShieldAlert size={20} aria-hidden="true" /><div><strong>{toast.is_simulated ? 'Cảnh báo mô phỏng mới' : 'Cảnh báo mới'}</strong><p>{toast.student.full_name} · {eventLabel(toast)}</p><Button variant="outline" size="sm" onClick={() => { openEvent(toast.id); setToast(null); }}>Xem ngay</Button></div><button type="button" aria-label="Đóng thông báo cảnh báo" className="icon-button" onClick={() => setToast(null)}><X size={16} aria-hidden="true" /></button></aside>}
  </div>;
}
