'use client';

import Link from 'next/link';
import { CalendarDays, Clock3, ShieldCheck, CircleCheck, Circle, ArrowRight, Camera } from 'lucide-react';
import type { CalendarEvent } from '@/lib/student-calendar';
import { getStudentExamState, studentExamActionTarget } from '@/lib/studentExamStatus';
import { formatCalendarDateTime } from '@/lib/calendar-date';
import type { User } from '@/types';
import styles from './StudentHeroExam.module.css';

// The same geometric face and eyes as the public mascot, kept static in the workspace.
function StudentOwl() {
  return <svg className={styles.owl} viewBox="100 60 320 210" aria-hidden="true" fill="none" data-chat-avoid>
    <path d="M133 177L108 63L193 91Q260 66 327 91L412 63L387 177Q414 249 396 314H124Q106 249 133 177Z" fill="#006D77" />
    <path d="M198 104Q230 101 260 132Q290 101 322 104Q379 107 379 174Q379 243 315 247Q283 245 260 224Q237 245 205 247Q141 243 141 174Q141 107 198 104Z" fill="#ECF5EB" />
    {[204,316].map(cx => <g key={cx}><circle cx={cx} cy="173" r="44" fill="#FFFDF4"/><circle cx={cx} cy="174" r="28" fill="#E9C777"/><circle cx={cx} cy="174" r="19" fill="#183D43"/><circle cx={cx+7} cy="166" r="7" fill="#FFFDF4"/></g>)}
    <path d="M248 222Q260 215 272 222L260 240Z" fill="#DDAE50" />
    <path d="M165 122Q191 104 217 117M303 117Q329 104 355 122" stroke="#00616B" strokeWidth="7" strokeLinecap="round"/>
  </svg>;
}

export function StudentHeroExam({ event, user, now }: { event: CalendarEvent; user: User | null; now: number }) {
  if (!event.exam) return null;
  const exam = { ...event.exam, end_time: event.end?.toISOString() ?? '' };
  const state = getStudentExamState(exam, user?.id, now);
  const target = state.canRetry ? `/student/exams/${encodeURIComponent(exam.id)}/verify` : studentExamActionTarget(exam, state) ?? event.href;
  const days = Math.max(0, Math.ceil((event.start.getTime() - now) / 86_400_000));
  const requirement = event.exam as typeof event.exam & { require_camera?: boolean; require_mic?: boolean };
  const needsDevices = requirement.require_camera || requirement.require_mic;
  const identityKnown = user?.identity_profile_status !== undefined;
  const cardKnown = user?.student_card_status !== undefined;
  const readiness = [
    { title:'Hồ sơ sinh viên', done:user?.identity_profile_status === 'VERIFIED', detail:identityKnown ? user?.identity_profile_status === 'VERIFIED' ? 'Đã xác minh' : 'Chưa được xác minh' : 'Xem trạng thái trong hồ sơ', href:'/student/profile' },
    ...(requirement.require_camera ? [{ title:'Thẻ sinh viên', done:user?.student_card_status === 'VERIFIED', detail:cardKnown ? user?.student_card_status === 'VERIFIED' ? 'Đã xác thực' : 'Cần kiểm tra trong hồ sơ' : 'Xem trạng thái trong hồ sơ', href:'/student/profile' }] : []),
  ];
  return <section className={styles.hero} aria-label="Kỳ thi ưu tiên" data-chat-avoid>
    <StudentOwl />
    <div className={styles.card} data-exam-status={state.status}>
      <div className={styles.exam}>
        <span className={styles.status}>{state.canRetry ? `Có thể làm lại · Còn ${Math.max(0,(exam.max_attempts??1)-state.attempts.length)} lượt` : state.status === 'upcoming' ? days > 1 ? `Còn ${days} ngày` : 'Sắp diễn ra' : state.label}</span>
        <p className={styles.context}>Kỳ thi trong khoảng lịch đang xem</p>
        <h2>{event.exam.title}</h2>
        {!!event.courseNames?.length && <p className={styles.course}>{event.courseNames.join(' · ')}</p>}
        <ul className={styles.meta}>
          <li><CalendarDays size={19} aria-hidden="true"/><span>Mở: <strong>{formatCalendarDateTime(event.exam.start_time)}</strong></span></li>
          <li><CalendarDays size={19} aria-hidden="true"/><span>Đóng: <strong>{formatCalendarDateTime(event.exam.end_time)}</strong></span></li>
          {event.durationMinutes !== undefined && <li><Clock3 size={19} aria-hidden="true"/><span>Thời lượng làm bài: <strong>{event.durationMinutes} phút</strong></span></li>}
        </ul>
        <Link className="ui-button ui-button-primary" href={target}>{state.canRetry ? 'Làm lại bài thi' : state.action === 'resume' ? state.actionLabel : 'Chuẩn bị'}<ArrowRight size={17} aria-hidden="true"/></Link>
        {state.canRetry && state.attempt && <Link className="ui-button ui-button-outline" href={`/student/attempts/${encodeURIComponent(state.attempt.id)}/result`}>Xem kết quả lần trước</Link>}
      </div>
      <aside className={styles.readiness} aria-label="Chuẩn bị trước giờ thi">
        <h3>Chuẩn bị trước giờ thi</h3>
        <ul>{readiness.map(item => <li key={item.title} data-ready={item.done}><Link href={item.href}>{item.done ? <CircleCheck size={23} aria-hidden="true"/> : <Circle size={23} aria-hidden="true"/>}<span><strong>{item.title}</strong><small>{item.detail}</small></span><ArrowRight size={16} aria-hidden="true"/></Link></li>)}</ul>
        <div className={styles.device}><Camera size={20} aria-hidden="true"/><span>{needsDevices ? [requirement.require_camera && 'Camera', requirement.require_mic && 'microphone'].filter(Boolean).join(' và ') : 'Thiết bị và yêu cầu bài thi'}<small>Kiểm tra tại bước chuẩn bị, trước khi vào bài.</small></span></div>
        {requirement.require_camera && <p className={styles.note}><ShieldCheck size={18} aria-hidden="true"/>Xác minh khuôn mặt được thực hiện trong luồng vào thi.</p>}
      </aside>
    </div>
  </section>;
}
