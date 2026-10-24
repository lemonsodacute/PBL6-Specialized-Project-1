'use client';

import { Check, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, LoadingSkeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { CardPreview, CardStatus } from '@/lib/student-card';
import { cardErrorMessages, cardProfileState } from '@/lib/student-card';
import { friendlyError } from '@/lib/uiErrors';
import styles from './StudentCardIdentity.module.css';
import { useAuth } from '@/components/auth/AuthContext';

function debugCard(event: string, metadata: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === 'development') console.debug(event, metadata);
}
function cardError(cause: unknown, fallback: string) {
  return cause instanceof ApiError && cause.code && cardErrorMessages[cause.code]
    ? cardErrorMessages[cause.code] : friendlyError(cause, fallback);
}

export function StudentCardIdentity({ verified }: { verified: boolean }) {
  const { user, refreshProfile } = useAuth();
  const [status, setStatus] = useState<CardStatus | null>(null);
  const [preview, setPreview] = useState<CardPreview | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState<'upload' | 'confirm' | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [error, setError] = useState('');
  const [profileRefreshFailed, setProfileRefreshFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  const [reload, setReload] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const statusVersion = useRef<number | undefined>();
  const statusEpoch = useRef(0);
  const operation = useRef<'upload' | 'confirm' | null>(null);
  const cardState = cardProfileState(status);
  const canUpload = verified && status?.identity_profile_status === 'VERIFIED'
    && ['update', 'invalid', 'not_submitted'].includes(cardState);
  const uploadLabel = cardState === 'update' ? 'Cập nhật thẻ sinh viên'
    : cardState === 'invalid' ? 'Tải thẻ sinh viên mới' : 'Tải thẻ sinh viên';
  useEffect(() => {
    if (user?.avatar_reference_id && user.avatar_reference_id === status?.reference_version) setProfileRefreshFailed(false);
  }, [user?.avatar_reference_id, status?.reference_version]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    const epoch = ++statusEpoch.current;
    setStatusLoading(true);
    api.studentCard.status().then(result => { if (active && epoch === statusEpoch.current) {
      if (statusVersion.current !== undefined && result.card_admin_version !== undefined && statusVersion.current !== result.card_admin_version) setExpired(true);
      statusVersion.current = result.card_admin_version; setStatus(result); if (!status) setError('');
    } })
      .catch(cause => { if (active && epoch === statusEpoch.current) setError(cardError(cause, 'Chưa tải được trạng thái thẻ. Vui lòng thử lại.')); })
      .finally(() => { if (active && epoch === statusEpoch.current) setStatusLoading(false); });
    return () => { active = false; };
  }, [verified, reload]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setReload(value => value + 1); };
    window.addEventListener('focus', refresh); window.addEventListener('student-card-updated', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('student-card-updated', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  useEffect(() => {
    setImages([]);
    setExpired(false);
    if (!preview) return;
    const remaining = new Date(preview.expires_at).getTime() - Date.now();
    if (remaining <= 0) { setExpired(true); return; }
    const controller = new AbortController();
    const urls: string[] = [];
    const timer = window.setTimeout(() => { setExpired(true); setImages([]); controller.abort(); urls.forEach(URL.revokeObjectURL); }, remaining);
    Promise.all([preview.card_preview_url, preview.face_preview_url].map(path => api.studentCard.image(path, controller.signal)))
      .then(blobs => {
        if (controller.signal.aborted) return;
        urls.push(...blobs.map(blob => URL.createObjectURL(blob)));
        setImages([...urls]);
      }).catch(() => { if (!controller.signal.aborted) setError('Chưa tải được ảnh xem trước. Thông tin đọc từ thẻ vẫn được giữ lại. Vui lòng chọn lại ảnh thẻ.'); });
    return () => { window.clearTimeout(timer); controller.abort(); urls.forEach(URL.revokeObjectURL); };
  }, [preview]);

  async function upload(file?: File) {
    if (!file) return;
    debugCard('CARD_FILE_SELECTED', { type: file.type, size: file.size });
    if (!canUpload) { setError('Trạng thái thẻ đã thay đổi. Vui lòng kiểm tra lại trước khi tải ảnh.'); debugCard('CARD_PREVIEW_ERROR', { code: 'CARD_STATE_CHANGED' }); return; }
    if (operation.current) return;
    setError('');
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 8 * 1024 * 1024) {
      setError('Vui lòng chọn ảnh JPG hoặc PNG, tối đa 8 MB.'); debugCard('CARD_PREVIEW_ERROR', { code: 'INVALID_FILE' }); return;
    }
    operation.current = 'upload'; setBusy('upload'); setPreview(null);
    debugCard('CARD_PREVIEW_REQUEST_START');
    try {
      const result = await api.studentCard.preview(file);
      debugCard('CARD_PREVIEW_RESPONSE', { has_name: !!result.extracted.full_name, has_student_code: !!result.extracted.student_code, can_confirm: result.can_confirm, blocking_errors: result.blocking_errors.filter(code => /^[A-Z_]+$/.test(code)), warning_count: result.warnings.length });
      if (alive.current) setPreview(result);
    } catch (cause) {
      debugCard('CARD_PREVIEW_ERROR', { status: cause instanceof ApiError ? cause.status : undefined, code: cause instanceof ApiError && /^[A-Z_]+$/.test(cause.code ?? '') ? cause.code : 'PREVIEW_FAILED' });
      if (alive.current) setError(cardError(cause, 'Không thể đọc thẻ sinh viên. Vui lòng chọn lại ảnh và thử lại.'));
    } finally { operation.current = null; if (alive.current) setBusy(null); }
  }
  async function confirm() {
    if (!canUpload || !preview || !preview.can_confirm || expired || operation.current) return;
    operation.current = 'confirm';
    setBusy('confirm'); setError('');
    try {
      const result = await api.studentCard.confirm(preview.preview_id);
      if (alive.current) { statusEpoch.current++; statusVersion.current = result.card_admin_version; setStatus(result); setStatusLoading(false); setPreview(null); }
      await refreshProfile().then(() => { if (alive.current) setProfileRefreshFailed(false); })
        .catch(() => { if (alive.current) setProfileRefreshFailed(true); });
      if (alive.current) setReload(value => value + 1);
    } catch (cause) {
      if (!alive.current) return;
      setError(cardError(cause, 'Chưa xác nhận được thông tin. Vui lòng thử lại.'));
      if (cause instanceof ApiError && ['PREVIEW_EXPIRED', 'PREVIEW_SUPERSEDED', 'PREVIEW_NOT_FOUND', 'PROFILE_CHANGED', 'PROFILE_NOT_VERIFIED'].includes(cause.code ?? '')) setExpired(true);
    } finally { operation.current = null; if (alive.current) setBusy(null); }
  }

  return <section aria-labelledby="identity-heading" className={styles.section}>
    <h2 id="identity-heading">Xác minh danh tính</h2>
    {(cardState === 'update' || cardState === 'invalid') && <div role="status" className={styles.warning}><strong>{cardState === 'invalid' ? 'Xác thực thẻ không còn hiệu lực' : 'Cần cập nhật thẻ sinh viên'}</strong>{status?.update_reason && <p>Lý do: {status.update_reason}</p>}</div>}
    {!verified ? <><p>Hồ sơ sinh viên của bạn đang chờ xác nhận.</p><p>Bạn cần được xác nhận thông tin sinh viên trước khi tải ảnh thẻ định danh.</p></> : <>
      <Badge tone="success">Hồ sơ sinh viên đã được xác nhận</Badge>
      {statusLoading && !status ? <LoadingSkeleton rows={2} /> : <>
        {cardState === 'verified' ? <div role="status" className={styles.confirmed}><Badge tone="success"><Check className="inline-icon" aria-hidden="true" /> Đã xác thực</Badge><p><Check className="inline-icon" aria-hidden="true" /> Ảnh định danh đã được xác nhận.</p>{status?.updated_at && <p className={styles.updated}>Cập nhật: {new Date(status.updated_at).toLocaleString('vi-VN')}</p>}</div>
          : cardState === 'not_submitted' && !preview && busy !== 'upload' ? <p>Chưa xác thực thẻ sinh viên</p>
          : cardState === 'unavailable' && status ? <p>Chưa xác định được trạng thái xác thực thẻ sinh viên.</p> : null}
        {canUpload && <input ref={input} type="file" accept="image/jpeg,image/png" aria-label="Ảnh thẻ sinh viên" hidden disabled={!!busy}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); }} />
        }
        {canUpload && !preview && busy !== 'upload' && !error && <Button type="button" disabled={!!busy} onClick={() => input.current?.click()}>{uploadLabel}</Button>}
        {busy === 'upload' && <div role="status" aria-live="polite" className={styles.processing}><span className="ui-spinner" aria-hidden="true" /><div><p>Đang kiểm tra thẻ sinh viên...</p><p>Đang đọc thông tin trên thẻ...</p></div></div>}
        {canUpload && preview && <div className={styles.preview}>
          <h3>Xác nhận thông tin thẻ sinh viên</h3>
          {images.length === 2 && <div className={styles.images}><figure><img src={images[0]} alt="Thẻ sinh viên đã tải lên" /><figcaption>Ảnh thẻ sinh viên</figcaption></figure><figure><img src={images[1]} alt="Khuôn mặt được phát hiện" /><figcaption>Khuôn mặt được phát hiện</figcaption></figure></div>}
          <h4>Thông tin hệ thống đọc được</h4>
          <dl className={styles.fields}>{([['Họ và tên', preview.extracted.ocr_display_name ?? preview.extracted.full_name], ['Mã sinh viên', preview.extracted.student_code], ['Ngành', preview.extracted.major], ['Lớp', preview.extracted.class_status === 'CLASS_UNREADABLE' ? null : preview.extracted.class_name]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || (label === 'Lớp' || label === 'Ngành' ? 'Không đọc được' : 'Chưa đọc được')}</dd></div>)}</dl>
          <p>{!preview.extracted.full_name ? 'Chưa đọc rõ họ tên.' : preview.comparison.name_match_type === 'EXACT' ? 'Họ tên khớp chính xác' : preview.comparison.name_match ? 'Họ tên phù hợp sau chuẩn hóa' : 'Họ tên trên thẻ chưa phù hợp với hồ sơ.'}</p>
          {preview.extracted.full_name && preview.comparison.name_match && preview.comparison.name_match_type !== 'EXACT' && <p>Hệ thống có thể chưa nhận chính xác dấu tiếng Việt.</p>}
          {preview.blocking_errors.includes('NAME_LOW_CONFIDENCE') && <p><TriangleAlert className="inline-icon" aria-hidden="true" /> Đã đọc được họ tên nhưng độ tin cậy chưa đủ. Vui lòng tải ảnh rõ nét hơn.</p>}
          <p>{!preview.extracted.student_code || preview.blocking_errors.includes('STUDENT_CODE_UNREADABLE') ? 'Chưa đọc rõ mã sinh viên.' : preview.comparison.student_code_will_update ? 'MSSV sẽ được lưu vào hồ sơ khi xác nhận thẻ.' : preview.comparison.student_code_match ? 'Mã sinh viên khớp' : cardErrorMessages.STUDENT_CODE_MISMATCH}</p>
          {preview.blocking_errors.includes('OCR_FAILED') && <p role="alert">Thông tin chưa đủ rõ. Vui lòng tải ảnh rõ nét hơn.</p>}
          {preview.blocking_errors.filter(code => !['NAME_UNREADABLE', 'NAME_MISMATCH', 'NAME_LOW_CONFIDENCE', 'STUDENT_CODE_UNREADABLE', 'STUDENT_CODE_MISMATCH', 'OCR_FAILED'].includes(code)).map((code, index) => <p role="alert" key={index}>{cardErrorMessages[code] ?? 'Thông tin thẻ chưa đủ điều kiện xác nhận. Vui lòng chọn ảnh rõ nét hơn.'}</p>)}
          {expired ? <p role="alert">Bản xem trước không còn khả dụng. Vui lòng tải lại ảnh thẻ.</p> : <p>Vui lòng kiểm tra lại thông tin trước khi xác nhận. Bản xem trước có hiệu lực 10 phút.</p>}
          <div className={styles.actions}><Button type="button" variant="warning" disabled={!!busy} onClick={() => input.current?.click()}>Chọn ảnh khác</Button><Button type="button" variant="success" loading={busy === 'confirm'} disabled={!!busy || !preview.can_confirm || expired || images.length !== 2} onClick={() => void confirm()}>Xác nhận thẻ sinh viên</Button></div>
        </div>}
        {cardState === 'unavailable' && status && <Button type="button" variant="warning" disabled={!!busy} onClick={() => setReload(value => value + 1)}>Tải lại trạng thái</Button>}
      </>}
      {profileRefreshFailed && <div role="status"><p>Thẻ đã được xác nhận. Chưa tải được thông tin hồ sơ mới.</p><Button type="button" variant="outline" disabled={!!busy} onClick={() => void refreshProfile().then(() => setProfileRefreshFailed(false)).catch(() => undefined)}>Tải lại hồ sơ</Button></div>}
      {error && <div role="alert"><p>{error}</p>{canUpload && !preview && <Button type="button" variant="warning" disabled={!!busy} onClick={() => input.current?.click()}>Chọn ảnh khác</Button>}{!status && !preview && <Button type="button" variant="warning" onClick={() => setReload(value => value + 1)}>Tải lại trạng thái</Button>}</div>}
    </>}
  </section>;
}
