'use client';

import { Check } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { ProfileRequestStatus } from '@/lib/profile-requests';
import { StudentCardIdentity } from './StudentCardIdentity';

export function ProfileIdentitySection({ verified }: { verified: boolean }) {
  const [status, setStatus] = useState<ProfileRequestStatus | null>(null);
  const [loading, setLoading] = useState(!verified);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const working = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const result = await api.profileRequests.status();
      if (mounted.current && request === generation.current) { setStatus(result); setError(''); }
    } catch (cause) {
      if (mounted.current && request === generation.current) setError(cause instanceof Error ? cause.message : 'Chưa tải được trạng thái yêu cầu.');
    } finally { if (mounted.current && request === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (!verified) void load();
    const onFocus = () => { if (!verified && !working.current) void load(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('profile-verification-updated', onFocus);
    return () => { mounted.current = false; generation.current++; window.removeEventListener('focus', onFocus); window.removeEventListener('profile-verification-updated', onFocus); };
  }, [verified, load]);

  async function send() {
    if (working.current || loading || !status || status.verification_request_status === 'PENDING') return;
    working.current = true; generation.current++; setSending(true); setError('');
    try { const result = await api.profileRequests.send(); if (mounted.current) setStatus(result); }
    catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof ApiError && cause.code === 'PROFILE_ALREADY_VERIFIED') await load();
      else setError(cause instanceof Error ? cause.message : 'Chưa gửi được yêu cầu. Vui lòng thử lại.');
    } finally { working.current = false; if (mounted.current) setSending(false); }
  }

  if (verified || status?.identity_profile_status === 'VERIFIED') return <StudentCardIdentity verified />;
  const pending = status?.verification_request_status === 'PENDING';
  const rejected = status?.verification_request_status === 'REJECTED';
  return <section aria-labelledby="identity-heading" style={{ display: 'grid', gap: 12 }}>
    <h2 id="identity-heading">Xác minh danh tính</h2>
    <p>Hồ sơ sinh viên của bạn đang chờ xác nhận.</p>
    <p>Bạn cần được quản trị viên xác nhận thông tin sinh viên trước khi tải ảnh thẻ định danh.</p>
    {pending && <div role="status"><p><Check className="inline-icon" aria-hidden="true" /> Đã gửi yêu cầu xác minh</p><p>Yêu cầu của bạn đang chờ quản trị viên xử lý.</p>
      {status.verification_requested_at && <p>Gửi lúc: {new Date(status.verification_requested_at).toLocaleString('vi-VN')}</p>}</div>}
    {rejected && <div role="status"><p>Yêu cầu xác minh chưa được chấp nhận.</p><p>Lý do: {status.verification_rejection_reason}</p><p>Vui lòng liên hệ quản trị viên để kiểm tra, sửa thông tin hồ sơ trước khi gửi lại.</p></div>}
    <Button
      type="button"
      style={{ justifySelf: 'start' }}
      variant={rejected ? 'warning' : 'primary'}
      loading={sending}
      disabled={loading || sending || pending || !status}
      onClick={() => void send()}
    >
      {sending ? 'Đang gửi yêu cầu...' : loading ? 'Đang tải trạng thái...' : pending ? 'Đã gửi yêu cầu' : rejected ? 'Gửi lại yêu cầu' : 'Gửi yêu cầu xác minh'}
    </Button>
    {error && <div role="alert"><p>{error}</p><Button variant="warning" disabled={sending} onClick={() => { setLoading(true); void load(); }}>Tải lại trạng thái</Button></div>}
  </section>;
}
