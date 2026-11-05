'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { captureLiveFrame } from '@/components/identity/captureLiveFrame';
import { rememberExamDeviceSetup, takeExamMedia, transferExamMedia } from './examMediaTransfer';

export type DeviceStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'not_found' | 'unsupported' | 'lost' | 'error';
export type DeviceInfo = { deviceId: string; label: string };
const preferenceKey = 'proctoring_device_pref';
const live = (track?: MediaStreamTrack) => !!track && track.readyState === 'live' && track.enabled;
const errorStatus = (cause: unknown): DeviceStatus => {
  const name = cause instanceof DOMException ? cause.name : '';
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'not_found' : 'error';
};

// This stream belongs only to the active exam. Device selection does not own cleanup.
export function useExamMedia(requireVideo: boolean, requireAudio: boolean, attemptId?: string) {
  const streamRef = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const videoElements = useRef(new Set<HTMLVideoElement>());
  const audioContext = useRef<AudioContext | null>(null);
  const animation = useRef<number | null>(null);
  const listeners = useRef<(() => void)[]>([]);
  const preference = useRef({ cameraId: '', microphoneId: '' });
  const entryConfirmed = useRef(false);
  const requirements = useRef({ requireVideo, requireAudio });
  requirements.current = { requireVideo, requireAudio };
  const scope = useRef(attemptId); scope.current = attemptId;
  const permissions = useRef<{ camera?: PermissionState; microphone?: PermissionState }>({});
  const cleanupTimer = useRef<number | null>(null);
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
    entryConfirmed.current = false;
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

  const adoptStream = useCallback((combined: MediaStream, reportStatus = true) => {
    streamRef.current = combined;
    setStream(combined);
    const videoTrack = combined.getVideoTracks()[0], audioTrack = combined.getAudioTracks()[0];
    if (reportStatus) {
      setCameraStatus(live(videoTrack) && !videoTrack?.muted ? 'granted' : videoTrack ? 'lost' : 'idle');
      setMicrophoneStatus(live(audioTrack) && !audioTrack?.muted ? 'granted' : audioTrack ? 'lost' : 'idle');
    }
    combined.getTracks().forEach(track => {
      const changed = () => {
        if (streamRef.current !== combined || !mounted.current) return;
        const kind = track.kind === 'video' ? 'camera' : 'microphone';
        const available = live(track) && !track.muted && permissions.current[kind] !== 'denied';
        (kind === 'camera' ? setCameraStatus : setMicrophoneStatus)(permissions.current[kind] === 'denied' ? 'denied' : available ? 'granted' : 'lost');
        if (!available) setLostMessage('Kết nối thiết bị đã bị ngắt. Vui lòng kết nối lại và kiểm tra cài đặt thiết bị.');
      };
      for (const event of ['ended', 'mute', 'unmute']) {
        track.addEventListener(event, changed);
        listeners.current.push(() => track.removeEventListener(event, changed));
      }
    });
    videoElements.current.forEach(element => { if (element.isConnected) element.srcObject = combined; else videoElements.current.delete(element); });
    startMeter(combined); void refreshDevices();
  }, [refreshDevices, startMeter]);

  const acquire = useCallback(async (cameraId?: string, microphoneId?: string) => {
    if (!mounted.current) return false;
    const { requireVideo, requireAudio } = requirements.current;
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
        (kind === 'video' ? setCameraStatus : setMicrophoneStatus)(live(track) && !track?.muted ? 'granted' : 'lost');
      } catch (cause) { if (current()) (kind === 'video' ? setCameraStatus : setMicrophoneStatus)(errorStatus(cause)); }
    }
    if (!current()) { combined.getTracks().forEach(track => track.stop()); return false; }
    const videoTrack = combined.getVideoTracks()[0], audioTrack = combined.getAudioTracks()[0];
    const ids = { cameraId: videoTrack?.getSettings().deviceId || camera, microphoneId: audioTrack?.getSettings().deviceId || microphone };
    preference.current = ids; setSelectedCamera(ids.cameraId); setSelectedMicrophone(ids.microphoneId);
    try { localStorage.setItem(preferenceKey, JSON.stringify(ids)); } catch { /* Optional preference. */ }
    adoptStream(combined, false);
    return (!requireVideo || live(videoTrack)) && (!requireAudio || live(audioTrack));
  }, [adoptStream, stopStream]);

  const hasRequiredTracks = useCallback((video = requirements.current.requireVideo, audio = requirements.current.requireAudio) => {
    const current = streamRef.current;
    const camera = current?.getVideoTracks()[0], microphone = current?.getAudioTracks()[0];
    return (!video || (permissions.current.camera !== 'denied' && live(camera) && !camera?.muted))
      && (!audio || (permissions.current.microphone !== 'denied' && live(microphone) && !microphone?.muted));
  }, []);
  const confirmEntry = useCallback((video = requirements.current.requireVideo, audio = requirements.current.requireAudio) => {
    if (!scope.current || !hasRequiredTracks(video, audio)) return false;
    entryConfirmed.current = true;
    rememberExamDeviceSetup(scope.current, { camera: video, microphone: audio });
    return true;
  }, [hasRequiredTracks]);
  const restore = useCallback(async () => {
    const { requireVideo, requireAudio } = requirements.current;
    try {
      if (!navigator.permissions?.query) return false;
      const names = [requireVideo && 'camera', requireAudio && 'microphone'].filter(Boolean) as ('camera' | 'microphone')[];
      const states = await Promise.all(names.map(name => navigator.permissions.query({ name: name as PermissionName })));
      // A stored completion flag must never trigger a new permission prompt.
      if (!mounted.current || states.some(status => status.state !== 'granted')) return false;
      if (hasRequiredTracks()) return true;
      return await acquire();
    } catch { return false; }
  }, [acquire, hasRequiredTracks]);

  useEffect(() => {
    let active = true;
    const remove: (() => void)[] = [];
    for (const kind of ['camera', 'microphone'] as const) {
      void navigator.permissions?.query({ name: kind as PermissionName }).then(status => {
        if (!active) return;
        const changed = () => {
          if (!active) return;
          permissions.current[kind] = status.state;
          const track = kind === 'camera' ? streamRef.current?.getVideoTracks()[0] : streamRef.current?.getAudioTracks()[0];
          if (status.state === 'denied') {
            (kind === 'camera' ? setCameraStatus : setMicrophoneStatus)('denied');
            if (track) setLostMessage('Quyền thiết bị đã thay đổi. Vui lòng kiểm tra cài đặt thiết bị.');
          } else if (status.state === 'granted') {
            (kind === 'camera' ? setCameraStatus : setMicrophoneStatus)(live(track) && !track?.muted ? 'granted' : track ? 'lost' : 'idle');
          }
        };
        changed(); status.addEventListener('change', changed);
        remove.push(() => status.removeEventListener('change', changed));
      }).catch(() => { /* Unsupported permission queries do not imply denial or grant. */ });
    }
    return () => { active = false; remove.forEach(callback => callback()); };
  }, []);

  useEffect(() => {
    if (cleanupTimer.current !== null) clearTimeout(cleanupTimer.current);
    const attachedVideos = videoElements.current;
    mounted.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
      preference.current = { cameraId: typeof saved?.cameraId === 'string' ? saved.cameraId : '', microphoneId: typeof saved?.microphoneId === 'string' ? saved.microphoneId : '' };
    } catch { /* Ignore a malformed/stale preference. */ }
    const transferred = attemptId ? takeExamMedia(attemptId) : null;
    if (transferred) {
      entryConfirmed.current = transferred.getTracks().length > 0 && transferred.getTracks().every(live);
      adoptStream(transferred);
      setSelectedCamera(transferred.getVideoTracks()[0]?.getSettings().deviceId || '');
      setSelectedMicrophone(transferred.getAudioTracks()[0]?.getSettings().deviceId || '');
    }
    void refreshDevices();
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    window.addEventListener('pagehide', stopStream);
    return () => {
      mounted.current = false;
      // React's development effect replay must not stop a just-transferred stream.
      cleanupTimer.current = window.setTimeout(() => { stopStream(); attachedVideos.clear(); }, 0);
      navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices);
      window.removeEventListener('pagehide', stopStream);
    };
  }, [refreshDevices, stopStream, attemptId, adoptStream]);

  const captureFrame = useCallback(async (waitForReady = true) => {
    const current = streamRef.current;
    const findVideo = () => [...videoElements.current].find(element => element.isConnected && element.srcObject === current && !element.paused && element.readyState >= 2 && element.videoWidth > 0);
    let video = findVideo();
    const deadline = performance.now() + 2500;
    while (waitForReady && current && !video && mounted.current && streamRef.current === current && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
      video = findVideo();
    }
    if (!current || !video) throw new Error('Hãy bật camera và chờ hình ảnh trực tiếp trước khi xác minh.');
    return captureLiveFrame(video, current);
  }, []);
  const transferToAttempt = useCallback((id: string) => {
    const { requireVideo, requireAudio } = requirements.current;
    const current = streamRef.current;
    if (!current || !hasRequiredTracks(requireVideo, requireAudio)) return false;
    transferExamMedia(id, current);
    rememberExamDeviceSetup(id, { camera: requireVideo, microphone: requireAudio });
    // Detach ownership before unmount; the destination hook owns track cleanup.
    streamRef.current = null;
    stopStream();
    return true;
  }, [hasRequiredTracks, stopStream]);

  const cameraReady = cameraStatus === 'granted' && live(stream?.getVideoTracks()[0]) && !stream?.getVideoTracks()[0]?.muted;
  const microphoneReady = microphoneStatus === 'granted' && live(stream?.getAudioTracks()[0]) && !stream?.getAudioTracks()[0]?.muted;
  const ready = (!requireVideo || cameraReady) && (!requireAudio || microphoneReady);
  useEffect(() => { if (ready) setLostMessage(''); }, [ready]);
  const busy = cameraStatus === 'requesting' || microphoneStatus === 'requesting';
  return { stream, cameraStatus, microphoneStatus, cameraReady, microphoneReady, ready, busy, cameras, microphones, selectedCamera, selectedMicrophone, level, lostMessage, acquire, restore, confirmEntry, hasRequiredTracks, attachVideo, stopStream, captureFrame, transferToAttempt, entryConfirmed };
}

export type ExamMedia = ReturnType<typeof useExamMedia>;
