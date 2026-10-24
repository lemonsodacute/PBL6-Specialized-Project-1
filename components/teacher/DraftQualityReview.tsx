'use client';
import { Check } from 'lucide-react';
import { Star } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button, Select, Textarea } from '@/components/ui';
import { apiFetch } from '@/lib/api';

export type QualityFeedback = {
  decision: 'accepted' | 'edited' | 'rejected' | null;
  reason: string | null;
  quality_rating?: number | null;
  reason_note?: string | null;
};
const empty: QualityFeedback = { decision: null, reason: null, quality_rating: null, reason_note: null };
const reasons = { wrong_answer: 'Sai đáp án', ungrounded: 'Không bám tài liệu', ambiguous: 'Câu hỏi mơ hồ',
  weak_distractors: 'Phương án nhiễu chưa tốt', wrong_difficulty: 'Sai mức độ khó', weak_explanation: 'Giải thích chưa tốt', wording: 'Cần chỉnh câu chữ', other: 'Khác' };
const ratingLabels = ['Rất kém', 'Kém', 'Trung bình', 'Tốt', 'Rất tốt'];

export function DraftQualityReview({ path, initial, disabled, onSaved, onSavingChange }: {
  path: string; initial?: QualityFeedback; disabled: boolean; onSaved: (value: QualityFeedback) => void;
  onSavingChange?: (value: boolean) => void;
}) {
  const [feedback, setFeedback] = useState<QualityFeedback>(initial ?? empty);
  const [hover, setHover] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [noteDirty, setNoteDirty] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const pending = useRef<Partial<QualityFeedback>>({});
  const saving = useRef(false);
  const note = useRef<string | undefined>(undefined);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const savingListener = useRef(onSavingChange);
  savingListener.current = onSavingChange;
  const ratingId = useId();

  useEffect(() => {
    if (!saving.current && !Object.keys(pending.current).length && note.current === undefined) setFeedback(initial ?? empty);
  }, [initial]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (noteTimer.current) clearTimeout(noteTimer.current); savingListener.current?.(false); };
  }, []);
  useEffect(() => { savingListener.current?.(busy || noteDirty); }, [busy, noteDirty]);

  // Serialize partial updates so a reason/note cannot overwrite an earlier rating
  // or decision when requests take different amounts of time.
  async function persist(patch: Partial<QualityFeedback>) {
    if (disabled) return;
    if (noteTimer.current) clearTimeout(noteTimer.current);
    const changes = { ...(note.current !== undefined ? { reason_note: note.current || null } : {}), ...patch };
    note.current = undefined;
    setNoteDirty(false);
    setFeedback(current => ({ ...current, ...changes }));
    pending.current = { ...pending.current, ...changes };
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(''); setSaved(false);
    try {
      while (Object.keys(pending.current).length) {
        const update = pending.current;
        pending.current = {};
        try {
          const response = await apiFetch<{ data: QualityFeedback }>(path, { method: 'PUT', body: update });
          if (!mounted.current) return;
          onSaved(response.data);
        } catch (cause) {
          pending.current = { ...update, ...pending.current };
          throw cause;
        }
      }
      if (mounted.current) setSaved(true);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Chưa lưu được đánh giá.');
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function updateNote(value: string) {
    setFeedback(current => ({ ...current, reason_note: value }));
    note.current = value; setNoteDirty(true); setSaved(false);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => void persist({}), 600);
  }
  const displayedRating = hover ?? feedback.quality_rating ?? 0;
  return <div className="draft-quality-review">
    <fieldset className="draft-quality-section" disabled={disabled}>
      <legend>Đánh giá chất lượng</legend>
      <div className="draft-rating-row">
        <div className="draft-rating-stars" role="radiogroup" aria-label="Đánh giá chất lượng từ 1 đến 5 sao" aria-describedby={ratingId} onMouseLeave={() => setHover(null)}>
          {ratingLabels.map((label, index) => {
            const value = index + 1;
            return <label className={`draft-rating-star ${value <= displayedRating ? 'is-filled' : ''}`} key={value}
              onMouseEnter={() => { if (!disabled) setHover(value); }}>
              <input type="radio" name={ratingId} value={value} aria-label={`${value} sao · ${label}`} checked={feedback.quality_rating === value}
                disabled={busy} onChange={() => { setHover(null); void persist({ quality_rating: value }); }} />
              <Star aria-hidden="true" strokeWidth={1.6} />
            </label>;
          })}
        </div>
        <span className="draft-rating-caption" id={ratingId}>{displayedRating ? `${displayedRating}/5 · ${ratingLabels[displayedRating - 1]}` : 'Chưa đánh giá'}</span>
      </div>
      <label>Lý do (tùy chọn)<Select disabled={busy} value={feedback.reason ?? ''} onChange={event => void persist({ reason: event.target.value || null, reason_note: null })}>
        <option value="">Không có</option>{Object.entries(reasons).map(([id, label]) => <option value={id} key={id}>{label}</option>)}
      </Select></label>
      {feedback.reason === 'other' && <label>Mô tả lý do<Textarea placeholder="Mô tả lý do…" maxLength={2000} rows={3} value={feedback.reason_note ?? ''}
        onChange={event => updateNote(event.target.value)} onBlur={() => { if (note.current !== undefined) void persist({}); }} /></label>}
    </fieldset>
    <fieldset className="draft-quality-section draft-review-decision" disabled={disabled}>
      <legend>Quyết định</legend>
      <div className="draft-review-decisions">{([['accepted', 'Đạt'], ['edited', 'Cần sửa'], ['rejected', 'Loại bỏ']] as const).map(([value, label]) =>
        <Button type="button" key={value} variant="outline" className={`draft-decision draft-decision-${value}`} aria-pressed={feedback.decision === value} onClick={() => void persist({ decision: value })}>
          {feedback.decision === value && <span aria-hidden="true"><Check className="inline-icon" aria-hidden="true" /> </span>}{label}
        </Button>)}</div>
      {feedback.decision && <p className="field-helper">{error || busy ? 'Quyết định sẽ được áp dụng sau khi lưu thành công.' : feedback.decision === 'rejected' ? 'Đã loại bỏ khỏi danh sách chọn. Đổi đánh giá trước khi chọn lại.' : feedback.decision === 'edited' ? 'Đã đánh dấu cần sửa. Bấm Sửa để chỉnh nội dung, lưu bản nháp rồi cập nhật đánh giá khi hoàn tất.' : 'Quyết định hiện tại: Đạt.'}</p>}
    </fieldset>
    <div className="draft-review-save-status" role="status" aria-live="polite">{error ? 'Chưa lưu được thay đổi.' : busy ? 'Đang lưu…' : noteDirty ? 'Đang chờ lưu ghi chú…' : saved ? 'Đã lưu đánh giá.' : 'Đánh giá sao và quyết định được lưu riêng.'}</div>
    {error && <div className="draft-review-error" role="alert"><p>{error}</p><Button type="button" variant="outline" disabled={disabled || busy} onClick={() => void persist({})}>Thử lưu lại</Button></div>}
  </div>;
}
