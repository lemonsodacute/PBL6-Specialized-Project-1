import type { HTMLAttributes } from 'react';
type Severity = 'low' | 'medium' | 'high' | 'critical';
export function Badge({ className = '', tone = 'neutral', ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'purple' | 'brand' }) { return <span className={`ui-badge badge-${tone} ${className}`} {...props} />; }
export function AttemptStatusBadge({ status }: { status: string }) {
  const states: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'purple' | 'brand' }> = {
    not_started: {label:'Chưa bắt đầu',tone:'neutral'},
    in_progress: { label: 'Đang làm bài', tone: 'info' },
    submitted: { label: 'Đã nộp', tone: 'success' },
    auto_submitted: { label: 'Đã nộp tự động', tone: 'warning' },
    graded: { label: 'Đã chấm', tone: 'success' },
    terminated: { label: 'Bị kết thúc', tone: 'error' },
  };
  const state = states[status] ?? { label: 'Chưa cập nhật', tone: 'neutral' as const };
  return <Badge tone={state.tone}>{state.label}</Badge>;
}
export function StatusBadge({status,label}:{status:string;label?:string}){
  const states:Record<string,{label:string;tone:'neutral'|'success'|'warning'|'error'|'info'|'purple'|'brand'}>={
    draft:{label:'Bản nháp',tone:'neutral'},published:{label:'Đã xuất bản',tone:'info'},
    ongoing:{label:'Đang diễn ra',tone:'info'},live:{label:'Đang diễn ra',tone:'info'},
    scheduled:{label:'Sắp diễn ra',tone:'purple'},ended:{label:'Đã kết thúc',tone:'neutral'},closed:{label:'Đã đóng',tone:'neutral'},cancelled:{label:'Đã hủy',tone:'neutral'},
    verified:{label:'Đã xác thực',tone:'success'},active:{label:'Đang hiệu lực',tone:'success'},pending:{label:'Chờ xác nhận',tone:'warning'},pending_confirmation:{label:'Chờ xác nhận',tone:'warning'},
    revoked:{label:'Đã thu hồi',tone:'error'},invalidated:{label:'Không còn hiệu lực',tone:'error'},requires_update:{label:'Cần cập nhật',tone:'warning'},needs_reupload:{label:'Cần cập nhật',tone:'warning'},
    submitted:{label:'Đã nộp',tone:'success'},in_progress:{label:'Đang làm bài',tone:'info'},
    open:{label:'Đang diễn ra',tone:'info'},upcoming:{label:'Sắp diễn ra',tone:'purple'},
    auto_submitted:{label:'Đã nộp tự động',tone:'warning'},completed:{label:'Đã hoàn thành',tone:'success'},
    graded:{label:'Đã chấm',tone:'success'},finalized:{label:'Đã có kết quả',tone:'success'},
    terminated:{label:'Bị kết thúc',tone:'error'},unavailable:{label:'Chưa khả dụng',tone:'neutral'},
  };
  const value=states[status.toLowerCase()];return <Badge tone={value?.tone??'neutral'}>{label??value?.label??status}</Badge>;
}
export function SeverityBadge({ severity, className = '' }: { severity: Severity; className?: string }) {
  const labels = { low: 'Thấp', medium: 'Trung bình', high: 'Cao', critical: 'Nghiêm trọng' };
  return <span className={`ui-badge severity-${severity} ${className}`}>{labels[severity]}</span>;
}
