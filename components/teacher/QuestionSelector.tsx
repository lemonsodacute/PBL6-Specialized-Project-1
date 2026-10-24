'use client';
import {ActionMenu} from '@/components/ui/ActionMenu';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, EmptyState, Modal, LoadingSkeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { QuestionImages } from '@/components/questions/QuestionImages';
import { difficultyLabels, emptyFilters, filteredQuestions, normalizeQuestions, typeLabels, questionTypeLabel, isSupportedQuestionType, type RandomRule, type SelectionQuestion } from '@/lib/question-selection';
import { QuestionFilters } from './QuestionFilters';
import { QuestionSelectionSummary } from './QuestionSelectionSummary';
import { RandomQuestionPicker } from './RandomQuestionPicker';
import { CollectionToolbar, CollectionPagination } from '@/components/collections/CollectionToolbar';
import type { CollectionState } from '@/lib/collections';
type ServerSource={state:CollectionState;total:number|null;topics:string[];hasDifficulty?:boolean;loading:boolean;error?:string;allMatching:()=>Promise<SelectionQuestion[]>};

export function QuestionSelector({ bankId, questions, selected, onChange, disabled = false, readOnly = false, manageInactive = false, onEdit, onDone, pointsPerQuestion, onBusyChange, serverSource }: {
  bankId: string; questions: SelectionQuestion[]; selected: SelectionQuestion[]; onChange: (questions: SelectionQuestion[]) => void;
  disabled?: boolean; readOnly?: boolean; manageInactive?: boolean; onEdit?: (question: SelectionQuestion) => void; onDone?: () => void; pointsPerQuestion?: number;
  onBusyChange?: (busy: boolean) => void;
  serverSource?:ServerSource;
}) {
  const [filters, setFilters] = useState({ ...emptyFilters });
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState('manual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<SelectionQuestion | null>(null);
  const [showSelected, setShowSelected] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const rules = useRef<Record<string, RandomRule>>({});
  const preview = useRef<HTMLElement>(null);
  const allCheck = useRef<HTMLInputElement>(null);
  const locked = disabled || busy || readOnly;
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => { setSummaryExpanded(!window.matchMedia('(max-width: 767px)').matches); }, []);
  useEffect(() => { setFilters({ ...emptyFilters }); setPage(1); setMode('manual'); setError(''); }, [bankId]);
  const result = useMemo(() => serverSource ? questions.filter(q=>isSupportedQuestionType(q.type)) : filteredQuestions(questions, filters), [questions, filters,serverSource]);
  const total=serverSource?.total??result.length;
  const limit=serverSource?Number(serverSource.state.values.limit):20;
  const pages = Math.max(1, Math.ceil(total / limit));
  const currentPage = serverSource?Number(serverSource.state.values.page):Math.min(page, pages);
  const visible = serverSource?result:result.slice((currentPage - 1) * limit, currentPage * limit);
  const selectedIds = new Set(selected.map(q => q.id));
  const eligible = (items: SelectionQuestion[]) => items.filter(q => isSupportedQuestionType(q.type) && (manageInactive || q.is_active));
  const pageQuestions = eligible(visible);
  const allOnPage = pageQuestions.length > 0 && pageQuestions.every(q => selectedIds.has(q.id));
  useEffect(() => { if (allCheck.current) allCheck.current.indeterminate = !allOnPage && pageQuestions.some(q => selectedIds.has(q.id)); }, [allOnPage, pageQuestions, selectedIds]);
  function add(items: SelectionQuestion[]) {
    const additions = items.filter(q => isSupportedQuestionType(q.type) && !selectedIds.has(q.id));
    if (!manageInactive && selected.length + additions.length > 500) { setError('Một đề có thể chọn tối đa 500 câu.'); return; }
    onChange([...selected, ...additions]); setError('');
  }
  function concreteRule(q: SelectionQuestion): RandomRule {
    return rules.current[q.id] ?? { question_type: q.type, ...(q.difficulty ? { difficulty: q.difficulty } : {}), ...(q.topic ? { topic: q.topic } : {}) };
  }
  async function replace(items: SelectionQuestion[]) {
    if (locked || !items.length) return;
    setBusy(true); setError('');
    const replacements = new Map<string, SelectionQuestion>();
    const groups = new Map<string, { bank: string; rule: RandomRule; items: SelectionQuestion[] }>();
    items.forEach(q => { const rule = concreteRule(q); const key = JSON.stringify([q.question_bank_id, rule]); const group = groups.get(key) ?? { bank: q.question_bank_id, rule, items: [] }; group.items.push(q); groups.set(key, group); });
    try {
      for (const group of Array.from(groups.values())) {
        const excluded = [...selected.map(q => q.id), ...Array.from(replacements.values()).map(q => q.id)];
        const next = normalizeQuestions(await api.questionBanks.randomSelect(group.bank, { count: group.items.length, ...group.rule, exclude_ids: excluded }));
        if (next.length !== group.items.length || new Set(next.map(q => q.id)).size !== next.length || next.some(q => q.question_bank_id !== group.bank || !q.is_active || excluded.includes(q.id))) throw new Error('Invalid selection');
        group.items.forEach((old, index) => { replacements.set(old.id, next[index]); rules.current[next[index].id] = group.rule; });
      }
      onChange(selected.map(q => replacements.get(q.id) ?? q));
    } catch (cause) { setError(cause instanceof ApiError && cause.code === 'NOT_ENOUGH_QUESTIONS' ? cause.message : 'Không thể thay câu hỏi. Danh sách đã chọn được giữ nguyên.'); }
    finally { setBusy(false); }
  }
  const openPreview = () => { setShowSelected(true); requestAnimationFrame(() => preview.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })); };
  async function selectAllMatching(){
    if(!serverSource){add(eligible(result));return;}
    if(locked||serverSource.loading) return;setBusy(true);setError('');
    try{add(eligible(await serverSource.allMatching()));}catch{setError('Không tải được các câu hỏi phù hợp. Danh sách đã chọn được giữ nguyên.');}finally{setBusy(false);}
  }
  return <div className="question-selector" aria-busy={busy}>
    <div className="question-selector-layout"><div className="selector-main form-stack">
      {!readOnly && <div className="selector-mode" aria-label="Chế độ chọn câu"><Button variant={mode === 'manual' ? 'primary' : 'outline'} aria-pressed={mode === 'manual'} disabled={disabled || busy} onClick={() => setMode('manual')}>Chọn thủ công</Button><Button variant={mode === 'random' ? 'primary' : 'outline'} aria-pressed={mode === 'random'} disabled={disabled || busy || !bankId} onClick={() => setMode('random')}>Chọn nhanh / Ngẫu nhiên</Button></div>}
      {readOnly ? <p>Đề đã xuất bản hoặc đóng: danh sách câu hỏi chỉ được xem.</p>
        : mode === 'random' ? <RandomQuestionPicker sourceMetadata={serverSource?{topics:serverSource.topics,hasDifficulty:serverSource.hasDifficulty}:undefined} maxTotal={manageInactive ? undefined : 500} key={bankId} bankId={bankId} questions={questions} excludeIds={selected.map(q => q.id)} disabled={disabled} onBusy={setBusy} onPick={(picked, rule) => {
          picked.forEach(q => { rules.current[q.id] = { question_type: rule.question_type, difficulty: rule.difficulty_counts ? q.difficulty ?? undefined : rule.difficulty, topic: rule.topic_counts ? q.topic ?? undefined : rule.topic }; });
          add(picked); openPreview();
        }} /> : <>
          {serverSource?<CollectionToolbar state={serverSource.state} disabled={busy} searchLabel="Tìm theo nội dung" placeholder="Tìm câu hỏi..." filters={[
            {key:'type',label:'Loại câu hỏi',options:Object.entries(typeLabels).map(([value,label])=>({value,label}))},
            {key:'difficulty',label:'Độ khó',options:Object.entries(difficultyLabels).map(([value,label])=>({value,label}))},
            {key:'topic',label:'Chủ đề / chương',options:serverSource.topics.map(topic=>({value:topic,label:topic}))},
            {key:'status',label:'Trạng thái câu hỏi',options:[{value:'active',label:'Đang sử dụng'},{value:'inactive',label:'Ngừng sử dụng'}]},
          ]} sorts={[{value:'newest',label:'Mới nhất'},{value:'oldest',label:'Cũ nhất'}]}/>:<QuestionFilters questions={questions} value={filters} disabled={disabled || busy} showStatus={manageInactive} onChange={value => { setFilters(value); setPage(1); }} />}
          <div className="selection-toolbar"><label><input ref={allCheck} className="ui-checkbox" type="checkbox" aria-label="Chọn tất cả trên trang" checked={allOnPage} disabled={locked || !pageQuestions.length} onChange={e => e.target.checked ? add(pageQuestions) : onChange(selected.filter(q => !pageQuestions.some(v => v.id === q.id)))} />Chọn tất cả trên trang ({pageQuestions.length})</label>
            <Button variant="outline" disabled={locked || !!serverSource?.loading || !total} onClick={()=>void selectAllMatching()}>Chọn tất cả {serverSource?total:eligible(result).length} kết quả</Button>
          </div><p>{total} kết quả · Trang {currentPage}/{pages}</p>
          {serverSource?.loading?<LoadingSkeleton rows={3}/>:serverSource?.error?null:!result.length ? <EmptyState title="Không tìm thấy kết quả phù hợp."><Button variant="outline" onClick={() => { if(serverSource)serverSource.state.clear();else{setFilters({ ...emptyFilters }); setPage(1);} }}>Xóa bộ lọc</Button></EmptyState>
            : <div className="selector-question-list">{visible.map(q => <article key={q.id} className="selector-question-row">
              <label className="selector-question-choice"><input className="ui-checkbox" type="checkbox" aria-label={`Chọn câu: ${q.content}`} checked={selectedIds.has(q.id)} disabled={locked || (!manageInactive && !q.is_active)} onChange={e => e.target.checked ? add([q]) : onChange(selected.filter(item => item.id !== q.id))} /><span><span className="question-row-content">{q.content}</span><span className="question-row-meta"><Badge className="question-type" data-type={q.type}>{questionTypeLabel(q.type)}</Badge>{q.difficulty && <span className="question-difficulty" data-difficulty={q.difficulty}>{difficultyLabels[q.difficulty]}</span>}{q.topic && <span>{q.topic}</span>}<span>{q.default_points} điểm</span>{!q.is_active && <span>Ngừng sử dụng</span>}</span></span></label>
              <ActionMenu label={`Thao tác câu: ${q.content}`} items={[{label:'Xem',onSelect:()=>setViewing(q)},...(onEdit?[{label:'Sửa',disabled:locked,onSelect:()=>onEdit(q)}]:[])]}/>
            </article>)}</div>}
          {serverSource?<CollectionPagination state={serverSource.state} total={serverSource.total} count={visible.length} loading={busy||serverSource.loading}/>:<div className="form-actions"><Button variant="outline" disabled={currentPage === 1 || disabled || busy} onClick={() => setPage(currentPage - 1)}>Trang trước</Button><Button variant="outline" disabled={currentPage >= pages || disabled || busy} onClick={() => setPage(currentPage + 1)}>Trang sau</Button></div>}
        </>}
    </div><details className="selection-summary-panel" open={summaryExpanded} onToggle={e => setSummaryExpanded(e.currentTarget.open)}><summary>Đã chọn: {selected.length} câu</summary><QuestionSelectionSummary selected={selected} pointsPerQuestion={pointsPerQuestion} disabled={locked} onClear={() => onChange([])} onView={openPreview} onDone={onDone} /></details></div>
    {error && <p role="alert">{error}</p>}
    <section ref={preview} className="selection-preview" aria-label="Câu hỏi đã chọn"><div className="form-toolbar"><h3>Câu hỏi đã chọn — {selected.length}</h3><Button variant="outline" aria-expanded={showSelected || readOnly} onClick={() => setShowSelected(value => !value)}>{showSelected ? 'Thu gọn danh sách' : 'Xem câu đã chọn'}</Button>{selected.length > 0 && !readOnly && <Button variant="outline" disabled={locked} onClick={() => void replace(selected)}>Thay tất cả ngẫu nhiên</Button>}</div>
      {(showSelected || readOnly) && <ol className="selected-question-list">{selected.map(q => <li key={q.id}><p>{q.content}</p><div className="question-row-meta"><Badge className="question-type" data-type={q.type}>{questionTypeLabel(q.type)}</Badge>{q.difficulty && <span className="question-difficulty" data-difficulty={q.difficulty}>{difficultyLabels[q.difficulty]}</span>}{q.topic && <span>{q.topic}</span>}</div><div className="row-actions"><Button variant="outline" onClick={() => setViewing(q)}>Xem</Button>{!readOnly && <ActionMenu label={`Thao tác câu đã chọn: ${q.content}`} items={[{label:'Thay câu',disabled:locked,onSelect:()=>void replace([q])},{label:'Bỏ',disabled:locked,onSelect:()=>onChange(selected.filter(item=>item.id!==q.id))}]}/>}</div></li>)}</ol>}
    </section>
    <Modal open={!!viewing} size="large" title="Chi tiết câu hỏi" onClose={() => setViewing(null)}>{viewing && <div className="form-stack"><p>{viewing.content}</p><QuestionImages images={viewing.images} /><p>{questionTypeLabel(viewing.type)} · {viewing.default_points} điểm{viewing.topic ? ` · ${viewing.topic}` : ''}</p>{viewing.options_json && <pre className="question-detail-options">{typeof viewing.options_json === 'string' ? viewing.options_json : JSON.stringify(viewing.options_json, null, 2)}</pre>}{viewing.explanation && <p>{viewing.explanation}</p>}</div>}</Modal>
  </div>;
}
