'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthContext';
import { StudentPageHeader } from '@/components/student/StudentPageHeader';
import { Card, PageHeader, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { friendlyError } from '@/lib/uiErrors';
import { recordingDuration, type RecordingDetail } from '@/lib/class-recordings';

export default function RecordingPlayback() {
  const { id, recordingId } = useParams<{ id: string; recordingId: string }>();
  const { user } = useAuth();
  const [detail, setDetail] = useState<RecordingDetail | null>(null);
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [speed, setSpeed] = useState(1);
  const video = useRef<HTMLVideoElement>(null);
  const seek = useRef(0), resumePlay = useRef(false), lastSaved = useRef(0);
  const key = `class-recording-position:${user?.id}:${recordingId}`;
  useEffect(() => {
    let live = true, renewTimer = 0, revoked = false;
    const revoke = (message: string) => {
      revoked = true;
      if (!live) return;
      setError(message); setUrl('');
      if (video.current) { video.current.pause(); video.current.removeAttribute('src'); video.current.load(); }
    };
    const renew = async () => {
      if (revoked) return;
      try {
        const lease = await api.recordings.playback(recordingId);
        if (!live || revoked) return;
        if (video.current?.currentTime) { seek.current = video.current.currentTime; resumePlay.current = !video.current.paused; }
        setUrl(lease.url);
        renewTimer = window.setTimeout(() => void renew(), Math.max(10000, new Date(lease.expires_at).getTime() - Date.now() - 30000));
      } catch (cause) { revoke(friendlyError(cause, 'Không thể phát bản ghi. Vui lòng mở lại sau.')); }
    };
    const check = async () => {
      try {
        const { data } = await api.recordings.get(recordingId);
        if (data.live_class_id !== id) { revoke('Bản ghi không thuộc buổi học này.'); return; }
        if (live) setDetail(data);
      } catch (cause) {
        if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) revoke('Bản ghi đã được ẩn, hết hạn hoặc bạn không có quyền xem.');
        else if (live) setError(friendlyError(cause, 'Không tải được bản ghi.'));
      }
    };
    try { const saved = Number(localStorage.getItem(key)); if (Number.isFinite(saved) && saved > 0) seek.current = saved; } catch { /* Resume is optional. */ }
    void check().then(() => { if (live && !revoked) void renew(); });
    const timer = window.setInterval(() => void check(), 5000);
    return () => { live = false; window.clearInterval(timer); window.clearTimeout(renewTimer); };
  }, [id, recordingId, key]);
  const save = (force = false) => {
    if (!video.current || (!force && Date.now() - lastSaved.current < 5000)) return;
    lastSaved.current = Date.now();
    try { localStorage.setItem(key, String(video.current.ended ? 0 : Math.floor(video.current.currentTime))); } catch { /* Playback works without local storage. */ }
  };
  return <div className="workspace-page classroom-page classroom-playback-page">
    {user?.role === 'student' ? <StudentPageHeader title="Lớp học trực tuyến" /> : <PageHeader mode="context" title="Bản ghi buổi học" />}
    <nav className="classroom-breadcrumb" aria-label="Đường dẫn bản ghi"><ol><li><Link href={user?.role === 'student' ? '/student/live-classes' : '/dashboard/live-classes'}>Lớp học trực tuyến</Link></li><li><Link href={`/live-class/${id}`}>{detail?.session.title || 'Buổi học'}</Link></li><li aria-current="page">Xem lại</li></ol></nav>
    {error && <Card><p role="alert">{error}</p></Card>}
    {!detail && !error && <p role="status">Đang tải bản ghi…</p>}
    {detail && !error && <Card className="classroom-playback-card">
      {url ? <video ref={video} src={url} controls controlsList="nodownload noremoteplayback" disableRemotePlayback playsInline preload="metadata" aria-label={`Bản ghi ${detail.session.title}`}
        onLoadedMetadata={() => { if (video.current) { if (seek.current > 0 && seek.current < video.current.duration - 2) video.current.currentTime = seek.current; video.current.playbackRate = speed; if (resumePlay.current) void video.current.play().catch(() => {}); } }}
        onTimeUpdate={() => save()} onPause={() => save(true)} onEnded={() => save(true)} onError={() => setError('Không thể phát bản ghi. Vui lòng mở lại trang hoặc kiểm tra kết nối.')} /> : <p role="status">Đang chuẩn bị phát…</p>}
      <div className="classroom-playback-toolbar"><label>Tốc độ phát<Select aria-label="Tốc độ phát" value={speed} onChange={event => { const value = Number(event.target.value); setSpeed(value); if (video.current) video.current.playbackRate = value; }}>{[.75, 1, 1.25, 1.5, 2].map(value => <option value={value} key={value}>{value}x</option>)}</Select></label><span>Thời lượng: {recordingDuration(detail.duration_seconds)}</span></div>
      <h2>{detail.session.title}</h2><p>Giảng viên: {detail.session.teacher_name || '—'}</p><p>Ngày học: {new Date(detail.session.actual_start || detail.session.scheduled_start).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })}</p>
    </Card>}
    <Link className="ui-button ui-button-outline classroom-playback-back" href={`/live-class/${id}`}>Quay lại buổi học</Link>
  </div>;
}
