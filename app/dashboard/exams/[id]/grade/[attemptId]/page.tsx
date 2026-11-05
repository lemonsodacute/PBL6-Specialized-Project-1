'use client';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Input, LoadingSkeleton } from '@/components/ui';
import { PageHeader } from '@/components/ui/PageHeader';
import { QuestionImages } from '@/components/questions/QuestionImages';
import { api, ApiError } from '@/lib/api';
import { answerText, resultDate, resultError, resultStatusLabels, scoreText, type ResultQuestion, type TeacherAttemptResult } from '@/lib/teacher-results';
import styles from '@/components/teacher/TeacherResults.module.css';

export default function GradeAttemptPage() {
  const { id, attemptId } = useParams<{ id: string; attemptId: string }>();
  const [result, setResult] = useState<TeacherAttemptResult | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const epoch = useRef(0);
  const load = useCallback(async () => {
    const request = ++epoch.current; setLoading(true); setError(''); setResult(null);
    try {
      const data = await api.teacherResults.attempt(attemptId);
      if (data?.id !== attemptId || data.exam_id !== id) throw new ApiError('Result not found', 404);
      if (!Array.isArray(data.questions)) throw new Error('Invalid result response');
      if (request === epoch.current) setResult(data);
    } catch (cause) { if (request === epoch.current) setError(resultError(cause)); }
    finally { if (request === epoch.current) setLoading(false); }
  }, [id, attemptId]);
  useEffect(() => { void load(); return () => { epoch.current++; }; }, [load]);
  return <div className={`workspace-page ${styles.page}`}><Link className="back-link" href={`/dashboard/exams/${id}/attempts`}><ArrowLeft className="inline-icon" aria-hidden="true" /> Quay lại kết quả bài thi</Link>
    <PageHeader mode="context" context="Chi tiết bài làm"  title={result?.exam_title??'Chi tiết kết quả'}  actions={<Button variant="outline" loading={loading} onClick={() => void load()}>Tải lại bài làm</Button>} />
    {loading && <LoadingSkeleton rows={5} />}
    {error && <Card role="alert"><p>{error}</p><Button onClick={() => void load()}>Thử lại</Button></Card>}
    {result && <><Card borderRole="exams"><dl className={styles.fields}>
      <div><dt>Sinh viên</dt><dd><strong>{result.student?.full_name ?? '—'}</strong></dd></div>
      <div><dt>MSSV</dt><dd>{result.student?.student_code || '—'}</dd></div>
      <div><dt>Đề thi</dt><dd>{result.exam_title}</dd></div>
      <div><dt>Điểm</dt><dd><strong>{scoreText(result.score)} / {scoreText(result.max_score)}</strong></dd></div>
      <div><dt>Bắt đầu lúc</dt><dd>{resultDate(result.started_at)}</dd></div>
      <div><dt>Nộp lúc</dt><dd>{resultDate(result.submitted_at)}</dd></div>
      <div><dt>Trạng thái</dt><dd>{resultStatusLabels[result.status]}</dd></div>
      <div><dt>Lần thi</dt><dd>{result.attempt_number}</dd></div>
    </dl></Card>
      {result.questions.map((question, index) => <QuestionResult key={question.question_id} question={question} index={index} reload={load} />)}
      {!result.questions.length && <Card borderRole="exams"><p>Chưa có câu hỏi trong bài làm này.</p></Card>}
    </>}
  </div>;
}

function QuestionResult({ question, index, reload }: { question: ResultQuestion; index: number; reload: () => Promise<void> }) {
  const manual = question.type === 'essay';
  const [points, setPoints] = useState(String(question.points_awarded ?? '')); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!question.answer_id || points.trim() === '') return;
    setSaving(true); setError('');
    try { await api.attempts.gradeAnswer(question.answer_id, { points_awarded: Number(points) }); await reload(); }
    catch { setError('Không lưu được điểm. Vui lòng kiểm tra điểm và thử lại.'); }
    finally { setSaving(false); }
  }
  const status = question.is_correct === true ? 'Đúng' : question.is_correct === false ? 'Sai' : question.student_answer === null ? 'Chưa trả lời' : manual && question.points_awarded !== null ? 'Đã chấm' : 'Chưa chấm';
  return <Card borderRole="exams"><div className={styles.detailHeader}><strong>Câu {index + 1}</strong><Badge>{({ mcq_single: 'Trắc nghiệm', mcq_multi: 'Nhiều đáp án', essay: 'Tự luận', oral: 'Hình thức đã ngừng hỗ trợ' } as Record<string, string>)[question.type] ?? question.type}</Badge></div>
    <p className={styles.question}>{question.content}</p><QuestionImages images={question.images} /><dl className={styles.fields}>
      <div><dt>Đáp án sinh viên</dt><dd>{answerText(question.student_answer, question.options_json)}</dd></div>
      <div><dt>Đáp án đúng</dt><dd>{question.correct_answer === null ? 'Chưa có đáp án được lưu' : answerText(question.correct_answer, question.options_json)}</dd></div>
      <div><dt>Kết quả</dt><dd>{status}</dd></div><div><dt>Điểm câu</dt><dd>{scoreText(question.points_awarded)} / {scoreText(question.points)}</dd></div>
    </dl>{question.explanation && <p className={styles.question}>Giải thích: {question.explanation}</p>}
    {manual && question.answer_id && <form className={styles.gradeForm} onSubmit={event => void save(event)}><label>Điểm câu {index + 1}<Input type="number" min="0" max={Number(question.points)} step="0.01" required value={points} onChange={event => setPoints(event.target.value)} /></label><Button type="submit" loading={saving}>Lưu điểm câu {index + 1}</Button>{error && <p role="alert">{error}</p>}</form>}
  </Card>;
}
