export type AttemptLike = { id: string; status: string; exam_id?: string; student_id?: string; attempt_number?: number; started_at?: string | null; updated_at?: string | null; server_deadline_at?: string | null; submitted_at?: string | null; score?: number | string | null; max_score?: number | string | null; final_score?: number | string | null; grading_pending?: boolean };
export type ExamLike = { id: string; status?: string; start_time: string; end_time: string; max_attempts?: number; allow_review?: boolean; attempt?: AttemptLike | null; attempts?: AttemptLike[] };
export type StudentExamStatus = 'upcoming' | 'open' | 'in_progress' | 'submitted' | 'auto_submitted' | 'completed' | 'graded' | 'finalized' | 'terminated' | 'ended' | 'unavailable';
export type StudentExamState = { status: StudentExamStatus; label: string; group: 'upcoming' | 'current' | 'open' | 'completed' | 'ended' | 'unavailable'; attempt: AttemptLike | null; attempts: AttemptLike[]; action: 'start' | 'resume' | 'result' | 'none'; actionLabel: string; canRetry: boolean };
const terminalStatuses = new Set(['submitted', 'auto_submitted', 'completed', 'graded', 'finalized', 'terminated']);
export const isCompletedAttempt = (status: string) => terminalStatuses.has(status.toLowerCase());
export const studentAttemptLabel = (status: string) => ({not_started:'Chưa bắt đầu',in_progress:'Đang làm',submitted:'Đã nộp',auto_submitted:'Tự động nộp',completed:'Đã hoàn thành',graded:'Đã có kết quả',finalized:'Đã có kết quả',terminated:'Bị kết thúc'}[status.toLowerCase()] ?? 'Chưa xác định được trạng thái bài làm');

/** Zero is a real score. A partial automatic score is not a final score. */
export function getStudentFinalScore(attempt: AttemptLike): number | string | null {
  if (!isCompletedAttempt(attempt.status) || attempt.grading_pending) return null;
  return attempt.final_score !== undefined ? attempt.final_score : attempt.score ?? null;
}

/** The parent exam supplies scope for older responses; explicit foreign IDs are never rebound. */
export function getExamAttempts(exam: ExamLike, studentId?: string): AttemptLike[] {
  const records = new Map<string, AttemptLike>();
  for (const item of [...(Array.isArray(exam.attempts) ? exam.attempts : []), ...(exam.attempt ? [exam.attempt] : [])]) {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.status !== 'string') continue;
    if (item.exam_id !== undefined && item.exam_id !== exam.id) continue;
    if (studentId && item.student_id !== undefined && item.student_id !== studentId) continue;
    records.set(item.id, item);
  }
  return [...records.values()].sort((a,b) => (b.attempt_number ?? 0) - (a.attempt_number ?? 0)
    || (Date.parse(b.started_at ?? '') || 0) - (Date.parse(a.started_at ?? '') || 0) || b.id.localeCompare(a.id));
}

export function canRetryExam(exam: ExamLike, attempts: AttemptLike[], now = Date.now()) {
  const own = getExamAttempts({...exam, attempt:null, attempts});
  // "allow_review" controls whether students may view answers, not whether
  // they may use another attempt. Backend /attempts/start enforces max_attempts.
  return Boolean(own.some(item=>isCompletedAttempt(item.status))
    && !own.some(item=>item.status.toLowerCase()==='in_progress')
    && (exam.max_attempts ?? 1) > own.length
    && ['published','ongoing'].includes(exam.status ?? '')
    && now >= Date.parse(exam.start_time) && now <= Date.parse(exam.end_time));
}

