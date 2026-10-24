'use client';


import { friendlyError } from '@/lib/uiErrors';

import { Suspense, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, Modal, Select, Table,ActionMenu,ConfirmDialog,PasswordInput } from '@/components/ui';
import { useCollectionState, useServerCollection } from '@/lib/collections';
import { CollectionToolbar, CollectionPagination, EmptySearchState, commonSorts } from '@/components/collections/CollectionToolbar';
import type { UserRole } from '@/types';
import { api, ApiError } from '@/lib/api';
import { ProfileVerificationRequests } from '@/components/admin/ProfileVerificationRequests';
import { ProfileAvatar } from '@/components/profile/ProfileAvatar';
import {cardLabels, type ManagedCardStatus} from '@/lib/admin-student-cards';
import type { AvatarFields } from '@/types';

type SafeUser = AvatarFields & { id: string; full_name: string; email: string; role: UserRole; phone?: string | null; is_active: boolean; last_login_at?: string | null; created_at?: string; updated_at?: string; student_code: string | null; class_name: string | null; student_card_status?: ManagedCardStatus; identity_profile_status: 'PENDING' | 'VERIFIED'; identity_profile_version: number };
type Draft = { full_name: string; email: string; password: string; role: UserRole; phone: string; student_code: string };
const roleLabels: Record<UserRole, string> = { admin: 'Quản trị viên', teacher: 'Giảng viên', student: 'Sinh viên' };
const emptyDraft: Draft = { full_name: '', email: '', password: '', role: 'student', phone: '', student_code: '' };

function toSafe(value: unknown): SafeUser {
  const item = value as Partial<SafeUser>;
  return { id: String(item.id), full_name: item.full_name ?? '', email: item.email ?? '', role: item.role ?? 'student', phone: item.phone ?? null, is_active: item.is_active !== false, last_login_at: item.last_login_at ?? null, created_at: item.created_at, updated_at: item.updated_at, student_code: item.student_code ?? null, class_name:item.class_name??null, student_card_status:item.student_card_status, identity_profile_status: item.identity_profile_status ?? 'PENDING', identity_profile_version: item.identity_profile_version ?? 1, avatar_url: item.avatar_url ?? null, avatar_source: item.avatar_source, avatar_reference_id: item.avatar_reference_id, avatar_updated_at: item.avatar_updated_at };
}

