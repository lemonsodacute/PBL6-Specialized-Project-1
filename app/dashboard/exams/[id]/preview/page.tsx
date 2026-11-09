'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, List, ListOrdered } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthContext';
import { QuestionImages } from '@/components/questions/QuestionImages';
import { Badge, Button, Card, LoadingSkeleton } from '@/components/ui';
import type { ManagedExam } from '@/components/teacher/ExamEditor';
import { api } from '@/lib/api';
import { examOptions } from '@/lib/exam-answer-options';
import { isSupportedQuestionType, normalizeQuestions, questionTypeLabel, unwrap, type SelectionQuestion } from '@/lib/question-selection';
import { friendlyError } from '@/lib/uiErrors';
import styles from './preview.module.css';

type PreviewExam = ManagedExam & { questions: SelectionQuestion[] };

export default function TeacherExamPreviewPage() {
  const { id } = useParams<{ id: string }>();
  const { user, authReady } = useAuth();
  const allowed = user?.role === 'teacher' || user?.role === 'admin';
  const [exam, setExam] = useState<PreviewExam | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [mode, setMode] = useState<'all' | 'single'>('all');
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!authReady || !allowed || !id) return;
    let active = true;
    setLoading(true);
    setError('');
    setExam(null);
    void api.exams.get(id).then(response => {
      if (!active) return;
      const detail = unwrap<ManagedExam>(response);
      if (!detail || !Array.isArray(detail.questions)) throw new Error('Phản hồi đề thi không có danh sách câu hỏi.');
      setExam({ ...detail, questions: normalizeQuestions(detail.questions) });
      setCurrentIndex(0);
    }).catch(cause => {
      if (active) setError(friendlyError(cause, 'Không tải được nội dung đề thi. Vui lòng thử lại.'));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, authReady, allowed, retry]);

  const questions = exam?.questions ?? [];
  const selected = Math.min(currentIndex, Math.max(0, questions.length - 1));
  const shown = mode === 'all' ? questions.map((question, index) => ({ question, index }))
    : questions[selected] ? [{ question: questions[selected], index: selected }] : [];

  const jump = (index: number) => {
    setCurrentIndex(index);
    if (mode === 'all') document.getElementById(`preview-question-${index + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (!authReady) return <div className="workspace-page"><LoadingSkeleton rows={3} /></div>;
  if (!allowed) return <div className="workspace-page"><Card role="alert">Chỉ giáo viên và quản trị viên được xem trước toàn bộ đề thi.</Card></div>;

  return <div className={`workspace-page ${styles.page}`}>
    <div className={styles.backBar}>
      <Link href="/dashboard/exams" className={styles.back}><ArrowLeft size={17} aria-hidden="true" />Danh sách đề thi</Link>
      <span className={styles.readonly}><Eye size={15} aria-hidden="true" /> Bản xem trước · Không ghi nhận bài làm</span>
    </div>

    {loading ? <LoadingSkeleton rows={5} /> : error ? <Card role="alert" className={styles.error}>
      <p>{error}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}>Thử lại</Button>
    </Card> : exam && <><header className={styles.header}>
      <div className={styles.examHeading}>
        <span className={styles.eyebrow}>Xem toàn bộ đề thi</span>
        <h1>{exam.title}</h1>
        <p>{exam.description || 'Bản xem trước nội dung đề thi dành cho giáo viên.'}</p>
        <div className={styles.examFacts}><Badge>{exam.status === 'draft' ? 'Bản nháp' : exam.status === 'closed' ? 'Đã đóng' : 'Đã xuất bản'}</Badge>
          <span>{questions.length} câu hỏi</span><span>{exam.duration_minutes} phút</span>
          {exam.shuffle_questions && <span>Thứ tự câu có thể được xáo trộn khi thi</span>}
          {exam.shuffle_options && <span>Đáp án có thể được xáo trộn khi thi</span>}
        </div>
      </div>
      <div className={styles.modes} role="group" aria-label="Cách xem đề thi">
        <Button type="button" variant={mode === 'all' ? 'primary' : 'outline'} size="sm" aria-pressed={mode === 'all'} onClick={() => setMode('all')}><List size={16} aria-hidden="true" /> Xem tất cả</Button>
        <Button type="button" variant={mode === 'single' ? 'primary' : 'outline'} size="sm" aria-pressed={mode === 'single'} onClick={() => setMode('single')}><ListOrdered size={16} aria-hidden="true" /> Từng câu</Button>
      </div>
    </header>

    {questions.length === 0 ? <Card className={styles.empty}>Đề thi này chưa có câu hỏi. Hãy vào Xem / Sửa để thêm câu hỏi.</Card>
      : <div className={styles.layout}>
        <aside className={styles.indexPanel} aria-label="Danh sách câu hỏi">
          <strong>{mode === 'single' ? `Câu ${selected + 1}/${questions.length}` : `Toàn bộ ${questions.length} câu hỏi`}</strong>
          <div className={styles.indexGrid}>{questions.map((question, index) =>
            <button key={question.id} type="button" aria-label={`Đi đến câu ${index + 1}`}
              aria-current={mode === 'single' && selected === index ? 'step' : undefined}
              className={mode === 'single' && selected === index ? styles.activeIndex : ''}
              onClick={() => jump(index)}>{index + 1}</button>
          )}</div>
          <p>Đây là nội dung gốc của đề thi. Đáp án đúng không được đánh dấu như khi sinh viên làm bài.</p>
        </aside>

        <section className={styles.questions} aria-label="Nội dung toàn bộ đề thi">
          {shown.map(({ question, index }) => {
            const options = examOptions(question.options_json);
            const isMulti = question.type === 'mcq_multi';
            return <article key={question.id} id={`preview-question-${index + 1}`} className={styles.questionCard}>
              <div className={styles.questionTop}><Badge>{questionTypeLabel(question.type)}</Badge>
                <span>Câu {index + 1} / {questions.length}</span>
                <span className={styles.points}>{question.points ?? question.default_points} điểm</span></div>
              {question.topic && <p className={styles.topic}>{question.topic}</p>}
              <h2>{question.content}</h2>
              <QuestionImages images={question.images} />
              {isSupportedQuestionType(question.type) && question.type !== 'essay'
                ? options.length > 0 ? <ul className={styles.options} aria-label={`Các phương án câu ${index + 1}`}>{options.map((option, optionIndex) =>
                    <li key={option.value + '-' + optionIndex} className={styles.option}>
                      <span className={isMulti ? styles.checkbox : styles.radio} aria-hidden="true" />
                      <span>{option.label}</span>
                    </li>
                  )}</ul> : <p className={styles.noOptions}>Câu hỏi chưa có phương án trả lời.</p>
                : question.type === 'essay'
                  ? <div className={styles.essayPlaceholder} aria-label="Vùng nhập câu trả lời tự luận (chỉ xem trước)">Sinh viên sẽ nhập câu trả lời tự luận ở đây.</div>
                  : <p className={styles.noOptions}>Loại câu hỏi này chưa được hỗ trợ trong bài thi trực tuyến.</p>}
            </article>;
          })}
          {mode === 'single' && <nav className={styles.navigation} aria-label="Điều hướng câu hỏi">
            <Button variant="outline" disabled={selected === 0} onClick={() => setCurrentIndex(index => index - 1)}><ArrowLeft size={16} aria-hidden="true" /> Câu trước</Button>
            <span>Câu {selected + 1}/{questions.length}</span>
            <Button variant="outline" disabled={selected === questions.length - 1} onClick={() => setCurrentIndex(index => index + 1)}>Câu tiếp theo <ArrowRight size={16} aria-hidden="true" /></Button>
          </nav>}
        </section>
      </div>}
    </>}
  </div>;
}
