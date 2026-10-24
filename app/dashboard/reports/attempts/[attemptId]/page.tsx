'use client';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, LoadingSkeleton, Table } from '@/components/ui';
import { PageHeader } from '@/components/ui/PageHeader';
import { api } from '@/lib/api';
import { isSubmitted, resultDate, resultStatusLabels, scoreText } from '@/lib/teacher-results';
import { eventLabels, reportError, type AttemptReport } from '@/lib/teacher-reports';
import styles from '@/components/teacher/TeacherResults.module.css';
import { useCollectionState } from '@/lib/collections';
import { CollectionToolbar,CollectionPagination,EmptySearchState } from '@/components/collections/CollectionToolbar';

export default function AttemptReportPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const collection=useCollectionState({source:'',severity:''});
  const [data, setData] = useState<AttemptReport | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const epoch = useRef(0);
  const load = useCallback(async () => {
    const request = ++epoch.current; setLoading(true); setError(''); setData(null);
    try { const response = await api.teacherReports.attempt(attemptId,collection.params); if (response?.attempt_id !== attemptId || !Array.isArray(response.events)) throw new Error('Invalid report'); if (request === epoch.current) setData(response); }
    catch (cause) { if (request === epoch.current) setError(reportError(cause)); }
    finally { if (request === epoch.current) setLoading(false); }
  }, [attemptId,collection.key]);
  useEffect(() => { if(collection.ready)void load(); return () => { epoch.current++; }; }, [load,collection.ready]);
  return <div className={`workspace-page ${styles.page}`}><Link className="back-link" href="/dashboard/reports"><ArrowLeft className="inline-icon" aria-hidden="true" /> Quay lại báo cáo</Link><PageHeader mode="context" context="Báo cáo" title="Chi tiết báo cáo"  actions={<Button variant="outline" loading={loading} onClick={() => void load()}>Tải lại báo cáo</Button>} />
    {(collection.active||(data?.violation_count??0)>20)&&<Card><CollectionToolbar state={collection} search={false} placeholder="Sự kiện giám sát" filters={[{key:'source',label:'Nguồn',options:[{value:'browser',label:'Trình duyệt'},{value:'detector',label:'Phát hiện'}]},{key:'severity',label:'Mức độ',options:[{value:'low',label:'Thấp'},{value:'medium',label:'Trung bình'},{value:'high',label:'Cao'},{value:'critical',label:'Nghiêm trọng'}]}]}/></Card>}
    {loading && <LoadingSkeleton rows={5} />}{error && <Card role="alert"><p>{error}</p><Button onClick={() => void load()}>Thử lại</Button></Card>}
    {data && <><Card><dl className={styles.fields}>{[
      ['Sinh viên', data.full_name || '—'], ['MSSV', data.student_code || '—'], ['Đề thi', data.exam_title],
      ['Điểm', data.score !== null ? `${scoreText(data.score)} / ${scoreText(data.max_score)}` : '—'],
      ['Trạng thái', resultStatusLabels[data.status]], ['Lần thi', data.attempt_number],
      ['Bắt đầu lúc', resultDate(data.started_at)], ['Nộp lúc', resultDate(data.submitted_at)],
      ['Vi phạm', data.violation_count], ['Risk score', scoreText(data.risk_score)],
    ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {isSubmitted(data.status) && <Link className="table-link" href={`/dashboard/exams/${data.exam_id}/grade/${data.attempt_id}`}>Xem bài làm và đáp án <ArrowRight className="inline-icon" aria-hidden="true" /></Link>}
    </Card><Card><h2>Sự kiện giám sát</h2><p className={styles.note}>{data.browser_violation_count} sự kiện trình duyệt · {data.detection_count} cảnh báo phát hiện</p>
      {data.events.length ? <Table label="Sự kiện giám sát"><thead><tr><th>Thời điểm</th><th>Nguồn</th><th>Sự kiện</th><th>Mức độ</th><th>Độ tin cậy</th></tr></thead><tbody>{data.events.map(event => <tr key={`${event.source}-${event.id}`}><td>{resultDate(event.occurred_at)}</td><td>{event.source === 'browser' ? 'Trình duyệt' : 'Phát hiện'}</td><td>{eventLabels[event.type] ?? event.type}</td><td><Badge>{({ low: 'Thấp', medium: 'Trung bình', high: 'Cao', critical: 'Nghiêm trọng' } as Record<string, string>)[event.severity] ?? event.severity}</Badge></td><td>{scoreText(event.confidence)}</td></tr>)}</tbody></Table> : collection.active?<EmptySearchState state={collection}/>:<p className="empty-state">Chưa ghi nhận sự kiện giám sát trong bài làm này.</p>}
    <CollectionPagination state={collection} total={data.meta?.total??null} count={data.events.length} loading={loading}/></Card></>}
  </div>;
}
