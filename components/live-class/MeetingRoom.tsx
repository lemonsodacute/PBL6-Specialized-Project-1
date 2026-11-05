'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, CameraOff, Mic, MicOff, MonitorUp, Hand, Smile, Users, MessageSquare, MoreHorizontal, PhoneOff, ShieldCheck, LayoutGrid, Presentation, Maximize, Settings, X, LockKeyhole, Signal } from 'lucide-react';
import { Button, ConfirmDialog, Input, Modal } from '@/components/ui';
import { useDialogFocus } from '@/components/ui/useDialogFocus';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/uiErrors';
import type { ClassroomPolicy, ClassroomSession, ClassroomTransport, ConnectionState } from '@/lib/classroom';
import { ParticipantTile, ClassroomMediaTrack } from './ParticipantTile';
import { DeviceSettings } from './DeviceSettings';
import { userInitials } from '@/lib/profile';
import { AccountMenu } from '@/components/layout/AccountMenu';
import { useAuth } from '@/components/auth/AuthContext';
import { useRouter } from 'next/navigation';
import { ClassRecordingControls, RecordingIndicator } from './ClassRecordingControls';
import { latestRecordingState } from '@/lib/class-recordings';

type Props = { id: string; session: ClassroomSession; engine: ClassroomTransport; manager: boolean; connection: ConnectionState; busy: boolean; error: (message: string) => void; onSession: (value: ClassroomSession) => void; onMedia: (kind: 'camera' | 'microphone', enabled: boolean) => Promise<void>; onLeave: () => void; onEnd: () => void; attendance: ReactNode; onAttendance: () => void };
const connectionLabels: Record<ConnectionState, string> = { IDLE: 'Sẵn sàng', CONNECTING: 'Đang kết nối…', CONNECTED: 'Đã kết nối', RECONNECTING: 'Đang kết nối lại...', DISCONNECTED: 'Đã ngắt kết nối', ERROR: 'Kết nối chưa thành công' };
const qualityLabels: Record<string, string> = { excellent: 'Tốt', good: 'Trung bình', poor: 'Yếu', lost: 'Mất kết nối' };

function Control({ icon, label, active, disabled, onClick, className = '' }: { icon: ReactNode; label: string; active?: boolean; disabled?: boolean; onClick: () => void; className?: string }) {
  return <button type="button" className={`meeting-control ${active ? 'active' : ''} ${className}`} aria-label={label} title={label} aria-pressed={active} disabled={disabled} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function Elapsed({ start }: { start: string | null }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { const tick = () => setSeconds(start ? Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 1000)) : 0); tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, [start]);
  return <time aria-label="Thời gian buổi học">{[Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':')}</time>;
}

