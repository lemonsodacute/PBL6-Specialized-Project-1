'use client';
import {useRouter} from 'next/navigation';
import {Badge,Button,Card,StatusBadge} from '@/components/ui';
import { Clock, CircleCheck, ClipboardList } from 'lucide-react';
import {getStudentFinalScore,studentExamActionTarget,type ExamLike,type StudentExamState} from '@/lib/studentExamStatus';
import {formatCalendarDateTime} from '@/lib/calendar-date';

export type StudentExamListItem = ExamLike & {title:string;description?:string|null;duration_minutes:number;questions_count?:number;require_camera:boolean;require_mic?:boolean;classes?:{id:string;name:string}[]};

export function StudentExamCard({exam,state,classView=false}:{exam:StudentExamListItem;state:StudentExamState;classView?:boolean}){
  const router=useRouter(),target=studentExamActionTarget(exam,state);
  const attempt=state.attempt;
  const finalScore=attempt?getStudentFinalScore(attempt):null;
  return <Card className="student-exam-card" data-exam-status={state.status} data-chat-avoid><div className="student-exam-card-top"><div className="study-set-mark" aria-hidden="true">{state.status==='upcoming'?<Clock size={22}/>:state.status==='ended'?<CircleCheck size={22}/>:<ClipboardList size={22}/>}</div><div>
    <h3>{exam.title}</h3><p>{classView?exam.description??'Đề thi của lớp':exam.classes?.map(item=>item.name).join(', ')||'Đề thi cá nhân'}</p>
  </div></div><div className="student-exam-meta"><span>Thời lượng làm bài: {exam.duration_minutes} phút</span>{exam.questions_count!==undefined&&<span>{exam.questions_count} câu</span>}{exam.require_camera&&<Badge>Camera</Badge>}{exam.require_mic&&<Badge>Microphone</Badge>}</div>
    <StatusBadge status={state.status} label={state.label}/>
    <p className="student-exam-note">Thời gian mở: {formatCalendarDateTime(exam.start_time)}<br/>Hạn làm bài: {formatCalendarDateTime(exam.end_time)}</p>
    {state.status==='in_progress'&&<p className="student-exam-note">Còn lại khoảng {attempt?.server_deadline_at?`${Math.floor(Math.max(0,(Date.parse(attempt.server_deadline_at)-Date.now())/60000))} phút`:'—'}</p>}
    {state.action==='result'&&attempt&&<p className="student-exam-score">{finalScore===null?'Đang chờ chấm':<>Điểm: <strong>{finalScore} / {attempt.max_score??'—'}</strong></>}</p>}
    <div className="student-exam-actions"><Button variant={state.action==='result'?'outline':'primary'} disabled={!target} onClick={()=>{if(target)router.push(target);}}>{state.actionLabel}</Button>
      {state.canRetry&&<Button variant="warning" onClick={()=>router.push(`/student/exams/${encodeURIComponent(exam.id)}/verify`)}>Làm lại</Button>}
    </div>
  </Card>;
}
