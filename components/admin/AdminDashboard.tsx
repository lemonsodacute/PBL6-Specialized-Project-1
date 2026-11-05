'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowUpRight, BookOpen, CheckCircle2, ClipboardList, CreditCard, Info, RefreshCw, Users, FileClock } from 'lucide-react';
import { api } from '@/lib/api';
import { readCollection } from '@/lib/collection-query';
import { adminCards, type ManagedCard } from '@/lib/admin-student-cards';
import { readOverview } from '@/lib/teacher-reports';
import { submissionTrend } from '@/lib/analytics';
import { type AuditRow, formatAuditAction, formatAuditActor, formatAuditTime } from '@/lib/audit-log-formatters';
import { Button, LoadingSkeleton, Badge } from '@/components/ui';
import { AreaChart, ChartCard, DonutChart, KpiCard } from '@/components/analytics/Charts';
import styles from './AdminAnalytics.module.css';

const countValue = (value: unknown): number | null => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
const format = (value: number) => value.toLocaleString('vi-VN');
type Exam = { id: string; title: string; status: string; duration_minutes: number };
type Stats = { classes?: number; ongoing_exams?: number; active_attempts?: number; recent_violations?: number; recent_window_minutes?: number; as_of?: string };
const loadStats = async () => { const response = await api.dashboard.stats(); return ((response as { data?: Stats }).data ?? response) as Stats; };
const loadRoles = async () => {
  const values = await Promise.all(['student', 'teacher', 'admin'].map(async role => {
    const response = readCollection(await api.users.list({ role, page: 1, limit: 1 }));
    const total = countValue(response.meta?.total);
    if (total == null) throw new Error('Missing user totals');
    return total;
  }));
  return { student: values[0], teacher: values[1], admin: values[2], total: values.reduce((sum, value) => sum + value, 0) };
};
const loadExams = async () => readCollection<Exam>(await api.exams.list({ page: 1, limit: 5, sort: 'newest' }));
const loadCards = () => adminCards.list('', 'PENDING_CONFIRMATION', 1, 3);
const loadAudit = async () => readCollection<AuditRow>(await api.auditLogs.list({ page: 1, limit: 4, sort: 'newest', role: 'admin' }));
const loadReport = async () => readOverview(await api.teacherReports.overview('', { page: 1, limit: 20 }), '');

function useRead<T>(loader: () => Promise<T>, version: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setData(null); setError(false);
    void loader().then(value => { if (active) setData(value); }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loader, version]);
  return { data, loading, error };
}

function ReadError({ children, retry }: { children: ReactNode; retry: () => void }) {
  return <div className={styles.error} role="alert"><p>{children}</p><Button variant="outline" size="sm" onClick={retry}>Thử lại</Button></div>;
}
function EmptyList({ children }: { children: ReactNode }) {
  return <p className={styles.emptyList}><CheckCircle2 size={18} aria-hidden="true" />{children}</p>;
}
const examLabels: Record<string,string> = { draft: 'Bản nháp', published: 'Đã xuất bản', ongoing: 'Đang diễn ra', closed: 'Đã đóng' };

