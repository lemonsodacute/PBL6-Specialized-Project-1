'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronRight, ShieldCheck } from 'lucide-react';
import { Button, Card, EmptyState, Input, LoadingSkeleton, Select } from '@/components/ui';
import { eventDate, eventLabels, proctorApi, severityLabels, type ProctorReport } from '@/lib/proctoring';
import { useProctorRealtime } from './ProctoringProvider';
import { ProctorEventDetail, StudentEventTimeline } from './ProctorEventDetail';
import styles from './ExamMonitoringReport.module.css';

const attemptLabels: Record<string, string> = { in_progress: 'Đang làm bài', submitted: 'Đã nộp', auto_submitted: 'Nộp tự động', terminated: 'Đã kết thúc', not_started: 'Chưa bắt đầu' };

export function ExamMonitoringReport({ examId, attemptId }: { examId: string; attemptId?: string }) {
  const router = useRouter(), search = useSearchParams(), realtime = useProctorRealtime();
  const simulated = search.get('simulation') === '1', scope = simulated ? '?simulation=1' : '';
  const [data, setData] = useState<ProctorReport | null>(null), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [term, setTerm] = useState(''), [filter, setFilter] = useState('all'), [severity, setSeverity] = useState(''), [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0), [loading, setLoading] = useState(true);
  const [event, setEvent] = useState<string | null>(search.get('event'));
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => { const timer = setTimeout(() => { setTerm(query); setPage(1); }, 250); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { setEvent(search.get('event')); }, [search]);
  useEffect(() => {
    let live = true; setLoading(true); setError('');
    void proctorApi.report(examId, simulated, { q: term, alert_filter: filter, severity, page }).then(result => {
      if (!result.exam || !Array.isArray(result.attempts)) throw new Error('Invalid report');
      if (live) setData(result);
    }).catch(() => { if (live) setError('Không tải được báo cáo giám sát hoặc bạn không có quyền xem đề thi này.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [examId, simulated, term, filter, severity, page, revision, realtime.revision]);
  const root = `/dashboard/monitor/${examId}`;
  const closeDetail = () => { setEvent(null); router.replace(root + scope); };
  const closeEvent = () => { setEvent(null); if (!attemptId) router.replace(root + scope); };
  const student = (id: string) => { setEvent(null); router.push(`${root}/${id}${scope}`); };
  const metrics = data ? [
    ['Sinh viên tham gia', data.participating_students, 'users'], ['Sinh viên có cảnh báo', data.students_with_alerts, 'warning'],
    ['Tổng cảnh báo', data.summary.total, 'warning'], ['Cảnh báo chưa xem', data.summary.new, 'warning'], ['Đã xác nhận', data.summary.confirmed, 'danger'],
    ['Đã bỏ qua', data.summary.dismissed, 'success'], ['Mức cao / nghiêm trọng', data.summary.high_priority, 'danger'],
  ] as const : [];
  return <div className={`workspace-page ${styles.page}`}>
    <Link className={styles.back} href="/dashboard/monitor"><ArrowLeft size={16} aria-hidden="true"/>Quay lại Giám sát</Link>
    <header className={styles.header}><div><span className={styles.eyebrow}>GIÁM SÁT THI</span><h1>Báo cáo giám sát</h1><p>{data?.exam_title || 'Đang tải đề thi…'}</p></div><ShieldCheck size={30} aria-hidden="true"/></header>
    {simulated && <p className={styles.notice}>Mô phỏng · Số liệu kiểm thử riêng, không thuộc cảnh báo thực tế.</p>}
    {error && <Card role="alert"><p>{error}</p><Button variant="outline" onClick={refresh}>Thử lại</Button></Card>}
    {!data && loading && <LoadingSkeleton rows={5}/>}
    {data && !error && <>
      <Card borderRole="exams" className={styles.context}><dl>
        <div><dt>Lớp học</dt><dd>{data.exam.classes.map(item => item.name).join(' · ') || 'Giao trực tiếp cho sinh viên'}</dd></div>
        <div><dt>Giảng viên</dt><dd>{data.exam.teacher_name || '—'}</dd></div>
        <div><dt>Mở đề</dt><dd>{eventDate(data.exam.start_time)}</dd></div><div><dt>Đóng đề</dt><dd>{eventDate(data.exam.end_time)}</dd></div>
        <div><dt>Thời gian làm bài</dt><dd>{data.exam.duration_minutes} phút</dd></div>
        <div><dt>Trạng thái</dt><dd>{data.exam.status === 'closed' || Date.now() >= Date.parse(data.exam.end_time) ? 'Đã kết thúc' : 'Trong thời gian mở đề'}</dd></div>
      </dl></Card>
      <div className={styles.metrics}>{metrics.map(([label, value, borderRole]) => <Card key={label} borderRole={borderRole}><span>{label}</span><strong>{value}</strong></Card>)}</div>
      {data.summary.total > 0 && <Card borderRole="warning"><h2>Phân bố cảnh báo</h2><ul className={styles.breakdown}>{data.types.map(item => <li key={item.event_type}><span>{eventLabels[item.event_type] || item.event_type}</span><span className={styles.track}><i style={{ width: `${Math.max(2, item.count / data.summary.total * 100)}%` }}/></span><strong>{item.count}</strong></li>)}</ul></Card>}
      {data.total_attempts === 0 ? <Card><EmptyState title="Chưa có lượt làm bài cho đề thi này.">Báo cáo sẽ xuất hiện khi có phiên thi được lưu.</EmptyState></Card> : <>
        {data.summary.total === 0 && <Card borderRole="success"><EmptyState title="Không có cảnh báo giám sát.">Không có sự kiện bất thường được ghi nhận trong các phiên thi này.</EmptyState></Card>}
        <section className={styles.students} aria-busy={loading}><div className={styles.sectionHeading}><div><h2>Danh sách sinh viên</h2><p>{data.total_attempts} lượt làm bài · Mỗi lượt thi được xem xét riêng</p></div><Button variant="outline" disabled={loading} onClick={refresh}>Làm mới</Button></div>
          <div className={styles.filters} role="search" aria-label="Lọc lượt thi"><Input type="search" value={query} aria-label="Tìm theo tên hoặc MSSV" placeholder="Tìm theo tên hoặc MSSV..." onChange={e => setQuery(e.target.value)}/>
            <Select aria-label="Lọc cảnh báo" value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}><option value="all">Tất cả sinh viên</option><option value="with_alerts">Có cảnh báo</option><option value="unresolved">Chưa xử lý</option><option value="confirmed">Đã xác nhận</option><option value="dismissed">Đã bỏ qua</option></Select>
            <Select aria-label="Mức cảnh báo cao nhất" value={severity} onChange={e => { setSeverity(e.target.value); setPage(1); }}><option value="">Tất cả mức độ</option>{Object.entries(severityLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</Select>
          </div>
          <div className={styles.tableWrap}><table className={`ui-table ${styles.table}`}><thead><tr><th>Sinh viên / MSSV</th><th>Lượt thi</th><th>Trạng thái</th><th>Cảnh báo</th><th>Mức cao nhất</th><th>Xác nhận / Bỏ qua</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{data.attempts.map(item => <tr key={item.id}>
            <td data-label="Sinh viên"><strong>{item.student.full_name}</strong><small>{item.student.student_code || 'Chưa có MSSV'}</small></td><td data-label="Lượt thi">Lần {item.attempt_number}</td><td data-label="Trạng thái">{attemptLabels[item.status] || item.status}</td><td data-label="Cảnh báo"><strong>{item.total}</strong>{item.new > 0 && <small>{item.new} chưa xem</small>}</td><td data-label="Mức cao nhất"><span className={item.highest_severity ? styles[item.highest_severity] : styles.muted}>{item.highest_severity ? severityLabels[item.highest_severity] : 'Không có cảnh báo'}</span></td><td data-label="Xác nhận / Bỏ qua">{item.confirmed} / {item.dismissed}</td><td><Link className={styles.detailLink} href={`${root}/${item.id}${scope}`} aria-label={`Xem chi tiết ${item.student.full_name}, lần ${item.attempt_number}`}>Xem chi tiết<ChevronRight size={15} aria-hidden="true"/></Link></td>
          </tr>)}</tbody></table></div>
          {!data.attempts.length && <Card><p>Không có lượt thi phù hợp bộ lọc.</p></Card>}
          <nav className={styles.pagination} aria-label="Phân trang lượt thi"><span>{data.pagination.total} lượt thi phù hợp · Trang {page}</span><Button variant="outline" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>Trang trước</Button><Button variant="outline" disabled={loading || page * data.pagination.limit >= data.pagination.total} onClick={() => setPage(value => value + 1)}>Trang sau</Button></nav>
        </section>
      </>}
      <p className={styles.disclaimer}>Cảnh báo hỗ trợ giảng viên xem xét. Quyết định xác nhận không tự động thay đổi điểm thi.</p>
    </>}
    {attemptId && !event && <StudentEventTimeline key={`${examId}:${attemptId}`} examId={examId} attemptId={attemptId} simulated={simulated} revision={revision + realtime.revision} onClose={closeDetail} onEvent={setEvent}/>}
    {event && <ProctorEventDetail key={event} id={event} examId={examId} revision={revision + realtime.revision} onClose={closeEvent} onReviewed={refresh} onStudent={student}/>}
  </div>;
}
