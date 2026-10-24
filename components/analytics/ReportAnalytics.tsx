'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ClipboardCheck, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { readOverview, reportError, type ReportsOverview } from '@/lib/teacher-reports';
import { submissionTrend, attemptDistribution } from '@/lib/analytics';
import { Button, LoadingSkeleton } from '@/components/ui';
import { AreaChart, BarChart, ChartCard, DonutChart, KpiCard } from './Charts';

export function ReportAnalytics({ data, detailed = false }: { data: ReportsOverview; detailed?: boolean }) {
  const points = submissionTrend(data);
  const scope = `${data.results.length} bài làm${data.meta?.page != null ? ` trên trang ${data.meta.page}` : ' đang hiển thị'}${data.meta?.total != null ? ` / ${data.meta.total} kết quả phù hợp` : ''}`;
  return <div className="an-report-charts">
    <div className="an-grid an-grid-main">
      <ChartCard title="Nhịp độ nộp bài" description="Lượt nộp theo ngày · giờ Việt Nam" action={<span className="an-range">Dữ liệu đang hiển thị</span>} footer={<><span>{scope}. Chỉ tính bài hoàn tất có thời gian nộp.</span><span>Biểu đồ thay đổi theo bộ lọc và trang kết quả.</span></>}>
        <AreaChart points={points} label="Bài đã nộp" />
      </ChartCard>
      <ChartCard title="Nguồn cảnh báo" description="Trong toàn bộ phạm vi báo cáo đã chọn" footer="Cảnh báo cần được xem xét trước khi kết luận vi phạm.">
        <DonutChart label="Phân bố nguồn cảnh báo" totalLabel="Cảnh báo" items={[{ label: 'Trình duyệt', value: data.summary.browser_violation_count, tone: 'brand' }, { label: 'Phát hiện AI', value: data.summary.detection_count, tone: 'blue' }]} />
      </ChartCard>
    </div>
    {detailed && <ChartCard title="Trạng thái bài làm" description={`Phân bố ${scope}`} footer="Số lượt trên trang hiện tại; không phải phân bố của toàn bộ hệ thống."><BarChart label="Phân bố trạng thái bài làm" items={attemptDistribution(data)} /></ChartCard>}
  </div>;
}

export function OverviewAnalytics({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<ReportsOverview | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true); setData(null); setError('');
    void api.teacherReports.overview('', { page: 1, limit: 20 }).then(response => {
      const overview = readOverview(response, '');
      if (alive) setData(overview);
    }).catch(cause => { if (alive) setError(reportError(cause)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [refreshKey, version]);
  return <section className="an-overview" aria-label="Phân tích bài thi">
    <div className="an-section-heading"><div><span className="an-eyebrow">PHÂN TÍCH BÀI THI</span><h2>Hoạt động & chất lượng giám sát</h2><p>Tổng hợp bài làm và cảnh báo trong phạm vi quản lý.</p></div><Link className="ui-button ui-button-outline" href="/dashboard/reports">Mở báo cáo<ArrowUpRight size={16} aria-hidden="true" /></Link></div>
    {loading ? <LoadingSkeleton rows={3} /> : error ? <div className="an-inline-error" role="alert"><p>{error}</p><Button variant="outline" size="sm" onClick={() => setVersion(value => value + 1)}>Tải lại phân tích</Button></div> : data && <>
      <div className="an-kpis an-kpis-compact">
        <KpiCard label="Bài hoàn tất" value={data.summary.completed_attempts.toLocaleString('vi-VN')} detail="Theo thống kê báo cáo" icon={<ClipboardCheck size={19} aria-hidden="true" />} />
        <KpiCard label="Cảnh báo đã ghi nhận" value={data.summary.total_violations.toLocaleString('vi-VN')} detail="Trong phạm vi quản lý" tone="warning" icon={<ShieldAlert size={19} aria-hidden="true" />} />
      </div>
      <ReportAnalytics data={data} />
    </>}
  </section>;
}
