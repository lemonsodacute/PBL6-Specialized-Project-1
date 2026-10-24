'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge, Button, EmptyState, Input, LoadingSkeleton, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/uiErrors';
import { normalizeQuestions, unwrap, type Bank, type SelectionDraft, type SelectionQuestion } from '@/lib/question-selection';
import { QuestionSelector } from './QuestionSelector';

type ClassItem = { id: string; name: string };
export type ManagedExam = {
  id: string; title: string; description: string | null; status: string; start_time: string; end_time: string;
  duration_minutes: number; questions_count: number; classes: ClassItem[]; require_camera: boolean; require_mic?: boolean;
  require_fullscreen?: boolean; shuffle_questions?: boolean; shuffle_options?: boolean; allow_review?: boolean;
  max_attempts?: number; questions?: SelectionQuestion[];
  violation_auto_lock_threshold?: number | null;
  attempt_count?: number; completed_attempt_count?: number;
};
type Form = { title: string; description: string; start_time: string; end_time: string; duration_minutes: string;
  max_attempts: string; require_camera: boolean; require_mic: boolean; require_fullscreen: boolean;
  shuffle_questions: boolean; shuffle_options: boolean; allow_review: boolean; violation_auto_lock_threshold: string };
const initial: Form = { title: '', description: '', start_time: '', end_time: '', duration_minutes: '60', max_attempts: '1',
  require_camera: true, require_mic: true, require_fullscreen: true, shuffle_questions: false, shuffle_options: false, allow_review: true, violation_auto_lock_threshold: '' };
function inputDate(value: string) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }

