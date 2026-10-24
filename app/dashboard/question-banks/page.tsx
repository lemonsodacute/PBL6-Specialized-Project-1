'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, Input, LoadingSkeleton, Modal, Textarea,ActionMenu,ConfirmDialog } from '@/components/ui';
import { api } from '@/lib/api';
import { unwrap, type Bank } from '@/lib/question-selection';
import { friendlyError } from '@/lib/uiErrors';
import { useCollectionState,useServerCollection } from '@/lib/collections';
import { CollectionToolbar,CollectionPagination,EmptySearchState,commonSorts } from '@/components/collections/CollectionToolbar';

export default function QuestionBanksPage() {
  const collection=useCollectionState();
  const {rows:banks,total,loading,error:loadError,reload:load}=useServerCollection<Bank>(collection,params=>api.questionBanks.list(params));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<'create' | 'rename' | 'delete' | null>(null);
  const [target, setTarget] = useState<Bank | null>(null);
  const [draft, setDraft] = useState({ name: '', description: '' });
  const [saving, setSaving] = useState(false);
  function open(next: typeof action, bank: Bank | null = null) {
    setAction(next); setTarget(bank); setError('');
    setDraft({ name: bank?.name ?? '', description: bank?.description ?? '' });
  }
  async function save() {
    if (saving) return;
    if (action !== 'delete' && !draft.name.trim()) { setError('Vui lòng nhập tên ngân hàng.'); return; }
    setSaving(true); setError('');
    try {
      if (action === 'delete' && target) await api.questionBanks.delete(target.id);
      else if (action === 'rename' && target) await api.questionBanks.update(target.id, { name: draft.name.trim() });
      else await api.questionBanks.create({ name: draft.name.trim(), description: draft.description.trim() || null });
      setNotice(action === 'delete' ? 'Đã xóa ngân hàng khỏi danh sách đang sử dụng.' : action === 'rename' ? 'Đã đổi tên ngân hàng.' : 'Đã tạo ngân hàng câu hỏi.');
      setAction(null); await load();
    } catch (cause) { setError(friendlyError(cause, 'Không hoàn tất được thao tác. Vui lòng thử lại.')); }
    finally { setSaving(false); }
  }
  return <div className="workspace-page question-bank-page">
    
    {notice && <p role="status">{notice}</p>}
    {(error || loadError) && !action && <Card role="alert"><p>{error || loadError}</p><Button variant="warning" onClick={() => void load()}>Tải lại</Button></Card>}
    <Card><CollectionToolbar actions={<Button disabled={saving} onClick={() => open('create')}>+ Tạo ngân hàng</Button>} state={collection} placeholder="Tìm ngân hàng câu hỏi..." sorts={commonSorts}/></Card>
    {loading ? <LoadingSkeleton rows={3} /> : !banks.length && !error && !loadError
      ? <EmptySearchState mascot state={collection}/>
      : <div className="question-bank-grid">{banks.map(bank => {
        const date = bank.updated_at ? new Date(bank.updated_at) : null;
        return <Card key={bank.id} className="question-bank-card">
          <h2><Link href={`/dashboard/question-banks/${bank.id}`}>{bank.name}</Link></h2>
          <p className="bank-count">{bank.questions_count} câu hỏi</p>
          {bank.description && <p>{bank.description}</p>}
          {date && !Number.isNaN(date.getTime()) && <p className="bank-updated">Cập nhật {date.toLocaleDateString('vi-VN')}</p>}
          <div className="bank-card-actions"><Link className="bank-open-link" href={`/dashboard/question-banks/${bank.id}`} aria-label={`Mở ngân hàng ${bank.name}`}>Mở</Link>
            <ActionMenu label={`Thao tác ngân hàng ${bank.name}`} disabled={saving} items={[{label:'Đổi tên',onSelect:()=>open('rename',bank)},{label:'Xóa',tone:'danger',onSelect:()=>open('delete',bank)}]}/></div>
        </Card>;
      })}</div>}
    <CollectionPagination state={collection} total={total} count={banks.length} loading={loading}/>
    <ConfirmDialog open={action==='delete'} title="Xóa ngân hàng" description={`Xóa ngân hàng “${target?.name??''}” khỏi danh sách đang sử dụng? Các câu hỏi và liên kết trong đề thi được giữ lại.`} confirmLabel="Xác nhận" busy={saving} error={error} onCancel={()=>setAction(null)} onConfirm={()=>void save()}/>
    <Modal open={!!action&&action!=='delete'} size="medium" title={action === 'create' ? 'Tạo ngân hàng câu hỏi' : action === 'rename' ? 'Đổi tên ngân hàng' : 'Xóa ngân hàng'} onClose={() => { if (!saving) setAction(null); }}>
      <form className="question-form" onSubmit={event => { event.preventDefault(); void save(); }}>
        {error && <p role="alert">{error}</p>}
        {action === 'delete' ? <p>Xóa ngân hàng “{target?.name}” khỏi danh sách đang sử dụng? Các câu hỏi và liên kết trong đề thi được giữ lại.</p>
          : <><label>Tên ngân hàng<Input required maxLength={255} value={draft.name} disabled={saving} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label>
            {action === 'create' && <label>Mô tả<Textarea value={draft.description} disabled={saving} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} /></label>}</>}
        <div className="modal-actions"><Button type="button" variant="outline" disabled={saving} onClick={() => setAction(null)}>Hủy</Button>
          <Button type="submit" variant={action === 'delete' ? 'danger' : 'success'} disabled={saving}>{saving ? 'Đang lưu...' : 'Xác nhận'}</Button></div>
      </form>
    </Modal>
  </div>;
}
