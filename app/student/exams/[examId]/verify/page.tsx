'use client';

import { Check, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Badge, Button, Card, LoadingSkeleton, PageHeader } from '@/components/ui';
import { CameraPreview, CapturedImage } from '@/components/identity/CameraPreview';
import { useIdentityCamera } from '@/components/identity/useIdentityCamera';
import { useExamMedia } from '@/components/proctoring/useExamMedia';
import { ExamDeviceSetup } from '@/components/proctoring/ExamDeviceSetup';
import { api, ApiError } from '@/lib/api';
import { entryMismatchMessage, identityError } from '@/lib/identity';
import type { CardStatus } from '@/lib/student-card';
import { formatCalendarDateTime } from '@/lib/calendar-date';

type ExamSettings = { title: string; require_camera: boolean; require_mic?: boolean; start_time?: string; end_time?: string; duration_minutes?: number };
const steps = ['Thiết bị', 'Xác minh khuôn mặt', 'Vào bài thi'];

export default function VerifyExamPage() {
  const { examId } = useParams<{ examId: string }>();
  const router = useRouter();
  const camera = useIdentityCamera();
  const [exam, setExam] = useState<ExamSettings | null>(null);
  const [identity, setIdentity] = useState<CardStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [verified, setVerified] = useState(false);
  const [image, setImage] = useState<Blob | null>(null);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const media = useExamMedia(Boolean(exam?.require_camera), Boolean(exam?.require_mic));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.exams.get(examId);
      const settings = ((response as { data?: ExamSettings }).data ?? response) as ExamSettings;
      const status = settings.require_camera ? await api.studentCard.status() : null;
      setExam(settings);
      setIdentity(status);
    } catch (cause) { setError(identityError(cause)); }
    finally { setLoading(false); }
  }, [examId]);
  useEffect(() => { void load(); }, [load]);

  async function checkDevices() {
    if (!exam || working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      if (exam.require_camera) {
        if (await camera.open(Boolean(exam.require_mic))) setStep(1);
      } else {
        if (exam.require_mic) {
          if (!navigator.mediaDevices?.getUserMedia) throw new Error('Hãy dùng HTTPS hoặc localhost để cấp quyền microphone.');
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(track => track.stop());
        }
        setStep(2);
      }
    } catch { setError('Không thể mở microphone. Hãy kiểm tra thiết bị và cấp quyền truy cập rồi thử lại.'); }
    finally { working.current = false; setBusy(false); }
  }

  async function capture() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    setVerified(false);
    try { setImage(await camera.capture()); }
    catch (cause) { setError(identityError(cause)); }
    finally { working.current = false; setBusy(false); }
  }

  async function verify() {
    if (!image || !consent || working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    setVerified(false);
    try {
      const result = await api.identity.verify(examId, image, consent);
      if (result.verified && result.status === 'verified') {
        setVerified(true);
        setStep(2);
        camera.stop();
      } else setError(result.message);
    } catch (cause) {
      if (cause instanceof ApiError && ['REFERENCE_CHANGED', 'REFERENCE_REQUIRED', 'PROFILE_NOT_VERIFIED'].includes(cause.code ?? '')) {
        camera.stop(); setStep(0); setImage(null); setConsent(false); void load();
      }
      setError(identityError(cause));
    } finally { working.current = false; setBusy(false); }
  }

  async function startAttempt() {
    if (!exam || (exam.require_camera && !verified) || working.current) return;
    if ((exam.require_camera || exam.require_mic) && !media.ready) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      let entryId: string | undefined;
      if (exam.require_camera) {
        // Always capture here; never reuse the initial verification preview/blob.
        const frame = await media.captureFrame();
        const final = await api.identity.verifyEntry(examId, frame, consent);
        if (!final.verified || final.status !== 'verified') {
          setError(entryMismatchMessage);
          return;
        }
        entryId = final.id;
        if (!entryId) throw new Error('Chưa nhận được xác nhận danh tính. Vui lòng thử lại.');
      }
      const response = await api.attempts.start(examId, entryId) as { id?: string; data?: { id?: string } };
      const attemptId = response.data?.id ?? response.id;
      if (!attemptId) throw new Error('Không nhận được mã lượt thi. Vui lòng thử lại.');
      camera.stop();
      media.transferToAttempt(attemptId);
      router.push(`/student/attempts/${attemptId}`);
    } catch (cause) {
      if (cause instanceof ApiError && ['IDENTITY_VERIFICATION_REQUIRED', 'REFERENCE_CHANGED', 'REFERENCE_REQUIRED', 'PROFILE_NOT_VERIFIED'].includes(cause.code ?? '')) {
        setVerified(false);
        setImage(null);
        setConsent(false);
        setStep(0);
        setDevicesOpen(false);
        media.stopStream();
        camera.stop();
        void load();
      }
      setError(identityError(cause));
    } finally { working.current = false; setBusy(false); }
  }

  if (loading) return <div className="workspace-page verify-page"><LoadingSkeleton rows={4} /></div>;
  if (!exam) return <div className="workspace-page verify-page"><Card><p className="form-error" role="alert">{error}</p><Button variant="warning" onClick={() => void load()}>Thử lại</Button><p><Link href="/student/exams">Quay lại danh sách đề thi</Link></p></Card></div>;
  const profileLink = '/student/profile';
  const identityReady = identity?.identity_profile_status === 'VERIFIED' && identity.has_reference;

  return <div className="workspace-page verify-page">
    <PageHeader mode="context" context={exam?.title??'Trước khi thi'}  title="Xác minh danh tính"  actions={<Badge tone="info">Bước {step + 1}/{steps.length}</Badge>} />
    <p className="verify-exam-name">Đề thi: <strong>{exam.title}</strong></p>
    <Card><p>Thời gian mở: {formatCalendarDateTime(exam.start_time)}<br />Hạn làm bài: {formatCalendarDateTime(exam.end_time)}<br />Thời lượng làm bài: {exam.duration_minutes !== undefined ? `${exam.duration_minutes} phút` : 'Chưa có thông tin'}</p></Card>
    <ol className="verify-steps">{steps.map((label, index) => <li className={index <= step ? 'active' : ''} aria-current={index === step ? 'step' : undefined} key={label}>{index + 1}. {index === 1 && !exam.require_camera ? 'Không yêu cầu khuôn mặt' : label}</li>)}</ol>
    <div className="verify-grid"><Card borderRole="users" className="verify-card">
      {exam.require_camera && identityReady && step < 2 && <CameraPreview camera={camera} hint="Nhìn thẳng và giữ khuôn mặt ở giữa khung." />}
      {step === 0 && <><h2>Kiểm tra thiết bị</h2><p>{exam.require_camera ? `Bài thi yêu cầu camera${exam.require_mic ? ' và microphone' : ''}. Hãy chuẩn bị nơi đủ sáng và chỉ một người trước camera.` : exam.require_mic ? 'Bài thi yêu cầu microphone. Hãy cấp quyền để tiếp tục.' : 'Bài thi này không yêu cầu camera, microphone hoặc xác minh khuôn mặt.'}</p>
        {exam.require_camera && !identityReady ? <div className="identity-message warning"><strong>{identity?.identity_profile_status !== 'VERIFIED' ? 'Hồ sơ sinh viên của bạn chưa được xác nhận.' : 'Bạn chưa thiết lập ảnh định danh.'}</strong><p>Vui lòng cập nhật ảnh thẻ sinh viên trong Hồ sơ trước khi tham gia bài thi.</p><Link href={profileLink}>Đi đến Hồ sơ</Link></div> : <Button disabled={busy || camera.state === 'opening'} onClick={() => void checkDevices()}>{busy ? 'Đang kiểm tra…' : exam.require_camera || exam.require_mic ? 'Kiểm tra thiết bị' : 'Tiếp tục'}</Button>}</>}
      {step === 1 && <><h2>Xác minh khuôn mặt</h2><p>Nhìn thẳng vào camera, chụp ảnh rõ mặt rồi gửi xác minh.</p><div className="identity-actions"><Button variant="outline" disabled={busy || camera.state === 'opening'} onClick={() => void camera.open(Boolean(exam.require_mic))}>{camera.state === 'on' ? 'Mở lại camera' : 'Mở camera'}</Button><Button variant={image ? 'warning' : 'primary'} disabled={busy || !camera.ready || camera.state !== 'on'} onClick={() => void capture()}>{image ? 'Chụp lại' : 'Chụp ảnh'}</Button></div>
        {image && <div className="identity-trial-preview"><CapturedImage image={image} alt="Ảnh khuôn mặt để xác minh trước bài thi" /><p>Ảnh sẽ được đối chiếu với ảnh định danh từ thẻ sinh viên đã xác nhận.</p></div>}
        <label className="identity-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /><span>Tôi đồng ý sử dụng ảnh này để xác minh khuôn mặt cho bài thi.</span></label><Button variant="success" disabled={busy || !image || !consent} onClick={() => void verify()}>{busy ? 'Đang xử lý…' : 'Xác minh khuôn mặt'}</Button><Link href={profileLink}>Cập nhật ảnh định danh trong Hồ sơ</Link></>}
      {step === 2 && <><div className="identity-complete-icon" aria-hidden="true"><Check className="inline-icon" aria-hidden="true" /></div><h2>{verified ? 'Xác minh danh tính thành công' : 'Sẵn sàng vào bài'}</h2><p>Hoàn tất xác nhận thiết bị trước khi vào bài. {exam.require_camera ? 'Camera sẽ chụp ảnh mới để xác minh lại ngay khi bạn vào phòng thi. ' : ''}Thời gian làm bài chỉ bắt đầu sau khi các kiểm tra bắt buộc thành công.</p><Button variant="success" disabled={busy || (exam.require_camera && !verified)} onClick={() => { if (exam.require_camera || exam.require_mic) setDevicesOpen(true); else void startAttempt(); }}>{busy ? 'Đang xác minh danh tính...' : 'Bắt đầu làm bài'}</Button></>}
      {!devicesOpen && (error || camera.error) && <div className="identity-message error" role="alert">{error || camera.error}</div>}
    </Card><Card className="verify-guide">
      <h2>Hướng dẫn chuẩn bị</h2>
      {exam.require_camera ? <ol>
        <li><strong>Chọn nơi đủ sáng</strong>Ánh sáng chiếu đều lên mặt, tránh ngồi ngược sáng.</li>
        <li><strong>Nhìn thẳng vào camera</strong>Giữ toàn bộ khuôn mặt trong khung và chờ hình ảnh rõ nét.</li>
        <li><strong>Chỉ một người trong khung</strong>Đảm bảo không có người khác phía sau bạn.</li>
      </ol> : <p>Bài thi này không yêu cầu xác minh khuôn mặt. Hoàn tất bước kiểm tra thiết bị để tiếp tục.</p>}
      {exam.require_mic && <p>Bài thi yêu cầu microphone. Hãy cấp quyền khi trình duyệt hỏi.</p>}
      <p>Bạn chỉ vào bài thi sau khi hoàn tất các bước được yêu cầu.</p>
    </Card></div><ExamDeviceSetup open={devicesOpen} media={media} requireVideo={exam.require_camera} requireAudio={Boolean(exam.require_mic)} verifying={busy} entryError={error} onEnter={() => void startAttempt()} onClose={() => setDevicesOpen(false)} /><p className="identity-return"><Link href="/student/exams"><ArrowLeft className="inline-icon" aria-hidden="true" /> Quay lại danh sách đề thi</Link></p>
  </div>;
}
