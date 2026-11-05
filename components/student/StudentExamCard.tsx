
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, Modal, StatusBadge } from '@/components/ui';
import {
  Clock,
  CircleCheck,
  ClipboardList,
  Camera,
  Mic,
  CircleHelp,
} from 'lucide-react';
import {
  getStudentFinalScore,
  studentExamActionTarget,
  type ExamLike,
  type StudentExamState,
} from '@/lib/studentExamStatus';
import { formatCalendarDateTime } from '@/lib/calendar-date';
import styles from './StudentExams.module.css';

export type StudentExamListItem = ExamLike & {
  title: string;
  description?: string | null;
  duration_minutes: number;
  questions_count?: number;
  require_camera: boolean;
  require_mic?: boolean;
  classes?: { id: string; name: string }[];
};

export function StudentExamCard({
  exam,
  state,
  classView = false,
  playful = false,
}: {
  exam: StudentExamListItem;
  state: StudentExamState;
  classView?: boolean;
  playful?: boolean;
}) {
  const router = useRouter();
  const target = studentExamActionTarget(exam, state);

  const [retryConfirmationOpen, setRetryConfirmationOpen] = useState(false);

  const attempt = state.attempt;
  const finalScore = attempt ? getStudentFinalScore(attempt) : null;
  const soft = playful && (
    state.status === 'open' || state.status === 'upcoming'
  );

  const allowedAttempts = Math.max(1, exam.max_attempts ?? 1);
  const attemptsUsed = state.attempts.length;
  const remainingAttempts = Math.max(0, allowedAttempts - attemptsUsed);

  const retryHref = `/student/exams/${encodeURIComponent(exam.id)}/verify`;

  const statusBadge = (
    <StatusBadge status={state.status} label={state.label} />
  );

  return (
    <Card
      borderRole="exams"
      className={`student-exam-card ${playful ? styles.card : ''} ${
        soft ? styles.softCard : ''
      }`}
      data-exam-status={state.status}
      data-chat-avoid
    >
      <div className="student-exam-card-top">
        <div className="study-set-mark" aria-hidden="true">
          {state.status === 'upcoming' ? (
            <Clock size={22} />
          ) : state.status === 'ended' ? (
            <CircleCheck size={22} />
          ) : (
            <ClipboardList size={22} />
          )}
        </div>

        <div>
          <h3>{exam.title}</h3>
          <p>
            {classView
              ? exam.description ?? 'Đề thi của lớp'
              : exam.classes?.map(item => item.name).join(', ') ||
                'Đề thi cá nhân'}
          </p>
        </div>
      </div>

      <div className="student-exam-meta">
        {soft && state.status === 'upcoming' && statusBadge}

        <span>
          {playful && <Clock size={16} aria-hidden="true" />}
          {!soft && 'Thời lượng làm bài: '}
          {exam.duration_minutes} phút
        </span>

        {exam.questions_count !== undefined && (
          <span>
            {playful && <CircleHelp size={16} aria-hidden="true" />}
            {exam.questions_count} câu
          </span>
        )}

        {exam.require_camera && (
          <Badge>
            {playful && <Camera size={16} aria-hidden="true" />}
            Camera
          </Badge>
        )}

        {exam.require_mic && (
          <Badge>
            {playful && <Mic size={16} aria-hidden="true" />}
            Microphone
          </Badge>
        )}
      </div>

      {(!soft || state.status !== 'upcoming') && statusBadge}

      {playful ? (
        <dl className={styles.schedule}>
          <div>
            <dt>Thời gian mở</dt>
            <dd>
              <time dateTime={exam.start_time}>
                {formatCalendarDateTime(exam.start_time)}
              </time>
            </dd>
          </div>
          <div>
            <dt>Hạn làm bài</dt>
            <dd>
              <time dateTime={exam.end_time}>
                {formatCalendarDateTime(exam.end_time)}
              </time>
            </dd>
          </div>
        </dl>
      ) : (
        <p className="student-exam-note">
          Thời gian mở: {formatCalendarDateTime(exam.start_time)}
          <br />
          Hạn làm bài: {formatCalendarDateTime(exam.end_time)}
        </p>
      )}

      {state.status === 'in_progress' && (
        <p className="student-exam-note">
          Còn lại khoảng{' '}
          {attempt?.server_deadline_at
            ? `${Math.floor(
                Math.max(
                  0,
                  (Date.parse(attempt.server_deadline_at) - Date.now()) / 60000
                )
              )} phút`
            : '—'}
        </p>
      )}

      {state.action === 'result' && attempt && (
        <p className="student-exam-score">
          {finalScore === null ? (
            'Đang chờ chấm'
          ) : (
            <>
              Điểm: <strong>{finalScore} / {attempt.max_score ?? '—'}</strong>
            </>
          )}
        </p>
      )}

      <p className="student-exam-note">
        Bài thi cho phép tối đa{' '}
        <strong>{allowedAttempts} lần làm</strong>.
        {' '}Đã dùng {attemptsUsed}/{allowedAttempts} lượt.
        {state.canRetry && ` Còn ${remainingAttempts} lượt làm bài.`}
      </p>

      <div className="student-exam-actions">
        {state.canRetry && (
          <Button
            variant="primary"
            onClick={() => setRetryConfirmationOpen(true)}
          >
            Làm lại bài thi
          </Button>
        )}

        {target ? (
          <Link
            href={target}
            prefetch={true}
            className={`ui-button ui-button-${
              state.action === 'result' || state.canRetry
                ? 'outline'
                : 'primary'
            } ui-button-md`}
          >
            {state.actionLabel}
          </Link>
        ) : (
          <Button variant="outline" disabled>
            {state.actionLabel}
          </Button>
        )}
      </div>

      <Modal
        open={retryConfirmationOpen && state.canRetry}
        title="Bạn có muốn làm lại bài thi?"
        size="small"
        onClose={() => setRetryConfirmationOpen(false)}
      >
        <p className="modal-copy">
          Bài thi <strong>{exam.title}</strong> cho phép tối đa{' '}
          <strong>{allowedAttempts} lần làm</strong>.
        </p>

        <p className="modal-copy">
          Bạn đã dùng <strong>{attemptsUsed}/{allowedAttempts}</strong> lượt.
          Bạn còn <strong>{remainingAttempts}</strong> lượt làm bài.
        </p>

        <p className="modal-copy">
          Bạn có muốn làm lại bài thi này không?
          Kết quả của các lần làm trước vẫn được lưu.
        </p>

        <div className="modal-actions">
          <Button
            variant="outline"
            onClick={() => setRetryConfirmationOpen(false)}
          >
            Để sau
          </Button>

          <Button
            variant="primary"
            onClick={() => {
              setRetryConfirmationOpen(false);
              router.push(retryHref);
            }}
          >
            Tiếp tục làm lại
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
