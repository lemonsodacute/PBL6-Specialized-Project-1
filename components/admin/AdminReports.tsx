'use client';
import { borderProps } from '@/components/ui/Border';


import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ClipboardList, ClipboardCheck, Download, Filter, Info, RefreshCw, ShieldAlert, Target } from 'lucide-react';
import { Badge, Button, Input, LoadingSkeleton, Select, Table } from '@/components/ui';
import { AreaChart, ChartCard, KpiCard } from '@/components/analytics/Charts';
import { SearchInput, CollectionPagination, EmptySearchState } from '@/components/collections/CollectionToolbar';
import { RemoteFilterSelect } from '@/components/collections/RemoteFilterSelect';
import type { CollectionState } from '@/lib/collections';
import type { ReportsOverview } from '@/lib/teacher-reports';
import { completedDescription } from '@/lib/teacher-reports';
import { resultDate, resultStatusLabels, scoreText } from '@/lib/teacher-results';
import { submissionTrend } from '@/lib/analytics';
import { scoreDistribution } from '@/lib/admin-analytics';
import styles from './AdminAnalytics.module.css';

function EmptyChart({ children }: { children: string }) {
  return <div className="an-empty" role="status"><span><Info size={22} aria-hidden="true" /></span><strong>Chưa có đủ dữ liệu để hiển thị biểu đồ.</strong><p>{children}</p></div>;
}

function ScoreHistogram({ data }: { data: ReturnType<typeof scoreDistribution> }) {
  const [active, setActive] = useState<string | null>(null);
  const maximum = Math.max(...data.items.map(item => item.value));
  if (!data.observed) return <EmptyChart>Chưa có bài hoàn tất với điểm phần trăm hợp lệ trong các kết quả đang hiển thị.</EmptyChart>;
  return <ul className={styles.histogram} aria-label="Phân bố điểm chuẩn hóa">{data.items.map(item => <li key={item.label} tabIndex={0} role="img" aria-label={`${item.label}: ${item.value} bài`} onMouseEnter={() => setActive(item.label)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(item.label)} onBlur={() => setActive(null)} data-chat-avoid>
    <div className={styles.histogramLabel}><span>{item.label}</span><strong>{item.value.toLocaleString('vi-VN')}</strong></div>
    <svg viewBox="0 0 400 10" preserveAspectRatio="none" aria-hidden="true"><rect width="400" height="10" rx="5" /><rect width={item.value / maximum * 400} height="10" rx="5" /></svg>
    {active === item.label && <span className={styles.histogramTooltip} role="status">{item.label} · {item.value.toLocaleString('vi-VN')} bài</span>}
  </li>)}</ul>;
}

