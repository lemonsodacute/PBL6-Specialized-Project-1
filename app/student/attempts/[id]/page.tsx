'use client';

import { Settings, Check, ArrowLeft, ArrowRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Badge, Button, Card, LoadingSkeleton, Modal, Textarea } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { QuestionImages } from '@/components/questions/QuestionImages';
import { friendlyError } from '@/lib/uiErrors';
import { entryMismatchMessage, identityError } from '@/lib/identity';
import { isCompletedAttempt } from '@/lib/studentExamStatus';
import {isSupportedQuestionType} from '@/lib/question-selection';
import type { AttemptStatus, JsonValue, Question, SeverityLevel, ViolationType } from '@/types';
import { StudentCallResponder } from '@/components/proctoring/StudentCallResponder';
import { useExamMedia } from '@/components/proctoring/useExamMedia';
import { useProctorInput } from '@/components/proctoring/useProctorInput';
import { forgetExamDeviceSetup, hasExamDeviceSetup } from '@/components/proctoring/examMediaTransfer';
import { GazeCalibrationPanel } from '@/components/proctoring/GazeCalibrationPanel';
import type { GazeCalibrationSample } from '@/components/proctoring/useProctorInput';
import { ExamDeviceSetup } from '@/components/proctoring/ExamDeviceSetup';
import { FloatingCamera } from '@/components/proctoring/FloatingCamera';
import { examEssay, examOptions, examSelection } from '@/lib/exam-answer-options';
import { StudentWarnings, useStudentWarnings } from '@/components/proctoring/StudentWarnings';

const formatTime = (seconds: number) => `${String(Math.floor(Math.max(seconds, 0) / 60)).padStart(2, '0')}:${String(Math.max(seconds, 0) % 60).padStart(2, '0')}`;
const severity: Record<ViolationType, SeverityLevel> = { tab_switch: 'medium', window_blur: 'medium', copy: 'high', paste: 'high', fullscreen_exit: 'high', right_click: 'low', devtools_open: 'high', network_offline: 'medium', network_online: 'low', multi_monitor: 'critical', other: 'low' };
const terminal = (status?: string) => Boolean(status && isCompletedAttempt(status));
const unwrap = <T,>(response: unknown): T => ((response as { data?: T }).data ?? response) as T;
function exitFullscreen() {
  const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
  if (!doc.fullscreenElement && !doc.webkitFullscreenElement) return;
  // Browser teardown is best effort and must never gate result navigation.
  try { void Promise.resolve((doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc)).catch(() => undefined); } catch { /* Already exiting/unsupported. */ }
}

function QuestionAnswer({ question, attemptId, value, disabled, onChange }: { question: Question; attemptId: string; value: JsonValue | undefined; disabled: boolean; onChange: (value: JsonValue) => void }) {
  const options = examOptions(question.options_json);
  if (question.type === 'essay') return <div className="answer-panel"><p className="question-topic">{question.topic} · {question.default_points} điểm</p><h2>{question.content}</h2><QuestionImages images={question.images} attemptId={attemptId} /><Textarea disabled={disabled} value={examEssay(value)} onChange={(event) => onChange(event.target.value)} rows={10} placeholder="Nhập câu trả lời của bạn..." /><div className="character-count">{examEssay(value).length} ký tự</div></div>;
  const selected = examSelection(value);
  return <div className="answer-panel"><p className="question-topic">{question.topic} · {question.default_points} điểm</p><h2>{question.content}</h2><QuestionImages images={question.images} attemptId={attemptId} /><div className="answer-options">{options.map((option) => <label className={`answer-option ${selected.includes(option.value) ? 'selected' : ''}`} key={option.value}><input disabled={disabled} type={question.type === 'mcq_single' ? 'radio' : 'checkbox'} checked={selected.includes(option.value)} onChange={() => onChange(question.type === 'mcq_single' ? option.value : selected.includes(option.value) ? selected.filter((item) => item !== option.value) : [...selected, option.value])} /><span className="option-marker" /><span>{option.label}</span></label>)}</div></div>;
}

