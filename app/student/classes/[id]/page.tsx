'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, LoadingSkeleton, Toast, PageHeader } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { type StudentClassDetail, type StudentExam } from '@/lib/dataSource';
import type { LiveClass } from '@/types';
import {friendlyError} from '@/lib/uiErrors';
import {useCollectionState,useServerCollection} from '@/lib/collections';
import {CollectionToolbar,CollectionPagination,EmptySearchState} from '@/components/collections/CollectionToolbar';
import {getStudentExamState,type AttemptLike} from '@/lib/studentExamStatus';
import {useAuth} from '@/components/auth/AuthContext';
import {StudentExamCard} from '@/components/student/StudentExamCard';
import {useStudentExamRefresh} from '@/components/student/useStudentExamRefresh';

const formatDate = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const statusLabel = (status: string) => ({ ongoing: 'Đang diễn ra', published: 'Sắp diễn ra', scheduled: 'Sắp diễn ra' }[status] ?? status);

export default function StudentClassDetailPage() {
  const {id}=useParams<{id:string}>();const router=useRouter();const {user}=useAuth();
  const [classItem,setClassItem]=useState<StudentClassDetail|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  const examState=useCollectionState({period:''},'start_time');
  const liveState=useCollectionState({status:''},'active',false);
  const examResult=useServerCollection<StudentExam&{attempts?:AttemptLike[];attempt?:AttemptLike|null}>(examState,params=>api.exams.list({...params,class_id:id}),undefined,`${id}|${user?.id??''}`);
  const now=useStudentExamRefresh(examResult.reload,user?.id);
  const liveResult=useServerCollection<LiveClass>(liveState,params=>api.liveClasses.list({...params,class_id:id}),undefined,id);
  useEffect(()=>{let active=true;setLoading(true);setError('');
    api.classes.get(id,{include_students:false}).then(result=>{if(active)setClassItem((result as {data:StudentClassDetail}).data);})
      .catch(cause=>{if(!active)return;if(cause instanceof ApiError&&[403,404].includes(cause.status)){router.replace('/student/classes?error=class_access');return;}setError(friendlyError(cause,'Không tải được thông tin lớp học.'));})
      .finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[id,router]);
  if(loading)return <div className="workspace-page"><LoadingSkeleton rows={5}/></div>;
  if(error||!classItem)return <div className="workspace-page"><Toast severity="critical">{error||'Không tìm thấy lớp học.'}</Toast><Link href="/student/classes">Quay lại danh sách lớp</Link></div>;
  return <div className="workspace-page"><Link href="/student/classes" className="back-link"><ArrowLeft className="inline-icon" aria-hidden="true" /> Quay lại danh sách lớp</Link><PageHeader mode="context" context="Lớp học" title={classItem.name} actions={<Badge>{classItem.students_count} học sinh</Badge>}/><p className="detail-meta">Giáo viên chủ nhiệm: {classItem.teacher?.full_name??'Chưa phân công'}</p>
    <div className="class-detail-layout"><section><h2>Đề thi của lớp</h2>
      {((examResult.total??0)>10||examState.active)&&<Card><CollectionToolbar state={examState} placeholder="Tìm đề thi..." filters={[{key:'period',label:'Thời gian',options:[{value:'upcoming',label:'Sắp diễn ra'},{value:'open',label:'Đang mở'},{value:'ended',label:'Đã kết thúc'}]}]}/></Card>}
      {examResult.error&&<Card role="alert">{examResult.error}<Button onClick={()=>void examResult.reload()}>Thử lại</Button></Card>}
      {examResult.loading?<LoadingSkeleton rows={3}/>:!examResult.error&&(examResult.rows.length?<div className="student-exam-grid">{examResult.rows.map(exam=><StudentExamCard key={exam.id} exam={exam} state={getStudentExamState(exam,user?.id,now)} classView/>)}</div>:<Card><EmptySearchState state={examState}/></Card>)}
      <CollectionPagination state={examState} total={examResult.total} count={examResult.rows.length} loading={examResult.loading}/>
    </section><section><h2>Buổi học trực tuyến</h2>
      {((liveResult.total??0)>10||liveState.active)&&<Card><CollectionToolbar state={liveState} placeholder="Tìm buổi học..." filters={[{key:'status',label:'Trạng thái',options:[{value:'scheduled',label:'Sắp diễn ra'},{value:'ongoing',label:'Đang diễn ra'},{value:'ended',label:'Đã kết thúc'},{value:'cancelled',label:'Đã hủy'}]}]}/></Card>}
      {liveResult.error&&<Card role="alert">{liveResult.error}<Button onClick={()=>void liveResult.reload()}>Thử lại</Button></Card>}
      {liveResult.loading?<LoadingSkeleton rows={3}/>:!liveResult.error&&(liveResult.rows.length?<div className="class-live-list">{liveResult.rows.map(item=><LiveClassCard key={item.id} item={item}/>)}</div>:<Card><EmptySearchState state={liveState}/></Card>)}
      <CollectionPagination state={liveState} total={liveResult.total} count={liveResult.rows.length} loading={liveResult.loading}/>
    </section></div></div>;
}

function LiveClassCard({ item }: { item: LiveClass }) { return <Card className="live-class-card"><div><h3>{item.title}</h3><p>{item.description ?? 'Buổi học trực tuyến của lớp.'}</p></div><div className="student-exam-meta"><span>{formatDate(item.scheduled_start)}</span><Badge>{item.status === 'ended' ? 'Đã kết thúc' : item.status === 'cancelled' ? 'Đã hủy' : statusLabel(item.status)}</Badge></div>{item.status === 'ongoing' && <Link className="ui-button ui-button-filled-pill" href={`/live-class/${item.id}`}>Tham gia phòng</Link>}</Card>; }
