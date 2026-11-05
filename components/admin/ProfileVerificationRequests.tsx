'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Badge, Button, Card, EmptyState, Modal,ConfirmDialog, Table, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import type { ProfileRequest, ReviewStudent } from '@/lib/profile-requests';

export function ProfileVerificationRequests({ refresh, onEdit, onApproved }: {
  refresh: number; onEdit: (student: ReviewStudent) => void; onApproved: () => void;
}) {
  const [rows, setRows] = useState<ProfileRequest[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<ProfileRequest | null>(null);
  const [reason, setReason] = useState('');
  const [studentId, setStudentId] = useState<string | undefined>();
  const searchParams = useSearchParams();
  const generation = useRef(0);
  useEffect(() => {
    const value = searchParams.get('student_id');
    setStudentId(value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined);
    setPage(1);
  }, [searchParams]);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError('');
    try {
      const response = await api.profileRequests.list(page, studentId);
      if (request !== generation.current) return;
      setRows(response.data); setTotal(response.meta?.total ?? response.data.length);
    } catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : 'Chưa tải được yêu cầu xác minh.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [page, studentId]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load, refresh]);
  const [rejectConfirm,setRejectConfirm]=useState(false);
  async function review(approve: boolean) {
    if (!selected || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (approve) await api.users.verifyIdentityProfile(selected.student.id, selected.student.identity_profile_version);
      else await api.profileRequests.reject(selected.id, selected.student.identity_profile_version, reason.trim());
      setSelected(null);setRejectConfirm(false); setReason('');
      setNotice(approve ? 'Đã xác nhận hồ sơ sinh viên.' : 'Đã từ chối yêu cầu và thông báo cho sinh viên.');
      await load(); onApproved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa xử lý được yêu cầu.'); }
    finally { setBusy(false); }
  }
  return <Card borderRole="warning">
    <div className="card-toolbar"><div><h2>Yêu cầu xác minh hồ sơ</h2><p>{loading ? 'Đang tải yêu cầu...' : `${total} yêu cầu chờ xử lý`}</p></div>
      <Button variant="warning" disabled={busy || loading} onClick={() => { setSelected(null); void load(); }}>Tải lại yêu cầu</Button></div>
    {studentId && <Button variant="outline" onClick={() => { setStudentId(undefined); setPage(1); }}>Xem tất cả yêu cầu</Button>}
    {notice && <p role="status">{notice}</p>}
    {error && !selected && <p role="alert">{error}</p>}
    {!loading && rows.length > 0 && <Table><thead><tr><th>Họ tên</th><th>Email</th><th>MSSV</th><th>Ngày gửi</th><th>Thao tác</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.id}><td>{row.student.full_name}</td><td>{row.student.email}</td><td>{row.student.student_code || 'Chưa cập nhật'}</td><td>{new Date(row.requested_at).toLocaleString('vi-VN')}</td>
        <td><Button variant="outline" disabled={busy} onClick={() => { setSelected(row); setReason(''); setError(''); }}>Xem hồ sơ</Button></td></tr>)}
    </tbody></Table>}
    {!loading && !rows.length && !error && <EmptyState title="Không có yêu cầu chờ xác minh" />}
    {(total > 20 || page > 1) && <div className="modal-actions"><Button variant="outline" disabled={page === 1 || loading} onClick={() => setPage(value => value-1)}>Trang trước</Button><span>Trang {page}</span><Button variant="outline" disabled={page*20 >= total || loading} onClick={() => setPage(value => value+1)}>Trang sau</Button></div>}

    <Modal open={!!selected} size="large" title="Xem hồ sơ sinh viên" onClose={() => { if (!busy) setSelected(null); }}>
      {selected && <div className="question-form">
        {error && <div><p role="alert">{error}</p><Button variant="warning" disabled={busy || loading} onClick={() => { setSelected(null); void load(); }}>Tải lại yêu cầu</Button></div>}
        <dl className="review-details"><div><dt>Họ và tên</dt><dd>{selected.student.full_name}</dd></div><div><dt>MSSV</dt><dd>{selected.student.student_code || 'Chưa cập nhật'}</dd></div><div><dt>Email</dt><dd>{selected.student.email}</dd></div><div><dt>Số điện thoại</dt><dd>{selected.student.phone || 'Chưa cập nhật'}</dd></div></dl>
        <Badge tone={selected.student.is_active ? 'success' : 'neutral'}>{selected.student.is_active ? 'Tài khoản đang hoạt động' : 'Tài khoản đã khóa'}</Badge>
        <p>Kiểm tra họ tên và MSSV theo hồ sơ nhà trường trước khi xác nhận.</p>
        {!selected.student.student_code && <p>MSSV sẽ được bổ sung sau khi sinh viên xác nhận thẻ hợp lệ.</p>}
        <Button variant="outline" disabled={busy} onClick={() => { onEdit(selected.student); setSelected(null); }}>Chỉnh sửa hồ sơ</Button>
        <label>Lý do từ chối<Textarea value={reason} maxLength={500} rows={3} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
        <p>Lý do sẽ hiển thị cho sinh viên. Chỉ nhập hướng dẫn cần thiết để sửa hồ sơ.</p>
        <div className="modal-actions"><Button variant="danger" disabled={busy || !reason.trim()} onClick={() => setRejectConfirm(true)}>Từ chối</Button>
          <Button variant="success" loading={busy} disabled={busy || !selected.student.is_active || selected.student.identity_profile_status !== 'PENDING'} onClick={() => void review(true)}>Xác nhận</Button></div>
      </div>}
    </Modal>
    <ConfirmDialog open={rejectConfirm&&!!selected} title="Từ chối yêu cầu?" description="Sinh viên sẽ nhận lý do từ chối và cần gửi lại hồ sơ." confirmLabel="Từ chối" busy={busy} error={error} onCancel={()=>setRejectConfirm(false)} onConfirm={()=>void review(false)}/>
  </Card>;
}
