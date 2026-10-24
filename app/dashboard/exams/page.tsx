'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthContext';
import { Badge, Button, Card, EmptyState, LoadingSkeleton, Modal,ConfirmDialog, Table } from '@/components/ui';
import { ExamEditor, type ManagedExam } from '@/components/teacher/ExamEditor';
import { ExamActions, type ExamAction, type ExamAttemptState } from '@/components/teacher/ExamActions';
import actionStyles from '@/components/teacher/ExamActions.module.css';
import { api, ApiError } from '@/lib/api';
import { selectionDraftKey, unwrap, type SelectionDraft } from '@/lib/question-selection';
import { friendlyError } from '@/lib/uiErrors';
import { readCollection, useCollectionState } from '@/lib/collections';
import { CollectionToolbar, CollectionPagination, EmptySearchState, commonSorts } from '@/components/collections/CollectionToolbar';

const statusLabels: Record<string, string> = { draft: 'Bản nháp', published: 'Đã xuất bản', ongoing: 'Đang diễn ra', closed: 'Đã đóng' };
const formatDate = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
export default function ExamsPage() {
  const { user } = useAuth(); const router = useRouter();
  const collection=useCollectionState({status:'',class_id:'',require_camera:'',require_mic:'',teacher_id:''});
  const [total,setTotal]=useState<number|null>(null);
  const [items, setItems] = useState<ManagedExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [initialSelection, setInitialSelection] = useState<SelectionDraft>();
  const [attemptStates, setAttemptStates] = useState<Record<string, ExamAttemptState> | null>(null);
  const [confirm, setConfirm] = useState<{ exam: ManagedExam; action: 'close' | 'delete' } | null>(null);
  const [actionSaving, setActionSaving] = useState(false); const [actionError, setActionError] = useState('');
  const working = useRef(false); const epoch = useRef(0);
  const load = async () => {
    const request = ++epoch.current; setLoading(true); setAttemptStates(null);setItems([]);setTotal(null);setError('');
    const [list] = await Promise.allSettled([api.exams.list(collection.params)]);
    if (request !== epoch.current) return;
    try {if (list.status === 'fulfilled') {
      const result=readCollection<ManagedExam>(list.value);setItems(result.data);setTotal(result.meta?.total??null);setError('');
      const states:Record<string,ExamAttemptState>={};
      result.data.forEach(exam=>{if(typeof exam.attempt_count==='number'&&typeof exam.completed_attempt_count==='number') states[exam.id]={count:exam.attempt_count,completed:exam.completed_attempt_count};});
      setAttemptStates(states);
    }
    else setError(friendlyError(list.reason, 'Không tải được dữ liệu quản lý đề thi.'));
    }catch(cause){setError(friendlyError(cause,'Không tải được dữ liệu quản lý đề thi.'));}
    setLoading(false);
  };
  useEffect(() => { if(collection.ready) void load(); return () => { epoch.current++; }; }, [collection.key,collection.ready]);
  useEffect(() => {
    if (!user || new URLSearchParams(window.location.search).get('create') !== '1') return;
    try {
      const draft = JSON.parse(sessionStorage.getItem(selectionDraftKey(user.id)) ?? 'null');
      if (draft && typeof draft.bank_id === 'string' && Array.isArray(draft.question_ids) && draft.question_ids.every((id: unknown) => typeof id === 'string')) setInitialSelection(draft);
    } catch { setError('Không khôi phục được lựa chọn câu hỏi. Vui lòng chọn lại.'); }
    setEditingId(undefined); setOpen(true);
  }, [user?.id]);
  function close() { if (editorSaving) return; setOpen(false); const query=new URLSearchParams(window.location.search);query.delete('create');window.history.replaceState(window.history.state,'',location.pathname+(query.size?'?'+query.toString():'')); }
  async function changeStatus(exam: ManagedExam) {
    if (working.current) return; working.current = true;
    try { await api.exams.update(exam.id, { status: 'published' }); await load(); } catch (cause) { setError(friendlyError(cause, 'Không thể cập nhật trạng thái đề thi.')); }
    finally { working.current = false; }
  }
  function action(exam: ManagedExam, selected: ExamAction) {
    if (selected === 'edit') { setEditingId(exam.id); setInitialSelection(undefined); setOpen(true); }
    else if (selected === 'publish') void changeStatus(exam);
    else { setActionError(''); setConfirm({ exam, action: selected }); }
  }
  async function confirmAction() {
    if (!confirm || working.current) return;
    working.current = true; setActionSaving(true); setActionError('');
    try {
      if (confirm.action === 'delete') await api.exams.delete(confirm.exam.id);
      else await api.exams.update(confirm.exam.id, { status: 'closed' });
      setConfirm(null); await load();
    } catch (cause) {
      setActionError(cause instanceof ApiError && cause.code === 'EXAM_HAS_ATTEMPTS'
        ? 'Đề đã có bài làm. Không thể đổi trạng thái hoặc xóa đề theo quy định hiện tại.'
        : friendlyError(cause, 'Không thể thực hiện thao tác. Vui lòng thử lại.'));
    } finally { working.current = false; setActionSaving(false); }
  }
  return <div className="workspace-page">
    {error && <Card role="alert"><p>{error}</p><Button variant="warning" onClick={() => void load()}>Thử lại</Button></Card>}
    <Card><CollectionToolbar mascot actions={<><Button variant="outline" loading={loading} onClick={() => void load()}>Tải lại danh sách</Button><Button onClick={() => { setEditingId(undefined); setInitialSelection(undefined); setOpen(true); }}>+ Tạo đề thi</Button></>} state={collection} placeholder="Tìm đề thi..." sorts={[...commonSorts,{value:'start_time',label:'Thời gian bắt đầu'}]} filters={[
      {key:'status',label:'Trạng thái',options:Object.entries(statusLabels).map(([value,label])=>({value,label}))},
      {key:'class_id',label:'Lớp được giao',source:'classes',options:[]},
      ...(user?.role==='admin'?[{key:'teacher_id',label:'Giảng viên',source:'teachers' as const,options:[]}]:[]),
      {key:'require_camera',label:'Camera',options:[{value:'true',label:'Yêu cầu'},{value:'false',label:'Không yêu cầu'}]},
      {key:'require_mic',label:'Microphone',options:[{value:'true',label:'Yêu cầu'},{value:'false',label:'Không yêu cầu'}]},
    ]}/></Card>
    {loading ? <LoadingSkeleton rows={5} /> : !error&&<Card>{items.length ? <Table><thead><tr><th>Tên đề thi</th><th>Trạng thái</th><th>Thời gian</th><th>Số câu</th><th>Lớp được giao</th><th>Thiết bị</th><th className={actionStyles.column}>Thao tác</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><strong>{item.title}</strong><small className="table-description">{item.description}</small></td><td><Badge>{statusLabels[item.status] ?? item.status}</Badge></td><td>{formatDate(item.start_time)}<small className="table-description">đến {formatDate(item.end_time)}</small></td><td>{item.questions_count}</td><td>{(item.classes ?? []).map(c => c.name).join(', ') || 'Chưa giao'}</td><td>{[item.require_camera && 'Camera', item.require_mic && 'Microphone'].filter(Boolean).join(', ') || 'Không yêu cầu'}</td><td className={actionStyles.column}><ExamActions exam={item} attempts={attemptStates?.[item.id]} onAction={selected => action(item, selected)} /></td></tr>)}</tbody></Table> : <EmptySearchState state={collection}/>}<CollectionPagination state={collection} total={total} count={items.length} loading={loading}/></Card>}
    <ConfirmDialog open={!!confirm} title={confirm?.action==='delete'?'Xóa đề thi?':'Đóng đề thi?'} description={confirm?.action==='delete'?'Hành động này không thể hoàn tác.':'Sinh viên sẽ không thể tiếp tục làm bài theo policy hiện tại.'} confirmLabel={confirm?.action==='delete'?'Xóa':'Đóng đề'} tone={confirm?.action==='delete'?'danger':'warning'} busy={actionSaving} error={actionError} onCancel={()=>setConfirm(null)} onConfirm={()=>void confirmAction()}><p><strong>{confirm?.exam.title}</strong></p></ConfirmDialog>
    <Modal open={open} size="large" title={editingId ? 'Sửa đề thi' : 'Tạo đề thi'} onClose={close} className="exam-form-modal">
      {open && <ExamEditor key={editingId ?? 'new'} examId={editingId} onSavingChange={setEditorSaving} initialSelection={initialSelection} onCancel={close} onSaved={() => { if (user) sessionStorage.removeItem(selectionDraftKey(user.id)); close(); void load(); }} />}
    </Modal>
  </div>;
}
