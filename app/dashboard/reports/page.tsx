'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, LoadingSkeleton, Select, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { resultDate, resultStatusLabels, scoreText } from '@/lib/teacher-results';
import { completedDescription, exportReportCSV, readOverview, reportError, type ReportsOverview } from '@/lib/teacher-reports';
import styles from '@/components/teacher/TeacherResults.module.css';
import { useCollectionState } from '@/lib/collections';
import { CollectionToolbar,CollectionPagination,EmptySearchState } from '@/components/collections/CollectionToolbar';
import { ClipboardCheck, Gauge, ShieldAlert, Target } from 'lucide-react';
import { KpiCard } from '@/components/analytics/Charts';
import { ReportAnalytics } from '@/components/analytics/ReportAnalytics';
import { useAuth } from '@/components/auth/AuthContext';
import { AdminReports } from '@/components/admin/AdminReports';

export default function ReportsPage() {
  const { user } = useAuth();
  const collection=useCollectionState({exam_id:'',status:'',risk_min:'',has_risk:''});const examId=collection.values.exam_id;
  const [responseData,setData]=useState<ReportsOverview|null>(null);const [responseKey,setResponseKey]=useState('');
  const data = responseData && responseKey===collection.key && (responseData.exam_id ?? '') === examId ? responseData : null;
  const [exporting,setExporting]=useState(false);
  const [exams, setExams] = useState<ReportsOverview['exams']>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const epoch = useRef(0);
  const load = useCallback(async () => {
    const request = ++epoch.current; setLoading(true); setError(''); setData(null);
    try {
      const response = readOverview(await api.teacherReports.overview(examId,collection.params), examId);
      if (request === epoch.current) { setData(response);setResponseKey(collection.key); setExams(response.exams); }
    } catch (cause) { if (request === epoch.current) setError(reportError(cause)); }
    finally { if (request === epoch.current) setLoading(false); }
  }, [examId,collection.key]);
  useEffect(() => { if(collection.ready) void load(); return () => { epoch.current++; }; }, [load,collection.ready]);
  async function download(){if(exporting||!data)return;setExporting(true);try{await api.teacherReports.exportCSV(examId,collection.params);}catch(cause){setError(reportError(cause));}finally{setExporting(false);}}
  const summary = data?.summary;
  const average = summary ? summary.average_score !== null && summary.max_score !== null
    ? `${scoreText(summary.average_score)} / ${scoreText(summary.max_score)}`
    : summary.average_percentage !== null ? `${scoreText(summary.average_percentage)}%` : '—' : '—';
  if (user?.role === 'admin') return <AdminReports collection={collection} data={data} loading={loading} error={error} exporting={exporting} reload={() => void load()} download={() => void download()} />;
  return <div className={`workspace-page an-page ${styles.page}`}>
    
    <Card><CollectionToolbar actions={<><Button variant="outline" loading={loading} onClick={() => void load()}>Tải lại báo cáo</Button><Button loading={exporting} disabled={!data || loading || collection.pending || !data.results.length} onClick={() => void download()}>Xuất CSV</Button></>} state={collection} placeholder="Tìm sinh viên, MSSV hoặc đề thi..." filters={[
      {key:'exam_id',label:'Đề thi',source:'exams',options:[]},
      {key:'status',label:'Trạng thái bài làm',options:Object.entries(resultStatusLabels).map(([value,label])=>({value,label}))},
      {key:'risk_min',label:'Risk score từ',type:'number',options:[]},
      {key:'has_risk',label:'Đánh giá rủi ro',options:[{value:'true',label:'Có dữ liệu'},{value:'false',label:'Chưa có dữ liệu'}]},
    ]} sorts={[{value:'newest',label:'Bắt đầu gần nhất'},{value:'submitted',label:'Nộp gần nhất'},{value:'score_desc',label:'Điểm cao nhất'},{value:'score_asc',label:'Điểm thấp nhất'}]}/>
      {data && <p className={styles.note}>Điểm trung bình chỉ tính bài ở trạng thái: {completedDescription(data)}. Bài đang làm và chưa làm không được tính.</p>}
    </Card>
    {loading && <LoadingSkeleton rows={5} />}
    {error && <Card role="alert"><p>{error}</p><Button onClick={() => void load()}>Thử lại</Button></Card>}
    {data && summary && <>
      <div className="an-kpis" aria-label="Thống kê báo cáo">
        <KpiCard label="Bài đã nộp" value={summary.completed_attempts.toLocaleString('vi-VN')} detail="Bài hoàn tất trong phạm vi lọc" icon={<ClipboardCheck size={19} aria-hidden="true" />} />
        <KpiCard label="Điểm trung bình" value={average} detail={`${summary.scored_attempts} bài có điểm`} tone="blue" icon={<Target size={19} aria-hidden="true" />} />
        <KpiCard label="Tổng vi phạm" value={summary.total_violations.toLocaleString('vi-VN')} detail="Sự kiện trình duyệt và phát hiện AI" tone="warning" icon={<ShieldAlert size={19} aria-hidden="true" />} />
        <KpiCard label="Risk score TB" value={scoreText(summary.average_risk_score)} detail={`${summary.risk_scored_attempts} bài có đánh giá rủi ro`} tone="purple" icon={<Gauge size={19} aria-hidden="true" />} />
      </div>
      <p className={styles.note}>{examId ? 'Điểm dựa trên thang điểm đã lưu của từng bài; nếu thang điểm khác nhau, hiển thị trung bình phần trăm.' : 'Điểm trung bình là trung bình phần trăm của từng bài đã có điểm, không trộn các thang điểm khác nhau.'} {summary.scored_attempts < summary.completed_attempts && `${summary.completed_attempts - summary.scored_attempts} bài hoàn tất chưa có điểm.`} {summary.percentage_attempts < summary.scored_attempts && `${summary.scored_attempts - summary.percentage_attempts} bài chưa có thang điểm hợp lệ để tính phần trăm.`} {summary.risk_scored_attempts === 0 && 'Chưa có dữ liệu đánh giá rủi ro.'}</p>
      <ReportAnalytics data={data} detailed />
      <Card><h2>Chi tiết bài làm</h2>
        {data.results.length ? <Table label="Báo cáo bài thi"><thead><tr><th>Đề thi</th><th>MSSV</th><th>Họ tên</th><th>Điểm</th><th>Trạng thái</th><th>Vi phạm</th><th>Risk score</th><th>Thao tác</th></tr></thead><tbody>
          {data.results.map(row => <tr key={row.attempt_id}><td><strong>{row.exam_title}</strong><small className="table-description">Lần thi {row.attempt_number}</small></td><td>{row.student_code || '—'}</td><td>{row.full_name || '—'}</td>
            <td>{row.score !== null ? `${scoreText(row.score)} / ${scoreText(row.max_score)}` : '—'}</td><td><Badge tone={data.completed_statuses.includes(row.status) ? 'success' : 'neutral'}>{resultStatusLabels[row.status]}</Badge><small className="table-description">{resultDate(row.submitted_at)}</small></td>
            <td>{row.violation_count}</td><td>{scoreText(row.risk_score)}</td><td><Link className="table-link" href={`/dashboard/reports/attempts/${row.attempt_id}`}>Xem</Link></td></tr>)}
        </tbody></Table> : collection.active?<EmptySearchState state={collection}/>:<div className="empty-state"><p>Chưa có kết quả bài thi.</p><p>Nội dung báo cáo sẽ xuất hiện sau khi sinh viên nộp bài.</p></div>}
      </Card>
      <CollectionPagination state={collection} total={data.meta?.total??null} count={data.results.length} loading={loading}/>
      <Card><h2>Gợi ý xử lý</h2><p>{summary.total_violations === 0 ? 'Chưa ghi nhận vi phạm trong phạm vi đang chọn.' : `Có ${summary.total_violations} lượt vi phạm trong phạm vi đang chọn.`}</p>
        <p className={styles.note}>Gồm {summary.browser_violation_count} sự kiện trình duyệt và {summary.detection_count} cảnh báo phát hiện. Mỗi bản ghi được tính một lần; cảnh báo cần được xem xét trước khi kết luận.</p>
      </Card>
      {exams.length > 0 && <Card><h2>Kết quả theo sinh viên</h2><p className={styles.note}>Xem danh sách được giao đề, sinh viên chưa làm và lịch sử các lần thi.</p><div className={styles.examLinks}>{exams.filter(exam => !examId || exam.id === examId).map(exam => <Link className="table-link" key={exam.id} href={`/dashboard/exams/${exam.id}/attempts`}>Xem kết quả — {exam.title}</Link>)}</div></Card>}
    </>}
  </div>;
}
