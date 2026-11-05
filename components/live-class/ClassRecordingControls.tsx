'use client';
import { useEffect, useRef, useState } from 'react';
import { CircleDot, Square } from 'lucide-react';
import { Button, ConfirmDialog } from '@/components/ui';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/uiErrors';
import { recordingDuration, type RecordingState } from '@/lib/class-recordings';

export function RecordingIndicator({ state }: { state?: RecordingState | null }) {
  const [elapsed, setElapsed] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const seen = useRef(new Set<string>());
  const initial = useRef(Boolean(state?.active));
  useEffect(() => {
    if (!state?.active || !state.id) return;
    if (!seen.current.has(state.id)) {
      seen.current.add(state.id);
      setAnnouncement(initial.current ? 'Buổi học này đang được ghi hình.' : 'Giảng viên đã bắt đầu ghi lại buổi học.');
      initial.current = false;
    }
  }, [state?.id, state?.active]);
  useEffect(() => {
    if (!state?.active || !state.started_at) return;
    const start = new Date(state.started_at).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick(); const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [state?.active, state?.started_at]);
  useEffect(() => {
    if (!announcement) return;
    const timer = window.setTimeout(() => setAnnouncement(''), 7000);
    return () => window.clearTimeout(timer);
  }, [announcement]);
  return <>{state?.active && <span className="classroom-recording-indicator" aria-label="Đang ghi hình"><i aria-hidden="true" />Đang ghi hình <time>{recordingDuration(elapsed)}</time></span>}
    <span className="classroom-recording-announcement" role="status" aria-live="polite">{announcement}</span></>;
}

export function ClassRecordingControls({ id, state, disabled, menu = false, onChange }: {
  id: string; state?: RecordingState | null; disabled: boolean; menu?: boolean; onChange: () => Promise<void>;
}) {
  const [available, setAvailable] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = state?.status === 'STARTING' || state?.status === 'RECORDING';
  const failure = error || (state?.status === 'FAILED' ? 'Không thể xử lý bản ghi.' : '');
  useEffect(() => {
    let live = true;
    const refresh = () => void api.liveClasses.recordings(id).then(({ data }) => { if (live) setAvailable(data.available); }).catch(() => { if (live) setAvailable(false); });
    refresh(); const timer = window.setInterval(refresh, 15000);
    return () => { live = false; window.clearInterval(timer); };
  }, [id]);
  const change = async (start: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (start) await api.liveClasses.startRecording(id); else await api.liveClasses.stopRecording(id);
      await onChange(); setConfirm(false);
    } catch (cause) { setError(friendlyError(cause, 'Không thay đổi được trạng thái ghi hình. Vui lòng thử lại.')); }
    finally { setBusy(false); }
  };
  return <div className={menu ? 'classroom-recording-menu' : 'meeting-recording-controls'}>
    {active ? <Button className={menu ? '' : 'meeting-control'} variant="outline" disabled={disabled || busy} aria-label="Dừng ghi" onClick={() => void change(false)}><Square size={18} aria-hidden="true" /><span>{busy ? 'Đang dừng…' : 'Dừng ghi'}</span></Button>
      : <Button className={menu ? '' : 'meeting-control'} variant="outline" disabled={disabled || busy || !available} aria-label={available ? 'Bắt đầu ghi hình' : 'Ghi hình hiện không khả dụng.'} title={available ? 'Bắt đầu ghi hình' : 'Ghi hình hiện không khả dụng.'} onClick={() => setConfirm(true)}><CircleDot size={18} aria-hidden="true" /><span>{available ? menu ? 'Bắt đầu ghi hình' : 'Ghi hình' : 'Chưa khả dụng'}</span></Button>}
    {menu && !available && !active && <p>Ghi hình hiện không khả dụng.</p>}
    {failure && !confirm && <p role="alert" className="classroom-recording-error">{failure}</p>}
    <ConfirmDialog open={confirm} title="Ghi lại buổi học?" description="Âm thanh, hình ảnh và nội dung chia sẻ màn hình của buổi học có thể được lưu lại để sinh viên xem sau." confirmLabel="Bắt đầu ghi" busy={busy} error={error} onCancel={() => setConfirm(false)} onConfirm={() => void change(true)} />
  </div>;
}