export default function AdminDashboard() {
  const [version, setVersion] = useState(0);
  const stats = useRead(loadStats, version), roles = useRead(loadRoles, version), exams = useRead(loadExams, version);
  const cards = useRead(loadCards, version), audit = useRead(loadAudit, version), report = useRead(loadReport, version);
  const points = useMemo(() => report.data ? submissionTrend(report.data) : [], [report.data]);
  const refresh = () => setVersion(value => value + 1);
  const pending = stats.loading || roles.loading || exams.loading || cards.loading;
  const metrics = [
    { label: 'Tổng người dùng', value: roles.data?.total ?? null, detail: 'Sinh viên, giảng viên và quản trị viên', icon: <Users size={18} aria-hidden="true" />, tone: 'brand' as const, borderRole: 'users' as const },
    { label: 'Lớp học', value: countValue(stats.data?.classes), detail: 'Trong phạm vi quản lý', icon: <BookOpen size={18} aria-hidden="true" />, tone: 'blue' as const, borderRole: 'classes' as const },
    { label: 'Đề thi', value: countValue(exams.data?.meta?.total), detail: 'Tất cả trạng thái đề thi', icon: <ClipboardList size={18} aria-hidden="true" />, tone: 'purple' as const, borderRole: 'exams' as const },
    { label: 'Thẻ chờ xác nhận', value: countValue(cards.data?.meta?.total), detail: 'Hồ sơ cần kiểm tra', icon: <CreditCard size={18} aria-hidden="true" />, tone: 'warning' as const, borderRole: 'warning' as const },
  ];
  const liveMetrics = [
    { label: 'Đề thi đang diễn ra', value: countValue(stats.data?.ongoing_exams) },
    { label: 'Lượt thi đang hoạt động', value: countValue(stats.data?.active_attempts) },
    { label: stats.data?.recent_window_minutes != null ? `Cảnh báo / ${stats.data.recent_window_minutes} phút` : 'Cảnh báo gần đây', value: countValue(stats.data?.recent_violations) },
  ].filter((item): item is { label: string; value: number } => item.value != null);
  return <div className={`workspace-page ${styles.page}`}>
    <header className={styles.header}><div><h1>Tổng quan hệ thống</h1><p>Theo dõi người dùng, bài thi và các hồ sơ cần quản trị viên kiểm tra.</p></div><div className={styles.headerActions}><Button variant="outline" disabled={pending} onClick={refresh}><RefreshCw size={16} aria-hidden="true" />Làm mới</Button></div></header>
    {pending ? <LoadingSkeleton rows={2} /> : <div className="an-kpis" aria-label="Chỉ số tổng quan">{metrics.filter(item => item.value != null).map(item => <KpiCard key={item.label} label={item.label} value={format(item.value!)} detail={item.detail} tone={item.tone} borderRole={item.borderRole} icon={item.icon} />)}</div>}
    {!pending && (roles.error || stats.error || exams.error || cards.error) && <ReadError retry={refresh}>Một số chỉ số chưa tải được. Các số liệu hiện có vẫn được hiển thị.</ReadError>}
    <div className={styles.mainGrid}>
      <ChartCard title={points.length >= 4 ? 'Nhịp độ nộp bài' : 'Hoạt động hệ thống'} description={points.length >= 4 ? 'Bài hoàn tất theo ngày · giờ Việt Nam' : 'Tình hình thi và các đề thi mới nhất'} action={<Link className={styles.link} href="/dashboard/reports">Báo cáo chi tiết<ArrowUpRight size={15} aria-hidden="true" /></Link>}
        footer={points.length >= 4 ? `${report.data!.results.length} bài làm${report.data!.meta?.page != null ? ` trên trang ${report.data!.meta.page}` : ' đang hiển thị'}${report.data!.meta?.total != null ? ` / ${report.data!.meta.total} kết quả phù hợp` : ''}. Biểu đồ chỉ mô tả các bài đang hiển thị, không phải toàn bộ lịch sử.` : stats.data?.as_of && Number.isFinite(Date.parse(stats.data.as_of)) ? `Ảnh chụp số liệu lúc ${new Date(stats.data.as_of).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}.` : undefined}>
        {report.loading ? <LoadingSkeleton rows={3} /> : points.length >= 4 ? <AreaChart points={points} label="Bài đã nộp" /> : <div className={styles.operational}>
          {liveMetrics.length > 0 && <dl className={styles.liveMetrics}>{liveMetrics.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{format(item.value)}</dd></div>)}</dl>}
          <p className={styles.notice} role={report.error ? 'alert' : undefined}><Info size={16} aria-hidden="true" />{report.error ? 'Chưa tải được lịch sử bài làm. Bạn vẫn có thể xem các số liệu vận hành hiện có.' : 'Chưa có đủ dữ liệu theo ngày để hiển thị xu hướng. Số liệu vận hành được hiển thị trong khối này.'}</p>
          {exams.loading ? <LoadingSkeleton rows={2} /> : exams.error ? <ReadError retry={refresh}>Chưa tải được đề thi gần đây.</ReadError> : exams.data?.data.length ? <ul className={styles.list}>{exams.data.data.slice(0,3).map(exam => <li key={exam.id}><span className={styles.listIcon}><ClipboardList size={17} aria-hidden="true" /></span><span className={styles.listCopy}><Link className={styles.link} href={`/dashboard/exams/${exam.id}`}>{exam.title}</Link><small>{exam.duration_minutes} phút · Đề thi gần đây</small></span><Badge tone={exam.status === 'ongoing' ? 'info' : 'neutral'}>{examLabels[exam.status] ?? 'Chưa xác định'}</Badge></li>)}</ul> : <EmptyList>Chưa có đề thi được ghi nhận.</EmptyList>}
          {report.error && <Button variant="outline" size="sm" onClick={refresh}>Tải lại phân tích</Button>}
        </div>}
      </ChartCard>
      <ChartCard borderRole="users" title="Phân bố người dùng" description="Theo vai trò tài khoản trong hệ thống" footer="Số lượng tài khoản, bao gồm cả tài khoản đang ngừng hoạt động.">
        {roles.loading ? <LoadingSkeleton rows={3} /> : roles.error || !roles.data ? <ReadError retry={refresh}>Chưa tải được số lượng người dùng theo vai trò.</ReadError> : <DonutChart label="Phân bố vai trò người dùng" totalLabel="Người dùng" items={[{label:'Sinh viên',value:roles.data.student,tone:'brand'},{label:'Giảng viên',value:roles.data.teacher,tone:'blue'},{label:'Quản trị viên',value:roles.data.admin,tone:'purple'}]} />}
      </ChartCard>
    </div>
    <div className={styles.bottomGrid}>
      <ChartCard borderRole="warning" title="Cần xử lý" description="Thẻ sinh viên đang chờ xác nhận" action={<Link className={styles.link} href="/admin/student-cards?status=PENDING_CONFIRMATION">Xem danh sách<ArrowUpRight size={15} aria-hidden="true" /></Link>} footer={cards.data?.meta?.total != null ? `${cards.data.meta.total} thẻ chờ xác nhận · hiển thị tối đa 3 hồ sơ.` : undefined}>
        {cards.loading ? <LoadingSkeleton rows={2} /> : cards.error ? <ReadError retry={refresh}>Chưa tải được hồ sơ cần kiểm tra.</ReadError> : cards.data?.data.length ? <ul className={styles.list}>{cards.data.data.map((card:ManagedCard) => <li key={card.student_id}><span className={styles.listIcon}><CreditCard size={17} aria-hidden="true" /></span><span className={styles.listCopy}><strong>{card.full_name}</strong><small>{card.student_code ?? card.email}</small></span><Badge tone="warning">Chờ xác nhận</Badge></li>)}</ul> : <EmptyList>Không có thẻ sinh viên đang chờ xác nhận.</EmptyList>}
      </ChartCard>
      <ChartCard title="Hoạt động gần đây" description="Những thao tác quản trị đã được ghi nhận" action={<Link className={styles.link} href="/dashboard/action-logs?role=admin">Nhật ký<ArrowUpRight size={15} aria-hidden="true" /></Link>}>
        {audit.loading ? <LoadingSkeleton rows={2} /> : audit.error ? <ReadError retry={refresh}>Chưa tải được nhật ký quản trị.</ReadError> : audit.data?.data.length ? <ul className={styles.list}>{audit.data.data.map(row => <li key={row.id}><span className={styles.listIcon}><FileClock size={17} aria-hidden="true" /></span><span className={styles.listCopy}><strong>{formatAuditAction(row.action)}</strong><small>{formatAuditActor(row).name}</small></span><time dateTime={row.created_at}>{formatAuditTime(row.created_at)}</time></li>)}</ul> : <EmptyList>Chưa có thao tác quản trị được ghi nhận.</EmptyList>}
      </ChartCard>
    </div>
  </div>;
}
