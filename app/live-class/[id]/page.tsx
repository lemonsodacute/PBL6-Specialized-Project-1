'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Badge, Button, Card, Input, Modal,ConfirmDialog, Table, PageHeader } from '@/components/ui';
import { api, ApiError, setSessionToken } from '@/lib/api';
import { useAuth } from '@/components/auth/AuthContext';
import { DeviceSetup } from '@/components/live-class/DeviceSetup';
import { ParticipantTile } from '@/components/live-class/ParticipantTile';
import { classroomDate, classroomDuration, classroomListPath, createClassroomTransport, type AttendanceRow, type ClassroomSession, type ClassroomTransport, type ClassroomDevices, type ConnectionState } from '@/lib/classroom';
import { classroomError, ClassroomError, traceClassroom, type ClassroomErrorCode } from '@/lib/classroom-errors';
import { friendlyError } from '@/lib/uiErrors';

type Phase = 'setup' | 'joining' | 'room' | 'failed';
const connectionLabels: Record<ConnectionState, string> = { IDLE: 'Sẵn sàng tham gia', CONNECTING: 'Đang kết nối…', CONNECTED: 'Đã kết nối', RECONNECTING: 'Đang kết nối lại…', DISCONNECTED: 'Đã ngắt kết nối', ERROR: 'Kết nối chưa thành công' };

export default function LiveClassPage() {
  const { id } = useParams<{ id: string }>();
  return <LiveClassRoom key={id} id={id} />;
}

