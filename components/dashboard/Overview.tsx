'use client';

import Link from 'next/link';
import { ClipboardList, Users, GraduationCap, TriangleAlert, ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, LoadingSkeleton } from '@/components/ui';
import { useAuth } from '@/components/auth/AuthContext';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/uiErrors';
import { KpiCard } from '@/components/analytics/Charts';
import { OverviewAnalytics } from '@/components/analytics/ReportAnalytics';
import AdminDashboard from '@/components/admin/AdminDashboard';

type DashboardStats = {
  ongoing_exams: number; active_attempts: number; classes: number; recent_violations: number;
  as_of: string; recent_window_minutes: number;
};
type DashboardExam = { id: string; title: string; duration_minutes: number; status: string };
const unwrap = <T,>(response: unknown): T => ((response as { data?: T }).data ?? response) as T;
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('vi-VN') : '—';

export default function Overview() {
  const { user } = useAuth();
  return user?.role === 'admin' ? <AdminDashboard key={user.id} /> : <StandardOverview />;
}

function StandardOverview() {
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [exams, setExams] = useState<DashboardExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void Promise.all([api.dashboard.stats(), api.exams.list({ status: 'ongoing', limit: 3 }), api.exams.list({ status: 'published', limit: 3 })])
      .then(([statsResponse, ongoingResponse, publishedResponse]) => {
        if (!active) return;
        setStats(unwrap<DashboardStats>(statsResponse));
        setExams([...new Map([...unwrap<DashboardExam[]>(ongoingResponse), ...unwrap<DashboardExam[]>(publishedResponse)].map(exam => [exam.id, exam])).values()]);
      }).catch(cause => { if (active) setError(friendlyError(cause, 'Không tải được tổng quan. Vui lòng thử lại.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload, user?.id]);
  const openExams = exams.filter(exam => ['ongoing', 'published'].includes(exam.status));
  const updated = stats?.as_of ? new Date(stats.as_of) : null;

  return <div className="workspace-page an-page">
    {loading ? <LoadingSkeleton rows={4} /> : error ? <Card role="alert"><h2>Không tải được tổng quan</h2><p>{error}</p><Button variant="warning" onClick={() => setReload(value => value + 1)}>Thử lại</Button></Card> : <>
      <div className="an-kpis" aria-label="Chỉ số tổng quan">
        {typeof stats?.ongoing_exams === 'number' && <KpiCard label="Đề thi đang diễn ra" borderRole="exams" value={count(stats.ongoing_exams)} detail="Trong phạm vi quản lý" tone="blue" icon={<ClipboardList size={19} aria-hidden="true" />} />}
        {typeof stats?.active_attempts === 'number' && <KpiCard label="Lượt thi đang hoạt động" borderRole="exams" value={count(stats.active_attempts)} detail="Đang làm bài" tone="positive" icon={<Users size={19} aria-hidden="true" />} />}
        {typeof stats?.classes === 'number' && <KpiCard label="Lớp học" borderRole="classes" value={count(stats.classes)} detail="Đang quản lý" icon={<GraduationCap size={19} aria-hidden="true" />} />}
        {typeof stats?.recent_violations === 'number' && <KpiCard label="Vi phạm gần đây" borderRole="warning" value={count(stats.recent_violations)} detail={typeof stats.recent_window_minutes === 'number' ? `Trong ${stats.recent_window_minutes} phút` : 'Theo dữ liệu máy chủ'} tone="warning" icon={<TriangleAlert size={19} aria-hidden="true" />} />}
      </div>
      {updated && Number.isFinite(updated.getTime()) && <p className="dashboard-updated">Cập nhật lúc <time dateTime={stats!.as_of}>{updated.toLocaleString('vi-VN')}</time></p>}
      <OverviewAnalytics key={user?.id} refreshKey={reload} />
      <div className="overview-grid">
        <Card borderRole="exams"><div className="card-toolbar"><div><h2>Đề thi đang mở</h2><p>Truy cập nhanh đề đã xuất bản và đang diễn ra.</p></div><Link className="table-link" href="/dashboard/exams">Xem tất cả</Link></div>
          {openExams.length ? <div className="overview-list">{openExams.slice(0, 3).map(exam => <Link className="overview-list-row" key={exam.id} href={`/dashboard/exams/${exam.id}`}><span><strong>{exam.title}</strong><small>{exam.duration_minutes} phút</small></span><Badge tone="info">{exam.status === 'ongoing' ? 'Đang diễn ra' : 'Đã xuất bản'}</Badge></Link>)}</div>
            : <EmptyState mascot title="Chưa có đề thi đang mở">Các đề đã xuất bản hoặc đang diễn ra sẽ xuất hiện tại đây.</EmptyState>}
        </Card>
        <Card borderRole={admin ? 'users' : 'warning'}><div className="card-toolbar"><div><h2>{admin ? 'Quản trị nhanh' : 'Giám sát bài thi'}</h2><p>{admin ? 'Truy cập các khu vực quản lý hệ thống.' : 'Theo dõi từng phòng thi và các cảnh báo đã ghi nhận.'}</p></div><Link className="ui-button ui-button-primary" href={admin ? '/dashboard/users' : '/dashboard/exams'}>{admin ? 'Quản lý người dùng' : 'Mở danh sách đề thi'}</Link></div>
          <div className="activity-list">
            <Link className="activity-row" href={admin ? '/admin/classes' : '/dashboard/classes'}><span>Lớp học</span><ArrowRight size={18} aria-hidden="true" /></Link>
            <Link className="activity-row" href={admin ? '/dashboard/users' : '/dashboard/monitor'}><span>{admin ? 'Người dùng' : 'Mở giám sát'}</span><ArrowRight size={18} aria-hidden="true" /></Link>
            <Link className="activity-row" href="/dashboard/reports"><span>Báo cáo và kết quả</span><ArrowRight size={18} aria-hidden="true" /></Link>
          </div>
        </Card>
      </div>
    </>}
  </div>;
}
