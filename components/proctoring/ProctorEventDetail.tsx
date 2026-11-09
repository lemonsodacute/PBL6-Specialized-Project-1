'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ApiError } from '@/lib/api';
import { Button, LoadingSkeleton, Modal, Textarea } from '@/components/ui';
import { eventDate, eventLabel, proctorApi, severityLabels, statusLabels, type ProctorDetail, type ProctorEvent, type ProctorStatus, type StudentTimeline } from '@/lib/proctoring';
import styles from './ProctorConsole.module.css';
const attemptLabels: Record<string,string> = {in_progress:'Đang làm bài',submitted:'Đã nộp',auto_submitted:'Nộp tự động',terminated:'Đã kết thúc',not_started:'Chưa bắt đầu'};

function LegacyEvidence({ id }: { id: string }) {
  const [preview, setPreview] = useState(''), [error, setError] = useState(false), [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); let url = ''; setError(false);
    void proctorApi.legacyEvidence(id, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setPreview(url);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [id, open]);
  return <div>{!open ? <Button variant="outline" onClick={() => setOpen(true)}>Xem ảnh đã lưu</Button>
    : error ? <p role="alert">Ảnh đã hết thời hạn lưu hoặc không còn khả dụng.</p>
      : preview ? <Image src={preview} width={640} height={480} unoptimized className={styles.evidenceImage} alt="Ảnh bằng chứng từ lịch sử giám sát" /> : <LoadingSkeleton rows={2} />}</div>;
}

export function SeverityBadge({ event }: { event: ProctorEvent }) {
  return <span className={`${styles.severity} ${styles[event.severity]}`}><span aria-hidden="true">●</span>{severityLabels[event.severity]}</span>;
}

