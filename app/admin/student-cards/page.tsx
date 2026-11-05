'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, EmptyState, LoadingSkeleton, Modal, Table, ActionMenu, ConfirmDialog } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { adminCards, cardLabels, confirmationActor, type CardEvent, type ManagedCard } from '@/lib/admin-student-cards';
import styles from './student-cards.module.css';
import { ProfileAvatar } from '@/components/profile/ProfileAvatar';
import { useCollectionState } from '@/lib/collections';
import { CollectionToolbar,CollectionPagination,EmptySearchState } from '@/components/collections/CollectionToolbar';

const date = (value?: string | null) => value ? new Date(value).toLocaleString('vi-VN') : 'Chưa có';
const eventLabels: Record<string, string> = { CARD_VERIFIED: 'Xác nhận thẻ sinh viên', CARD_REPLACED: 'Thay thế thẻ sinh viên', CARD_REVOKED: 'Thu hồi xác thực thẻ', CARD_UPDATE_REQUESTED: 'Yêu cầu cập nhật thẻ', CARD_NOTIFICATION_SENT: 'Gửi thông báo' };
function Status({ card }: { card: ManagedCard }) { return <Badge tone={card.management_status === 'VERIFIED' ? 'success' : card.management_status === 'REVOKED' ? 'error' : 'warning'}>{cardLabels[card.management_status]}</Badge>; }