export function MeetingRoom({ id, session, engine, manager, connection, busy, error, onSession, onMedia, onLeave, onEnd, attendance, onAttendance }: Props) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [panel, setPanel] = useState<'participants' | 'chat' | 'attendance'>('participants');
  const [showPanel, setShowPanel] = useState(true);
  const [compact, setCompact] = useState(false);
  const [view, setView] = useState('grid');
  const [menu, setMenu] = useState<'more' | 'host' | 'devices' | 'reactions' | null>(null);
  const [pending, setPending] = useState(false);
  const [pendingPolicy, setPendingPolicy] = useState<Partial<ClassroomPolicy>>({});
  const actionLock = useRef(false);
  const [remove, setRemove] = useState<{ id: string; name: string } | null>(null);
  const [message, setMessage] = useState('');
  const [reconnected, setReconnected] = useState(false);
  const priorConnection = useRef(connection);
  const chatEnd = useRef<HTMLDivElement>(null);
  const panelElement = useRef<HTMLElement>(null);
  const closePanel = useCallback(() => setShowPanel(false), []);
  useDialogFocus(showPanel && compact, panelElement, closePanel);
  const participants = engine.participants().sort((a, b) => Number(b.host) - Number(a.host) || (a.hand && b.hand ? a.hand.localeCompare(b.hand) : Number(Boolean(b.hand)) - Number(Boolean(a.hand))) || a.name.localeCompare(b.name));
  const local = participants.find(participant => participant.local);
  const sharer = participants.find(participant => participant.screen);
  const speaker = participants.find(participant => participant.speaking) || participants.find(participant => participant.host) || participants[0];
  const policy = engine.policy();
  const recording = latestRecordingState(engine.recording(), session.recording);
  const refreshRecording = async () => { const response = await api.liveClasses.get(id); onSession((response as { data: ClassroomSession }).data); };
  const connected = connection === 'CONNECTED';
  const messages = engine.messages();
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1024px)');
    const changed = () => { setCompact(query.matches); if (query.matches) setShowPanel(false); };
    changed(); query.addEventListener('change', changed);
    const saved = localStorage.getItem('classroom-view'); if (saved === 'speaker') setView(saved);
    return () => query.removeEventListener('change', changed);
  }, []);
  useEffect(() => { if (panel === 'chat') chatEnd.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length, panel, showPanel]);
  useEffect(() => {
    if (priorConnection.current === 'RECONNECTING' && connected) setReconnected(true);
    priorConnection.current = connection;
    const timer = setTimeout(() => setReconnected(false), 4000);
    return () => clearTimeout(timer);
  }, [connection, connected]);
  const run = async (work: () => Promise<unknown>, fallback = 'Chưa thực hiện được thao tác. Vui lòng thử lại.') => {
    if (actionLock.current) return;
    actionLock.current = true; setPending(true); error('');
    try { await work(); }
    catch (cause) { error(friendlyError(cause, fallback)); }
    finally { actionLock.current = false; setPending(false); }
  };
  const hostAction = (action: string, participantId?: string) => run(async () => {
    try { const result = await api.liveClasses.action(id, action, participantId); onSession(result.data); }
    // The server may apply removal before its response is lost. Always release
    // this dialog so the error and remaining room controls stay reachable.
    finally { if (action === 'remove') setRemove(null); }
  });
  const changePolicy = async (key: keyof ClassroomPolicy, value: boolean) => {
    setPendingPolicy({ [key]: value });
    try { await run(async () => { const result = await api.liveClasses.policy(id, { [key]: value }); onSession(result.data); }); }
    finally { setPendingPolicy({}); }
  };
  const togglePanel = (next: typeof panel) => { setPanel(next); setShowPanel(next !== panel || !showPanel); if (next === 'attendance') onAttendance(); };
  const share = () => run(async () => { try { await engine.screenShare(!local?.screen); } catch (cause) { if (cause instanceof Error && ['NotAllowedError', 'AbortError'].includes(cause.name)) return; throw cause; } }, 'Không chia sẻ được màn hình. Kiểm tra quyền chia sẻ của trình duyệt.');
  const fullscreen = () => run(async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }, 'Trình duyệt chưa cho phép toàn màn hình.');
  const switchView = () => setView(previous => { const next = previous === 'grid' ? 'speaker' : 'grid'; localStorage.setItem('classroom-view', next); return next; });
  const hand = () => run(() => api.liveClasses.hand(id, !local?.hand));
  const blocked = busy || pending || !connected;
  const canShare = manager || policy.screen_share;
  const canChat = manager || policy.chat;
  const shareLabel = local?.screen ? 'Dừng chia sẻ' : canShare ? 'Chia sẻ màn hình' : 'Giảng viên chưa cho phép chia sẻ màn hình';
  const handLabel = local?.hand ? 'Hạ tay' : 'Giơ tay';

  const panelContent = <><div className="classroom-panel-tabs"><button type="button" className={panel === 'participants' ? 'selected' : ''} onClick={() => setPanel('participants')}>Danh sách ({participants.length})</button><button type="button" className={panel === 'chat' ? 'selected' : ''} onClick={() => setPanel('chat')}>Trò chuyện</button>{manager && <button type="button" className={panel === 'attendance' ? 'selected' : ''} onClick={() => { setPanel('attendance'); onAttendance(); }}>Điểm danh</button>}<button type="button" aria-label="Đóng bảng bên" title="Đóng bảng bên" onClick={closePanel}><X size={18}/></button></div>
    {panel === 'participants' && <div className="meeting-panel-scroll">
      {manager && Boolean(session.waiting?.length) && <section className="meeting-waiting"><h3>Đang chờ ({session.waiting.length})</h3><Button size="sm" disabled={blocked || policy.locked} onClick={() => void hostAction('admit_all')}>Cho tất cả vào</Button>{session.waiting.map(person => <div key={person.id}><strong>{person.name}</strong><div className="meeting-row-actions"><Button size="sm" disabled={blocked || policy.locked} onClick={() => void hostAction('admit', person.id)}>Cho vào</Button><Button size="sm" variant="outline" disabled={blocked} onClick={() => void hostAction('reject', person.id)}>Từ chối</Button></div></div>)}</section>}
      <ul className="classroom-participant-list">{participants.map(person => <li key={person.sid}><div className="meeting-person"><span className="meeting-avatar">{userInitials(person.name)}</span><div><strong>{person.name}{person.local ? ' (Bạn)' : ''}</strong>{person.host && <span className="classroom-teacher-badge">Giảng viên</span>}<small>{person.mic ? 'Mic bật' : 'Mic tắt'} · {person.camera ? 'Camera bật' : 'Camera tắt'}</small>{person.hand && <small className="meeting-hand-order"><Hand size={14}/> Giơ tay lúc {new Date(person.hand).toLocaleTimeString('vi-VN')}</small>}</div></div>{manager && !person.host && !person.local && <details className="meeting-person-menu" name="classroom-participant-actions"><summary aria-label={`Thao tác với ${person.name}`}>⋯</summary><div><button disabled={blocked} onClick={() => void hostAction('mute', person.id)}>Tắt micro</button><button disabled={blocked || !policy.unmute} onClick={() => void hostAction('request_unmute', person.id)}>Yêu cầu bật micro</button>{person.hand && <button disabled={blocked} onClick={() => void hostAction('lower_hand', person.id)}>Hạ tay</button>}<button disabled={blocked} onClick={() => setRemove({ id: person.id, name: person.name })}>Đưa ra khỏi lớp</button></div></details>}</li>)}</ul>
    </div>}
    {panel === 'attendance' && attendance}
    {panel === 'chat' && <><div className="classroom-chat-log" role="log" aria-label="Tin nhắn phòng học">{messages.map(item => <div key={item.id}><strong>{item.name}</strong><time>{new Date(item.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</time><p>{item.text}</p></div>)}{!messages.length && <p>Chưa có tin nhắn. Tin nhắn chỉ lưu trong phiên hiện tại.</p>}<div ref={chatEnd}/></div>{!canChat && <p className="meeting-panel-notice">Giảng viên đã tắt trò chuyện.</p>}<form className="classroom-chat-form" onSubmit={event => { event.preventDefault(); if (canChat && message.trim()) void run(async () => { await engine.chat(message.trim()); setMessage(''); }, 'Chưa gửi được tin nhắn.'); }}><Input aria-label="Tin nhắn" placeholder="Nhắn tin cho lớp..." maxLength={1000} value={message} disabled={!canChat || !connected} onChange={event => setMessage(event.target.value)}/><Button size="sm" type="submit" disabled={blocked || !canChat || !message.trim()}>Gửi</Button></form></>}
  </>;

  return <>
    <header className="meeting-header"><div className="meeting-brand"><img src="/proctoowl-mark.svg" width={28} height={28} alt=""/><div><span className="meeting-context">ProctoOwl · {user?.role === 'student' ? 'Khu vực sinh viên' : user?.role === 'admin' ? 'Khu vực quản trị' : 'Khu vực giảng dạy'}</span><h1>{session.title}</h1><p>{session.class_name} · {session.teacher_name}</p></div></div><div className="meeting-status"><span className="meeting-live">LIVE</span><RecordingIndicator state={recording} /><span>{participants.length} người đang tham gia</span><Elapsed start={session.actual_start}/>{policy.locked && <span title="Lớp đã khóa" aria-label="Lớp đã khóa"><LockKeyhole size={16}/></span>}<span className={`classroom-connection ${connection.toLowerCase()}`} role="status">{reconnected ? 'Đã kết nối lại.' : connectionLabels[connection]}</span>{local && qualityLabels[local.quality] && <span className="meeting-quality" aria-label={`Chất lượng kết nối: ${qualityLabels[local.quality]}`}><Signal size={16}/>{qualityLabels[local.quality]}</span>}{user && <div className="meeting-account"><AccountMenu user={user} onLogout={() => { logout(); router.replace('/login'); }}/></div>}</div></header>
    {engine.audioBlocked() && <Button variant="outline" onClick={() => void run(() => engine.startAudio(), 'Không phát được âm thanh. Kiểm tra loa hoặc tai nghe.')}>Bật âm thanh phòng học</Button>}
    <div className={`classroom-room ${showPanel && !compact ? '' : 'panel-hidden'}`}>
      <main className="classroom-stage">
        {sharer ? <div className="meeting-presentation"><div className="meeting-shared-screen"><p><MonitorUp size={16}/>{sharer.name} đang chia sẻ màn hình</p><ClassroomMediaTrack track={sharer.screen!} label={`Màn hình ${sharer.name}`}/></div><div className="meeting-filmstrip">{participants.map(person => <ParticipantTile key={person.sid} participant={person} teacherId={session.teacher_id}/>)}</div></div> : view === 'speaker' && speaker ? <div className="meeting-speaker"><ParticipantTile participant={speaker} teacherId={session.teacher_id}/><div className="meeting-filmstrip">{participants.filter(person => person.id !== speaker.id).map(person => <ParticipantTile key={person.sid} participant={person} teacherId={session.teacher_id}/>)}</div></div> : <div className="classroom-grid" data-count={Math.min(participants.length, 4)}>{participants.map(person => <ParticipantTile key={person.sid} participant={person} teacherId={session.teacher_id}/>)}</div>}
        {manager && participants.length === 1 && <div className="classroom-waiting"><img src="/proctoowl-mark.svg" width={28} height={28} alt=""/><p>Chưa có sinh viên tham gia.</p></div>}
      </main>
      {showPanel && !compact && <aside className="classroom-panel" aria-label="Bảng lớp học">{panelContent}</aside>}
      {showPanel && compact && <div className="meeting-sheet-scrim" onClick={closePanel}><aside ref={panelElement} tabIndex={-1} className="classroom-panel meeting-sheet" role="dialog" aria-modal="true" aria-label="Bảng lớp học" onClick={event => event.stopPropagation()}>{panelContent}</aside></div>}
    </div>
    <div className="meeting-audio" aria-hidden="true">{participants.map(person => <div key={person.sid} data-audio-participant-id={person.id}>{person.audio && <ClassroomMediaTrack track={person.audio} audio/>}{person.screenAudio && <ClassroomMediaTrack track={person.screenAudio} audio/>}</div>)}</div>
    <footer className="classroom-controls">
      <Control icon={local?.mic ? <Mic/> : <MicOff/>} label={local?.mic ? 'Tắt mic' : 'Bật mic'} active={Boolean(local?.mic)} disabled={blocked || (!manager && !policy.unmute && !local?.mic)} onClick={() => void onMedia('microphone', !local?.mic)}/>
      <Control icon={local?.camera ? <Camera/> : <CameraOff/>} label={local?.camera ? 'Tắt camera' : 'Bật camera'} active={Boolean(local?.camera)} disabled={blocked} onClick={() => void onMedia('camera', !local?.camera)}/>
      <Control className="meeting-secondary-control" icon={<MonitorUp/>} label={shareLabel} active={Boolean(local?.screen)} disabled={blocked || (!canShare && !local?.screen)} onClick={share}/>
      <Control icon={<Hand/>} label={handLabel} active={Boolean(local?.hand)} disabled={blocked} onClick={hand}/>
      <Control className="meeting-secondary-control" icon={<Smile/>} label="Cảm xúc" onClick={() => setMenu('reactions')} disabled={blocked}/>
      <Control className="meeting-secondary-control" icon={<Users/>} label={`Người tham gia (${participants.length})`} active={showPanel && panel === 'participants'} onClick={() => togglePanel('participants')}/>
      <Control icon={<MessageSquare/>} label="Chat" active={showPanel && panel === 'chat'} onClick={() => togglePanel('chat')}/>
      <Control icon={<MoreHorizontal/>} label="Thêm" onClick={() => setMenu('more')}/>
      {manager && <Control className="meeting-secondary-control" icon={<ShieldCheck/>} label="Điều khiển lớp học" onClick={() => setMenu('host')}/>}
      {manager && <ClassRecordingControls id={id} state={recording} disabled={blocked} onChange={refreshRecording} />}
      <Control icon={<PhoneOff/>} label="Rời phòng" className="meeting-leave" onClick={onLeave}/>
      {manager && <Control icon={<PhoneOff/>} label="Kết thúc buổi" className="meeting-end meeting-secondary-control" onClick={onEnd}/>}
    </footer>
    {!manager && !policy.unmute && <p className="meeting-policy-notice" role="status">Giảng viên chưa cho phép sinh viên bật micro.</p>}
    <Modal open={menu === 'more'} title="Tùy chọn lớp học" onClose={() => setMenu(null)}><div className="meeting-menu"><Button variant="outline" onClick={switchView}>{view === 'grid' ? <Presentation size={18}/> : <LayoutGrid size={18}/>} {view === 'grid' ? 'Chế độ người nói' : 'Chế độ lưới'}</Button><Button variant="outline" onClick={fullscreen}><Maximize size={18}/> Toàn màn hình</Button><Button variant="outline" onClick={() => setMenu('devices')}><Settings size={18}/> Thiết bị</Button><Button variant="outline" onClick={() => { setMenu(null); togglePanel('participants'); }}>Người tham gia ({participants.length})</Button><Button variant="outline" disabled={blocked || !canShare} onClick={share}>{shareLabel}</Button><Button variant="outline" disabled={blocked} onClick={() => setMenu('reactions')}>Cảm xúc</Button>{manager && <><Button onClick={() => setMenu('host')}>Điều khiển lớp học</Button><Button variant="danger" onClick={() => { setMenu(null); onEnd(); }}>Kết thúc lớp cho tất cả</Button></>}</div></Modal>
    <Modal open={menu === 'devices'} title="Thiết bị trong lớp" onClose={() => setMenu(null)}><DeviceSettings engine={engine} onError={error}/></Modal>
    <Modal open={menu === 'reactions'} title="Cảm xúc" onClose={() => setMenu(null)}><div className="meeting-reactions">{['👍', '👏', '❤️', '😂', '🎉'].map(emoji => <button key={emoji} aria-label={`Gửi ${emoji}`} disabled={blocked} onClick={() => { void run(() => engine.reaction(emoji)); setMenu(null); }}>{emoji}</button>)}</div></Modal>
    <Modal open={menu === 'host' && manager} title="Điều khiển lớp học" onClose={() => setMenu(null)}><div className="meeting-host-controls">{(Object.entries({ unmute: 'Cho phép sinh viên bật micro', screen_share: 'Cho phép sinh viên chia sẻ màn hình', chat: 'Cho phép trò chuyện', waiting_room: 'Phòng chờ', locked: 'Khóa lớp học' }) as [keyof ClassroomPolicy, string][]).map(([key, label]) => <label key={key}><span>{label}</span><input type="checkbox" checked={pendingPolicy[key] ?? session.policy[key]} disabled={blocked} onChange={event => void changePolicy(key, event.target.checked)}/></label>)}<Button variant="outline" disabled={blocked} onClick={() => void hostAction('mute_all')}>Tắt micro tất cả sinh viên</Button><Button variant="outline" disabled={blocked} onClick={() => void hostAction('lower_all')}>Hạ tất cả tay</Button><Button variant="outline" onClick={() => { setMenu(null); togglePanel('attendance'); }}>Xem điểm danh</Button><Button variant="danger" onClick={() => { setMenu(null); onEnd(); }}>Kết thúc lớp cho tất cả</Button></div></Modal>
    <ConfirmDialog open={Boolean(remove)} title={`Đưa ${remove?.name || 'sinh viên'} ra khỏi lớp?`} description="Bạn có chắc muốn đưa sinh viên này ra khỏi lớp? Sinh viên sẽ không thể tham gia lại buổi này." confirmLabel="Đưa ra khỏi lớp" busy={pending} onCancel={() => setRemove(null)} onConfirm={() => { if (remove) void hostAction('remove', remove.id); }}/>
    <ConfirmDialog open={engine.notice() === 'request_unmute'} title="Giảng viên yêu cầu bật micro" tone="success" description="Bạn có muốn bật microphone để phát biểu?" confirmLabel="Bật micro" onCancel={() => engine.dismissNotice()} onConfirm={() => { engine.dismissNotice(); void onMedia('microphone', true); }}/>
  </>;
}
