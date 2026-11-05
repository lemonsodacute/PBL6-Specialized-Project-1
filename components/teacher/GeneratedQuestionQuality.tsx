import { Badge } from '@/components/ui';
import { qualityReasons, type DraftQualityCheck } from '@/lib/question-quality';
import { difficultyLabels } from '@/lib/question-selection';

export function GeneratedQuestionQuality({ check, selectedDifficulty }: { check?: DraftQualityCheck | null; selectedDifficulty?: string | null }) {
  if (!check) return <p className="field-helper">Chưa kiểm tra tự động. Giảng viên cần review câu hỏi và đáp án.</p>;
  const reasons = check.flags.map(flag => qualityReasons[flag]);
  return <div className="document-quality-check" role="note" aria-label="Kiểm tra tự động">
    <Badge tone={check.status === 'pass' ? 'success' : 'warning'}>Kiểm tra tự động: {check.status === 'pass' ? 'Đạt' : 'Cần xem lại'}</Badge>
    {!!reasons.length && <p className="field-helper">{reasons.slice(0, 2).join(' · ')}</p>}
    {reasons.length > 2 && <details><summary>Xem thêm điểm cần kiểm tra ({reasons.length - 2})</summary><ul>{reasons.slice(2).map(reason => <li key={reason}>{reason}</li>)}</ul></details>}
    {check.assessed_difficulty && check.assessed_difficulty !== selectedDifficulty && <p className="field-helper">Mức độ kiểm tra: {difficultyLabels[check.assessed_difficulty]}. Cần giảng viên xác nhận.</p>}
  </div>;
}
