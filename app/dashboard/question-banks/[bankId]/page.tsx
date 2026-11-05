'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthContext';

import { Button, Card, Input, LoadingSkeleton, Modal,ConfirmDialog,ActionMenu, Select } from '@/components/ui';
import { QuestionSelector } from '@/components/teacher/QuestionSelector';
import { QuestionEditor } from '@/components/teacher/QuestionEditor';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/uiErrors';
import { normalizeQuestions, selectionDraftKey, unwrap, type Bank, type SelectionQuestion } from '@/lib/question-selection';
import { readCollection,useCollectionState,useServerCollection } from '@/lib/collections';
import type { ManagedExam } from '@/components/teacher/ExamEditor';

export default function QuestionBankDetailPage() {
  const { user } = useAuth(); const router = useRouter();
  const { bankId } = useParams<{ bankId: string }>();
  const [bank, setBank] = useState<Bank | null>(null);
  const collection=useCollectionState({type:'',difficulty:'',topic:'',status:''});
  const questionParams=(params:Record<string,string|number|boolean|undefined>)=>({...params,status:undefined,is_active:params.status==='active'?true:params.status==='inactive'?false:undefined});
  const questionResult=useServerCollection<SelectionQuestion>(collection,async params=>{const result=readCollection<SelectionQuestion>(await api.questionBanks.questions(bankId,questionParams(params)));return {...result,data:normalizeQuestions(result.data)};},undefined,bankId);
  const questions=questionResult.rows;
  const [selected, setSelected] = useState<SelectionQuestion[]>([]);
  const [editing, setEditing] = useState<SelectionQuestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectorBusy, setSelectorBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState('');
  const [topic, setTopic] = useState('');
  const [exams, setExams] = useState<ManagedExam[]>([]);
  const [target, setTarget] = useState('');
  const generation = useRef(0);
  async function loadBank() {
    const request = ++generation.current;
    setLoading(true); setError('');
    try {
      const detail = unwrap<Bank & { questions: SelectionQuestion[] }>(await api.questionBanks.get(bankId,{include_questions:false}));
      if (request === generation.current) { setBank(detail); }
    } catch (cause) { if (request === generation.current) setError(friendlyError(cause, 'Không tải được ngân hàng câu hỏi.')); }
    finally { if (request === generation.current) setLoading(false); }
  }
  useEffect(() => { setBank(null); setSelected([]); void loadBank(); return () => { generation.current++; }; }, [bankId]);
  async function refreshQuestions(){
    const version=generation.current;
    const [,response]=await Promise.all([questionResult.reload(),api.questionBanks.get(bankId,{include_questions:false})]);
    const detail=unwrap<Bank>(response);
    if(version===generation.current)setBank(detail);
  }
  async function allMatching(){
    const rows:SelectionQuestion[]=[];
    for(let page=1;;page++){
      const result=readCollection<SelectionQuestion>(await api.questionBanks.questions(bankId,{...questionParams(collection.params),page,limit:100}));
      rows.push(...normalizeQuestions(result.data));
      if(!result.data.length||result.meta?.total===undefined||rows.length>=result.meta.total) break;
    }
    return rows;
  }
  async function openAdd() {
    setAction('add'); setTarget(''); setError('');
    try { setExams(unwrap<ManagedExam[]>(await api.exams.list({ status: 'draft', limit: 100 }))); }
    catch (cause) { setError(friendlyError(cause, 'Không tải được danh sách đề nháp.')); }
  }
  async function bulk() {
    if (busy || selectorBusy) return;
    setBusy(true); setError(''); setNotice('');
    const succeeded = new Set<string>();
    try {
      if (action === 'add') {
        if (selected.some(q => !q.is_active) || selected.length > 500) { setError('Chỉ thêm tối đa 500 câu đang sử dụng vào đề.'); return; }
        if (!target) {
          if (!user) return;
          sessionStorage.setItem(selectionDraftKey(user.id), JSON.stringify({ bank_id: bankId, question_ids: selected.map(q => q.id) }));
          router.push('/dashboard/exams?create=1'); return;
        }
        const detail = unwrap<ManagedExam>(await api.exams.get(target));
        if (detail.status !== 'draft') { setError('Đề không còn ở trạng thái nháp. Vui lòng tải lại.'); return; }
        const ids = Array.from(new Set([...(detail.questions ?? []).map(q => q.id), ...selected.map(q => q.id)]));
        if (ids.length > 500) { setError('Đề vượt quá 500 câu.'); return; }
        await api.exams.replaceQuestions(target, ids);
        setNotice(`Đã thêm câu vào đề “${detail.title}”.`); setAction(''); return;
      }
      for (const q of selected) {
        if (action === 'delete') await api.questionBanks.deleteQuestion(q.id);
        else await api.questionBanks.updateQuestion(q.id, { topic: topic.trim() || null });
        succeeded.add(q.id);
      }
      setNotice(`Đã ${action === 'delete' ? 'ngừng sử dụng' : 'chuyển chủ đề'} ${succeeded.size} câu hỏi.`);
      setSelected([]); setAction(''); await refreshQuestions();
    } catch (cause) {
      if (succeeded.size) {
        setSelected(current => current.filter(q => !succeeded.has(q.id)));
        setError(`Đã cập nhật ${succeeded.size} câu. Các câu còn lại chưa được xử lý; vui lòng thử lại.`);
        try { await refreshQuestions(); } catch { /* Keep the last usable list and selection. */ }
      } else setError(friendlyError(cause, 'Không hoàn tất được thao tác. Vui lòng thử lại.'));
    } finally { setBusy(false); }
  }
  return <div className="workspace-page question-bank-page">
    <nav className="bank-breadcrumb" aria-label="Đường dẫn ngân hàng"><Link href="/dashboard/question-banks">Ngân hàng câu hỏi</Link><span aria-hidden="true">/</span><span>{bank?.name ?? 'Chi tiết ngân hàng'}</span></nav>
    
    {(error||questionResult.error) && !action && <Card role="alert"><p>{error||questionResult.error}</p><Button variant="warning" onClick={() => {void questionResult.reload();void loadBank();}}>Tải lại</Button></Card>}
    {notice && <p role="status">{notice}</p>}
    {loading ? <LoadingSkeleton rows={3} /> : bank && <Card borderRole="exams"><div className="card-toolbar"><div><h2>Câu hỏi trong ngân hàng</h2>{bank.description&&<p>{bank.description}</p>}</div><div className="action-row"><><Button variant="outline" disabled={!bank || busy || selectorBusy || loading} onClick={() => router.push(`/dashboard/question-banks/${bankId}/documents`)}>Tạo từ tài liệu</Button><Button disabled={!bank || busy || selectorBusy || loading} onClick={() => setEditing({ id: 'new', question_bank_id: bankId, content: '', type: 'mcq_single', difficulty: 'easy', topic: null, is_active: true, default_points: 1, options_json: { options: ['', ''] }, correct_answer_json: null })}>+ Thêm câu hỏi</Button></></div></div>
      <div className="selection-bulk-actions"><strong>Đã chọn: {selected.length} câu</strong><Button disabled={busy || selectorBusy || !selected.length || selected.some(q => !q.is_active)} onClick={() => void openAdd()}>Thêm vào đề</Button><ActionMenu label="Thao tác các câu đã chọn" disabled={busy||selectorBusy||!selected.length} items={[{label:'Chuyển chủ đề',onSelect:()=>{setTopic('');setError('');setAction('topic');}},{label:'Xóa đã chọn',tone:'danger',onSelect:()=>{setError('');setAction('delete');}}]}/></div>
      <QuestionSelector onBusyChange={setSelectorBusy} bankId={bankId} questions={questions} selected={selected} onChange={setSelected} disabled={busy || selectorBusy || questionResult.loading} serverSource={{state:collection,total:questionResult.total,topics:questionResult.meta?.topics??[],hasDifficulty:questionResult.meta?.has_difficulty,loading:questionResult.loading,error:questionResult.error,allMatching}} manageInactive onEdit={setEditing} />
    </Card>}
    {editing && <QuestionEditor key={editing.id} question={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refreshQuestions().catch(() => setError('Đã lưu nhưng chưa tải lại được danh sách. Vui lòng tải lại.')); }} />}
    <ConfirmDialog open={action==='delete'} title="Xóa câu hỏi đã chọn" description={`Ngừng sử dụng ${selected.length} câu hỏi đã chọn? Liên kết trong các đề thi được giữ lại.`} confirmLabel="Xác nhận" busy={busy||selectorBusy} error={error} onCancel={()=>setAction('')} onConfirm={()=>void bulk()}/>
    <Modal open={!!action&&action!=='delete'} size="small" title={action === 'add' ? 'Thêm câu hỏi vào đề' : action === 'topic' ? 'Chuyển chủ đề' : 'Xóa câu hỏi đã chọn'} onClose={() => { if (!busy) setAction(''); }}>
      <div className="question-form">{error && <p role="alert">{error}</p>}
        {action === 'add' ? <><p>Thêm {selected.length} câu đang chọn; câu đã có trong đề sẽ được bỏ qua.</p><label>Đề nhận câu hỏi<Select value={target} disabled={busy || selectorBusy} onChange={e => setTarget(e.target.value)}><option value="">Tạo đề mới</option>{exams.filter(exam => exam.status === 'draft').map(exam => <option key={exam.id} value={exam.id}>{exam.title}</option>)}</Select></label></>
          : action === 'topic' ? <><p>Cập nhật chủ đề cho {selected.length} câu hỏi.</p><label>Chủ đề mới<Input value={topic} disabled={busy || selectorBusy} onChange={e => setTopic(e.target.value)} /></label><p>Để trống để bỏ chủ đề.</p></>
          : <p>Ngừng sử dụng {selected.length} câu đã chọn. Các câu này sẽ không được đưa vào lượt chọn đề mới.</p>}
        <div className="modal-actions"><Button variant="outline" disabled={busy || selectorBusy} onClick={() => setAction('')}>Hủy</Button><Button variant={action === 'delete' ? 'danger' : 'success'} disabled={busy || selectorBusy} onClick={() => void bulk()}>{busy ? 'Đang xử lý...' : action === 'add' && !target ? 'Tiếp tục tạo đề' : 'Xác nhận'}</Button></div>
      </div>
    </Modal>
  </div>;
}
