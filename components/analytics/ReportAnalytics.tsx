'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ClipboardCheck, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { readOverview, reportError, type ReportsOverview } from '@/lib/teacher-reports';
import { submissionTrend, attemptDistribution } from '@/lib/analytics';
import { Button, LoadingSkeleton } from '@/components/ui';
import { AreaChart, BarChart, ChartCard, DonutChart, KpiCard } from './Charts';

const demoSubmissionCounts = [1, 2, 2, 3, 4, 2, 5, 3, 4, 3, 5, 4, 3, 3]; // 44 total
const demoDetectionClasses = [
  { label: 'Điện thoại', value: 13, tone: 'blue' as const },
  { label: 'Sách', value: 8, tone: 'brand' as const },
  { label: 'Hướng mắt', value: 6, tone: 'purple' as const },
  { label: 'Tư thế đầu', value: 4, tone: 'warning' as const },
  { label: 'Không thấy mặt', value: 3, tone: 'critical' as const },
  { label: 'Nhiều người', value: 2, tone: 'positive' as const },
];

function demoReport(data: ReportsOverview): ReportsOverview {
  return {
    ...data,
    exam_id: null, exams: [], results: [], meta: undefined,
    summary: {
      completed_attempts: 44, attempt_count: 44, total_violations: 154,
      browser_violation_count: 118, detection_count: 36,
      scored_attempts: 0, percentage_attempts: 0, average_percentage: null,
      average_score: null, max_score: null, average_risk_score: null, risk_scored_attempts: 0,
    },
    submission_trend: demoSubmissionCounts.map((value, index) => ({
      date: `2026-11-${String(4 + index).padStart(2, '0')}`, value,
    })),
  };
}

export function ReportAnalytics({ data, detailed = false, demo = false }: { data: ReportsOverview; detailed?: boolean; demo?: boolean }) {
  const points = submissionTrend(data);
  const scope = demo ? '44 bài hoàn tất · DEMO, số liệu mô phỏng' : `${data.results.length} bài làm${data.meta?.page != null ? ` trên trang ${data.meta.page}` : ' đang hiển thị'}${data.meta?.total != null ? ` / ${data.meta.total} kết quả phù hợp` : ''}`;
  return <div className="an-report-charts">
    <div className="an-grid an-grid-main">
      <ChartCard title="Nhịp độ nộp bài" description={demo ? '14 ngày · DEMO, không phải bài thi thật' : 'Lượt nộp theo ngày · giờ Việt Nam'} action={<span className="an-range">{demo ? 'DEMO · 14 ngày' : data.submission_trend ? 'Toàn bộ phạm vi lọc' : 'Dữ liệu đang hiển thị'}</span>} footer={<><span>{scope}. {demo ? 'Chỉ dành cho trình diễn, không lưu database.' : 'Chỉ tính bài hoàn tất có thời gian nộp.'}</span><span>{demo ? 'Không đưa số liệu demo vào CSV hoặc báo cáo thật.' : data.submission_trend ? 'Biểu đồ tổng hợp toàn bộ phạm vi lọc, không bị giới hạn bởi trang kết quả.' : 'Biểu đồ của trang kết quả hiện tại.'}</span></>}>
        <AreaChart points={points} label="Bài đã nộp" />
      </ChartCard>
      <ChartCard borderRole="warning" title="Nguồn cảnh báo" description="Trong toàn bộ phạm vi báo cáo đã chọn" footer="Cảnh báo cần được xem xét trước khi kết luận vi phạm.">
        <DonutChart label="Phân bố nguồn cảnh báo" totalLabel="Cảnh báo" items={[{ label: 'Trình duyệt', value: data.summary.browser_violation_count, tone: 'brand' }, { label: 'Phát hiện AI', value: data.summary.detection_count, tone: 'blue' }]} />
      </ChartCard>
    </div>
    {demo && <ChartCard title="Loại cảnh báo AI (DEMO)" description="36 cảnh báo mô phỏng theo sáu nhóm · không phải kết quả phát hiện thật">
      <BarChart label="Cảnh báo AI mô phỏng" items={demoDetectionClasses} />
    </ChartCard>}
    {detailed && <ChartCard title="Trạng thái bài làm" description={`Phân bố ${scope}`} footer="Số lượt trên trang hiện tại; không phải phân bố của toàn bộ hệ thống."><BarChart label="Phân bố trạng thái bài làm" items={attemptDistribution(data)} /></ChartCard>}
  </div>;
}

export function OverviewAnalytics({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<ReportsOverview | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [demoEnabled, setDemoEnabled] = useState(false);
  // A local-only presentation preview: never persisted and never exported.
  const canShowDemo = process.env.NODE_ENV === 'development';
  useEffect(() => {
    let alive = true;
    setLoading(true); setData(null); setError('');
    void api.teacherReports.overview('', { page: 1, limit: 20 }).then(response => {
      const overview = readOverview(response, '');
      if (alive) setData(overview);
    }).catch(cause => { if (alive) setError(reportError(cause)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [refreshKey, version]);
  const shown = data && canShowDemo && demoEnabled ? demoReport(data) : data;
  return <section className="an-overview" aria-label="Phân tích bài thi">
    <div className="an-section-heading"><div><span className="an-eyebrow">PHÂN TÍCH BÀI THI</span><h2>Hoạt động & chất lượng giám sát</h2><p>Tổng hợp bài làm và cảnh báo trong phạm vi quản lý.</p></div><div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {canShowDemo && data && <button type="button" className="ui-button ui-button-outline"
          onClick={() => setDemoEnabled(value => !value)} aria-pressed={demoEnabled}>
          {demoEnabled ? 'Tắt dữ liệu demo' : 'Xem dữ liệu demo'}
        </button>}
        <Link className="ui-button ui-button-outline" href="/dashboard/reports">Mở báo cáo thật<ArrowUpRight size={16} aria-hidden="true" /></Link>
      </div></div>
    {canShowDemo && demoEnabled && data && !loading && !error && <div role="status" style={{ border: '2px dashed #bd7500', borderRadius: 10, padding: 12, marginBottom: 14, fontWeight: 700 }}>DEMO — DỮ LIỆU MÔ PHỎNG · Không phải số liệu thực, không lưu vào cơ sở dữ liệu.</div>}
    {loading ? <LoadingSkeleton rows={3} /> : error ? <div className="an-inline-error" role="alert"><p>{error}</p><Button variant="outline" size="sm" onClick={() => setVersion(value => value + 1)}>Tải lại phân tích</Button></div> : shown && <>
      <div className="an-kpis an-kpis-compact">
        <KpiCard label="Bài hoàn tất" borderRole="success" value={shown.summary.completed_attempts.toLocaleString('vi-VN')} detail={demoEnabled && canShowDemo ? 'DEMO · số liệu mô phỏng' : 'Theo thống kê báo cáo'} icon={<ClipboardCheck size={19} aria-hidden="true" />} />
        <KpiCard label="Cảnh báo đã ghi nhận" borderRole="warning" value={shown.summary.total_violations.toLocaleString('vi-VN')} detail={demoEnabled && canShowDemo ? 'DEMO · 118 trình duyệt, 36 AI' : 'Trong phạm vi quản lý'} tone="warning" icon={<ShieldAlert size={19} aria-hidden="true" />} />
      </div>
      <ReportAnalytics data={shown} demo={demoEnabled && canShowDemo} />
    </>}
  </section>;
}