function isAnswered(value: JsonValue | undefined) { return Array.isArray(value) ? value.length > 0 : String(value ?? '').trim().length > 0; }
function typeLabel(type: Question['type'] | undefined) { return type === 'mcq_single' ? 'MCQ · Một đáp án' : type === 'mcq_multi' ? 'MCQ · Nhiều đáp án' : type === 'essay' ? 'Tự luận' : 'Hình thức đã ngừng hỗ trợ'; }
type RealAttempt = { id: string; exam_id: string; status: AttemptStatus; started_at: string; server_deadline_at: string; submitted_at: string | null; score: number | null; max_score: number | null; remaining_seconds: number; questions: Question[]; answers: { id: string; question_id: string; answer_content: JsonValue | null; saved_at: string }[] };
type ExamSettings = { title: string; duration_minutes: number; require_camera: boolean; require_mic: boolean; require_fullscreen: boolean };

function useAttemptRecorder(attemptId: string | undefined, enabled: boolean, stream: MediaStream | null) {
  const current = useRef<MediaRecorder | null>(null);
  const stop = useCallback(() => { const recorder = current.current; current.current = null; if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* Stream already stopped. */ } } }, []);
  useEffect(() => {
    if (!attemptId || !enabled || !stream || typeof MediaRecorder === 'undefined') return;
    let recorder: MediaRecorder;
    try { recorder = new MediaRecorder(stream, { mimeType: 'video/webm' }); }
    catch { try { recorder = new MediaRecorder(stream); } catch { return; } }
    const chunks: Blob[] = [];
    let uploaded = false;
    current.current = recorder;
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => { if (!uploaded && chunks.length) { uploaded = true; void api.attempts.uploadRecording(attemptId, new Blob(chunks, { type: recorder.mimeType || 'video/webm' })).catch(() => undefined); } };
    try { recorder.start(1000); } catch { current.current = null; }
    return () => { if (current.current === recorder) stop(); else if (recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* Already stopped. */ } } };
  }, [attemptId, enabled, stream, stop]);
  return stop;
}

function RealStudentAttemptPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [attempt, setAttempt] = useState<RealAttempt | null>(null);
  const [exam, setExam] = useState<ExamSettings | null>(null);
  const [answers, setAnswers] = useState<Record<string, JsonValue>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [entryState, setEntryState] = useState<{ attemptId: string; phase: 'pending' | 'required' | 'complete' }>({ attemptId: id, phase: 'pending' });
  const gateOpen = entryState.attemptId === id && entryState.phase === 'required';
  const entryComplete = entryState.attemptId === id && entryState.phase === 'complete';
  const studentWarnings = useStudentWarnings(id, attempt?.status === 'in_progress' && !finished && entryComplete);
  const { recordBrowser, delivery: warningDelivery } = studentWarnings;
  const [entryBusy, setEntryBusy] = useState(false);
  const [entryError, setEntryError] = useState('');
  const entryWorking = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [fullscreenBlocked, setFullscreenBlocked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [gazeCalibrationEnabled, setGazeCalibrationEnabled] = useState(false);
  const [gazeCalibrationSample, setGazeCalibrationSample] = useState<GazeCalibrationSample | null>(null);
  const calibrationSampleRenderAt = useRef(0);
  const mounted = useRef(true);
  const submitInFlight = useRef(false);
  const submittedRef = useRef(false);
  const fullscreenStarted = useRef(false);
  const pendingSaves = useRef(new Set<Promise<void>>());
  const resources = useRef(new Set<() => void>());
  const initializedAttempt = useRef<string | null>(null);
  const fullscreenCleanup = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requireVideo = Boolean(exam?.require_camera), requireAudio = Boolean(exam?.require_mic);
  const media = useExamMedia(requireVideo, requireAudio, id);
  const entryMediaConfirmed = media.entryConfirmed;
  const stopEntryMedia = media.stopStream;
  const confirmDeviceEntry = media.confirmEntry, hasRequiredTracks = media.hasRequiredTracks, restoreMedia = media.restore, captureFrame = media.captureFrame;
  const stopRecording = useAttemptRecorder(attempt?.id, attempt?.status === 'in_progress' && !finished && entryComplete && media.ready, media.stream);
  const monitorVideoRef = useRef<HTMLVideoElement | null>(null);
  const attachMonitor = useCallback((element: HTMLVideoElement | null) => { monitorVideoRef.current = element; media.attachVideo(element); }, [media.attachVideo]);
  const receiveCalibrationSample = useCallback((sample: GazeCalibrationSample) => {
    const now = Date.now();
    if (now - calibrationSampleRenderAt.current < 200) return;
    calibrationSampleRenderAt.current = now;
    setGazeCalibrationSample(sample);
  }, []);
  const setCalibrationMode = useCallback((enabled: boolean) => setGazeCalibrationEnabled(enabled), []);
  useProctorInput(attempt?.id, attempt?.status === 'in_progress' && !finished && entryComplete && media.ready && requireVideo, monitorVideoRef, setCalibrationMode, receiveCalibrationSample);

  const finishAttempt = useCallback((status: AttemptStatus = 'submitted') => {
    if (!mounted.current || submittedRef.current) return;
    submittedRef.current = true;
    setFinished(true); setSubmitting(true); setSettingsOpen(false); setConfirmOpen(false); setFullscreenBlocked(false);
    forgetExamDeviceSetup(id);
    setAttempt(current => current ? { ...current, status } : current);
    resources.current.forEach(cleanup => cleanup()); resources.current.clear();
    stopRecording(); media.stopStream();
    router.replace(`/student/attempts/${id}/result`);
    exitFullscreen();
  }, [id, media.stopStream, router, stopRecording]);

  useEffect(() => {
    if (fullscreenCleanup.current !== null) clearTimeout(fullscreenCleanup.current);
    mounted.current = true;
    return () => {
      mounted.current = false; resources.current.forEach(cleanup => cleanup()); resources.current.clear();
      // Media/recorder hooks own cleanup. StrictMode replay must not stop their live handoff.
      fullscreenCleanup.current = setTimeout(exitFullscreen, 0);
    };
  }, []);

  useEffect(() => {
    if (initializedAttempt.current === id) return;
    let active = true;
    setLoading(true);
    void api.attempts.get(id).then(async response => {
      if (!active || submittedRef.current) return;
      const raw = unwrap<RealAttempt>(response);
      if (terminal(raw.status)) { finishAttempt(raw.status); return; }
      if (raw.status !== 'in_progress') { router.replace('/student/exams'); return; }
      if (raw.questions?.some(question=>!isSupportedQuestionType(question.type))) throw new ApiError('Unsupported exam format',422,'ORAL_EXAMS_DISABLED');
      const settings = unwrap<ExamSettings>(await api.exams.get(raw.exam_id));
      if (!active || submittedRef.current) return;
      const questions = (raw.questions ?? []).map(question => {
        const options = question.options_json as unknown;
        return { ...question, default_points: Number(question.default_points ?? 0), options_json: options && typeof options === 'object' && 'options' in options ? (options as { options: unknown[] }).options : options } as Question;
      });
      setAttempt({ ...raw, questions }); setExam({ ...settings, require_mic: Boolean(settings.require_mic) });
      initializedAttempt.current = id;
      setSecondsLeft(Math.max(0, Math.min(raw.remaining_seconds, Math.ceil((new Date(raw.server_deadline_at).getTime() - Date.now()) / 1000))));
      setAnswers(Object.fromEntries((raw.answers ?? []).map(answer => [answer.question_id, answer.answer_content])));
      const transferred = entryMediaConfirmed.current && hasRequiredTracks(settings.require_camera, Boolean(settings.require_mic));
      const completed = hasExamDeviceSetup(id, { camera: settings.require_camera, microphone: Boolean(settings.require_mic) });
      if (transferred) confirmDeviceEntry(settings.require_camera, Boolean(settings.require_mic));
      setEntryState({ attemptId: id, phase: !(settings.require_camera || settings.require_mic) || transferred ? 'complete' : completed ? 'pending' : 'required' });
      if (transferred && settings.require_fullscreen) {
        fullscreenStarted.current = true;
        setFullscreenBlocked(true); // Request fullscreen from the existing user-action prompt.
      }
    }).catch(cause => { if (active) { stopEntryMedia(); setError(friendlyError(cause, 'Không tải được bài làm.')); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, router, finishAttempt, entryMediaConfirmed, stopEntryMedia, confirmDeviceEntry, hasRequiredTracks]);

  useEffect(() => {
    if (!attempt || !exam || entryState.attemptId !== id || entryState.phase !== 'pending') return;
    let active = true;
    void (async () => {
      try {
        if (!await restoreMedia()) { if (active) setEntryState({ attemptId: id, phase: 'required' }); return; }
        if (!active || submittedRef.current) return;
        if (exam.require_camera) {
          const frame = await captureFrame(true);
          if (!active || submittedRef.current) return;
          const proof = await api.identity.verifyEntry(attempt.exam_id, frame, true);
          if (!proof.verified || proof.status !== 'verified' || !proof.id) throw new Error(entryMismatchMessage);
          if (!active || submittedRef.current) return;
          const resumed = unwrap<{ id: string }>(await api.attempts.start(attempt.exam_id, proof.id, attempt.id));
          if (resumed.id !== attempt.id) throw new Error('Lượt thi đã thay đổi. Vui lòng tải lại trang.');
        }
        if (!active || submittedRef.current) return;
        if (!confirmDeviceEntry()) throw new Error('Thiết bị chưa sẵn sàng. Vui lòng kiểm tra lại.');
        setEntryState({ attemptId: id, phase: 'complete' });
        if (exam.require_fullscreen) { fullscreenStarted.current = true; setFullscreenBlocked(true); }
      } catch (cause) {
        if (active && !submittedRef.current) {
          setEntryError(identityError(cause));
          setEntryState({ attemptId: id, phase: 'required' });
        }
      }
    })();
    return () => { active = false; };
  }, [id, attempt?.id, exam?.require_camera, exam?.require_mic, exam?.require_fullscreen, entryState.attemptId, entryState.phase, restoreMedia, captureFrame, confirmDeviceEntry]);

  useEffect(() => {
    if (!attempt || attempt.status !== 'in_progress' || finished || !entryComplete || !media.ready || (!requireVideo && !requireAudio)) return;
    void api.attempts.startProctoring(attempt.id).catch(() => undefined);
  }, [attempt?.id, attempt?.status, finished, entryComplete, media.ready, requireVideo, requireAudio]);

  const submitAttempt = useCallback(async () => {
    if (!attempt || attempt.status !== 'in_progress' || submitInFlight.current || submittedRef.current) return;
    submitInFlight.current = true; setSubmitting(true); setSubmitError(''); setError('');
    try {
      // Finish already-dispatched saves before the server locks this attempt.
      await Promise.allSettled(Array.from(pendingSaves.current));
      if (!mounted.current || submittedRef.current) return;
      const response = await api.attempts.submit(attempt.id);
      if (!mounted.current) return;
      const submitted = unwrap<Partial<RealAttempt>>(response);
      if (!submitted.status || !terminal(submitted.status)) throw new Error('Backend chưa xác nhận bài đã nộp. Vui lòng thử lại.');
      finishAttempt(submitted.status);
    } catch (cause) {
      if (!mounted.current || submittedRef.current) return;
      // A generic conflict is not evidence of submission: confirm actual status.
      if (cause instanceof ApiError && (cause.status === 409 || ['ATTEMPT_NOT_IN_PROGRESS', 'ATTEMPT_EXPIRED'].includes(cause.code ?? ''))) {
        try { const current = unwrap<RealAttempt>(await api.attempts.get(attempt.id)); if (terminal(current.status)) { finishAttempt(current.status); return; } } catch { /* Keep retry available. */ }
      }
      const message = friendlyError(cause, 'Không thể nộp bài. Vui lòng thử lại.');
      setSubmitError(message); setError(message);
    } finally {
      submitInFlight.current = false;
      if (mounted.current && !submittedRef.current) setSubmitting(false);
    }
  }, [attempt, finishAttempt]);

  useEffect(() => {
    if (!attempt || attempt.status !== 'in_progress' || finished) return;
    const deadline = new Date(attempt.server_deadline_at).getTime();
    const timer = window.setInterval(() => {
      if (submittedRef.current) return;
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining); if (!remaining) void submitAttempt();
    }, 1000);
    const cleanup = () => window.clearInterval(timer); resources.current.add(cleanup);
    return () => { cleanup(); resources.current.delete(cleanup); };
  }, [attempt?.id, attempt?.status, attempt?.server_deadline_at, finished, submitAttempt]);

  useEffect(() => {
    if (!attempt || attempt.status !== 'in_progress' || finished) return;
    let active = true, checking = false;
    const check = async () => {
      if (!active || checking || submittedRef.current || document.visibilityState === 'hidden') return;
      checking = true;
      try { const current = unwrap<RealAttempt>(await api.attempts.get(id)); if (active && terminal(current.status)) finishAttempt(current.status); } catch { /* A network failure does not end an attempt. */ }
      finally { checking = false; }
    };
    const timer = window.setInterval(() => void check(), 15_000);
    window.addEventListener('focus', check); window.addEventListener('pageshow', check);
    const cleanup = () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', check); window.removeEventListener('pageshow', check); };
    resources.current.add(cleanup);
    return () => { cleanup(); resources.current.delete(cleanup); };
  }, [id, attempt?.status, finished, finishAttempt]);

  const sendViolation = useCallback((type: ViolationType) => {
    if (!attempt || attempt.status !== 'in_progress' || submittedRef.current || !entryComplete) return;
    const warningId = recordBrowser(type);
    void api.attempts.violations(attempt.id, { type, severity: severity[type], metadata_json: { source: 'browser' } }).then(response => {
      if (!mounted.current || submittedRef.current) return;
      const result = unwrap<{ locked: boolean; attempt_status?: AttemptStatus }>(response);
      warningDelivery(warningId, 'sent');
      if (result.locked) finishAttempt('terminated');
      else if (terminal(result.attempt_status)) finishAttempt(result.attempt_status);
    }).catch(() => { if (mounted.current && !submittedRef.current) warningDelivery(warningId, 'failed'); });
  }, [attempt?.id, attempt?.status, entryComplete, finishAttempt, recordBrowser, warningDelivery]);

  useEffect(() => {
    if (!attempt || attempt.status !== 'in_progress' || finished) return;
    const onVisibility = () => { if (document.visibilityState === 'hidden') sendViolation('tab_switch'); };
    const onBlur = () => sendViolation('window_blur'), onCopy = () => sendViolation('copy'), onPaste = () => sendViolation('paste');
    const onContext = (event: MouseEvent) => { if (!submittedRef.current) { event.preventDefault(); sendViolation('right_click'); } };
    document.addEventListener('visibilitychange', onVisibility); window.addEventListener('blur', onBlur);
    document.addEventListener('copy', onCopy); document.addEventListener('paste', onPaste); document.addEventListener('contextmenu', onContext);
    const cleanup = () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('blur', onBlur); document.removeEventListener('copy', onCopy); document.removeEventListener('paste', onPaste); document.removeEventListener('contextmenu', onContext); };
    resources.current.add(cleanup);
    return () => { cleanup(); resources.current.delete(cleanup); };
  }, [attempt?.id, attempt?.status, finished, sendViolation]);

  useEffect(() => {
    if (!attempt || attempt.status !== 'in_progress' || finished) return;
    const onFullscreen = () => {
      if (submittedRef.current) return;
      const doc = document as Document & { webkitFullscreenElement?: Element };
      const full = !!(document.fullscreenElement || doc.webkitFullscreenElement); setIsFullscreen(full);
      if (!full && exam?.require_fullscreen && fullscreenStarted.current && entryComplete) { sendViolation('fullscreen_exit'); setFullscreenBlocked(true); }
    };
    const events = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
    events.forEach(event => document.addEventListener(event, onFullscreen));
    const cleanup = () => events.forEach(event => document.removeEventListener(event, onFullscreen));
    resources.current.add(cleanup);
    return () => { cleanup(); resources.current.delete(cleanup); };
  }, [exam?.require_fullscreen, attempt?.id, attempt?.status, finished, entryComplete, sendViolation]);

  function saveAnswer(questionId: string, value: JsonValue) {
    if (!attempt || attempt.status !== 'in_progress' || submittedRef.current || submitInFlight.current || fullscreenBlocked || !entryComplete) return;
    setAnswers(current => ({ ...current, [questionId]: value })); setSaving(true);
    const job = (async () => {
      try {
        const saved = unwrap<{ saved_at: string }>(await api.attempts.saveAnswer(attempt.id, { question_id: questionId, answer_content: value }));
        if (mounted.current && !submittedRef.current) setSavedAt(new Date(saved.saved_at).toLocaleTimeString('vi-VN', { hour12: false }));
      } catch (cause) {
        if (mounted.current && !submittedRef.current) {
          if (cause instanceof ApiError && ['ATTEMPT_EXPIRED', 'ATTEMPT_NOT_IN_PROGRESS'].includes(cause.code ?? '')) {
            try { const current = unwrap<RealAttempt>(await api.attempts.get(id)); if (terminal(current.status)) { finishAttempt(current.status); return; } } catch { /* Surface save failure. */ }
          }
          setError(friendlyError(cause, 'Không lưu được câu trả lời.'));
        }
      }
    })();
    pendingSaves.current.add(job);
    void job.finally(() => { pendingSaves.current.delete(job); if (mounted.current && !submittedRef.current) setSaving(pendingSaves.current.size > 0); });
  }
  const enterRoom = async () => {
    if (!media.ready || media.busy || submittedRef.current || entryWorking.current || !attempt) return;
    entryWorking.current = true;
    setEntryBusy(true);
    setEntryError('');
    try {
      if (requireVideo) {
        const frame = await media.captureFrame();
        const final = await api.identity.verifyEntry(attempt.exam_id, frame, true);
        if (!final.verified || final.status !== 'verified') {
          setEntryError(entryMismatchMessage);
          return;
        }
        if (!final.id) throw new Error('Chưa nhận được xác nhận danh tính. Vui lòng thử lại.');
        const resumed = unwrap<{ id: string }>(await api.attempts.start(attempt.exam_id, final.id, attempt.id));
        if (resumed.id !== attempt.id) throw new Error('Lượt thi đã thay đổi. Vui lòng tải lại trang.');
      }
      if (submittedRef.current) return;
      if (!confirmDeviceEntry()) throw new Error('Thiết bị chưa sẵn sàng. Vui lòng kiểm tra lại.');
      setEntryState({ attemptId: id, phase: 'complete' });
      if (exam?.require_fullscreen) {
        fullscreenStarted.current = true;
        const element = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
        try { const request = element.requestFullscreen ?? element.webkitRequestFullscreen; if (request) void Promise.resolve(request.call(element)).catch(() => { if (!submittedRef.current) setFullscreenBlocked(true); }); else setFullscreenBlocked(true); } catch { setFullscreenBlocked(true); }
      }
    } catch (cause) {
      setEntryError(identityError(cause));
    } finally {
      entryWorking.current = false;
      setEntryBusy(false);
    }
  };
  const toggleFullscreen = () => {
    if (submittedRef.current) return;
    if (document.fullscreenElement) exitFullscreen();
    else {
      const element = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
      try { const request = element.requestFullscreen ?? element.webkitRequestFullscreen; if (request) void Promise.resolve(request.call(element)).then(() => setFullscreenBlocked(false)).catch(() => setError('Vui lòng cho phép chế độ toàn màn hình để tiếp tục.')); } catch { setError('Chưa thể bật toàn màn hình. Vui lòng thử lại.'); }
    }
  };
  if (finished || terminal(attempt?.status)) return <div className="workspace-page"><Card role="status"><p>Bài thi đã kết thúc. Đang mở kết quả...</p></Card></div>;
  if (loading) return <div className="workspace-page"><LoadingSkeleton rows={5} /></div>;
  if (error && !attempt) return <div className="workspace-page"><Card><p role="alert">{error}</p></Card></div>;
  if (!attempt || !exam) return null;
  if (entryState.attemptId !== id || entryState.phase === 'pending') return <div className="workspace-page">
    <video ref={attachMonitor} autoPlay muted playsInline className="proctor-stream-hidden" aria-hidden="true" />
    <Card role="status"><p>Đang khôi phục thiết bị cho lượt thi...</p><LoadingSkeleton rows={3} /></Card>
  </div>;
  const currentQuestion = attempt.questions[currentIndex];
  const locked = attempt.status !== 'in_progress' || submitting;
  const answeredCount = Object.values(answers).filter(isAnswered).length;
  return <div className="attempt-page">
    {entryComplete && media.ready && <StudentCallResponder attemptId={attempt.id} />}
    <video ref={attachMonitor} autoPlay muted playsInline className="proctor-stream-hidden" aria-hidden="true" />
    <header className="attempt-header" data-camera-avoid><div><h1>{exam.title}</h1></div>
      <div className="attempt-header-actions"><div className="attempt-timer"><span><small>Thời gian còn lại</small><strong>{formatTime(secondsLeft)}</strong></span></div>
        <Button variant="outline" disabled={locked} onClick={toggleFullscreen} aria-label="Toàn màn hình">⛶</Button>
        {(requireVideo || requireAudio) && <Button variant="outline" disabled={locked} onClick={() => setSettingsOpen(true)} aria-label="Cài đặt thiết bị"><Settings className="inline-icon" aria-hidden="true" /></Button>}
        <Button variant="success" disabled={locked} onClick={() => setConfirmOpen(true)}>{submitting ? 'Đang nộp...' : 'Nộp bài'}</Button>
      </div>
    </header>
    {entryComplete && <StudentWarnings state={studentWarnings} />}
    {media.lostMessage && <div className="device-loss-banner" role="alert">{media.lostMessage}<Button variant="outline" onClick={() => setSettingsOpen(true)}>Kiểm tra thiết bị</Button></div>}
    {error && <div className="device-loss-banner" role="alert">{error}{submitError && <Button variant="warning" disabled={submitting} onClick={() => void submitAttempt()}>Thử lại</Button>}</div>}
    <div className="attempt-layout"><aside className="question-sidebar"><p>{answeredCount}/{attempt.questions.length} câu đã làm</p><div className="question-index-list">{attempt.questions.map((item, index) => <button key={item.id} disabled={locked} className={index === currentIndex ? 'active' : ''} onClick={() => setCurrentIndex(index)}><span>{index + 1}</span>{isAnswered(answers[item.id]) && <i><Check className="inline-icon" aria-hidden="true" /></i>}</button>)}</div></aside>
      <main className="question-main"><div className="question-main-top"><Badge>{typeLabel(currentQuestion?.type)}</Badge><span>Câu {currentIndex + 1} / {attempt.questions.length}</span>{saving && <span className="save-status">Đang lưu...</span>}{!saving && savedAt && <span className="save-status saved">Đã lưu lúc {savedAt}</span>}</div>{currentQuestion && <QuestionAnswer attemptId={attempt.id} question={currentQuestion} value={answers[currentQuestion.id]} disabled={locked || fullscreenBlocked || gateOpen} onChange={value => saveAnswer(currentQuestion.id, value)} />}</main>
    </div>
    <div className="attempt-footer" data-camera-avoid><Button variant="outline" disabled={locked || currentIndex === 0} onClick={() => setCurrentIndex(value => value - 1)}><ArrowLeft className="inline-icon" aria-hidden="true" /> Câu trước</Button><span>Thời gian còn lại {formatTime(secondsLeft)}</span><Button variant="outline" disabled={locked || currentIndex >= attempt.questions.length - 1} onClick={() => setCurrentIndex(value => value + 1)}>Câu tiếp theo <ArrowRight className="inline-icon" aria-hidden="true" /></Button></div>
    {entryComplete && (requireVideo || requireAudio) && <FloatingCamera attemptId={attempt.id} media={media} requireVideo={requireVideo} requireAudio={requireAudio} />}
    {gazeCalibrationEnabled && entryComplete && !finished && <GazeCalibrationPanel sample={gazeCalibrationSample} />}
    <ExamDeviceSetup open={gateOpen} media={media} requireVideo={requireVideo} requireAudio={requireAudio} verifying={entryBusy} entryError={entryError} onEnter={() => void enterRoom()} onClose={() => { if (!requireVideo && !requireAudio) setEntryState({ attemptId: id, phase: 'complete' }); }} />
    <ExamDeviceSetup open={settingsOpen && !gateOpen} settings media={media} requireVideo={requireVideo} requireAudio={requireAudio} onEnter={() => { if (media.ready) setSettingsOpen(false); }} onClose={() => setSettingsOpen(false)} />
    <Modal open={confirmOpen} size="small" title="Nộp bài kiểm tra?" onClose={() => { if (!submitting) setConfirmOpen(false); }}><p className="modal-copy">Bạn đã làm <strong>{answeredCount}/{attempt.questions.length}</strong> câu.</p><div className="modal-actions"><Button variant="outline" disabled={submitting} onClick={() => setConfirmOpen(false)}>Tiếp tục làm</Button><Button variant="success" disabled={submitting} onClick={() => { setConfirmOpen(false); void submitAttempt(); }}>Xác nhận nộp bài</Button></div></Modal>
    {fullscreenBlocked && <div className="fullscreen-overlay"><div className="fullscreen-panel"><h2>Bạn đã thoát chế độ toàn màn hình</h2><p>Hãy vào lại chế độ toàn màn hình để tiếp tục.</p><Button onClick={toggleFullscreen}>Vào lại toàn màn hình</Button></div></div>}
  </div>;
}

export default function StudentAttemptPage() { return <RealStudentAttemptPage />; }