export function AdminReports({ collection, data, loading, error, exporting, reload, download }: {
  collection: CollectionState; data: ReportsOverview | null; loading: boolean; error: string; exporting: boolean;
  reload: () => void; download: () => void;
}) {
  const [moreFilters, setMoreFilters] = useState(false);
  const trend = useMemo(() => data ? submissionTrend(data) : [], [data]);
  const distribution = useMemo(() => data ? scoreDistribution(data) : null, [data]);
  const summary = data?.summary;
  const extraFilters = [collection.values.risk_min, collection.values.has_risk].filter(Boolean).length;
  const scope = data ? `${data.results.length} bài làm${data.meta?.page != null ? ` trên trang ${data.meta.page}` : ' đang hiển thị'}${data.meta?.total != null ? ` / ${data.meta.total} kết quả phù hợp` : ''}` : '';
  return <div className={`workspace-page ${styles.page}`}>
    <header className={styles.header}><div><h1>Báo cáo & thống kê</h1><p>Phân tích kết quả bài thi, điểm số và cảnh báo trong phạm vi quản lý.</p></div><div className={styles.headerActions}>
      <Button variant="outline" loading={loading} onClick={reload}><RefreshCw size={16} aria-hidden="true" />Tải lại báo cáo</Button>
      <Button variant="outline" loading={exporting} disabled={!data || loading || collection.pending || !data.results.length} onClick={download}><Download size={16} aria-hidden="true" />Xuất CSV</Button>
    </div></header>
    <div className={styles.toolbar} role="search" aria-label="Bộ lọc báo cáo">
      <div className={styles.filterRow}>
        <SearchInput label="Tìm sinh viên, MSSV hoặc đề thi..." placeholder="Tìm sinh viên, MSSV hoặc đề thi..." value={collection.values.q} onChange={value => collection.set('q',value)} />
        <RemoteFilterSelect source="exams" label="Đề thi" value={collection.values.exam_id} onChange={value => collection.set('exam_id',value)} />
        <label>Trạng thái bài làm<Select aria-label="Trạng thái bài làm" value={collection.values.status} onChange={event => collection.set('status',event.target.value)}><option value="">Tất cả</option>{Object.entries(resultStatusLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
        <label>Sắp xếp<Select aria-label="Sắp xếp" value={collection.values.sort} onChange={event => collection.set('sort',event.target.value)}><option value="newest">Bắt đầu gần nhất</option><option value="submitted">Nộp gần nhất</option><option value="score_desc">Điểm cao nhất</option><option value="score_asc">Điểm thấp nhất</option></Select></label>
        <Button className={styles.moreFilters} variant="outline" aria-expanded={moreFilters || extraFilters > 0} aria-controls="admin-report-advanced" onClick={() => setMoreFilters(value => !value)}><Filter size={16} aria-hidden="true" />Bộ lọc khác{extraFilters ? ` (${extraFilters})` : ''}</Button>
      </div>
      {(moreFilters || extraFilters > 0) && <div className={styles.advancedFields} id="admin-report-advanced"><label>Risk score từ<Input type="number" min={0} max={100} aria-label="Risk score từ" value={collection.values.risk_min} onChange={event => collection.set('risk_min',event.target.value)} /></label><label>Đánh giá rủi ro<Select aria-label="Đánh giá rủi ro" value={collection.values.has_risk} onChange={event => collection.set('has_risk',event.target.value)}><option value="">Tất cả</option><option value="true">Có dữ liệu</option><option value="false">Chưa có dữ liệu</option></Select></label></div>}
      {collection.active && <div className={styles.filterState}><span>Đang lọc kết quả · số liệu cập nhật tự động</span><Button variant="ghost" size="sm" onClick={collection.clear}>Xóa bộ lọc</Button></div>}
    </div>
    {loading && <LoadingSkeleton rows={4} />}
    {error && <div className={styles.error} role="alert"><p>{error}</p><Button variant="outline" onClick={reload}>Thử lại</Button></div>}
    {data && summary && <>
      <div className="an-kpis" aria-label="Thống kê báo cáo">
        {Number.isFinite(summary.attempt_count) && <KpiCard label="Lượt làm bài" value={summary.attempt_count.toLocaleString('vi-VN')} detail="Trong toàn bộ phạm vi lọc" icon={<ClipboardList size={18} aria-hidden="true" />} />}
        <KpiCard label="Bài đã nộp" value={summary.completed_attempts.toLocaleString('vi-VN')} detail="Bài hoàn tất theo trạng thái đã lưu" tone="blue" icon={<ClipboardCheck size={18} aria-hidden="true" />} />
        {summary.average_percentage != null && <KpiCard label="Điểm trung bình" value={`${scoreText(summary.average_percentage)}%`} detail={`${summary.percentage_attempts} bài có điểm phần trăm hợp lệ`} tone="purple" icon={<Target size={18} aria-hidden="true" />} />}
        <KpiCard label="Tổng cảnh báo" value={summary.total_violations.toLocaleString('vi-VN')} detail="Trình duyệt và phát hiện AI" tone="warning" icon={<ShieldAlert size={18} aria-hidden="true" />} />
      </div>
      <div className={styles.mainGrid}>
        <ChartCard title="Nhịp độ nộp bài" description="Lượt nộp theo ngày · giờ Việt Nam" action={<span className="an-range">Dữ liệu đang hiển thị</span>} footer={`${scope}. Chỉ tính bài hoàn tất có thời gian nộp; các ngày không có bản ghi không được suy diễn thành 0.`}>
          {trend.length >= 4 ? <AreaChart points={trend} label="Bài đã nộp" /> : <EmptyChart>Cần ít nhất 4 ngày có bài nộp trong các kết quả đang hiển thị để phân tích xu hướng.</EmptyChart>}
        </ChartCard>
        <ChartCard title="Phân bố điểm" description="Điểm được chuẩn hóa về thang 100%" footer={`${distribution!.observed} bài có điểm phần trăm hợp lệ trên trang hiện tại. Không phải phân bố của toàn bộ hệ thống.`}>
          <ScoreHistogram data={distribution!} />
        </ChartCard>
      </div>
      <section className={styles.tableCard} aria-labelledby="admin-report-detail-title" {...borderProps('exams')}>
        <div className={styles.tableHeader}><div><h2 id="admin-report-detail-title">Chi tiết bài làm</h2><p>{scope}</p></div><span className={styles.updated}>Điểm gốc theo thang điểm từng bài thi</span></div>
        {data.results.length > 0 && <p className={styles.scrollHint}>Cuộn ngang để xem đầy đủ các cột.</p>}
        {data.results.length ? <Table label="Báo cáo bài thi" mobile="scroll"><thead><tr><th>Đề thi</th><th>MSSV</th><th>Họ tên</th><th>Điểm</th><th>Trạng thái</th><th>Cảnh báo</th><th>Risk score</th><th>Thao tác</th></tr></thead><tbody>{data.results.map(row => <tr key={row.attempt_id}>
          <td><strong>{row.exam_title}</strong><small className="table-description">Lần thi {row.attempt_number}</small></td><td>{row.student_code || '—'}</td><td>{row.full_name || '—'}</td><td>{row.score != null ? `${scoreText(row.score)} / ${scoreText(row.max_score)}` : '—'}</td>
          <td><Badge tone={data.completed_statuses.includes(row.status) ? 'success' : 'neutral'}>{resultStatusLabels[row.status]}</Badge><small className="table-description">{resultDate(row.submitted_at)}</small></td><td>{row.violation_count}</td><td>{scoreText(row.risk_score)}</td><td><Link className="table-link" href={`/dashboard/reports/attempts/${row.attempt_id}`}>Xem</Link></td>
        </tr>)}</tbody></Table> : collection.active ? <EmptySearchState state={collection} /> : <div className={styles.emptyTable}><strong>Chưa có kết quả bài thi.</strong><p>Nội dung báo cáo sẽ xuất hiện sau khi sinh viên nộp bài.</p></div>}
        <div className={styles.tableFooter}><CollectionPagination state={collection} total={data.meta?.total ?? null} count={data.results.length} loading={loading} /></div>
      </section>
      <div className={styles.insight}><Info size={18} aria-hidden="true" /><div><p>Điểm trung bình được tính từ phần trăm từng bài, không cộng gộp điểm gốc giữa các thang điểm khác nhau. Trạng thái hoàn tất: {completedDescription(data)}.</p><p>{summary.total_violations === 0 ? 'Chưa ghi nhận vi phạm trong phạm vi đang chọn.' : `${summary.total_violations} cảnh báo: ${summary.browser_violation_count} sự kiện trình duyệt và ${summary.detection_count} cảnh báo phát hiện. Cần xem xét trước khi kết luận.`}{summary.risk_scored_attempts === 0 ? ' Chưa có dữ liệu đánh giá rủi ro.' : ''}</p></div></div>
    </>}
  </div>;
}
