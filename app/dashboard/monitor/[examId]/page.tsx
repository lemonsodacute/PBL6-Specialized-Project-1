'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { ProctorConsole } from '@/components/proctoring/ProctorConsole';
import { ExamMonitoringReport } from '@/components/proctoring/ExamMonitoringReport';
import { Card, LoadingSkeleton } from '@/components/ui';
import { api } from '@/lib/api';

export default function MonitorPage() {
  const { examId, attemptId } = useParams<{ examId: string; attemptId?: string }>();
  const search=useSearchParams();
  const [ended,setEnded]=useState<boolean|null>(null),[error,setError]=useState(false);
  useEffect(()=>{
    let live=true;setEnded(null);setError(false);
    const check=()=>void api.exams.get(examId).then(response=>{const {data}=response as {data:{status:string;end_time:string}};if(live)setEnded(data.status==='closed'||Date.now()>=Date.parse(data.end_time));}).catch(()=>{if(live)setError(true);});
    check();const timer=window.setInterval(check,30000);
    return()=>{live=false;window.clearInterval(timer);};
  },[examId]);
  if(error)return <div className="workspace-page"><Card role="alert"><p>Không tải được đề thi hoặc bạn không có quyền xem.</p><Link href="/dashboard/monitor">Quay lại Giám sát</Link></Card></div>;
  if(ended===null)return <div className="workspace-page"><LoadingSkeleton rows={4}/></div>;
  if(ended||search.get('view')==='report')return <ExamMonitoringReport key={examId} examId={examId} attemptId={attemptId}/>;
  return <ProctorConsole key={examId} examId={examId} linkedAttemptId={attemptId} />;
}