function LiveClassRoom({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [session, setSession] = useState<ClassroomSession | null>(null);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState<ClassroomErrorCode>();
  const [phase, setPhase] = useState<Phase>('setup');
  const [setupKey, setSetupKey] = useState(0);
  const [, render] = useState(0);
  const [showPanel, setShowPanel] = useState(true);
  const [panel, setPanel] = useState<'participants' | 'chat' | 'attendance'>('participants');
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [attendanceError, setAttendanceError] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const transport = useRef<ClassroomTransport | null>(null);
  const mounted = useRef(false);
  const attempt = useRef(0);
  const joined = useRef(false);
  const joining = useRef(false);
  const unsubscribe = useRef<(() => void) | null>(null);
  const cleanup = useRef<Promise<void>>(Promise.resolve());
  const devices = useRef<ClassroomDevices>({ camera: false, microphone: false });
  const deviceDenied = useRef(false);
  const resumeChecked = useRef(false);
  const lastSessionStatus = useRef<string>();
  const resumeKey = `classroom-joined:${user?.id}:${id}`;
  const destination = classroomListPath(user?.role);
  const manager = user?.role === 'admin' || (user?.role === 'teacher' && session?.teacher_id === user.id);

  const release = useCallback(async () => {
    const engine = transport.current;
    transport.current = null;
    unsubscribe.current?.(); unsubscribe.current = null;
    const sid = engine?.localSid();
    if (engine) cleanup.current = (async () => {
      await engine.disconnect();
      if (sid) await api.liveClasses.leave(id, sid).catch(() => {});
    })();
    await cleanup.current;
  }, [id]);
  const leave = useCallback((notice = '') => {
    window.sessionStorage.removeItem(resumeKey);
    attempt.current++;
    void release();
    router.replace(`${destination}${notice ? `?notice=${notice}` : ''}`);
  }, [destination, release, router, resumeKey]);

  useEffect(() => {
    mounted.current = true; joined.current = false;
    const pagehide = () => { attempt.current++; void release(); };
    const pageshow = (event: PageTransitionEvent) => { if (event.persisted) { setPhase('setup'); setSetupKey(v => v + 1); joined.current = false; setError(''); } };
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('pageshow', pageshow);
    return () => { mounted.current = false; attempt.current++; window.removeEventListener('pagehide', pagehide); window.removeEventListener('pageshow', pageshow); void release(); };
  }, [release]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const refresh = async () => {
      try {
        let response;
        try { response = await api.liveClasses.get(id); }
        catch (cause) {
          if (!(cause instanceof ApiError) || cause.status !== 401) throw cause;
          const renewed = await api.auth.refresh();
          // Reuse the existing refresh API; never switch to another tab's user.
          if (!active || (renewed.user as { id?: string } | undefined)?.id !== user.id || !renewed.access_token) throw cause;
          setSessionToken(renewed.access_token);
          response = await api.liveClasses.get(id);
        }
        const detail = (response as { data: ClassroomSession }).data;
        if (!active) return;
        setSession(detail);
        if (lastSessionStatus.current !== detail.status) {
          traceClassroom('session_loaded', { session_id: id, session_status: detail.status });
          lastSessionStatus.current = detail.status;
        }
        if (detail.status !== 'ongoing' && joined.current) leave('ended');
      } catch (cause) {
        if (!active) return;
        if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) {
          leave('access');
        } else {
          const failure = classroomError(cause, 'session');
          setError(failure.message); setErrorCode(failure.code);
          traceClassroom('session_failed', { session_id: id, safe_error_code: failure.code });
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [id, user?.id, leave]);

  useEffect(() => {
    if (!session || !manager || (session.status !== 'ended' && panel !== 'attendance')) return;
    let active = true;
    const refresh = async () => {
      try { const response = await api.liveClasses.attendance(id); if (active) { setAttendance(response.data); setAttendanceError(''); } }
      catch (cause) { if (active) setAttendanceError(friendlyError(cause, 'Không tải được điểm danh.')); }
    };
    void refresh(); const timer = window.setInterval(() => { void refresh(); }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [id, session?.status, manager, panel]);

  const engine = transport.current;
  const connection: ConnectionState = phase === 'failed' ? 'ERROR' : phase === 'joining' ? 'CONNECTING' : engine?.connectionState() || 'IDLE';
  useEffect(() => {
    traceClassroom('connection_state', { session_id: id, session_status: session?.status, connection_state: connection });
  }, [id, session?.status, connection]);
  useEffect(() => {
    if (phase !== 'room' || !engine) return;
    if (connection === 'DISCONNECTED') {
      void api.liveClasses.get(id).then(response => {
        if (!mounted.current || transport.current !== engine) return;
        if ((response as { data: ClassroomSession }).data.status !== 'ongoing') leave('ended');
        else { void release(); const failure = new ClassroomError('REALTIME_CONNECTION_FAILED'); setError(failure.message); setErrorCode(failure.code); setPhase('failed'); }
      }).catch(() => { if (mounted.current && transport.current === engine) { void release(); const failure = new ClassroomError('REALTIME_CONNECTION_FAILED'); setError(failure.message); setErrorCode(failure.code); setPhase('failed'); } });
      return;
    }
    if (connection !== 'CONNECTED') return;
    const confirmPresence = () => {
      void api.liveClasses.join(id, engine.localSid()).catch(cause => {
        if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) leave('access');
        if (cause instanceof ApiError && ['LIVE_CLASS_NOT_ONGOING', 'SESSION_ENDED', 'ROOM_NOT_LIVE'].includes(cause.code || '')) leave('ended');
      });
    };
    confirmPresence(); const timer = window.setInterval(confirmPresence, 20000);
    return () => window.clearInterval(timer);
  }, [phase, connection, engine, id, leave, release]);

  const connect = async () => {
    if (joining.current) return;
    joining.current = true;
    const version = ++attempt.current;
    let stage: 'token' | 'connection' = 'token';
    let tokenStatus: number | 'pending' = 'pending';
    setPhase('joining'); setError(''); setErrorCode(undefined);
    try {
      await release();
      if (!mounted.current || version !== attempt.current) return;
      traceClassroom('token_request', { session_id: id, session_status: session?.status, token_request_status: 'pending' });
      const { data: token } = await api.liveClasses.token(id);
      tokenStatus = 200;
      traceClassroom('token_received', { session_id: id, session_status: session?.status, provider: token.provider, room_name: token.room_name, token_request_status: 200, server_url_configured: Boolean(token.server_url || token.url) });
      if (!mounted.current || version !== attempt.current) return;
      stage = 'connection';
      const next = await createClassroomTransport(token.provider);
      if (!mounted.current || version !== attempt.current) { await next.disconnect(); return; }
      transport.current = next;
      unsubscribe.current = next.subscribe(() => { if (mounted.current && transport.current === next) render(v => v + 1); });
      traceClassroom('provider_connect', { session_id: id, provider: token.provider, room_name: token.room_name, connection_state: 'CONNECTING' });
      await next.connect(token);
      if (!mounted.current || version !== attempt.current) { await next.disconnect(); return; }
      await api.liveClasses.join(id, next.localSid());
      if (!mounted.current || version !== attempt.current) { await next.disconnect(); return; }
      joined.current = true; setPhase('room'); render(v => v + 1);
      window.sessionStorage.setItem(resumeKey, JSON.stringify(devices.current));
      traceClassroom('room_connected', { session_id: id, provider: token.provider, room_name: token.room_name, connection_state: 'CONNECTED' });
      setBusy(true);
      try {
        traceClassroom('publish_devices', { session_id: id, connection_state: 'CONNECTED' });
        await next.publish(devices.current);
        if (deviceDenied.current) throw new ClassroomError('DEVICE_PERMISSION_ERROR');
      } catch (cause) {
        if (!mounted.current || version !== attempt.current) return;
        if (!['CONNECTED', 'RECONNECTING'].includes(next.connectionState())) throw new ClassroomError('REALTIME_CONNECTION_FAILED');
        const failure = classroomError(cause, 'device');
        setError(failure.message); setErrorCode(failure.code);
        traceClassroom('device_failed', { session_id: id, connection_state: next.connectionState(), safe_error_code: failure.code });
      }
    } catch (cause) {
      if (!mounted.current || version !== attempt.current) return;
      await release();
      if (!mounted.current || version !== attempt.current) return;
      const failure = classroomError(cause, stage);
      traceClassroom('join_failed', { session_id: id, token_request_status: stage === 'token' && cause instanceof ApiError ? cause.status : tokenStatus, connection_state: 'ERROR', safe_error_code: failure.code });
      if (failure.code === 'SESSION_ENDED') { leave('ended'); return; }
      setError(failure.message); setErrorCode(failure.code);
      setPhase('failed');
    } finally {
      joining.current = false;
      if (mounted.current && version === attempt.current) setBusy(false);
    }
  };
  const join = async (capture: MediaStream, denied = false) => {
    if (joining.current) return;
    const video = capture.getVideoTracks()[0]; const audio = capture.getAudioTracks()[0];
    devices.current = { camera: Boolean(video), microphone: Boolean(audio), videoDevice: video?.getSettings().deviceId, audioDevice: audio?.getSettings().deviceId };
    deviceDenied.current = denied;
    // Preview is optional; SDK captures are acquired only after room connection.
    capture.getTracks().forEach(track => track.stop());
    await connect();
  };
  useEffect(() => {
    if (!session || !user || resumeChecked.current) return;
    resumeChecked.current = true;
    if (session.status !== 'ongoing') { window.sessionStorage.removeItem(resumeKey); return; }
    const saved = window.sessionStorage.getItem(resumeKey);
    if (!saved) return;
    try {
      const value = JSON.parse(saved);
      devices.current = { camera: value.camera === true, microphone: value.microphone === true,
        videoDevice: typeof value.videoDevice === 'string' ? value.videoDevice : undefined,
        audioDevice: typeof value.audioDevice === 'string' ? value.audioDevice : undefined };
    } catch { window.sessionStorage.removeItem(resumeKey); return; }
    // Only resume a previously joined room in this tab. Never create a session,
    // persist a provider token, or autojoin a room opened for the first time.
    void connect();
    // This one-time resume belongs to the loaded session, not each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.status, user?.id, resumeKey]);
  const media = async (kind: 'camera' | 'microphone', enabled: boolean) => {
    if (!engine || busy) return;
    setBusy(true); setError(''); setErrorCode(undefined);
    try { await engine[kind](enabled); render(v => v + 1); }
    catch (cause) { const failure = classroomError(cause, 'device'); setError(failure.message); setErrorCode(failure.code); traceClassroom('device_failed', { session_id: id, connection_state: connection, safe_error_code: failure.code }); }
    finally { if (mounted.current) setBusy(false); }
  };
  const end = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await api.liveClasses.end(id); setConfirmEnd(false); leave('ended'); }
    catch (cause) { setError(friendlyError(cause, 'Không kết thúc được buổi học. Vui lòng thử lại.')); }
    finally { if (mounted.current) setBusy(false); }
  };
  const send = async () => {
    if (!engine || !message.trim() || busy) return;
    setBusy(true);
    try { await engine.chat(message.trim()); setMessage(''); }
    catch { setError('Chưa gửi được tin nhắn. Vui lòng thử lại.'); }
    finally { if (mounted.current) setBusy(false); }
  };

  if (!session) return <div className="workspace-page"><Card><p role={error ? 'alert' : 'status'}>{error || 'Đang tải phòng học…'}</p><Button variant="outline" onClick={() => leave()}>Quay lại danh sách</Button></Card></div>;
  const participants = engine?.participants() || [];
  const local = participants.find(p => p.local);
  const finished = ['ended', 'cancelled'].includes(session.status);
  return <div className="workspace-page classroom-page" data-connection-state={connection}><PageHeader mode="context" context={session.class_name||'Lớp học trực tuyến'} title={session.title} actions={phase === 'room' && <div className="classroom-header-actions"><Badge>{participants.length} người đang tham gia</Badge><Button variant="outline" size="sm" onClick={() => setShowPanel(v => !v)}>{showPanel ? 'Ẩn người tham gia' : 'Người tham gia'}</Button>{manager && <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirmEnd(true)}>Kết thúc buổi</Button>}</div>}/><p className="detail-meta">{session.description || `Giảng viên: ${session.teacher_name || '—'}`}</p>
    {error && <p className="classroom-alert" role="alert" data-error-code={errorCode}>{error}</p>}
    {session.status !== 'ongoing' ? <><Card><h2>{finished ? 'Buổi học đã kết thúc' : 'Buổi học sắp diễn ra'}</h2><p>{classroomDate(session.scheduled_start)} – {classroomDate(session.scheduled_end)}</p>{session.actual_end && <p>Kết thúc thực tế: {classroomDate(session.actual_end)}</p>}<Button variant="outline" onClick={() => leave()}>Quay lại danh sách</Button></Card>{manager && finished && <AttendanceTable rows={attendance} error={attendanceError} />}</> : <>
      {phase === 'setup' && <DeviceSetup key={setupKey} busy={false} onJoin={join} onLeave={() => leave()} />}
      {phase === 'joining' && <Card><p role="status">Đang kết nối…</p><Button variant="outline" onClick={() => leave()}>Rời phòng</Button></Card>}
      {phase === 'failed' && <Card><h2>Kết nối chưa thành công</h2><div className="classroom-setup-actions"><Button onClick={() => void connect()}>Thử lại</Button><Button variant="outline" onClick={() => leave()}>Rời phòng</Button></div></Card>}
      {phase === 'room' && <><p className={`classroom-connection ${connection.toLowerCase()}`} role="status">{connectionLabels[connection]}</p>{engine?.audioBlocked() && <Button variant="outline" onClick={() => void engine.startAudio().then(() => render(v => v + 1)).catch(() => setError('Không phát được âm thanh. Kiểm tra thiết bị đầu ra.'))}>Bật âm thanh phòng học</Button>}<div className={`classroom-room ${showPanel ? '' : 'panel-hidden'}`}><main className="classroom-stage"><div className="classroom-grid" data-count={Math.min(participants.length, 4)}>{participants.map(participant => <ParticipantTile key={participant.sid} participant={participant} teacherId={session.teacher_id} />)}</div>{manager && participants.length === 1 && <p className="classroom-waiting">Chưa có sinh viên nào trong phòng. Hãy chờ sinh viên tham gia.</p>}<div className="classroom-controls"><Button variant="outline" disabled={busy || connection !== 'CONNECTED'} aria-pressed={Boolean(local?.mic)} onClick={() => void media('microphone', !local?.mic)}>{local?.mic ? 'Tắt mic' : 'Bật mic'}</Button><Button variant="outline" disabled={busy || connection !== 'CONNECTED'} aria-pressed={Boolean(local?.camera)} onClick={() => void media('camera', !local?.camera)}>{local?.camera ? 'Tắt camera' : 'Bật camera'}</Button><Button variant="danger" onClick={() => leave()}>Rời phòng</Button></div></main>{showPanel && <aside className="classroom-panel"><div className="classroom-panel-tabs"><button className={panel === 'participants' ? 'selected' : ''} onClick={() => setPanel('participants')}>Người tham gia ({participants.length})</button><button className={panel === 'chat' ? 'selected' : ''} onClick={() => setPanel('chat')}>Chat</button>{manager && <button className={panel === 'attendance' ? 'selected' : ''} onClick={() => setPanel('attendance')}>Điểm danh</button>}</div>{panel === 'participants' && <ul className="classroom-participant-list">{participants.map(p => <li key={p.sid}><strong>{p.name}{p.local ? ' (Bạn)' : ''}</strong>{p.id === session.teacher_id && <span className="classroom-teacher-badge">Giảng viên</span>}<small>{p.mic ? '● Mic bật' : '○ Mic tắt'} · {p.camera ? '● Camera bật' : '○ Camera tắt'}</small></li>)}</ul>}{panel === 'attendance' && <AttendanceTable rows={attendance} error={attendanceError} compact />}{panel === 'chat' && <><div className="classroom-chat-log" role="log" aria-label="Tin nhắn phòng học">{engine?.messages().map(m => <div key={m.id}><strong>{m.name}</strong><time>{new Date(m.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</time><p>{m.text}</p></div>)}{!engine?.messages().length && <p>Chưa có tin nhắn. Tin nhắn chỉ lưu trong phiên hiện tại.</p>}</div><form className="classroom-chat-form" onSubmit={e => { e.preventDefault(); void send(); }}><Input aria-label="Tin nhắn" placeholder="Nhập tin nhắn…" maxLength={1000} value={message} onChange={e => setMessage(e.target.value)} /><Button type="submit" size="sm" disabled={busy || connection !== 'CONNECTED' || !message.trim()}>Gửi</Button></form></>}</aside>}</div></>}
    </>}
    <ConfirmDialog open={confirmEnd} title="Kết thúc buổi học?" description="Tất cả người tham gia sẽ rời khỏi phòng." confirmLabel="Kết thúc buổi học" busy={busy} error={error} onCancel={()=>setConfirmEnd(false)} onConfirm={()=>void end()}/>
  </div>;
}

function AttendanceTable({ rows, error, compact = false }: { rows: AttendanceRow[]; error: string; compact?: boolean }) {
  return <Card className="classroom-attendance"><h2>Điểm danh buổi học</h2>{error ? <p role="alert">{error}</p> : compact ? <ul className="classroom-participant-list">{rows.map(row => <li key={row.student_id}><strong>{row.full_name}</strong><small>Vào: {classroomDate(row.joined_at)}</small><small>Rời: {row.joined_at && !row.left_at ? 'Đang tham gia' : classroomDate(row.left_at)}</small><small>{row.joined_at ? classroomDuration(row.duration_sec) : 'Chưa tham gia'}</small></li>)}</ul> : <Table><thead><tr><th>Sinh viên</th><th>Vào</th><th>Rời</th><th>Thời lượng</th></tr></thead><tbody>{rows.map(row => <tr key={row.student_id}><td>{row.full_name}</td><td>{classroomDate(row.joined_at)}</td><td>{classroomDate(row.left_at)}</td><td>{row.joined_at ? classroomDuration(row.duration_sec) : 'Chưa tham gia'}</td></tr>)}</tbody></Table>}{!error && !rows.length && <p>Chưa có dữ liệu điểm danh.</p>}</Card>;
}
