'use client';
import { Button, Input, Select } from '@/components/ui';
import { difficultyLabels, emptyFilters, typeLabels, type Filters, type SelectionQuestion } from '@/lib/question-selection';

export function QuestionFilters({ questions, value, onChange, disabled = false, showStatus = false }: {
  questions: SelectionQuestion[]; value: Filters; onChange: (value: Filters) => void; disabled?: boolean; showStatus?: boolean;
}) {
  const topics = Array.from(new Set(questions.map(q => q.topic).filter((topic): topic is string => !!topic))).sort();
  const update = (key: keyof Filters, next: string) => onChange({ ...value, [key]: next });
  return <details className="question-filters" open><summary>Bộ lọc câu hỏi</summary><div className="form-grid">
    <label className="wide">Tìm theo nội dung<Input type="search" placeholder="Tìm câu hỏi..." value={value.query} disabled={disabled} onChange={e => update('query', e.target.value)} /></label>
    <label>Loại câu hỏi<Select value={value.type} disabled={disabled} onChange={e => update('type', e.target.value)}><option value="">Tất cả loại câu</option>{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
    <label>Độ khó<Select value={value.difficulty} disabled={disabled} onChange={e => update('difficulty', e.target.value)}><option value="">Tất cả độ khó</option>{Object.entries(difficultyLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
    <label>Chủ đề / chương<Select value={value.topic} disabled={disabled} onChange={e => update('topic', e.target.value)}><option value="">Tất cả chủ đề</option>{topics.map(topic => <option key={topic}>{topic}</option>)}</Select></label>
    {showStatus && <label>Trạng thái câu hỏi<Select value={value.status} disabled={disabled} onChange={e => update('status', e.target.value)}><option value="">Tất cả trạng thái</option><option value="active">Đang sử dụng</option><option value="inactive">Ngừng sử dụng</option></Select></label>}
    <Button variant="outline" disabled={disabled} onClick={() => onChange({ ...emptyFilters })}>Xóa bộ lọc</Button>
  </div></details>;
}