export function ProctorEventDetail({ id, examId, revision, onClose, onReviewed, onStudent }: { id: string; examId?: string; revision: number; onClose: () => void; onReviewed: () => void; onStudent: (attempt: string) => void }) {
  const [detail, setDetail] = useState<ProctorDetail | null>(null), [error, setError] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const dirtyNote = useRef(false);
  useEffect(() => {
    let active = true;
    setError('');
    void proctorApi.detail(id).then(async result => {
      if (!active) return;
      if (examId && result.exam_id !== examId) throw new Error('Event does not belong to this exam');
      if (result.status === 'NEW') {
        try { result = await proctorApi.review(result, 'REVIEWED'); if (active) onReviewed(); }
        catch (cause) { if (!(cause instanceof ApiError && cause.status === 409)) throw cause; result = await proctorApi.detail(id); }
      }
      if (active) { setDetail(result); if (!dirtyNote.current) setNote(result.review_note ?? ''); }
    }).catch(() => { if (active) setError('Không thể tải chi tiết cảnh báo. Vui lòng thử lại.'); });
    return () => { active = false; };
  }, [id, examId, revision, retry, onReviewed]);
  async function decide(status: 'DISMISSED' | 'CONFIRMED') {
    if (!detail || busy) return;
    setBusy(true); setError('');
    try { setDetail(await proctorApi.review(detail, status, note)); dirtyNote.current = false; onReviewed(); }
    catch (cause) { setError(cause instanceof ApiError && cause.status === 409 ? 'Cảnh báo đã được giám thị khác cập nhật. Hãy tải lại trước khi quyết định.' : 'Chưa lưu được quyết định. Vui lòng thử lại.'); }
    finally { setBusy(false); }
  }
  return <Modal open title="Chi tiết cảnh báo" size="large" className={styles.eventModal} onClose={onClose}>
    {error && <div className={styles.error} role="alert">{error}<Button variant="outline" onClick={() => setRetry(value => value + 1)}>Tải lại cảnh báo</Button></div>}
    {!detail ? !error && <LoadingSkeleton rows={4} /> : <div className={styles.detail}>
      {detail.is_simulated && <p className={styles.simulation}>Mô phỏng · Sự kiện kiểm thử, tách khỏi cảnh báo thực tế.</p>}
      <div className={styles.eventHeading}><div><h3>{eventLabel(detail)}</h3><p>{detail.student.full_name}{detail.student.student_code ? ` · ${detail.student.student_code}` : ''}</p></div><SeverityBadge event={detail} /></div>
      {detail.message && detail.message !== eventLabel(detail) && <p>{detail.message}</p>}
      <p className={styles.disclaimer}>Tín hiệu cần giám thị xem xét. Cảnh báo không tự động thay đổi điểm hoặc kết luận vi phạm.</p>
      <dl className={styles.facts}>
        <div><dt>Đề thi</dt><dd>{detail.exam?.title ?? 'Chưa tải được tên đề thi'}</dd></div>
        <div><dt>Thời điểm ghi nhận</dt><dd>{eventDate(detail.occurred_at)}</dd></div>
        <div><dt>Trạng thái</dt><dd>{statusLabels[detail.status]}</dd></div>
        {detail.duration_ms > 0 && <div><dt>Thời lượng quan sát</dt><dd>{(detail.duration_ms / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giây</dd></div>}
        {detail.confidence !== null && <div><dt>Độ tin cậy của tín hiệu</dt><dd>{Math.round(Number(detail.confidence) * 100)}%</dd></div>}
        {detail.max_confidence !== null && detail.occurrence_count > 1 && <div><dt>Độ tin cậy cao nhất</dt><dd>{Math.round(Number(detail.max_confidence) * 100)}%</dd></div>}
        <div><dt>Số lần ghi nhận</dt><dd>{detail.occurrence_count}</dd></div>
        <div><dt>Quan sát gần nhất</dt><dd>{eventDate(detail.last_seen)}</dd></div>
      </dl>
      {['BROWSER', 'TAB_SWITCH'].includes(detail.source) && <p className={styles.disclaimer}>Tín hiệu do trình duyệt sinh viên tự báo cáo; đây không phải kết quả nhận diện AI.</p>}
      {detail.source === 'LEGACY' && <p className={styles.disclaimer}>Sự kiện lịch sử từ nguồn cũ, không phải đầu ra của module giám sát mới.</p>}
      <section><h3>Bằng chứng</h3><p className={styles.muted}>{detail.has_snapshot ? 'Ảnh từ lịch sử giám sát, chỉ người có quyền được xem.' : 'Không có ảnh bằng chứng cho sự kiện này.'}{!detail.has_snapshot && detail.evidence ? ' Có bản tóm tắt siêu dữ liệu quan sát.' : ''}</p>
        {detail.has_snapshot && <LegacyEvidence id={id} />}
        {detail.evidence?.timestamp && <p>{eventDate(detail.evidence.timestamp)}</p>}
        {!!detail.evidence?.bounding_boxes?.length && <p>{detail.evidence.bounding_boxes.length} vùng quan sát đã chuẩn hóa.</p>}
      </section>
      <details className={styles.technical}><summary>Thông tin nguồn / module</summary><dl className={styles.facts}>
        <div><dt>Nguồn</dt><dd>{detail.source}</dd></div><div><dt>Module</dt><dd>{detail.provider}</dd></div>
        <div><dt>Loại sự kiện</dt><dd>{detail.event_type}</dd></div><div><dt>Máy chủ nhận</dt><dd>{eventDate(detail.received_at)}</dd></div>
        {!!detail.metadata?.model_version && <div><dt>Phiên bản</dt><dd>{String(detail.metadata.model_version)}</dd></div>}
      </dl></details>
      <section><h3>Lịch sử xem xét</h3><ol className={styles.history}>{detail.history.map(item => <li key={item.id}>
        <time dateTime={item.at}>{eventDate(item.at)}</time><div><strong>{item.status ? statusLabels[item.status] : 'Ghi nhận cảnh báo'}</strong>
          {item.actor && <span>{item.actor}</span>}{item.note && <p>{item.note}</p>}</div>
      </li>)}</ol></section>
      <label className={styles.note}>Ghi chú giám thị <span className={styles.muted}>(không bắt buộc)</span><Textarea maxLength={1000} rows={3} value={note} disabled={busy} onChange={event => { dirtyNote.current = true; setNote(event.target.value); }} /></label>
      <div className={styles.detailActions}><Button variant="outline" onClick={() => onStudent(detail.attempt_id)}>Xem cảnh báo của phiên</Button>
        <Button variant="outline" disabled={busy || detail.status === 'DISMISSED'} onClick={() => void decide('DISMISSED')}>Bỏ qua</Button>
        <Button disabled={busy || detail.status === 'CONFIRMED'} onClick={() => void decide('CONFIRMED')}>Xác nhận</Button></div>
    </div>}
  </Modal>;
}

export function StudentEventTimeline({ attemptId, examId, simulated, revision, onClose, onEvent, onCamera }: {
  attemptId: string; examId?: string; simulated: boolean; revision: number; onClose: () => void; onEvent: (id: string) => void; onCamera?: (id: string, name: string) => void;
}) {
  const [data, setData] = useState<StudentTimeline | null>(null), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  const [page,setPage]=useState(1),[loading,setLoading]=useState(false);
  useEffect(() => { setPage(1); }, [attemptId, simulated, revision]);
  useEffect(() => {
    let active = true; setError(false); setLoading(true);
    void proctorApi.timeline(attemptId, simulated, examId, page).then(result => { if (active) setData(previous => page === 1 || !previous ? result : {...result,entries:[...new Map([...previous.entries,...result.entries].map(item=>[item.id,item])).values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id))}); }).catch(() => { if (active) setError(true); }).finally(()=>{if(active)setLoading(false);});
    return () => { active = false; };
  }, [attemptId, examId, simulated, revision, retry, page]);
  const root = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
  return <Modal open title="Dòng thời gian sinh viên" size="large" className={styles.eventModal} onClose={onClose}>
    {error && <div role="alert" className={styles.error}>Không thể tải dòng thời gian.<Button onClick={() => setRetry(value => value + 1)}>Thử lại</Button></div>}
    {!data ? !error && <LoadingSkeleton rows={3} /> : <div className={styles.detail}>
      {examId && <Link className={styles.back} href={`/dashboard/monitor/${examId}${simulated?'?simulation=1':''}`}>← Báo cáo giám sát</Link>}
      <div><h3>{data.student.full_name}</h3><p>{data.student.student_code || 'Chưa có MSSV'}</p></div>
      <dl className={styles.facts}><div><dt>Trạng thái lượt thi</dt><dd>{attemptLabels[data.status]||data.status}</dd></div><div><dt>Mức cảnh báo cao nhất</dt><dd>{data.summary?.highest_severity?severityLabels[data.summary.highest_severity]:'Không có cảnh báo'}</dd></div><div><dt>Bắt đầu làm bài</dt><dd>{data.started_at?eventDate(data.started_at):'Chưa bắt đầu'}</dd></div><div><dt>Nộp bài</dt><dd>{data.submitted_at?eventDate(data.submitted_at):'Chưa nộp'}</dd></div></dl>
      {data.summary && <div className={styles.metrics}>{[['Tổng cảnh báo',data.summary.total],['Chưa xem',data.summary.new],['Đã xác nhận',data.summary.confirmed],['Đã bỏ qua',data.summary.dismissed]].map(([label,count])=><div className={styles.metric} key={label}><span>{label}</span><strong>{count}</strong></div>)}</div>}
      {data.total_events===0 && <p>Không có cảnh báo giám sát trong lượt thi này.</p>}
      {simulated && <p className={styles.simulation}>Mô phỏng · Chỉ các cảnh báo kiểm thử.</p>}
      <div className={styles.detailActions}>
        {data.status === 'in_progress' && onCamera && <Button onClick={() => onCamera(attemptId, data.student.full_name)}>Xem camera realtime</Button>}
        {data.recording_url && <a className="ui-button ui-button-outline" href={root + data.recording_url} target="_blank" rel="noreferrer">Mở video bản ghi</a>}
      </div>
      <ol className={styles.history}>{data.entries.map(item => <li key={item.id}><time dateTime={item.at}>{eventDate(item.at)}</time><div>
        {item.event ? <button type="button" className={styles.timelineLink} onClick={() => onEvent(item.event!.id)}>{eventLabel(item.event)}</button>
          : <strong>{item.kind === 'review' ? `Giám thị: ${statusLabels[item.status as ProctorStatus] ?? 'Đã xem xét'}` : item.label}</strong>}
        {item.event && <span>{statusLabels[item.event.status]}{item.event.is_simulated ? ' · Mô phỏng' : ''}</span>}
        {item.event && <span>{severityLabels[item.event.severity]}{item.event.duration_ms>0?` · ${(item.event.duration_ms/1000).toLocaleString('vi-VN')} giây`:''}{item.event.confidence!==null?` · ${Math.round(item.event.confidence*100)}%`:''}{item.event.occurrence_count>1?` · ${item.event.occurrence_count} lần ghi nhận`:''}</span>}
        {item.actor && <span>{item.actor}</span>}{item.note && <p>{item.note}</p>}
        {item.kind === 'review' && item.event_id && <button type="button" className={styles.timelineLink} onClick={() => onEvent(item.event_id!)}>Xem cảnh báo liên quan</button>}
      </div></li>)}</ol>
      {data.truncated && <Button variant="outline" disabled={loading} onClick={()=>setPage(value=>value+1)}>{loading?'Đang tải…':'Xem thêm sự kiện'}</Button>}
    </div>}
  </Modal>;
}
