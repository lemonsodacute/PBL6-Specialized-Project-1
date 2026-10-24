'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBadge, Button, Card, LoadingSkeleton, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { exportResults, isSubmitted, resultDate, resultError, resultStatusLabels, scoreText, type AttemptResultRow, type TeacherReport } from '@/lib/teacher-results';
import styles from './TeacherResults.module.css';
import { useCollectionState } from '@/lib/collections';
import { CollectionToolbar, CollectionPagination, EmptySearchState } from '@/components/collections/CollectionToolbar';
import { ProctorReport } from '@/components/proctoring/ProctorReport';

function AttemptValues({ attempt, examId }: { attempt: AttemptResultRow; examId: string }) {
  const completed = isSubmitted(attempt.status);
  return <>
    <td><StatusBadge status={attempt.status} label={resultStatusLabels[attempt.status]} />
      {attempt.attempt_number !== null && <small className="table-description">Lần thi {attempt.attempt_number}</small>}</td>
    <td>{completed && attempt.correct_count !== null ? `${attempt.correct_count}/${attempt.objective_question_count}` : '—'}
      {attempt.objective_question_count !== attempt.total_questions && attempt.correct_count !== null && <small className="table-description">Câu trắc nghiệm</small>}</td>
    <td>{completed && attempt.score !== null ? `${scoreText(attempt.score)} / ${scoreText(attempt.max_score)}` : '—'}
      {completed && attempt.pending_manual_count > 0 && <small className="table-description">Còn {attempt.pending_manual_count} câu chờ chấm</small>}</td>
    <td>{resultDate(attempt.submitted_at)}</td>
    <td>{completed && attempt.attempt_id ? <Link className="table-link" href={`/dashboard/exams/${examId}/grade/${attempt.attempt_id}`}>Xem chi tiết</Link> : '—'}</td>
  </>;
}

export function TeacherResults({ examId }: { examId: string }) {
  const collection=useCollectionState({status:'',grading:''},'name');
  const [report, setReport] = useState<TeacherReport | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [exporting,setExporting]=useState(false);const currentFilters=useRef(collection.key);currentFilters.current=collection.key;
  const epoch = useRef(0);
  const load = useCallback(async () => {
    const request = ++epoch.current; setLoading(true); setError(''); setReport(null);
    try {
      const data = await api.teacherResults.report(examId,collection.params);
      if (data?.exam?.id !== examId || !Array.isArray(data.results) || !data.summary) throw new Error('Invalid result response');
      if (request === epoch.current) setReport(data);
    } catch (cause) { if (request === epoch.current) setError(resultError(cause)); }
    finally { if (request === epoch.current) setLoading(false); }
  }, [examId,collection.key]);
  useEffect(() => { setExpanded({}); if(collection.ready) void load(); return () => { epoch.current++; }; }, [load,collection.ready]);
  async function download() {
    if(exporting||!report) return;
    const key=collection.key;setExporting(true);
    try {
      let full:TeacherReport|null=null;let rows:TeacherReport['results']=[];
      for(let page=1;;page++) {
        const batch=await api.teacherResults.report(examId,{...collection.params,page,limit:100});
        if(currentFilters.current!==key) return;
        if(batch.exam?.id!==examId||!Array.isArray(batch.results)) throw new Error('Invalid result response');
        full=batch;rows.push(...batch.results);
        if(!batch.meta||!batch.results.length||rows.length>=batch.meta.total) break;
      }
      if(full) exportResults({...full,results:rows});
    }catch(cause){setError(resultError(cause));}
    finally{setExporting(false);}
  }
  return <div className={`workspace-page ${styles.page}`}>
    <Link className="back-link" href="/dashboard/reports"><ArrowLeft className="inline-icon" aria-hidden="true" /> Danh sách kết quả đề thi</Link>
    
    {loading && <LoadingSkeleton rows={5} />}
    {error && <Card role="alert"><p>{error}</p><Button onClick={() => void load()}>Thử lại</Button></Card>}
    <Card><CollectionToolbar actions={<><Button variant="outline" loading={loading} onClick={() => void load()}>Tải lại kết quả</Button><Button disabled={!report || loading || collection.pending} loading={exporting} onClick={() => void download()}>Xuất CSV</Button></>} state={collection} placeholder="Tìm theo tên hoặc MSSV..." filters={[
      {key:'status',label:'Trạng thái bài làm',options:Object.entries(resultStatusLabels).map(([value,label])=>({value,label}))},
      {key:'grading',label:'Chấm điểm',options:[{value:'pending',label:'Chờ chấm'},{value:'graded',label:'Đã chấm'}]},
    ]} sorts={[{value:'name',label:'Tên A–Z'},{value:'submitted',label:'Nộp gần nhất'},{value:'score_desc',label:'Điểm cao nhất'},{value:'score_asc',label:'Điểm thấp nhất'}]}/></Card>
    {report && <>
      <ProctorReport examId={examId} />
      <Card className={styles.examSummary}><h2>{report.exam.title}</h2><p>Lớp: {report.exam.classes.map(item => item.name).join(', ') || 'Không giao theo lớp'}</p><p>Thang điểm: {scoreText(report.exam.max_score)}</p>
        <div className={styles.summary}>{[
          ['Số sinh viên', report.summary.student_count], ['Đã nộp', report.summary.submitted_count],
          ['Đang làm', report.summary.in_progress_count], ['Chưa làm', report.summary.not_started_count],
        ].map(([label, count]) => <div key={label}><span>{label}</span><strong>{count}</strong></div>)}</div>
      </Card>
      <Card>
        {report.exam.max_attempts > 1 && <p className={styles.note}>Bảng hiển thị lần thi gần nhất như khu vực sinh viên. Mở lịch sử để xem từng lần thi và điểm đã lưu.</p>}
        {report.results.length ? <Table label="Kết quả bài thi"><thead><tr><th>MSSV</th><th>Họ tên</th><th>Trạng thái</th><th>Số câu đúng</th><th>Điểm</th><th>Nộp lúc</th><th>Thao tác</th></tr></thead><tbody>
          {report.results.map(row => <ResultRows key={row.student_id} row={row} examId={examId} expanded={!!expanded[row.student_id]} toggle={() => setExpanded(current => ({ ...current, [row.student_id]: !current[row.student_id] }))} />)}
        </tbody></Table> : <EmptySearchState state={collection}/>}
        <CollectionPagination state={collection} total={report.meta?.total??null} count={report.results.length} loading={loading}/>
      </Card>
    </>}
  </div>;
}

function ResultRows({ row, examId, expanded, toggle }: { row: TeacherReport['results'][number]; examId: string; expanded: boolean; toggle: () => void }) {
  return <><tr><td>{row.student_code || '—'}</td><td><strong>{row.full_name}</strong>{row.attempts.length > 1 && <div><Button variant="ghost" size="sm" aria-expanded={expanded} onClick={toggle}>{expanded ? 'Ẩn lịch sử' : `Lịch sử ${row.attempts.length} lần thi`}</Button></div>}</td><AttemptValues attempt={row} examId={examId} /></tr>
    {expanded && row.attempts.map(attempt => <tr key={attempt.attempt_id} className={styles.history}><td>{row.student_code || '—'}</td><td>{row.full_name} · Lần thi {attempt.attempt_number}</td><AttemptValues attempt={attempt} examId={examId} /></tr>)}
  </>;
}
