'use client';
import { borderProps } from '@/components/ui/Border';

import Link from 'next/link';
import {ArrowRight} from 'lucide-react';
import {useAuth} from '@/components/auth/AuthContext';
import {api} from '@/lib/api';
import {useCollectionState,useServerCollection} from '@/lib/collections';
import {StatusBadge,Button,Card,EmptyState,Table,LoadingSkeleton} from '@/components/ui';
import {CollectionToolbar,CollectionPagination,EmptySearchState} from '@/components/collections/CollectionToolbar';
import {scoreText} from '@/lib/teacher-results';
import {getStudentFinalScore,isCompletedAttempt,studentAttemptLabel,type AttemptLike} from '@/lib/studentExamStatus';
import {useStudentExamRefresh} from './useStudentExamRefresh';
import {StudentPageHeader} from './StudentPageHeader';
import styles from './AttemptCollection.module.css';

type AttemptRow=AttemptLike&{exam_id:string;exam_title:string|null;classes:{id:string;name:string}[]};
function AttemptTime({value}:{value?:string|null}){
  if(!value||!Number.isFinite(Date.parse(value)))return <>—</>;
  const date=new Date(value),timeZone='Asia/Ho_Chi_Minh';
  return <time className={styles.submittedTime} dateTime={value}>
    <span>{new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',timeZone}).format(date)}</span>
    <small>{new Intl.DateTimeFormat('vi-VN',{hour:'2-digit',minute:'2-digit',timeZone}).format(date)}</small>
  </time>;
}
function durationText(row:AttemptRow,now:number){
  const start=Date.parse(row.started_at??'');
  const end=row.submitted_at?Date.parse(row.submitted_at):row.status.toLowerCase()==='in_progress'?now:NaN;
  if(!Number.isFinite(start)||!Number.isFinite(end))return '—';
  const seconds=Math.max(0,Math.floor((end-start)/1000));
  return `${Math.floor(seconds/60)} phút ${seconds%60} giây`;
}

export function AttemptCollection({history=false}:{history?:boolean}){
  const {user}=useAuth();
  const state=useCollectionState({status:'',from_time:'',to_time:''},history?'started':'submitted');
  const result=useServerCollection<AttemptRow>(state,params=>api.attempts.mine({...params,completed_only:!history,time_field:history?'started':'submitted',
    from_time:params.from_time?new Date(String(params.from_time)+'T00:00:00+07:00').toISOString():undefined,
    to_time:params.to_time?new Date(String(params.to_time)+'T23:59:59.999+07:00').toISOString():undefined,
  }),undefined,user?.id??'');
  const now=useStudentExamRefresh(result.reload,user?.id);
  const rows=history?result.rows:result.rows.filter(row=>isCompletedAttempt(row.status));
  return <div className={`workspace-page ${styles.page} ${history?styles.history:''}`}>
    {!history&&<>
      <StudentPageHeader title="Điểm số / Kết quả"/>
      <p>Các bài đã hoàn thành và điểm chính thức. Bài chưa chấm xong sẽ hiển thị đang chờ chấm.</p>
    </>}
    <Card className={styles.filters}><CollectionToolbar state={state} searchLabel="Tìm đề thi" placeholder="Nhập tên đề thi..." filters={[
      {key:'status',label:'Trạng thái',options:[...(history?[{value:'not_started',label:'Chưa bắt đầu'},{value:'in_progress',label:'Đang làm'}]:[]),{value:'submitted',label:'Đã nộp'},{value:'auto_submitted',label:'Tự động nộp'},{value:'terminated',label:'Bị kết thúc'}]},
      {key:'from_time',label:history?'Bắt đầu từ ngày':'Nộp từ ngày',type:'date',options:[]},
      {key:'to_time',label:history?'Bắt đầu đến ngày':'Nộp đến ngày',type:'date',options:[]},
    ]} sorts={history?[{value:'started',label:'Bắt đầu gần nhất'},{value:'oldest',label:'Cũ nhất'}]:[{value:'submitted',label:'Nộp gần nhất'},{value:'oldest',label:'Cũ nhất'}]}/></Card>
    {result.error&&<Card role="alert"><p>{result.error}</p><Button onClick={()=>void result.reload()}>Thử lại</Button></Card>}
    {result.loading?<LoadingSkeleton rows={4}/>:!result.error&&<Card className={styles.results} data-chat-avoid>{rows.length?<Table label={history?'Lịch sử làm bài':'Điểm số / Kết quả'}>
      <thead><tr><th>Đề thi</th>{history?<><th>Lần làm</th><th>Bắt đầu lúc</th><th>Nộp lúc</th><th>Thời lượng</th></>:<th>Điểm</th>}<th>Trạng thái</th>{!history&&<th>Nộp lúc</th>}<th>Thao tác</th></tr></thead>
      <tbody>{rows.map(row=>{
        const score=getStudentFinalScore(row),completed=isCompletedAttempt(row.status),working=row.status.toLowerCase()==='in_progress';
        return <tr key={row.id} {...borderProps('exams')} data-result-tone={row.status.toLowerCase()==='terminated'?'terminated':row.status.toLowerCase()==='auto_submitted'?'automatic':working?'working':row.status.toLowerCase()==='not_started'?'not-started':'submitted'}><td><div className={styles.exam}><strong>{row.exam_title??'—'}</strong><span>{row.classes?.map(cls=>cls.name).join(' · ')||'—'}</span></div></td>
          {history?<><td><span className={styles.attemptNumber}>{row.attempt_number??'—'}</span></td><td><AttemptTime value={row.started_at}/></td><td><AttemptTime value={row.submitted_at}/></td><td><span className={styles.duration}>{durationText(row,now)}</span></td></>:<td>{score===null?<span className={styles.pendingScore}>Đang chờ chấm</span>:<span className={styles.score}><strong>{scoreText(score)}</strong>{' '}<span>/ {scoreText(row.max_score??null)}</span></span>}</td>}
          <td><StatusBadge status={row.status} label={studentAttemptLabel(row.status)}/></td>{!history&&<td><AttemptTime value={row.submitted_at}/></td>}
          <td>{history?working?<Link className={styles.resultLink} href={`/student/attempts/${encodeURIComponent(row.id)}`}>Tiếp tục làm bài<ArrowRight size={17} aria-hidden="true"/></Link>:completed?<Link className={styles.resultLink} href={`/student/attempts/${encodeURIComponent(row.id)}/result`}>Chi tiết lần làm<ArrowRight size={17} aria-hidden="true"/></Link>:'—':<Link className={styles.resultLink} href={`/student/attempts/${encodeURIComponent(row.id)}/result`}>{score===null?'Xem bài đã nộp':'Xem kết quả'}<ArrowRight size={17} aria-hidden="true"/></Link>}</td>
        </tr>;
      })}</tbody>
    </Table>:state.active?<EmptySearchState mascot state={state}/>:<EmptyState mascot title={history?'Chưa có lịch sử làm bài.':'Chưa có bài kiểm tra đã hoàn thành.'}/>}
    <CollectionPagination state={state} total={result.total} count={rows.length}/></Card>}
  </div>;
}