/** Attempt.status is authoritative; presence, score and submitted_at do not imply submission. */
export function getStudentExamState(exam: ExamLike, studentId?: string, now = Date.now()): StudentExamState {
  const attempts = getExamAttempts(exam,studentId);
  const attempt = attempts.find(item=>item.status.toLowerCase()==='in_progress') ?? attempts[0] ?? null;
  const attemptStatus = attempt?.status.toLowerCase();
  const base = {attempt,attempts,canRetry:false};
  if (attemptStatus === 'in_progress') return {...base,status:'in_progress',label:'Đang làm',group:'current',action:'resume',actionLabel:'Tiếp tục làm bài'};
  const completed = attempts.find(item=>isCompletedAttempt(item.status));
  if (completed) {
    const status = completed.status.toLowerCase() as StudentExamStatus;
    const canRetry = canRetryExam(exam,attempts,now);
    return {...base,attempt:completed,status,label:studentAttemptLabel(status),group:canRetry?'open':'completed',action:'result',actionLabel:getStudentFinalScore(completed)===null?'Xem bài đã nộp':'Xem kết quả',canRetry};
  }
  if (attempt && attemptStatus !== 'not_started') return {...base,status:'unavailable',label:'Chưa xác định được trạng thái bài làm',group:'unavailable',action:'none',actionLabel:'Chưa thể làm bài'};
  const start = Date.parse(exam.start_time), end = Date.parse(exam.end_time);
  if (exam.status === 'closed' || now > end) return {...base,status:'ended',label:'Đã kết thúc',group:'ended',action:'none',actionLabel:'Bỏ lỡ'};
  if (exam.status === 'draft' || !Number.isFinite(start) || !Number.isFinite(end)) return {...base,status:'unavailable',label:exam.status==='draft'?'Chưa xuất bản':'Đề thi chưa khả dụng',group:'unavailable',action:'none',actionLabel:'Chưa thể làm bài'};
  if (now < start) return {...base,status:'upcoming',label:'Sắp diễn ra',group:'upcoming',action:'none',actionLabel:'Chưa đến giờ bắt đầu'};
  // Review/retry policy applies only after a completed attempt, never to the first start.
  const hasCapacity = attempts.length < (exam.max_attempts ?? 1);
  return {...base,status:hasCapacity?'open':'unavailable',label:hasCapacity?'Đang diễn ra':'Hết lượt làm bài',group:hasCapacity?'open':'unavailable',action:hasCapacity?'start':'none',actionLabel:hasCapacity?'Bắt đầu làm bài':'Hết lượt làm bài'};
}

export const actionableExamGroups = ['current','open','upcoming'] as const;
export function groupStudentActionableExams<T extends ExamLike>(exams:T[],studentId?:string,now=Date.now()) {
  const groups:Record<typeof actionableExamGroups[number],{exam:T;state:StudentExamState}[]>={current:[],open:[],upcoming:[]};
  for(const exam of exams){
    const state=getStudentExamState(exam,studentId,now);
    if(state.group==='current'||state.group==='open'||state.group==='upcoming')groups[state.group].push({exam,state});
  }
  const time=(value?:string|null)=>{const result=Date.parse(value??'');return Number.isFinite(result)?result:Infinity;};
  groups.current.sort((a,b)=>time(a.state.attempt?.server_deadline_at??a.exam.end_time)-time(b.state.attempt?.server_deadline_at??b.exam.end_time)||a.exam.id.localeCompare(b.exam.id));
  groups.open.sort((a,b)=>time(a.exam.end_time)-time(b.exam.end_time)||a.exam.id.localeCompare(b.exam.id));
  groups.upcoming.sort((a,b)=>time(a.exam.start_time)-time(b.exam.start_time)||a.exam.id.localeCompare(b.exam.id));
  return groups;
}

export function studentExamActionTarget(exam: ExamLike, state: StudentExamState): string | null {
  if (state.action==='resume' && state.attempt) return `/student/attempts/${encodeURIComponent(state.attempt.id)}`;
  if (state.action==='result' && state.attempt) return `/student/attempts/${encodeURIComponent(state.attempt.id)}/result`;
  if (state.action==='start') return `/student/exams/${encodeURIComponent(exam.id)}/verify`;
  return null;
}

export function getExamStatus(exam: ExamLike, attempt?: AttemptLike | null, now = Date.now()): StudentExamStatus {
  return getStudentExamState({...exam,attempt,attempts:attempt?[attempt]:[]},undefined,now).status;
}
