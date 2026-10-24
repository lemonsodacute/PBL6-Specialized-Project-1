'use client';
import { Button,ActionMenu } from '@/components/ui';
import { difficultyLabels, type SelectionQuestion } from '@/lib/question-selection';

export function QuestionSelectionSummary({ selected, onClear, onView, onDone, disabled, pointsPerQuestion }: {
  selected: SelectionQuestion[]; onClear: () => void; onView: () => void; onDone?: () => void; disabled?: boolean; pointsPerQuestion?: number;
}) {
  const total = selected.reduce((sum, q) => sum + (q.points ?? pointsPerQuestion ?? Number(q.default_points)), 0);
  return <aside className="question-selection-summary" aria-label="Tổng hợp câu hỏi đã chọn">
    <h3>Đã chọn: {selected.length} câu</h3><dl>{Object.entries(difficultyLabels).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{selected.filter(q => q.difficulty === key).length}</dd></div>)}
      {selected.some(q => !q.difficulty) && <div><dt>Chưa có độ khó</dt><dd>{selected.filter(q => !q.difficulty).length}</dd></div>}
      <div><dt>Tổng điểm</dt><dd>{Number(total.toFixed(2))}</dd></div></dl>
    <div className="row-actions">{onDone?<Button variant="success" disabled={disabled||!selected.length} onClick={onDone}>Hoàn tất</Button>:<Button variant="outline" onClick={onView}>Xem danh sách</Button>}<ActionMenu label="Thao tác danh sách đã chọn" items={[...(onDone?[{label:'Xem danh sách',onSelect:onView}]:[]),{label:'Bỏ chọn tất cả',onSelect:onClear,disabled:disabled||!selected.length}]}/></div>
  </aside>;
}