export function ExamEditor({ examId, initialSelection, onSaved, onCancel, onSavingChange }: {
  examId?: string; initialSelection?: SelectionDraft; onSaved: (exam: ManagedExam) => void; onCancel: () => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const [form, setForm] = useState<Form>(initial);
  const [exam, setExam] = useState<ManagedExam | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [bankId, setBankId] = useState('');
  const [questions, setQuestions] = useState<SelectionQuestion[]>([]);
  const [selected, setSelected] = useState<SelectionQuestion[]>([]);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [bankLoading, setBankLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectorBusy, setSelectorBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const createdId = useRef<string | undefined>();
  const working = useRef(false);
  const bankRequest = useRef(0);
  const reviewSection = useRef<HTMLElement>(null);
  const readOnly = !!exam && exam.status !== 'draft';
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    (async () => {
      try {
        const [bankResult, classResult, detailResult, defaultsResult] = await Promise.all([api.questionBanks.list(), api.classes.list(), examId ? api.exams.get(examId) : Promise.resolve(null), examId ? Promise.resolve(null) : api.settings.me()]);
        const availableBanks = unwrap<Bank[]>(bankResult);
        const detail = detailResult ? unwrap<ManagedExam>(detailResult) : null;
        if (!examId && !defaultsResult?.exam_defaults) throw new Error('Exam defaults unavailable');
        if (!active) return;
        setBanks(availableBanks); setClasses(unwrap<ClassItem[]>(classResult));
        setExam(detail);
        if (detail) {
          setForm({ title: detail.title, description: detail.description ?? '', start_time: inputDate(detail.start_time), end_time: inputDate(detail.end_time), duration_minutes: String(detail.duration_minutes), max_attempts: String(detail.max_attempts ?? 1),
            require_camera: detail.require_camera, require_mic: !!detail.require_mic, require_fullscreen: detail.require_fullscreen !== false, shuffle_questions: !!detail.shuffle_questions, shuffle_options: !!detail.shuffle_options, allow_review: detail.allow_review !== false, violation_auto_lock_threshold: detail.violation_auto_lock_threshold == null ? '' : String(detail.violation_auto_lock_threshold) });
          setSelected(normalizeQuestions(detail.questions ?? [])); setClassIds((detail.classes ?? []).map(item => item.id));
        } else if (defaultsResult?.exam_defaults) {
          const defaults = defaultsResult.exam_defaults;
          setForm(current => ({ ...current, duration_minutes: String(defaults.exam_duration_minutes), require_camera: defaults.exam_require_camera, require_mic: defaults.exam_require_mic }));
        }
        const startBank = initialSelection?.bank_id ?? detail?.questions?.[0]?.question_bank_id ?? '';
        if (startBank && availableBanks.some(bank => bank.id === startBank)) {
          const items = normalizeQuestions(await api.questionBanks.questions(startBank));
          if (!active) return;
          setBankId(startBank); setQuestions(items);
          if (initialSelection) {
            const wanted = new Set(initialSelection.question_ids);
            const valid = items.filter(q => wanted.has(q.id) && q.is_active);
            setSelected(valid);
            if (valid.length !== wanted.size) setError('Một số câu đã chọn không còn khả dụng; vui lòng kiểm tra danh sách.');
          }
        }
      } catch (cause) { if (active) setError(friendlyError(cause, 'Không tải được dữ liệu tạo đề.')); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; bankRequest.current++; };
  }, [examId, initialSelection, reload]);
  async function changeBank(id: string) {
    const generation = ++bankRequest.current;
    setBankId(id); setQuestions([]); setBankLoading(!!id); setError('');
    if (!id) return;
    try { const items = normalizeQuestions(await api.questionBanks.questions(id)); if (generation === bankRequest.current) setQuestions(items); }
    catch (cause) { if (generation === bankRequest.current) setError(friendlyError(cause, 'Không tải được câu hỏi.')); }
    finally { if (generation === bankRequest.current) setBankLoading(false); }
  }
  const update = (patch: Partial<Form>) => setForm(current => ({ ...current, ...patch }));
  async function save(publish: boolean) {
    if (working.current || selectorBusy || bankLoading) return;
    const start = new Date(form.start_time), end = new Date(form.end_time);
    if (!form.title.trim()) return setError('Vui lòng nhập tên đề thi.');
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return setError('Thời gian kết thúc phải sau thời gian bắt đầu.');
    if (![form.duration_minutes, form.max_attempts].every(value => Number.isInteger(Number(value)) && Number(value) > 0)) return setError('Thời lượng và số lần làm phải là số nguyên lớn hơn 0.');
    if (form.violation_auto_lock_threshold && (!Number.isInteger(Number(form.violation_auto_lock_threshold)) || Number(form.violation_auto_lock_threshold) < 0)) return setError('Ngưỡng tự động khóa cần là số nguyên không âm.');
    if (!selected.length) return setError('Vui lòng chọn ít nhất một câu hỏi.');
    if (selected.length > 500) return setError('Một đề có thể chọn tối đa 500 câu.');
    if (publish && !classIds.length) return setError('Cần giao đề cho ít nhất một lớp khi xuất bản.');
    working.current = true; setSaving(true); onSavingChange?.(true); setError('');
    try {
      const body = { ...form, title: form.title.trim(), description: form.description.trim() || null,
        start_time: start.toISOString(), end_time: end.toISOString(), duration_minutes: Number(form.duration_minutes), max_attempts: Number(form.max_attempts), violation_auto_lock_threshold: form.violation_auto_lock_threshold === '' ? null : Number(form.violation_auto_lock_threshold), status: exam?.status ?? 'draft' };
      const id = examId ?? createdId.current;
      let saved = unwrap<ManagedExam>(id ? await api.exams.update(id, body) : await api.exams.create(body));
      if (!examId) createdId.current = saved.id;
      if (!readOnly) await api.exams.replaceQuestions(saved.id, selected.map(q => q.id));
      const existing = unwrap<{ id: string; class_id: string }[]>(await api.examAssignments.list({ examId: saved.id }));
      for (const item of existing) if (!classIds.includes(item.class_id)) await api.examAssignments.delete(item.id);
      for (const classId of classIds) if (!existing.some(item => item.class_id === classId)) await api.examAssignments.create(saved.id, { class_id: classId });
      if (publish && saved.status === 'draft') saved = unwrap<ManagedExam>(await api.exams.update(saved.id, { status: 'published' }));
      onSaved(saved);
    } catch (cause) { setError(friendlyError(cause, 'Không thể lưu đề thi.')); }
    finally { working.current = false; setSaving(false); onSavingChange?.(false); }
  }
  if (loading) return <LoadingSkeleton rows={4} />;
  if (!banks.length && error && !exam) return <div role="alert"><p>{error}</p><Button variant="warning" onClick={() => setReload(value => value + 1)}>Thử lại</Button></div>;
  return <div className="exam-editor form-stack" aria-busy={saving}>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="exam-editor-section" aria-labelledby="exam-information"><h3 id="exam-information">1. Thông tin đề thi</h3><div className="exam-form-grid">
      <label>Tên đề thi<Input value={form.title} disabled={saving} onChange={e => update({ title: e.target.value })} /></label>
      <label>Mô tả<Textarea value={form.description} disabled={saving} rows={3} onChange={e => update({ description: e.target.value })} /></label>
      <div className="form-two-col"><label>Bắt đầu<Input type="datetime-local" value={form.start_time} disabled={saving} onChange={e => update({ start_time: e.target.value })} /></label><label>Kết thúc<Input type="datetime-local" value={form.end_time} disabled={saving} onChange={e => update({ end_time: e.target.value })} /></label></div>
      <div className="form-two-col"><label>Thời lượng (phút)<Input type="number" min="1" value={form.duration_minutes} disabled={saving} onChange={e => update({ duration_minutes: e.target.value })} /></label><label>Số lần làm tối đa<Input type="number" min="1" value={form.max_attempts} disabled={saving} onChange={e => update({ max_attempts: e.target.value })} /></label></div>
    </div></section>
    <section className="exam-editor-section" aria-labelledby="exam-selection"><h3 id="exam-selection">2. Chọn câu hỏi</h3><div className="form-stack">
      <label className="selector-bank-label">Ngân hàng câu hỏi<Select value={bankId} disabled={saving || readOnly || selectorBusy} onChange={e => void changeBank(e.target.value)}><option value="">Chọn ngân hàng</option>{banks.map(bank => <option key={bank.id} value={bank.id}>{bank.name} · {bank.questions_count} câu</option>)}</Select></label>
      {!banks.length && <EmptyState title="Chưa có ngân hàng câu hỏi">Thêm ngân hàng và câu hỏi trước khi tạo đề.</EmptyState>}
      {bankLoading && <p role="status">Đang tải câu hỏi...</p>}
      <QuestionSelector onBusyChange={setSelectorBusy} bankId={bankId} questions={questions.filter(q => q.is_active)} selected={selected} onChange={setSelected} disabled={saving || bankLoading || selectorBusy} readOnly={readOnly} pointsPerQuestion={1} onDone={() => reviewSection.current?.scrollIntoView({ behavior: 'smooth' })} />
    </div></section>
    <section className="exam-editor-section" aria-labelledby="exam-configuration"><h3 id="exam-configuration">3. Giao cho lớp & cấu hình thi</h3><div className="exam-form-grid"><div><div className="field-label">Giao cho lớp</div><div className="check-grid">{classes.map(item => <label key={item.id}><input type="checkbox" className="ui-checkbox" disabled={saving} checked={classIds.includes(item.id)} onChange={e => setClassIds(current => e.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />{item.name}</label>)}</div></div>
      <label>Ngưỡng tự động khóa bài<Input type="number" min="0" value={form.violation_auto_lock_threshold} disabled={saving} onChange={e => update({ violation_auto_lock_threshold: e.target.value })} /><small>Số vi phạm trước khi hệ thống khóa bài. Để trống để không đặt ngưỡng.</small></label>
      <div className="check-grid">{([['require_camera', 'Yêu cầu Camera'], ['require_mic', 'Yêu cầu Microphone'], ['require_fullscreen', 'Bắt buộc toàn màn hình'], ['shuffle_questions', 'Xáo trộn câu hỏi'], ['shuffle_options', 'Xáo trộn đáp án'], ['allow_review', 'Cho xem lại bài']] as const).map(([key, label]) => <label key={key}><input type="checkbox" className="ui-checkbox" checked={form[key]} disabled={saving} onChange={e => update({ [key]: e.target.checked })} />{label}</label>)}</div>
    </div></section>
    <section ref={reviewSection} className="exam-editor-section" aria-labelledby="exam-review"><h3 id="exam-review">4. Kiểm tra và lưu</h3><p><strong>{form.title || 'Chưa nhập tên đề'}</strong> · {selected.length} câu · {form.duration_minutes} phút</p><p>Lớp được giao: {classes.filter(item => classIds.includes(item.id)).map(item => item.name).join(', ') || 'Chưa giao lớp'}</p><Badge>{exam?.status === 'published' ? 'Đã xuất bản' : 'Chưa lưu thay đổi'}</Badge><p>Danh sách xem trước chỉ được lưu khi bạn chọn thao tác dưới đây.</p></section>
    <div className="modal-actions"><Button variant="outline" disabled={saving} onClick={onCancel}>Huỷ</Button><Button variant="secondary" disabled={saving || bankLoading || selectorBusy} onClick={() => void save(false)}>{exam?.status && exam.status !== 'draft' ? 'Lưu thay đổi' : 'Lưu nháp'}</Button>{(!exam || exam.status === 'draft') && <Button variant="success" disabled={saving || bankLoading || selectorBusy} onClick={() => void save(true)}>{saving ? 'Đang lưu...' : 'Xuất bản'}</Button>}</div>
  </div>;
}
