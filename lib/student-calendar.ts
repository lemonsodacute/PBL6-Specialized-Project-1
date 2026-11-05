import { getStudentExamState, isCompletedAttempt, studentAttemptLabel, type ExamLike } from './studentExamStatus';

export type CalendarExam = Omit<ExamLike, 'end_time'> & { title: string; end_time?: string | null; duration_minutes?: number; classes?: { id: string; name: string }[] };
export type CalendarClass = { id: string; title?: string; name?: string; class_id?: string; class_name?: string | null; start_time?: string; scheduled_start?: string; end_time?: string; scheduled_end?: string; status?: string };
export type CalendarEvent = { id: string; title: string; start: Date; end: Date | null; type: 'exam' | 'class'; href: string; durationMinutes?: number; exam?: CalendarExam; sourceStatus?: string; courseNames?: string[]; courseId?: string };
export const calendarDayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const dayStart = (date: Date) => { const result = new Date(date); result.setHours(0, 0, 0, 0); return result; };
const validDate = (value?: string | null) => { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? date : null; };

export function mapCalendarEvents(exams: CalendarExam[], classes: CalendarClass[]): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const exam of exams) {
    const start = validDate(exam.start_time), end = validDate(exam.end_time);
    if (!start) continue;
    events.push({ id: `exam-${exam.id}`, title: `Thi: ${exam.title}`, start, end: end && end >= start ? end : null,
      type: 'exam', href: `/student/exams/${encodeURIComponent(exam.id)}/verify`, durationMinutes: exam.duration_minutes, exam, courseNames: exam.classes?.map(item => item.name).filter(Boolean) });
  }
  for (const item of classes) {
    const start = validDate(item.start_time ?? item.scheduled_start), end = validDate(item.end_time ?? item.scheduled_end);
    if (!start) continue;
    events.push({ id: `class-${item.id}`, title: `Lớp: ${item.title ?? item.name ?? 'Buổi học trực tuyến'}`, start,
      end: end && end >= start ? end : null, type: 'class', href: '/student/live-classes', sourceStatus: item.status, courseNames: item.class_name ? [item.class_name] : [], courseId: item.class_id });
  }
  return events;
}

export function calendarEventStatus(event: CalendarEvent, studentId?: string, now = Date.now()) {
  if (event.exam) {
    const status = event.exam.status?.toLowerCase();
    if (status && isCompletedAttempt(status)) return { status, label: studentAttemptLabel(status) };
    const state = getStudentExamState({ ...event.exam, status: status === 'ended' ? 'closed' : status,
      end_time: event.end?.toISOString() ?? '' }, studentId, now);
    return { status: state.status, label: state.canRetry ? 'Có thể làm lại' : state.label, canRetry: state.canRetry };
  }
  const status = event.sourceStatus?.toLowerCase();
  if (status === 'cancelled') return { status: 'unavailable', label: 'Đã hủy' };
  if (status === 'ended' || (event.end && now > event.end.getTime())) return { status: 'ended', label: 'Đã kết thúc' };
  if (status === 'ongoing' || status === 'live' || now >= event.start.getTime()) return { status: 'open', label: 'Đang diễn ra' };
  return { status: 'upcoming', label: 'Sắp diễn ra' };
}

export function calendarEventOnDay(event: CalendarEvent, day: Date) {
  const date = dayStart(day).getTime();
  return dayStart(event.start).getTime() <= date && dayStart(event.end ?? event.start).getTime() >= date;
}