export default function UserManagementPage() {
  const collection=useCollectionState({role:'',is_active:'',identity_profile_status:''});
  const {rows:items,total,loading,error:loadError,reload:reloadUsers}=useServerCollection<SafeUser>(collection,async params=>{const result=await api.users.list(params);return {...result,data:result.data.map(toSafe)};});
  const [editing, setEditing] = useState<SafeUser | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [requestRefresh, setRequestRefresh] = useState(0);
  const [lockedUser,setLockedUser]=useState<SafeUser|null>(null);
  const [passwordUser,setPasswordUser]=useState<SafeUser|null>(null);const [passwordValue,setPasswordValue]=useState('');const [passwordError,setPasswordError]=useState('');
  const load=async()=>{await reloadUsers();setRequestRefresh(value=>value+1);};

  const filtered=items;
  const openCreate = () => { setDraft(emptyDraft); setEditing(null); setShowCreate(true); setError(''); };
  const openEdit = (user: SafeUser) => { setDraft({ full_name: user.full_name, email: user.email, password: '', role: user.role, phone: user.phone ?? '', student_code: user.student_code ?? '' }); setEditing(user); setShowCreate(true); setError(''); };
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get('edit_user');
    if (!target || !/^[0-9a-f-]{36}$/i.test(target)) return;
    let active = true;
    api.users.get(target).then(result => { if (active) openEdit(toSafe(result.data)); })
      .catch(cause => { if (active) setError(friendlyError(cause, 'Chưa tải được hồ sơ sinh viên.')); });
    return () => { active = false; };
  }, []);
  const save = async () => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (editing) {
        await api.users.update(editing.id, { full_name: draft.full_name, role: draft.role, phone: draft.phone, student_code: draft.role === 'student' ? draft.student_code.trim() || null : null });
      } else {
        if (!draft.password) throw new Error('Mật khẩu là bắt buộc khi tạo tài khoản.');
        await api.users.create({ full_name: draft.full_name, email: draft.email, password: draft.password, role: draft.role, phone: draft.phone, student_code: draft.role === 'student' ? draft.student_code.trim() || null : null });
      }
      setShowCreate(false); await load();
    } catch (cause) { setError(friendlyError(cause, 'Không lưu được tài khoản.')); }
    finally { setBusy(false); }
  };
  const toggleActive = async (user: SafeUser) => {
    if(busy)return false;setBusy(true);setError('');
    try {
      if (user.is_active) await api.users.deactivate(user.id);
      else await api.users.update(user.id, { is_active: true });
      await load();return true;
    } catch (cause) { setError(friendlyError(cause, 'Không cập nhật được trạng thái tài khoản.'));return false; }finally{setBusy(false);}
  };
  const resetPassword=async()=>{if(!passwordUser||busy)return;setBusy(true);setPasswordError('');
    try{await api.users.resetPassword(passwordUser.id,passwordValue);setPasswordUser(null);setPasswordValue('');setNotice('Đã đặt lại mật khẩu.');}
    catch(cause){setPasswordError(friendlyError(cause,'Không đặt lại được mật khẩu.'));}finally{setBusy(false);}};
  const update = (key: keyof Draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  const verifyIdentity = async (user: SafeUser) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.users.verifyIdentityProfile(user.id, user.identity_profile_version);
      await load();
      setNotice(`Đã xác nhận hồ sơ sinh viên ${user.full_name}.`);
    } catch (cause) { setError(friendlyError(cause, 'Không xác nhận được hồ sơ. Vui lòng tải lại danh sách.')); }
    finally { setBusy(false); }
  };

  return <div className="workspace-page">
    
    {(error || loadError) && !showCreate && <Card><p role="alert">{error || loadError}</p><Button variant="warning" onClick={() => void load()}>Tải lại danh sách</Button></Card>}
    {notice && <Card><p role="status">{notice}</p></Card>}
    {<Suspense fallback={<Card>Đang tải yêu cầu...</Card>}><ProfileVerificationRequests refresh={requestRefresh} onEdit={student => openEdit(toSafe(student))} onApproved={() => void load()} /></Suspense>}
    
    <Card>
      
      <CollectionToolbar actions={<Button onClick={openCreate}>+ Thêm người dùng</Button>} state={collection} placeholder="Tìm người dùng..." sorts={commonSorts} filters={[
        {key:'role',label:'Vai trò',options:Object.entries(roleLabels).map(([value,label])=>({value,label}))},
        {key:'is_active',label:'Trạng thái tài khoản',options:[{value:'true',label:'Đang hoạt động'},{value:'false',label:'Đã khóa'}]},
        {key:'identity_profile_status',label:'Hồ sơ sinh viên',options:[{value:'VERIFIED',label:'Đã xác nhận'},{value:'PENDING',label:'Chờ xác nhận'}]},
      ]}/>
      <div className="card-toolbar">
        <div><h2>Danh sách tài khoản</h2><p>{loading ? 'Đang tải...' : `${filtered.length} tài khoản đang hiển thị`}</p></div>

      </div>

      {!loading && !loadError && filtered.length ? <Table>
        <thead><tr><th>Người dùng</th><th>Email</th><th>Vai trò</th><th>Trạng thái tài khoản</th><th>Mã sinh viên</th><th>Hồ sơ sinh viên</th><th>Thao tác</th></tr></thead>
        <tbody>{filtered.map((user) => <tr key={user.id}>
          <td><strong>{user.full_name}</strong><small className="table-description">{user.phone ?? 'Chưa cập nhật số điện thoại'}</small></td>
          <td>{user.email}</td><td><Badge>{roleLabels[user.role]}</Badge></td>
          <td><Badge tone={user.is_active?'success':'neutral'}>{user.is_active ? 'Đang hoạt động' : 'Đã khóa'}</Badge></td>
          <td>{user.role === 'student' ? <>{user.student_code || 'Chưa cập nhật'}<small className="table-description">Lớp: {user.class_name || 'Chưa cập nhật'}</small></> : '—'}</td>
          <td>{user.role === 'student' ? <Badge tone={user.identity_profile_status === 'VERIFIED' ? 'success' : 'neutral'}>{user.identity_profile_status === 'VERIFIED' ? 'Đã xác nhận' : 'Chờ xác nhận'}</Badge> : '—'}</td>
          <td><div className="row-actions"><Button variant="outline" size="sm" disabled={busy} onClick={()=>openEdit(user)}>Chỉnh sửa</Button>
            <ActionMenu label={`Thao tác tài khoản ${user.full_name}`} disabled={busy} items={[
              ...(user.role==='student'&&user.identity_profile_status!=='VERIFIED'?[{label:'Xác nhận hồ sơ sinh viên',disabled:busy||!user.is_active,onSelect:()=>void verifyIdentity(user)}]:[]),
              {label:'Đổi mật khẩu',onSelect:()=>{setPasswordUser(user);setPasswordValue('');setPasswordError('');}},
              {label:user.is_active?'Khóa':'Mở khóa',tone:user.is_active?'danger':undefined,onSelect:()=>{if(user.is_active){setError('');setLockedUser(user);}else void toggleActive(user);}},
            ]}/></div></td>
        </tr>)}</tbody>
      </Table> : !loading && !loadError && <EmptySearchState mascot state={collection}/>}
      <CollectionPagination state={collection} total={total} count={items.length} loading={loading}/>
    </Card>
    <ConfirmDialog open={!!lockedUser} title="Khóa tài khoản?" description={`${lockedUser?.full_name??''} sẽ không thể sử dụng tài khoản cho đến khi được mở khóa.`} confirmLabel="Khóa" busy={busy} error={error} onCancel={()=>setLockedUser(null)} onConfirm={()=>{if(lockedUser)void toggleActive(lockedUser).then(ok=>{if(ok)setLockedUser(null);});}}/>
    <Modal open={!!passwordUser} title="Đổi mật khẩu" size="small" onClose={()=>{if(!busy)setPasswordUser(null);}}><form className="question-form" onSubmit={event=>{event.preventDefault();void resetPassword();}}><p>{passwordUser?.email}</p><label>Mật khẩu mới<PasswordInput autoComplete="new-password" minLength={8} required value={passwordValue} onChange={event=>setPasswordValue(event.target.value)} disabled={busy}/></label>{passwordError&&<p role="alert" className="field-error">{passwordError}</p>}<div className="modal-actions"><Button type="button" variant="outline" disabled={busy} onClick={()=>setPasswordUser(null)}>Hủy</Button><Button type="submit" variant="success" loading={busy}>Lưu</Button></div></form></Modal>
    <Modal open={showCreate} size="large" title={editing ? 'Chỉnh sửa tài khoản' : 'Thêm tài khoản'} onClose={() => { if (!busy) setShowCreate(false); }}>
      <form className="question-form form-grid" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        {(editing?.role === 'student' || editing?.role === 'teacher') && <div className="wide"><ProfileAvatar user={editing} className="student-avatar" /></div>}
        {editing?.role === 'student' && <dl className="review-details wide"><div><dt>Lớp hành chính</dt><dd>{editing.class_name || 'Chưa cập nhật'}</dd></div><div><dt>Thẻ sinh viên</dt><dd>{editing.student_card_status ? cardLabels[editing.student_card_status] : 'Chưa gửi'}</dd></div></dl>}
        {error && <p className="wide" role="alert">{error}</p>}
        <label>Họ và tên<Input value={draft.full_name} minLength={2} maxLength={255} onChange={(event) => update('full_name', event.target.value)} required /></label>
        {draft.role === 'student' && <label>Mã sinh viên<Input value={draft.student_code} maxLength={64} onChange={(event) => update('student_code', event.target.value)} /></label>}
        <label>Email<Input type="email" value={draft.email} onChange={(event) => update('email', event.target.value)} required disabled={Boolean(editing)} /></label>
        <label>Số điện thoại<Input value={draft.phone} onChange={(event) => update('phone', event.target.value)} /></label>
        <label>Vai trò<Select value={draft.role} onChange={(event) => update('role', event.target.value)}><option value="student">Sinh viên</option><option value="teacher">Giảng viên</option><option value="admin">Quản trị viên</option></Select></label>
        {!editing && <label>Mật khẩu<Input type="password" minLength={8} value={draft.password} onChange={(event) => update('password', event.target.value)} required /></label>}
        {editing?.identity_profile_status === 'VERIFIED' && <p className="wide">Thay đổi họ tên, mã sinh viên hoặc vai trò sẽ yêu cầu xác nhận lại hồ sơ và ảnh định danh.</p>}
        <div className="modal-actions wide"><Button type="button" variant="outline" disabled={busy} onClick={() => setShowCreate(false)}>Hủy</Button><Button type="submit" variant="success" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</Button></div>
      </form>
    </Modal>
  </div>;
}
