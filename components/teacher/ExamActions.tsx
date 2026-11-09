'use client';
import Link from 'next/link';
import { ArrowRight, Eye } from 'lucide-react';
import { Button,ActionMenu } from '@/components/ui';
import type { ManagedExam } from './ExamEditor';
import styles from './ExamActions.module.css';

export type ExamAttemptState = { count: number; completed: number };
export type ExamAction = 'edit' | 'publish' | 'close' | 'delete';
type Item = { label: string; href?: string; action?: ExamAction; disabled?: boolean; tone?: 'warning' | 'danger' };

export function ExamActions({ exam, attempts, onAction }: { exam: ManagedExam; attempts?: ExamAttemptState; onAction: (action: ExamAction) => void }) {
  const known = attempts !== undefined; const hasAttempts = known && attempts.count > 0;
  const draft = exam.status === 'draft'; const closed = exam.status === 'closed';
  const published = exam.status === 'published' || exam.status === 'ongoing';
  const editLabel = closed || hasAttempts || exam.status === 'ongoing' ? 'Xem chi tiết' : 'Xem / Sửa';
  const resultsHref = `/dashboard/exams/${exam.id}/attempts`; const monitorHref = `/dashboard/monitor/${exam.id}`;
  const previewHref = `/dashboard/exams/${exam.id}/preview`;
  const now = Date.now();
  const running = published && new Date(exam.start_time).getTime() <= now && new Date(exam.end_time).getTime() > now;
  const primary: Item = attempts && attempts.completed > 0 ? { label: 'Xem kết quả', href: resultsHref }
    : running && exam.require_camera ? { label: 'Giám sát', href: monitorHref } : { label: editLabel, action: 'edit' };
  const items: Item[] = [{ label: 'Xem toàn bộ đề thi', href: previewHref }, { label: editLabel, action: 'edit' }];
  if (draft) items.push({ label: 'Xuất bản', action: 'publish', disabled: !known || hasAttempts });
  if (!draft || (attempts && attempts.completed > 0)) items.push({ label: 'Xem kết quả', href: resultsHref });
  if (published || closed) items.push({ label: 'Xem giám sát', href: monitorHref });
  if (published) items.push({ label: 'Đóng đề', action: 'close', tone: 'warning', disabled: !known || hasAttempts });
  items.push({ label: 'Xóa đề', action: 'delete', tone: 'danger', disabled: !known || hasAttempts });
  const note = !known ? 'Chưa kiểm tra được tình trạng bài làm. Vui lòng tải lại danh sách.'
    : hasAttempts ? 'Đề đã có bài làm nên không thể đổi trạng thái hoặc xóa.' : '';
  return <div className={styles.actions}>
    <Link className={`ui-button ui-button-outline ui-button-sm ${styles.preview}`} href={previewHref} aria-label={`Xem toàn bộ đề thi ${exam.title}`}><Eye size={16} aria-hidden="true" /><span>Xem đề</span></Link>
    {primary.href ? <Link className={`ui-button ui-button-outline ui-button-sm ${styles.primary}`} href={primary.href}>{primary.label}{primary.href === resultsHref && <ArrowRight size={16} aria-hidden="true" />}</Link>
      : <Button variant="outline" size="sm" className={styles.primary} onClick={() => onAction('edit')}>{primary.label}</Button>}
    <ActionMenu label={`Thao tác đề ${exam.title}`} note={note} items={items.map(item=>({label:item.label,href:item.href,disabled:item.disabled,tone:item.tone,onSelect:()=>{if(item.action)onAction(item.action);}}))}/>

  </div>;
}
