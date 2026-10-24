'use client';


import { friendlyError } from '@/lib/uiErrors';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, EmptyState, Input, Modal,ConfirmDialog, Select, Table, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import type { LiveClass, LiveClassStatus } from '@/types';
import { useRef } from 'react';
import {RemoteFilterSelect} from '@/components/collections/RemoteFilterSelect';
import { useCollectionState,useServerCollection } from '@/lib/collections';
import { CollectionToolbar,CollectionPagination,EmptySearchState } from '@/components/collections/CollectionToolbar';

type ClassOption = { id: string; name: string };
const statusLabels: Record<LiveClassStatus, string> = { scheduled: 'Đã lên lịch', ongoing: 'Đang diễn ra', ended: 'Đã kết thúc', cancelled: 'Đã huỷ' };
const statusClass: Record<LiveClassStatus, string> = { scheduled: 'exam-status-published', ongoing: 'exam-status-ongoing', ended: 'exam-status-closed', cancelled: 'exam-status-draft' };
const unwrap = <T,>(response: unknown): T => (response as { data: T }).data;
const formatDate = (value: string) => new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const toInputDate = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const fromInputDate = (value: string) => value ? new Date(value).toISOString() : '';

const emptyLiveClass = (classId = ''): LiveClass => ({ id: '', class_id: classId, teacher_id: '', title: '', description: '', scheduled_start: new Date(Date.now() + 3600000).toISOString(), scheduled_end: new Date(Date.now() + 7200000).toISOString(), actual_start: null, actual_end: null, meeting_url: null, recording_url: null, status: 'scheduled', deleted_at: null, created_at: '', updated_at: '' });

export default function LiveClassesPage() {
  const router = useRouter();
  const collection=useCollectionState({status:'',class_id:''});
  const {rows:items,total,loading,error:loadError,reload:load}=useServerCollection<LiveClass>(collection,params=>api.liveClasses.list(params));
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [editing, setEditing] = useState<LiveClass | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const [ending, setEnding] = useState<LiveClass | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => { api.classes.list({page:1,limit:20}).then(result=>setClasses(unwrap<ClassOption[]>(result))).catch(()=>setClasses([])); const query = new URLSearchParams(window.location.search); setNotice(query.get('notice') === 'ended' ? 'Buổi học đã kết thúc.' : query.get('notice') === 'access' ? 'Bạn không còn quyền truy cập buổi học này.' : ''); const timer = window.setInterval(() => { void load(true); }, 10000); return () => window.clearInterval(timer); }, []);

  const save = async () => {
    if (actionLock.current) return;
    if (!editing?.title.trim() || !editing.class_id || !editing.scheduled_start || !editing.scheduled_end) { setError('Vui lòng nhập tiêu đề, lớp và thời gian buổi học.'); return; }
    if (new Date(editing.scheduled_end).getTime() <= new Date(editing.scheduled_start).getTime()) { setError('Thời gian kết thúc phải sau thời gian bắt đầu.'); return; }
    actionLock.current = true; setBusy(true); setError('');
    try {
      const response = await api.liveClasses.create({ class_id: editing.class_id, title: editing.title.trim(), description: editing.description || null, scheduled_start: editing.scheduled_start, scheduled_end: editing.scheduled_end });
      await load();
      setEditing(null);
    } catch (cause) {
      setError(friendlyError(cause, 'Không thể tạo buổi học. Thời gian kết thúc phải sau thời gian bắt đầu.'));
    } finally { actionLock.current = false; setBusy(false); }
  };

  const act = async (item: LiveClass, action: 'start' | 'end') => { if (actionLock.current) return; actionLock.current = true; setBusy(true); setError(''); try { await api.liveClasses[action](item.id); setEnding(null); await load(); } catch (cause) { setError(friendlyError(cause, 'Không thực hiện được thao tác. Vui lòng thử lại.')); } finally { actionLock.current = false; setBusy(false); } };
  const start = (item: LiveClass) => act(item, 'start');
  const end = (item: LiveClass) => act(item, 'end');

  return <div className="workspace-page classroom-page">
    {notice && <p className="classroom-notice" role="status">{notice}</p>}
    {(error||loadError) && <div className="classroom-alert" role="alert">{error||loadError}{loadError&&<Button onClick={()=>void load()}>Thử lại</Button>}</div>}
    {!classes.length && !loading && <Card><p>Giảng viên cần có ít nhất một lớp được phân công để lên lịch buổi học.</p></Card>}
    <Card><CollectionToolbar actions={<Button disabled={busy || loading || !classes.length} onClick={() => { setError(''); setEditing(emptyLiveClass(classes[0]?.id)); }}>+ Tạo buổi học</Button>} state={collection} placeholder="Tìm lớp hoặc buổi học..." filters={[{key:'status',label:'Trạng thái',options:Object.entries(statusLabels).map(([value,label])=>({value,label}))},{key:'class_id',label:'Lớp học',source:'classes',options:[]}]} sorts={[{value:'newest',label:'Lịch gần nhất'},{value:'oldest',label:'Lịch cũ nhất'}]}/></Card>
    {loading ? <Card><p>Đang tải…</p></Card> : !loadError&&<Card>{items.length ? <Table><thead><tr><th>Tiêu đề</th><th>Lớp</th><th>Thời gian</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><button className="table-link" onClick={() => router.push(`/live-class/${item.id}`)}>{item.title}</button><small className="table-description">{item.description}</small></td><td>{item.class_name??classes.find(c => c.id === item.class_id)?.name ?? '—'}</td><td><span className="date-stack">{formatDate(item.scheduled_start)}<small>đến {formatDate(item.scheduled_end)}</small></span></td><td><Badge className={`status-badge ${statusClass[item.status]}`}>{statusLabels[item.status]}</Badge></td><td><div className="table-actions">{item.status === 'scheduled' && <Button variant="success" size="sm" disabled={busy} onClick={() => void start(item)}>Bắt đầu</Button>}{item.status === 'ongoing' && <><Button variant="outline" size="sm" onClick={() => router.push(`/live-class/${item.id}`)}>Mở phòng</Button><Button variant="danger" size="sm" disabled={busy} onClick={() => setEnding(item)}>Kết thúc</Button></>}{item.status === 'ended' && <Button variant="outline" size="sm" onClick={() => router.push(`/live-class/${item.id}`)}>Xem chi tiết</Button>}</div></td></tr>)}</tbody></Table> : collection.active?<EmptySearchState mascot state={collection}/>:<EmptyState mascot title="Chưa có buổi học">Tạo buổi học đầu tiên cho lớp.</EmptyState>}</Card>}
    <CollectionPagination state={collection} total={total} count={items.length} loading={loading}/>
    <LiveClassModal value={editing} classes={classes} busy={busy} error={error} onChange={setEditing} onClose={() => { if (!busy) setEditing(null); }} onSave={() => void save()} />
    <ConfirmDialog open={Boolean(ending)} title="Kết thúc buổi học?" description="Tất cả người tham gia sẽ rời khỏi phòng." confirmLabel="Kết thúc buổi học" busy={busy} error={error} onCancel={()=>setEnding(null)} onConfirm={()=>{if(ending)void end(ending);}}/>
  </div>;
}

