'use client';
import Link from 'next/link';
import {useAuth} from '@/components/auth/AuthContext';
import {api} from '@/lib/api';
import {useCollectionState,useServerCollection} from '@/lib/collections';
import {StatusBadge,Button,Card,EmptyState,Table,LoadingSkeleton} from '@/components/ui';
import {CollectionToolbar,CollectionPagination,EmptySearchState} from '@/components/collections/CollectionToolbar';
import {resultDate,scoreText} from '@/lib/teacher-results';
import {getStudentFinalScore,isCompletedAttempt,studentAttemptLabel,type AttemptLike} from '@/lib/studentExamStatus';
import {useStudentExamRefresh} from './useStudentExamRefresh';
import {StudentPageHeader} from './StudentPageHeader';
import styles from './StudentGradesCompact.module.css';

type AttemptRow=AttemptLike&{exam_id:string;exam_title:string|null;classes:{id:string;name:string}[]};

/** Keep the submitted date/time in one line and in Vietnam's timezone. */
function compactResultDate(value:string|null|undefined){
  if(!value)return '—';
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return '—';
  const parts=new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Asia/Ho_Chi_Minh'}).formatToParts(date);
  const part=(type: Intl.DateTimeFormatPartTypes)=>parts.find(item=>item.type===type)?.value??'';
  return `${part('day')}/${part('month')}/${part('year')} · ${part('hour')}:${part('minute')}`;
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
  const graded=history?0:rows.filter(row=>getStudentFinalScore(row)!==null).length;
  const awaiting=history?0:rows.length-graded;
  return <div className={`workspace-page ${history?'':styles.page}`}>
    {!history&&<>
      <StudentPageHeader title="Điểm số / Kết quả"/>
      <p className={styles.subtitle}>Các bài đã hoàn thành và điểm chính thức. Bài chưa chấm xong sẽ hiển thị đang chờ chấm.</p>
      <section className={styles.stats} aria-label="Thống kê kết quả trên trang hiện tại">
        <div className={styles.stat}><span>Bài thi hiển thị</span><strong>{rows.length}</strong></div>
        <div className={styles.stat}><span>Đã có điểm</span><strong>{graded}</strong></div>
        <div className={styles.stat}><span>Chờ chấm</span><strong>{awaiting}</strong></div>
      </section>
    </>}
    <Card className={history?'':styles.filterCard}><CollectionToolbar state={state} placeholder="Tìm đề thi..." filters={[
      {key:'status',label:'Trạng thái',options:[...(history?[{value:'not_started',label:'Chưa bắt đầu'},{value:'in_progress',label:'Đang làm'}]:[]),{value:'submitted',label:'Đã nộp'},{value:'auto_submitted',label:'Tự động nộp'},{value:'terminated',label:'Bị kết thúc'}]},
      {key:'from_time',label:history?'Bắt đầu từ ngày':'Nộp từ ngày',type:'date',options:[]},
      {key:'to_time',label:history?'Bắt đầu đến ngày':'Nộp đến ngày',type:'date',options:[]},
    ]} sorts={history?[{value:'started',label:'Bắt đầu gần nhất'},{value:'oldest',label:'Cũ nhất'}]:[{value:'submitted',label:'Nộp gần nhất'},{value:'oldest',label:'Cũ nhất'}]}/></Card>
    {result.error&&<Card role="alert"><p>{result.error}</p><Button onClick={()=>void result.reload()}>Thử lại</Button></Card>}
    {result.loading?<LoadingSkeleton rows={4}/>:!result.error&&<Card className={history?'':styles.tableCard} data-chat-avoid>{rows.length?<Table label={history?'Lịch sử làm bài':'Điểm số / Kết quả'}>
      <thead><tr><th>Đề thi</th><th>Lớp</th>{history?<><th>Lần làm</th><th>Bắt đầu lúc</th><th>Nộp lúc</th><th>Thời lượng</th></>:<th>Điểm</th>}<th>Trạng thái</th>{!history&&<th>Nộp lúc</th>}<th>Thao tác</th></tr></thead>
      <tbody>{rows.map(row=>{
        const score=getStudentFinalScore(row),completed=isCompletedAttempt(row.status),working=row.status.toLowerCase()==='in_progress';
        return <tr key={row.id}><td className={history?'':styles.examTitle}>{row.exam_title??'—'}</td><td>{row.classes?.map(cls=>cls.name).join(', ')||'—'}</td>
          {history?<><td>{row.attempt_number??'—'}</td><td>{resultDate(row.started_at??null)}</td><td>{resultDate(row.submitted_at??null)}</td><td>{durationText(row,now)}</td></>:<td><span className={history?'':styles.score}>{score===null?'Đang chờ chấm':`${scoreText(score)} / ${scoreText(row.max_score??null)}`}</span></td>}
          <td><StatusBadge status={row.status} label={studentAttemptLabel(row.status)}/></td>{!history&&<td className={styles.submittedAt}><time dateTime={row.submitted_at??undefined}>{compactResultDate(row.submitted_at)}</time></td>}
          <td>{history?working?<Link className="table-link" href={`/student/attempts/${encodeURIComponent(row.id)}`}>Tiếp tục làm bài</Link>:completed?<Link className="table-link" href={`/student/attempts/${encodeURIComponent(row.id)}/result`}>Chi tiết lần làm</Link>:'—':<Link className={`table-link ${styles.resultLink}`} href={`/student/attempts/${encodeURIComponent(row.id)}/result`}>{score===null?'Xem bài đã nộp':'Xem kết quả'}</Link>}</td>
        </tr>;
      })}</tbody>
    </Table>:state.active?<EmptySearchState mascot state={state}/>:<EmptyState mascot title={history?'Chưa có lịch sử làm bài.':'Chưa có bài kiểm tra đã hoàn thành.'}/>}
    <CollectionPagination state={state} total={result.total} count={rows.length}/></Card>}
  </div>;
}
