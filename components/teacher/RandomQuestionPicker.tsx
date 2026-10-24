'use client';
import { useEffect, useState } from 'react';
import { Button, Input, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/components/auth/AuthContext';
import { difficultyLabels, normalizeQuestions, typeLabels, type RandomRule, type SelectionQuestion } from '@/lib/question-selection';

type Configuration = { mode: string; count: number; type: string; difficulty: string; topic: string; groups: Record<string, number> };
const initial: Configuration = { mode: 'count', count: 20, type: '', difficulty: '', topic: '', groups: { easy: 10, medium: 15, hard: 5 } };
export function RandomQuestionPicker({ bankId, questions, excludeIds, onPick, disabled, onBusy, maxTotal,sourceMetadata }: {
  bankId: string; questions: SelectionQuestion[]; excludeIds: string[]; onPick: (questions: SelectionQuestion[], rule: RandomRule) => void; disabled?: boolean; onBusy: (busy: boolean) => void;
  maxTotal?: number;
  sourceMetadata?:{topics:string[];hasDifficulty?:boolean};
}) {
  const { user } = useAuth();
  const [config, setConfig] = useState<Configuration>(initial);
  const [saved, setSaved] = useState<Configuration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const topics = sourceMetadata?.topics??Array.from(new Set(questions.map(q => q.topic).filter((v): v is string => !!v))).sort();
  const hasDifficulty = sourceMetadata?.hasDifficulty??questions.some(q => q.difficulty);
  const key = `ai-procto-question-template:${user?.id}:${bankId}`;
  useEffect(() => {
    setConfig(initial); setError(''); setNotice('');
    try { const value = JSON.parse(localStorage.getItem(key) ?? 'null'); setSaved(value && ['count', 'difficulty', 'topic'].includes(value.mode) && Number.isInteger(value.count) && value.groups && typeof value.groups === 'object' && ['type', 'difficulty', 'topic'].every(field => typeof value[field] === 'string') ? value : null); } catch { setSaved(null); }
  }, [key]);
  const update = (patch: Partial<Configuration>) => { setConfig(current => ({ ...current, ...patch })); setError(''); setNotice(''); };
  const groups = config.mode === 'difficulty' ? Object.entries(difficultyLabels) : topics.map(topic => [topic, topic]);
  const count = config.mode === 'count' ? config.count : groups.reduce((sum, [key]) => sum + (config.groups[key] ?? 0), 0);
  async function pick() {
    if (busy || disabled) return;
    if (maxTotal && count + excludeIds.length > maxTotal) { setError(`Một đề có thể chọn tối đa ${maxTotal} câu. Giảm số câu hoặc bỏ bớt lựa chọn hiện tại.`); return; }
    if (!Number.isInteger(count) || count < 1 || count > 500 || (config.mode !== 'count' && groups.some(([key]) => !Number.isInteger(config.groups[key] ?? 0) || (config.groups[key] ?? 0) < 0))) {
      setError('Chọn số nguyên không âm cho từng nhóm; tổng cần từ 1 đến 500 câu.'); return;
    }
    const rule: RandomRule = { ...(config.type ? { question_type: config.type } : {}),
      ...(config.mode !== 'topic' && config.topic ? { topic: config.topic } : {}),
      ...(config.mode !== 'difficulty' && config.difficulty ? { difficulty: config.difficulty } : {}),
      ...(config.mode === 'difficulty' ? { difficulty_counts: Object.fromEntries(groups.map(([key]) => [key, config.groups[key] ?? 0])) } : {}),
      ...(config.mode === 'topic' ? { topic_counts: Object.fromEntries(groups.map(([key]) => [key, config.groups[key] ?? 0])) } : {}) };
    setBusy(true); onBusy(true); setError(''); setNotice('');
    try {
      const picked = normalizeQuestions(await api.questionBanks.randomSelect(bankId, { count, ...rule, exclude_ids: excludeIds }));
      if (picked.length !== count || new Set(picked.map(q => q.id)).size !== count || picked.some(q => q.question_bank_id !== bankId || !q.is_active || excludeIds.includes(q.id))) throw new Error('Invalid selection');
      onPick(picked, rule); setNotice(`Đã thêm ${count} câu vào danh sách xem trước. Đề thi chưa được lưu.`);
    } catch (cause) { setError(cause instanceof ApiError && cause.code === 'NOT_ENOUGH_QUESTIONS' ? cause.message : 'Không chọn được câu hỏi. Vui lòng thử lại.'); }
    finally { setBusy(false); onBusy(false); }
  }
  return <div className="form-stack random-question-picker">
    <p>Chọn thêm câu phù hợp vào danh sách xem trước. Các câu đã chọn được loại khỏi lượt chọn mới.</p>
    <div className="form-grid"><label>Cách chọn<Select value={config.mode} disabled={busy || disabled} onChange={e => update({ mode: e.target.value })}><option value="count">Theo số lượng</option>{hasDifficulty && <option value="difficulty">Theo độ khó</option>}{topics.length > 0 && <option value="topic">Theo chủ đề</option>}</Select></label>
      <label>Loại câu hỏi<Select value={config.type} disabled={busy || disabled} onChange={e => update({ type: e.target.value })}><option value="">Tất cả loại câu</option>{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
      {config.mode !== 'topic' && <label>Chủ đề<Select value={config.topic} disabled={busy || disabled} onChange={e => update({ topic: e.target.value })}><option value="">Tất cả chủ đề</option>{topics.map(topic => <option key={topic}>{topic}</option>)}</Select></label>}
      {hasDifficulty && config.mode !== 'difficulty' && <label>Độ khó<Select value={config.difficulty} disabled={busy || disabled} onChange={e => update({ difficulty: e.target.value })}><option value="">Tất cả độ khó</option>{Object.entries(difficultyLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>}
      {config.mode === 'count' ? <label>Số câu<Input type="number" min="1" max="500" value={config.count} disabled={busy || disabled} onChange={e => update({ count: Number(e.target.value) })} /></label>
        : groups.map(([key, label]) => <label key={key}>{label}<Input type="number" min="0" max="500" value={config.groups[key] ?? 0} disabled={busy || disabled} onChange={e => update({ groups: { ...config.groups, [key]: Number(e.target.value) } })} /></label>)}
    </div><strong>Tổng cấu hình: {count} câu</strong>
    <div className="form-toolbar"><Button disabled={busy || disabled} onClick={() => void pick()}>{busy ? 'Đang chọn...' : 'Chọn ngẫu nhiên'}</Button>
      {hasDifficulty && <Button variant="outline" disabled={busy || disabled} onClick={() => update({ ...initial, mode: 'difficulty' })}>Đề 30 câu cơ bản</Button>}
      <Button variant="outline" disabled={busy || disabled} onClick={() => { try { localStorage.setItem(key, JSON.stringify(config)); setSaved(config); setNotice('Đã lưu cấu hình trên trình duyệt này.'); } catch { setError('Không lưu được cấu hình trên trình duyệt.'); } }}>Lưu cấu hình</Button>
      {saved && <Button variant="outline" disabled={busy || disabled} onClick={() => update(saved)}>Dùng cấu hình đã lưu</Button>}
    </div>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </div>;
}