function LiveClassModal({ value, classes, busy, error, onChange, onClose, onSave }: { value: LiveClass | null; classes: ClassOption[]; busy: boolean; error: string; onChange: (value: LiveClass | null) => void; onClose: () => void; onSave: () => void }) {
  const update = (patch: Partial<LiveClass>) => value && onChange({ ...value, ...patch });
  return <Modal open={Boolean(value)} size="large" title="Tạo buổi học trực tuyến" onClose={onClose}>{value && <div className="question-form">{error && <p role="alert">{error}</p>}<label>Lớp học *<RemoteFilterSelect source="classes" label="Lớp học" value={value.class_id} onChange={class_id=>{if(!busy)update({class_id});}}/></label><label>Tiêu đề *<Input disabled={busy} maxLength={255} value={value.title} onChange={e => update({ title: e.target.value })} placeholder="Ví dụ: Workshop React" /></label><label>Mô tả<Textarea disabled={busy} maxLength={5000} rows={3} value={value.description ?? ''} onChange={e => update({ description: e.target.value })} placeholder="Mô tả buổi học" /></label><div className="form-two-col"><label>Bắt đầu dự kiến *<Input disabled={busy} type="datetime-local" value={toInputDate(value.scheduled_start)} onChange={e => update({ scheduled_start: fromInputDate(e.target.value) })} /></label><label>Kết thúc dự kiến *<Input disabled={busy} type="datetime-local" value={toInputDate(value.scheduled_end)} onChange={e => update({ scheduled_end: fromInputDate(e.target.value) })} /></label></div><div className="modal-actions"><Button variant="outline" disabled={busy} onClick={onClose}>Huỷ</Button><Button variant="success" disabled={busy} onClick={onSave}>{busy ? 'Đang lưu…' : 'Lưu buổi học'}</Button></div></div>}</Modal>;
}