export default function StudentCardsPage() {
  const collection=useCollectionState({status:''});
  const query=String(collection.params.q); const filter=collection.values.status||'ALL'; const page=Number(collection.values.page); const limit=Number(collection.values.limit);
  const [rows, setRows] = useState<ManagedCard[]>([]); const [total, setTotal] = useState(0); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [refresh, setRefresh] = useState(0);
  const [detail, setDetail] = useState<ManagedCard | null>(null); const [events, setEvents] = useState<CardEvent[]>([]);
  const [historyPage, setHistoryPage] = useState(1); const [historyTotal, setHistoryTotal] = useState(0);
  const [detailReady, setDetailReady] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false); const [detailError, setDetailError] = useState('');
  const [action, setAction] = useState<'request-update' | 'revoke' | 'notify' | null>(null);
  const [reason, setReason] = useState(''); const [title, setTitle] = useState(''); const [message, setMessage] = useState('');
  const [revokeConfirm,setRevokeConfirm]=useState(false);
  const [saving, setSaving] = useState(false); const [face, setFace] = useState(''); const [imageError, setImageError] = useState('');
  const detailRequest = useRef(0); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if(!collection.ready) return; let active = true; setLoading(true); setError('');
    const timer = setTimeout(() => { adminCards.list(query, filter, page,limit).then(result => { if (active) { setRows(result.data); setTotal(result.meta.total); } })
      .catch(cause => { if (active) { setRows([]); setError(cause.message); } }).finally(() => { if (active) setLoading(false); }); }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [collection.key,collection.ready,refresh]);
  useEffect(() => {
    setFace(''); setImageError(''); if (!detail?.face_preview_url) return;
    const controller = new AbortController(); let url = '';
    adminCards.image(detail.face_preview_url, controller.signal).then(blob => { if (!controller.signal.aborted) { url = URL.createObjectURL(blob); setFace(url); } })
      .catch(cause => { if (!controller.signal.aborted) setImageError(cause.message); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [detail?.face_preview_url]);

  async function inspect(card: ManagedCard, nextAction: typeof action = null) {
    setRevokeConfirm(false);
    const request = ++detailRequest.current; setDetail(card); setDetailLoading(true); setDetailReady(false); setDetailError(''); setEvents([]);
    setAction(nextAction); setReason(''); setTitle(''); setMessage(''); setHistoryPage(1); setHistoryTotal(0);
    try {
      const [fresh, history] = await Promise.all([adminCards.detail(card.student_id), adminCards.history(card.student_id)]);
      if (alive.current && request === detailRequest.current) { setDetail(fresh); setDetailReady(true); setEvents(history.data); setHistoryTotal(history.meta.total); }
    } catch (cause) { if (alive.current && request === detailRequest.current) setDetailError(cause instanceof Error ? cause.message : 'Chưa đọc được hồ sơ thẻ.'); }
    finally { if (alive.current && request === detailRequest.current) setDetailLoading(false); }
  }
  function close() { if (!saving) { ++detailRequest.current; setDetail(null); setAction(null); } }
  async function save() {
    if (!detail || !action || saving) return;
    const selected = detail; setSaving(true); setDetailError('');
    try {
      if (action === 'notify') await adminCards.notify(selected.student_id, title.trim(), message.trim());
      else await adminCards.change(selected, action, reason.trim());
      if (!alive.current) return;
      setNotice(action === 'notify' ? 'Đã gửi thông báo cho sinh viên.' : 'Đã cập nhật trạng thái thẻ và gửi thông báo cho sinh viên.');
      setRefresh(value => value + 1);setRevokeConfirm(false); setAction(null);
      await inspect(selected);
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof ApiError && cause.code === 'CARD_CHANGED') { await inspect(selected); setRefresh(value => value + 1); }
      setDetailError(cause instanceof Error ? cause.message : 'Chưa lưu được thay đổi.');
    } finally { if (alive.current) setSaving(false); }
  }
  async function moreHistory() {
    if (!detail) return; const request = detailRequest.current; setDetailLoading(true);
    try { const result = await adminCards.history(detail.student_id, historyPage + 1); if (alive.current && request === detailRequest.current) { setEvents(current => [...current, ...result.data]); setHistoryPage(current => current + 1); } }
    catch (cause) { if (alive.current && request === detailRequest.current) setDetailError(cause instanceof Error ? cause.message : 'Chưa đọc được lịch sử.'); }
    finally { if (alive.current && request === detailRequest.current) setDetailLoading(false); }
  }

  return <div className={styles.page}>
    
    {notice && <p role="status" className={styles.success}>{notice}</p>}
    <Card><CollectionToolbar actions={<Button variant="outline" onClick={()=>setRefresh(value=>value+1)}>Làm mới</Button>} state={collection} placeholder="Tìm theo tên, MSSV hoặc email..." filters={[{key:'status',label:'Trạng thái thẻ',options:Object.entries(cardLabels).map(([value,label])=>({value,label}))}]}/></Card>
    {error && <p role="alert">{error}</p>}
    <Card borderRole="users" className={styles.results}>{loading ? <LoadingSkeleton rows={5} /> : error ? <EmptyState title="Chưa tải được danh sách" /> : rows.length ? <Table label="Danh sách xác thực thẻ sinh viên"><thead><tr>{['MSSV', 'Họ tên', 'Email', 'Hồ sơ', 'Thẻ sinh viên', 'Người xác nhận', 'Thời gian xác nhận', 'Reference hiện tại', 'Thao tác'].map(label => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{rows.map(card => <tr key={card.student_id}><td>{card.student_code || 'Chưa cập nhật'}</td><td><strong>{card.full_name}</strong>{!card.is_active && <small>Tài khoản ngừng hoạt động</small>}</td><td>{card.email}</td><td><Badge tone={card.identity_profile_status === 'VERIFIED' ? 'success' : 'warning'}>{card.identity_profile_status === 'VERIFIED' ? 'Đã xác minh' : 'Chờ xác minh'}</Badge></td><td><Status card={card} /></td><td>{confirmationActor(card.reference)}</td><td>{date(card.reference?.verified_at)}</td><td>{card.reference?.status ?? 'Chưa có'}</td><td><div className="row-actions"><Button size="sm" variant="outline" onClick={()=>void inspect(card)}>Xem</Button><ActionMenu label={`Thao tác thẻ ${card.full_name}`} items={[{label:'Yêu cầu cập nhật',tone:'warning',onSelect:()=>void inspect(card,'request-update')},...(card.reference&&!card.reference.revoked_at&&card.management_status!=='REVOKED'?[{label:'Thu hồi',tone:'danger' as const,onSelect:()=>void inspect(card,'revoke')}]:[])]}/></div></td></tr>)}</tbody></Table> : <EmptySearchState mascot state={collection}/>}
      <CollectionPagination state={collection} total={error?null:total} count={rows.length} loading={loading}/></Card>
    <Modal open={!!detail} title={action === 'revoke' ? 'Thu hồi xác thực thẻ?' : action === 'request-update' ? 'Yêu cầu cập nhật lại thẻ' : action === 'notify' ? 'Gửi thông báo cho sinh viên' : 'Chi tiết xác thực thẻ sinh viên'} onClose={close} size="large">
      {detail && <div className={styles.detail}>{detailLoading && <LoadingSkeleton rows={2} />}{detailError && <div role="alert"><p>{detailError}</p>{!detailReady && <Button variant="outline" disabled={detailLoading} onClick={() => void inspect(detail, action)}>Thử lại</Button>}</div>}
        <section><h3>Thông tin sinh viên</h3><ProfileAvatar user={{ ...detail, role: 'student' }} className={styles.avatar} /><dl className={styles.fields}><div><dt>Họ tên</dt><dd>{detail.full_name}</dd></div><div><dt>MSSV</dt><dd>{detail.student_code || 'Chưa cập nhật'}</dd></div><div><dt>Lớp</dt><dd>{detail.class_name || 'Chưa cập nhật'}</dd></div><div><dt>Email</dt><dd>{detail.email}</dd></div><div><dt>Trạng thái hồ sơ</dt><dd>{detail.identity_profile_status === 'VERIFIED' ? 'Đã xác minh' : 'Chờ xác minh'}</dd></div></dl></section>
        {action ? <form onSubmit={event => { event.preventDefault();if(action==='revoke')setRevokeConfirm(true);else void save(); }} className={styles.actionForm}>
          {action === 'notify' ? <><p>Người nhận: <strong>{detail.full_name}</strong> ({detail.email})</p><label>Tiêu đề<input required maxLength={255} value={title} onChange={event => setTitle(event.target.value)} disabled={saving} /></label><label>Nội dung<textarea required maxLength={3000} rows={5} value={message} onChange={event => setMessage(event.target.value)} disabled={saving} /></label></> : <>
            <p>{action === 'revoke' ? 'Xác thực thẻ hiện tại sẽ bị thu hồi. Sinh viên phải tải và xác nhận thẻ mới trước khi xác minh khuôn mặt để vào bài thi.' : 'Thẻ hiện tại sẽ không còn được dùng để xác minh mới. Sinh viên sẽ nhận thông báo yêu cầu tải lại thẻ.'}</p>
            <label>Lý do<textarea required maxLength={1000} rows={4} placeholder="Nhập lý do để sinh viên biết cần cập nhật điều gì" value={reason} onChange={event => setReason(event.target.value)} disabled={saving} /></label>
          </>}
          <div className={styles.actions}><Button type="button" variant="outline" disabled={saving} onClick={() => { setAction(null); setDetailError(''); }}>Hủy</Button><Button type="submit" variant={action === 'revoke' ? 'danger' : 'primary'} loading={saving} disabled={detailLoading || !detailReady || (action === 'notify' ? !title.trim() || !message.trim() : !reason.trim())}>{action === 'revoke' ? 'Xác nhận thu hồi' : action === 'notify' ? 'Gửi thông báo' : 'Xác nhận yêu cầu cập nhật'}</Button></div>
        </form> : <>
          <section><h3>Thông tin xác thực</h3><dl className={styles.fields}><div><dt>Trạng thái thẻ</dt><dd><Status card={detail} /></dd></div><div><dt>Người xác nhận</dt><dd>{confirmationActor(detail.reference)}</dd></div><div><dt>Ngày xác thực</dt><dd>{date(detail.reference?.verified_at)}</dd></div><div><dt>Reference hiện tại</dt><dd>{detail.reference?.status ?? 'Chưa có'}</dd></div><div><dt>Reference version</dt><dd>{detail.reference?.id ?? 'Chưa có'}</dd></div><div><dt>Profile version khi xác thực</dt><dd>{detail.reference?.identity_profile_version ?? 'Chưa có'}</dd></div>
            {detail.reference && (['ocr_model_version', 'parser_version', 'matching_version', 'face_model_name', 'face_model_version', 'face_preprocessing_version'] as const).map((key, index) => detail.reference?.[key] && <div key={key}><dt>{['Phiên bản OCR', 'Phiên bản parser', 'Phiên bản đối chiếu', 'Mô hình khuôn mặt', 'Phiên bản mô hình', 'Phiên bản xử lý ảnh'][index]}</dt><dd>{detail.reference[key]}</dd></div>)}
            {detail.reference?.revoked_at && <div><dt>Ngày thu hồi</dt><dd>{date(detail.reference.revoked_at)}</dd></div>}</dl>
            {detail.update_reason && <p className={styles.warning}>Lý do cần cập nhật: {detail.update_reason}</p>}
            {face && <figure className={styles.face}><img src={face} alt="Khuôn mặt định danh đã được xử lý" /><figcaption>Ảnh khuôn mặt định danh hiện tại</figcaption></figure>}{imageError && <p role="status">{imageError}</p>}
          </section>
          <div className="row-actions"><Button variant="warning" disabled={saving||detailLoading||!detailReady} onClick={()=>{setReason('');setAction('request-update');}}>Yêu cầu cập nhật lại</Button><ActionMenu label="Thao tác hồ sơ thẻ" disabled={saving||detailLoading||!detailReady} items={[{label:'Gửi thông báo',onSelect:()=>setAction('notify')},{label:'Cập nhật hồ sơ sinh viên',href:`/dashboard/users?student_id=${encodeURIComponent(detail.student_id)}&edit_user=${encodeURIComponent(detail.student_id)}`},...(detail.reference&&!detail.reference.revoked_at&&detail.management_status!=='REVOKED'?[{label:'Thu hồi xác thực',tone:'danger' as const,onSelect:()=>{setReason('');setAction('revoke');}}]:[])]}/></div>
          <section><h3>Lịch sử xác thực</h3>{events.length ? <ol className={styles.history}>{events.map(event => <li key={event.id}><time dateTime={event.created_at}>{date(event.created_at)}</time><strong>{eventLabels[event.action] ?? event.action}</strong><span>{event.actor_role === 'student' ? 'Sinh viên' : event.actor_role === 'admin' ? 'Admin' : 'Hệ thống'}{event.actor_name ? ` · ${event.actor_name}` : ''}</span>{event.reason && <p>Lý do: {event.reason}</p>}</li>)}</ol> : !detailLoading && <p>Chưa có lịch sử được ghi nhận. Dữ liệu cũ không được suy đoán người thực hiện.</p>}{events.length < historyTotal && <Button variant="outline" disabled={detailLoading} onClick={() => void moreHistory()}>Xem thêm lịch sử</Button>}</section>
        </>}
      </div>}
    </Modal>
    <ConfirmDialog open={revokeConfirm&&action==='revoke'&&!!detail} title="Thu hồi xác thực?" description="Thẻ hiện tại sẽ không còn hiệu lực. Sinh viên cần cập nhật thẻ theo yêu cầu." confirmLabel="Thu hồi" busy={saving} error={detailError} onCancel={()=>setRevokeConfirm(false)} onConfirm={()=>void save()}/>
  </div>;
}
