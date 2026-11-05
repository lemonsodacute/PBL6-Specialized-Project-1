import Link from 'next/link';
import { CheckCircle2, Clock3, Hourglass, CircleX } from 'lucide-react';
import { ProctoOwlMascot } from '@/components/brand/ProctoOwlMascot';
import { Button, Card } from '@/components/ui';
import type { ClassroomSession } from '@/lib/classroom';

// Detail/history dates include the full year and an explicit, consistent zone.
const date = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function SessionTime({ value }: { value: string }) {
  return <time dateTime={value}>{date.format(new Date(value))}</time>;
}

export function ClassroomSessionCard({ session, waiting = false, classHref, returnLabel, onLeave }: {
  session: ClassroomSession; waiting?: boolean; classHref: string; returnLabel: string; onLeave: () => void;
}) {
  const cancelled = session.status === 'cancelled';
  const ended = session.status === 'ended';
  const Icon = waiting ? Hourglass : cancelled ? CircleX : ended ? CheckCircle2 : Clock3;
  const title = waiting ? 'Đang chờ giảng viên cho vào lớp' : cancelled ? 'Buổi học đã hủy' : ended ? 'Buổi học đã kết thúc' : 'Buổi học sắp diễn ra';
  return <Card borderRole="classes" className="classroom-session-summary" aria-labelledby="classroom-state-title">
    <div className="classroom-summary-heading">
      <span className="classroom-state-icon"><Icon size={24} aria-hidden="true" /></span>
      <div><p className="classroom-state-label">{waiting ? 'Phòng chờ' : cancelled ? 'Đã hủy' : ended ? 'Đã kết thúc' : 'Sắp diễn ra'}</p><h2 id="classroom-state-title">{title}</h2></div>
      <ProctoOwlMascot variant="compact" />
    </div>
    <h3 className="classroom-session-title">{session.title}</h3>
    {waiting && <p className="classroom-waiting-message" role="status">Yêu cầu đã được gửi. Camera và microphone được tắt trong khi chờ.</p>}
    {!waiting && session.description && <p className="classroom-summary-description">{session.description}</p>}
    <dl className="classroom-session-facts">
      <div><dt>Lớp</dt><dd>{session.class_name || '—'}</dd></div>
      <div><dt>Giảng viên</dt><dd>{session.teacher_name || '—'}</dd></div>
      <div className="classroom-schedule"><dt>Thời gian dự kiến</dt><dd><SessionTime value={session.scheduled_start} /><span aria-hidden="true"> – </span><SessionTime value={session.scheduled_end} /></dd></div>
      {(ended || session.actual_end) && <div><dt>Kết thúc thực tế</dt><dd>{session.actual_end ? <SessionTime value={session.actual_end} /> : 'Chưa có dữ liệu'}</dd></div>}
    </dl>
    <p className="classroom-timezone">Giờ Việt Nam (UTC+7)</p>
    <div className="classroom-summary-actions">
      <Button onClick={onLeave}>{returnLabel}</Button>
      <Link href={classHref} className="ui-button ui-button-outline">Quay lại lớp học</Link>
    </div>
  </Card>;
}
