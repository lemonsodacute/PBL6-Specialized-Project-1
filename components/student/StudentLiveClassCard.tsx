import Link from 'next/link';
import { BarChart3, CalendarDays, ClipboardList, GraduationCap, Video } from 'lucide-react';
import { Badge, Card } from '@/components/ui';
import { classroomDate, type ClassroomSession } from '@/lib/classroom';
import styles from './StudentLiveClasses.module.css';

const accents = [
  { name: 'yellow', Icon: ClipboardList },
  { name: 'pink', Icon: Video },
  { name: 'purple', Icon: GraduationCap },
  { name: 'mint', Icon: BarChart3 },
] as const;
const statusLabels: Record<ClassroomSession['status'], string> = {
  scheduled: 'Sắp diễn ra', ongoing: 'Đang diễn ra', ended: 'Đã kết thúc', cancelled: 'Đã hủy',
};

/** Identity, rather than list position, keeps decorations stable while filtering. */
function sessionAccent(id: string) {
  const hash = Array.from(id).reduce((value, character) => (Math.imul(value, 31) + character.charCodeAt(0)) >>> 0, 0);
  return accents[hash % accents.length];
}

export function StudentLiveClassCard({ session }: { session: ClassroomSession }) {
  const { name, Icon } = sessionAccent(session.id);
  return <Card borderRole="classes" className={`classroom-session-card ${styles.sessionCard}`} data-student-online-session={session.id} data-status={session.status} data-chat-avoid>
    <div className={styles.sessionContent}>
      <span className={styles.sessionIcon} data-accent={name} aria-hidden="true"><Icon size={23} /></span>
      <span className={styles.statusBadge} data-status={session.status}><span className={styles.statusDot} aria-hidden="true" />{statusLabels[session.status]}</span>
      <h2>{session.title}</h2>
      {session.status === 'ended' && session.has_published_recording && <Badge className={styles.recordingBadge}>Bản ghi có sẵn</Badge>}
      <p className={styles.course}>{session.class_name}</p>
      <p className={styles.teacher}>Giảng viên: {session.teacher_name || '—'}</p>
      {session.description && <p className={styles.description}>{session.description}</p>}
      <div className={styles.schedule}><CalendarDays size={20} aria-hidden="true" /><span className={styles.scheduleRange}>
        <time dateTime={session.scheduled_start}>{classroomDate(session.scheduled_start)}</time><span aria-hidden="true">–</span><time dateTime={session.scheduled_end}>{classroomDate(session.scheduled_end)}</time>
      </span></div>
    </div>
    <Link href={session.status === 'ended' && session.published_recording_id ? `/live-class/${session.id}/recordings/${session.published_recording_id}` : `/live-class/${session.id}`}
      className={`ui-button ui-button-filled-pill ${styles.action}`}>
      {session.status === 'ongoing' ? 'Tham gia' : session.status === 'ended' && session.has_published_recording ? 'Xem lại buổi học' : 'Xem chi tiết'}
    </Link>
  </Card>;
}
