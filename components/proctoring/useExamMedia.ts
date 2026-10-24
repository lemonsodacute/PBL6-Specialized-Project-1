'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type DeviceStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'not_found' | 'unsupported' | 'lost' | 'error';
export type DeviceInfo = { deviceId: string; label: string };
const preferenceKey = 'proctoring_device_pref';
const live = (track?: MediaStreamTrack) => !!track && track.readyState === 'live' && track.enabled;
const errorStatus = (cause: unknown): DeviceStatus => {
  const name = cause instanceof DOMException ? cause.name : '';
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'not_found' : 'error';
};

// This stream belongs only to the active exam. Device selection does not own cleanup.
export function useExamMedia(requireVideo: boolean, requireAudio: boolean) {
  const streamRef = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const videoElements = useRef(new Set<HTMLVideoElement>());
  const audioContext = useRef<AudioContext | null>(null);
  const animation = useRef<number | null>(null);
  const listeners = useRef<(() => void)[]>([]);
  const preference = useRef({ cameraId: '', microphoneId: '' });
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraStatus, setCameraStatus] = useState<DeviceStatus>('idle');
  const [microphoneStatus, setMicrophoneStatus] = useState<DeviceStatus>('idle');
  const [cameras, setCameras] = useState<DeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<DeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [selectedMicrophone, setSelectedMicrophone] = useState('');
  const [level, setLevel] = useState(0);
  const [lostMessage, setLostMessage] = useState('');

  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    videoElements.current.forEach(item => { if (!item.isConnected) videoElements.current.delete(item); });
    if (element) { videoElements.current.add(element); element.srcObject = streamRef.current; }
  }, []);

  const stopStream = useCallback(() => {
    generation.current++;
    listeners.current.splice(0).forEach(remove => remove());
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    videoElements.current.forEach(element => { element.srcObject = null; });
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
    void audioContext.current?.close().catch(() => undefined);
    audioContext.current = null;
    if (mounted.current) { setStream(null); setLevel(0); setCameraStatus('idle'); setMicrophoneStatus('idle'); setLostMessage(''); }
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!mounted.current) return;
      setCameras(devices.filter(item => item.kind === 'videoinput').map(item => ({ deviceId: item.deviceId, label: item.label || 'Camera' })));
      setMicrophones(devices.filter(item => item.kind === 'audioinput').map(item => ({ deviceId: item.deviceId, label: item.label || 'Microphone' })));
    } catch { /* Enumeration failure does not invalidate active tracks. */ }
  }, []);

  const startMeter = useCallback((media: MediaStream) => {
    if (!media.getAudioTracks().length || typeof AudioContext === 'undefined') return;
    try {
      const context = new AudioContext(); audioContext.current = context;
      const analyser = context.createAnalyser(); analyser.fftSize = 256;
      context.createMediaStreamSource(media).connect(analyser);
      void context.resume().catch(() => undefined);
      const values = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (audioContext.current !== context || !mounted.current) return;
        analyser.getByteTimeDomainData(values);
        const rms = Math.sqrt(values.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / values.length);
        setLevel(Math.min(100, Math.round(rms * 180)));
        animation.current = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* A meter is informational; permission/track readiness is the gate. */ }
  }, []);

  const acquire = useCallback(async (cameraId?: string, microphoneId?: string) => {
    stopStream();
    const request = generation.current;
    const current = () => mounted.current && generation.current === request;
    if (!navigator.mediaDevices?.getUserMedia) {
      if (requireVideo) setCameraStatus('unsupported');
      if (requireAudio) setMicrophoneStatus('unsupported');
      return false;
    }
    const camera = cameraId ?? preference.current.cameraId;
    const microphone = microphoneId ?? preference.current.microphoneId;
    if (requireVideo) setCameraStatus('requesting');
    if (requireAudio) setMicrophoneStatus('requesting');
    const combined = new MediaStream();
    // Separate permission requests make each device's readiness/error truthful.
    for (const kind of ['video', 'audio'] as const) {
      if (!current()) { combined.getTracks().forEach(track => track.stop()); return false; }
      if (kind === 'video' ? !requireVideo : !requireAudio) continue;
      const deviceId = kind === 'video' ? camera : microphone;
      const constraints = deviceId ? { deviceId: { exact: deviceId } } : true;
      try {
        const acquired = await navigator.mediaDevices.getUserMedia({ video: kind === 'video' ? constraints : false, audio: kind === 'audio' ? constraints : false });
        if (!current()) { acquired.getTracks().forEach(track => track.stop()); combined.getTracks().forEach(track => track.stop()); return false; }
        acquired.getTracks().forEach(track => combined.addTrack(track));
        // Register partial acquisitions immediately so exit/switch stops them too.
        streamRef.current = combined;
        const track = kind === 'video' ? acquired.getVideoTracks()[0] : acquired.getAudioTracks()[0];
        (kind === 'video' ? setCameraStatus : setMicrophoneStatus)(live(track) ? 'granted' : 'lost');
      } catch (cause) { if (current()) (kind === 'video' ? setCameraStatus : setMicrophoneStatus)(errorStatus(cause)); }
    }
    if (!current()) { combined.getTracks().forEach(track => track.stop()); return false; }
    streamRef.current = combined;
    setStream(combined);
    const videoTrack = combined.getVideoTracks()[0], audioTrack = combined.getAudioTracks()[0];
    const ids = { cameraId: videoTrack?.getSettings().deviceId || camera, microphoneId: audioTrack?.getSettings().deviceId || microphone };
    preference.current = ids; setSelectedCamera(ids.cameraId); setSelectedMicrophone(ids.microphoneId);
    try { localStorage.setItem(preferenceKey, JSON.stringify(ids)); } catch { /* Optional preference. */ }
    combined.getTracks().forEach(track => {
      const ended = () => {
        if (streamRef.current !== combined || !mounted.current) return;
        (track.kind === 'video' ? setCameraStatus : setMicrophoneStatus)('lost');
        setLostMessage('Kết nối thiết bị đã bị ngắt. Vui lòng kết nối lại và kiểm tra cài đặt thiết bị.');
      };
      track.addEventListener('ended', ended);
      listeners.current.push(() => track.removeEventListener('ended', ended));
    });
    videoElements.current.forEach(element => { if (element.isConnected) element.srcObject = combined; else videoElements.current.delete(element); });
    startMeter(combined); void refreshDevices();
    return (!requireVideo || live(videoTrack)) && (!requireAudio || live(audioTrack));
  }, [requireVideo, requireAudio, refreshDevices, startMeter, stopStream]);

  useEffect(() => {
    mounted.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
      preference.current = { cameraId: typeof saved?.cameraId === 'string' ? saved.cameraId : '', microphoneId: typeof saved?.microphoneId === 'string' ? saved.microphoneId : '' };
    } catch { /* Ignore a malformed/stale preference. */ }
    void refreshDevices();
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    window.addEventListener('pagehide', stopStream);
    return () => {
      mounted.current = false; stopStream(); videoElements.current.clear();
      navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices);
      window.removeEventListener('pagehide', stopStream);
    };
  }, [refreshDevices, stopStream]);

  const cameraReady = cameraStatus === 'granted' && live(stream?.getVideoTracks()[0]);
  const microphoneReady = microphoneStatus === 'granted' && live(stream?.getAudioTracks()[0]);
  const ready = (!requireVideo || cameraReady) && (!requireAudio || microphoneReady);
  const busy = cameraStatus === 'requesting' || microphoneStatus === 'requesting';
  return { stream, cameraStatus, microphoneStatus, cameraReady, microphoneReady, ready, busy, cameras, microphones, selectedCamera, selectedMicrophone, level, lostMessage, acquire, attachVideo, stopStream };
}

export type ExamMedia = ReturnType<typeof useExamMedia>;
