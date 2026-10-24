'use client';
import { X } from 'lucide-react';
import { useState } from 'react';
import { Button, Input, Modal, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { QuestionImages } from '@/components/questions/QuestionImages';
import { friendlyError } from '@/lib/uiErrors';
import { difficultyLabels, typeLabels, isSupportedQuestionType, type SelectionQuestion } from '@/lib/question-selection';
import type { JsonValue, QuestionDifficulty, QuestionType } from '@/types';
import type { DocumentImage } from '@/lib/question-documents';

export function QuestionEditor({ question, onClose, onSaved, onSaveDraft, documentImages }: {
  question: SelectionQuestion; onClose: () => void; onSaved?: () => void;
  onSaveDraft?: (question: SelectionQuestion) => void;
  documentImages?: DocumentImage[];
}) {
  const [draft, setDraft] = useState(question);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const source = draft.options_json;
  const rawOptions = Array.isArray(source) ? source : source && typeof source === 'object' && !Array.isArray(source) ? source.options : null;
  const options = Array.isArray(rawOptions) && rawOptions.every(value => typeof value === 'string') ? rawOptions as string[] : null;
  const correct = draft.correct_answer_json;
  const answer = correct && typeof correct === 'object' && !Array.isArray(correct)
    ? correct.answer ?? correct.answers ?? correct.correct_option ?? correct.correct_option_id ?? correct.correct_options ?? correct.correct_option_ids : correct;
  const answers = Array.isArray(answer) ? answer : answer == null ? [] : [answer];
  const update = (patch: Partial<SelectionQuestion>) => setDraft(current => ({ ...current, ...patch }));
  function answerPatch(values: JsonValue[]): JsonValue {
    if (draft.type === 'mcq_single') return { answer: values[0] ?? null };
    return { answers: values };
  }
  function setOptions(values: string[]) { update({ options_json: Array.isArray(source) ? values : { ...(source && typeof source === 'object' && !Array.isArray(source) ? source : {}), options: values } }); }
  async function save() {
    if (saving) return;
    if (!isSupportedQuestionType(draft.type)) return setError('Hình thức thi này đã ngừng hỗ trợ.');
    if (!draft.content.trim() || !Number.isFinite(Number(draft.default_points)) || Number(draft.default_points) <= 0) return setError('Nhập nội dung và điểm lớn hơn 0.');
    if (['mcq_single', 'mcq_multi'].includes(draft.type) && options && (options.length < 2 || options.some(value => !value.trim()) || new Set(options).size !== options.length || !answers.length || answers.some(value => !options.includes(String(value))) || (draft.type === 'mcq_single' && answers.length !== 1))) return setError('Cần ít nhất hai phương án khác nhau và chọn đáp án đúng.');
    setSaving(true); setError('');
    const body = { question_bank_id: draft.question_bank_id, type: draft.type, content: draft.content.trim(), default_points: Number(draft.default_points), topic: draft.topic?.trim() || null, difficulty: draft.difficulty || null,
      options_json: draft.options_json ?? null, correct_answer_json: draft.correct_answer_json ?? null, explanation: draft.explanation ?? null,
      is_active: draft.is_active };
    if (onSaveDraft) { onSaveDraft({ ...draft, ...body }); setSaving(false); return; }
    try { if (draft.id === 'new') await api.questionBanks.createQuestion(draft.question_bank_id, body); else await api.questionBanks.updateQuestion(draft.id, body); onSaved?.(); }
    catch (cause) { setError(friendlyError(cause, 'Không lưu được câu hỏi.')); }
    finally { setSaving(false); }
  }
  return <Modal open size="large" title={onSaveDraft ? 'Sửa câu hỏi đề xuất' : draft.id === 'new' ? 'Thêm câu hỏi' : 'Sửa câu hỏi'} onClose={() => { if (!saving) onClose(); }}><div className="question-form">
    {error && <p role="alert">{error}</p>}
    <label>Loại câu<Select value={draft.type} disabled={saving} onChange={e => { const type = e.target.value as QuestionType; update({ type, ...(['mcq_single', 'mcq_multi'].includes(type) ? { ...(source == null ? { options_json: { options: ['', ''] } } : {}), correct_answer_json: type === 'mcq_single' ? { answer: answers[0] ?? null } : { answers } } : {}) }); }}>{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
    <label>Nội dung câu hỏi<Textarea rows={4} value={draft.content} disabled={saving} onChange={e => update({ content: e.target.value })} /></label>
    <QuestionImages images={draft.images} />
    {!!documentImages?.length && <fieldset className="document-image-associations"><legend>Bổ sung hình từ tài liệu</legend>
      <p className="field-helper">Chọn hình thuộc câu hỏi này nếu tài liệu chưa xác định được liên kết. Hình đã lấy cùng câu hỏi được giữ lại khi nhập.</p>
      {documentImages.map((image, index) => <label key={image.id}><input type="checkbox" className="ui-checkbox"
        checked={!!draft.images?.some(item => item.id === image.id)} disabled={saving || !!question.images?.some(item => item.id === image.id)}
        onChange={event => update({ images: event.target.checked ? [...(draft.images ?? []), { ...image, preview_url: image.temp_url }]
          : draft.images?.filter(item => item.id !== image.id) })} />
        Hình {index + 1}{image.page ? ` · Trang ${image.page}` : ''}{image.question_number != null ? ` · Câu ${image.question_number}` : ' · Chưa xác định câu hỏi'}</label>)}
    </fieldset>}
    {['mcq_single', 'mcq_multi'].includes(draft.type) && (options ? <div className="option-editor"><div className="field-label">Các phương án <span>Chọn đáp án đúng</span></div>{options.map((option, index) => <div className="option-row" key={index}>
      <input type={draft.type === 'mcq_single' ? 'radio' : 'checkbox'} name="correct-option" aria-label={`Đáp án đúng ${index + 1}`} disabled={saving || !option.trim()} checked={!!option && answers.includes(option)} onChange={e => update({ correct_answer_json: answerPatch(draft.type === 'mcq_single' ? [option] : e.target.checked ? [...answers, option] : answers.filter(value => value !== option)) })} />
      <Input value={option} placeholder={`Phương án ${index + 1}`} aria-label={`Phương án ${index + 1}`} disabled={saving} onChange={e => {
        const values = options.map((value, i) => i === index ? e.target.value : value);
        update({ options_json: Array.isArray(source) ? values : { ...(source && typeof source === 'object' && !Array.isArray(source) ? source : {}), options: values }, correct_answer_json: answerPatch(answers.map(value => value === option ? e.target.value : value)) });
      }} />{options.length > 2 && <button className="remove-option" aria-label={`Xóa phương án ${index + 1}`} disabled={saving} onClick={() => { setOptions(options.filter((_, i) => i !== index)); update({ correct_answer_json: answerPatch(answers.filter(value => value !== option)) }); }}><X className="inline-icon" aria-hidden="true" /></button>}
    </div>)}<Button variant="outline" disabled={saving} onClick={() => setOptions([...options, ''])}>+ Thêm phương án</Button></div> : <p>Phương án và đáp án hiện có được giữ nguyên.</p>)}
    <div className="form-two-col"><label>Điểm mặc định<Input type="number" min="0.1" step="0.1" value={draft.default_points} disabled={saving} onChange={e => update({ default_points: Number(e.target.value) })} /></label><label>Độ khó<Select value={draft.difficulty ?? ''} disabled={saving} onChange={e => update({ difficulty: e.target.value as QuestionDifficulty || null })}><option value="">Chưa phân loại</option>{Object.entries(difficultyLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label></div>
    <label>Chủ đề / chương<Input value={draft.topic ?? ''} disabled={saving} onChange={e => update({ topic: e.target.value })} /></label>
    {!draft.type.startsWith('mcq_') && <label>Đáp án mẫu / Hướng dẫn trả lời<Textarea rows={4} value={typeof answer === 'string' ? answer : ''} disabled={saving}
      onChange={e => update({ correct_answer_json: { answer: e.target.value } })} /></label>}
    <label>Giải thích<Textarea rows={3} value={draft.explanation ?? ''} disabled={saving} onChange={e => update({ explanation: e.target.value })} /></label>
    {!onSaveDraft && <label><input className="ui-checkbox" type="checkbox" checked={draft.is_active} disabled={saving} onChange={e => update({ is_active: e.target.checked })} /> Đang sử dụng</label>}
    <div className="modal-actions"><Button variant="outline" disabled={saving} onClick={onClose}>Hủy</Button><Button variant="success" disabled={saving} onClick={() => void save()}>{saving ? 'Đang lưu...' : onSaveDraft ? 'Lưu bản nháp' : 'Lưu câu hỏi'}</Button></div>
  </div></Modal>;
}
