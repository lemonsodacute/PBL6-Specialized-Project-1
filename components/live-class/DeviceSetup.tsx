'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, Select } from '@/components/ui';

export function DeviceSetup({ busy, onJoin, onLeave }: { busy: boolean; onJoin: (stream: MediaStream, denied?: boolean) => Promise<void>; onLeave: () => void }) {
  const stream = useRef<MediaStream | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const transferred = useRef(false);
  const mounted = useRef(false);
  const generation = useRef({ video: 0, audio: 0 });
  const captureQueue = useRef({ video: Promise.resolve(), audio: Promise.resolve() });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoId, setVideoId] = useState('');
  const [audioId, setAudioId] = useState('');
  const [camera, setCamera] = useState(false);
  const [microphone, setMicrophone] = useState(false);
  const [loading, setLoading] = useState({ video: true, audio: true });
  const [errors, setErrors] = useState({ video: '', audio: '' });
  const [level, setLevel] = useState(0);
  const refreshDevices = async () => { if (!navigator.mediaDevices) return; const result = await navigator.mediaDevices.enumerateDevices(); if (mounted.current) setDevices(result); };
  const acquire = async (kind: 'video' | 'audio', enabled: boolean, deviceId = '') => {
    const version = ++generation.current[kind];
    stream.current?.getTracks().filter(t => t.kind === kind).forEach(t => { t.stop(); stream.current?.removeTrack(t); });
    (kind === 'video' ? setCamera : setMicrophone)(false);
    setErrors(e => ({ ...e, [kind]: '' }));
    if (!enabled) { setLoading(s => ({ ...s, [kind]: false })); return; }
    setLoading(s => ({ ...s, [kind]: true }));
    // Serialize capture per device. Strict Mode and fast device changes must not
    // stop an obsolete capture while a newer capture uses the same source.
    const previous = captureQueue.current[kind];
    let finish!: () => void;
    captureQueue.current[kind] = new Promise<void>(resolve => { finish = resolve; });
    try {
      await previous;
      if (!mounted.current || version !== generation.current[kind] || transferred.current) return;
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('MEDIA_UNAVAILABLE');
      const capture = await navigator.mediaDevices.getUserMedia({ [kind]: deviceId ? { deviceId: { exact: deviceId } } : true });
      if (!mounted.current || version !== generation.current[kind] || transferred.current) { capture.getTracks().forEach(t => t.stop()); return; }
      capture.getTracks().forEach(track => {
        stream.current?.addTrack(track);
        // Keep the originating capture alive while its track is borrowed by the
        // combined preview and later by the transport.
        track.onended = () => { capture.removeTrack(track); if (mounted.current && !transferred.current && version === generation.current[kind]) { stream.current?.removeTrack(track); (kind === 'video' ? setCamera : setMicrophone)(false); } };
      });
      (kind === 'video' ? setCamera : setMicrophone)(capture.getTracks().every(t => t.readyState === 'live'));
      if (preview.current) preview.current.srcObject = stream.current;
      await refreshDevices();
    } catch (cause) {
      if (!mounted.current || version !== generation.current[kind]) return;
      const name = cause instanceof Error ? cause.name : '';
      setErrors(e => ({ ...e, [kind]: name === 'NotAllowedError' ? 'Bạn chưa cấp quyền. Có thể tham gia với thiết bị này tắt.' : 'Không mở được thiết bị. Kiểm tra kết nối và quyền truy cập của trình duyệt.' }));
    } finally { finish(); if (mounted.current && version === generation.current[kind]) setLoading(s => ({ ...s, [kind]: false })); }
  };
  useEffect(() => {
    mounted.current = true; transferred.current = false; stream.current = new MediaStream();
    // Wait for the mount commit. Strict Mode discards its first effect before
    // this callback runs, so it never opens and immediately stops that camera.
    const initialize = window.setTimeout(() => { void acquire('video', true); void acquire('audio', true); }, 0);
    const changed = () => { void refreshDevices().catch(() => {}); };
    const pagehide = () => { generation.current.video++; generation.current.audio++; stream.current?.getTracks().forEach(t => t.stop()); };
    navigator.mediaDevices?.addEventListener('devicechange', changed);
    window.addEventListener('pagehide', pagehide);
    return () => {
      mounted.current = false; generation.current.video++; generation.current.audio++;
      window.clearTimeout(initialize);
      navigator.mediaDevices?.removeEventListener('devicechange', changed);
      window.removeEventListener('pagehide', pagehide);
      if (!transferred.current) stream.current?.getTracks().forEach(t => t.stop());
      if (preview.current) preview.current.srcObject = null;
    };
    // Device acquisition belongs to this mounted setup, not each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!microphone || !stream.current?.getAudioTracks().length) { setLevel(0); return; }
    const context = new AudioContext();
    const analyser = context.createAnalyser(); analyser.fftSize = 256;
    const source = context.createMediaStreamSource(new MediaStream(stream.current.getAudioTracks())); source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const timer = window.setInterval(() => { analyser.getByteTimeDomainData(samples); const rms = Math.sqrt(samples.reduce((total, x) => total + ((x - 128) / 128) ** 2, 0) / samples.length); setLevel(Math.min(100, rms * 250)); }, 100);
    return () => { window.clearInterval(timer); source.disconnect(); analyser.disconnect(); void context.close(); };
  }, [microphone, audioId]);
  const join = async () => {
    const capture = stream.current;
    if (!capture || transferred.current) return;
    capture.getTracks().filter(t => t.readyState !== 'live').forEach(t => capture.removeTrack(t));
    transferred.current = true;
    await onJoin(capture, Boolean(errors.video || errors.audio));
  };
  return <Card className="classroom-device-card"><h2>Cài đặt thiết bị</h2><p>Kiểm tra camera và mic trước khi vào phòng. Bạn có thể tham gia với camera hoặc mic tắt.</p><div className="classroom-device-layout"><div className="classroom-preview"><video ref={preview} autoPlay muted playsInline aria-label="Xem trước camera" />{!camera && <span>Camera đang tắt</span>}</div><div className="classroom-device-fields"><label>Camera device<Select aria-label="Camera device" value={videoId} disabled={busy || loading.video} onChange={e => { setVideoId(e.target.value); void acquire('video', true, e.target.value); }}><option value="">Camera mặc định</option>{devices.filter(d => d.kind === 'videoinput').map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</Select></label><small role="status">{loading.video ? 'Đang mở camera…' : camera ? 'Camera hoạt động' : 'Camera tắt'}</small>{errors.video && <p role="alert">{errors.video}</p>}<Button variant="outline" disabled={busy || loading.video} onClick={() => void acquire('video', !camera, videoId)}>{camera ? 'Tắt camera' : 'Bật camera'}</Button><label>Microphone<Select aria-label="Microphone device" value={audioId} disabled={busy || loading.audio} onChange={e => { setAudioId(e.target.value); void acquire('audio', true, e.target.value); }}><option value="">Mic mặc định</option>{devices.filter(d => d.kind === 'audioinput').map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}</Select></label><meter min={0} max={100} value={level} aria-label="Mức âm thanh microphone" /><small role="status">{loading.audio ? 'Đang mở mic…' : microphone ? 'Microphone hoạt động' : 'Microphone tắt'}</small>{errors.audio && <p role="alert">{errors.audio}</p>}<Button variant="outline" disabled={busy || loading.audio} onClick={() => void acquire('audio', !microphone, audioId)}>{microphone ? 'Tắt mic' : 'Bật mic'}</Button></div></div><div className="classroom-setup-actions"><Button variant="outline" disabled={busy} onClick={onLeave}>Quay lại danh sách</Button><Button disabled={busy || loading.audio || loading.video} onClick={() => void join()}>{busy ? 'Đang kết nối…' : 'Vào phòng'}</Button></div></Card>;
}
