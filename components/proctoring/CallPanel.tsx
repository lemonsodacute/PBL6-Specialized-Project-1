"use client";

import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { getWebRtcIceServers } from '@/lib/dataSource';

type CallStatus = 'starting' | 'calling' | 'connected' | 'student-muted' | 'ended' | 'error';
type SignalMessage = { type: 'offer' | 'answer' | 'ice-candidate' | 'call-end'; payload?: RTCSessionDescriptionInit | RTCIceCandidateInit | { audioEnabled?: boolean; videoEnabled?: boolean }; reason?: string; purpose?: 'call' | 'monitor' };
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

function websocketUrl(attemptId: string) {
  const base = API_URL.replace(/^http/, 'ws');
  return `${base}/api/v1/ws/call/${encodeURIComponent(attemptId)}?role=teacher`;
}

function statusLabel(status: CallStatus) {
  return { starting: 'Đang khởi tạo camera/mic...', calling: 'Đang gọi...', connected: 'Đã kết nối', 'student-muted': 'Học sinh đã tắt mic', ended: 'Cuộc gọi đã kết thúc', error: 'Không thể kết nối' }[status];
}

export function CallPanel({ attemptId, studentName, onClose, mode = 'call' }: { attemptId: string; studentName: string; onClose: () => void; mode?: 'call' | 'monitor' }) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const controlChannelRef = useRef<RTCDataChannel | null>(null);
  const [status, setStatus] = useState<CallStatus>('starting');
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [error, setError] = useState('');

  const sendSignal = useCallback((message: SignalMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message));
  }, []);

  const closeCall = useCallback(() => {
    sendSignal({ type: 'call-end' });
    socketRef.current?.close();
    peerRef.current?.close();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    socketRef.current = null;
    peerRef.current = null;
    localStreamRef.current = null;
    onClose();
  }, [onClose, sendSignal]);

  useEffect(() => {
    let disposed = false;
    const start = async () => {
      try {
        const [stream, iceServers] = await Promise.all([
          navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
          getWebRtcIceServers(),
        ]);
        if (disposed) { stream.getTracks().forEach((track) => track.stop()); return; }
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        const peer = new RTCPeerConnection({ iceServers });
        peerRef.current = peer;
        stream.getTracks().forEach((track) => peer.addTrack(track, stream));
        peer.ontrack = (event) => {
          const [remoteStream] = event.streams;
          if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
          setStatus(remoteStream?.getAudioTracks().some((track) => track.readyState === 'live' && track.enabled) ? 'connected' : 'student-muted');
        };
        peer.onicecandidate = (event) => {
          if (event.candidate) sendSignal({ type: 'ice-candidate', payload: event.candidate.toJSON() });
        };
        const controlChannel = peer.createDataChannel('call-control');
        controlChannelRef.current = controlChannel;
        controlChannel.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as { type?: string; audioEnabled?: boolean };
            if (message.type === 'media-state') setStatus(message.audioEnabled === false ? 'student-muted' : 'connected');
          } catch { /* Ignore non-control data. */ }
        };
        const socket = new WebSocket(websocketUrl(attemptId));
        socketRef.current = socket;
        socket.onopen = async () => {
          if (!peerRef.current) return;
          setStatus('calling');
          const offer = await peerRef.current.createOffer();
          await peerRef.current.setLocalDescription(offer);
        sendSignal({ type: 'offer', payload: offer, purpose: mode });
        };
        socket.onmessage = async (event) => {
          const message = JSON.parse(event.data) as SignalMessage;
          if (message.type === 'answer' && message.payload && peerRef.current) await peerRef.current.setRemoteDescription(message.payload as RTCSessionDescriptionInit);
          if (message.type === 'ice-candidate' && message.payload && peerRef.current) await peerRef.current.addIceCandidate(message.payload as RTCIceCandidateInit);
          if (message.type === 'call-end') setStatus(message.reason === 'disconnected' ? 'ended' : 'ended');
        };
        socket.onerror = () => { setError('Không thể kết nối tới phòng gọi.'); setStatus('error'); };
        socket.onclose = () => { if (!disposed) setStatus('ended'); };
      } catch (cause) {
        if (!disposed) { setError(cause instanceof DOMException && cause.name === 'NotAllowedError' ? 'Giáo viên chưa cấp quyền camera/microphone.' : 'Không thể khởi tạo cuộc gọi.'); setStatus('error'); }
      }
    };
    void start();
    return () => {
      disposed = true;
      socketRef.current?.close();
      peerRef.current?.close();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [attemptId, mode, sendSignal]);

  const toggleMic = () => {
    const next = !micEnabled;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = next; });
    setMicEnabled(next);
    controlChannelRef.current?.send(JSON.stringify({ type: 'media-state', audioEnabled: next, videoEnabled: cameraEnabled }));
  };
  const toggleCamera = () => {
    const next = !cameraEnabled;
    localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setCameraEnabled(next);
    controlChannelRef.current?.send(JSON.stringify({ type: 'media-state', audioEnabled: micEnabled, videoEnabled: next }));
  };

  return <Card className="call-panel" role="dialog" aria-label={`${mode === 'monitor' ? 'Camera realtime' : 'Gọi nhắc nhở'} ${studentName}`}>
    <div className="call-panel-header"><div><strong>{mode === 'monitor' ? 'Camera realtime' : 'Gọi nhắc nhở'}</strong><span>{studentName}</span></div><button className="icon-button" onClick={closeCall} aria-label="Đóng"><X className="inline-icon" aria-hidden="true" /></button></div>
    <div className="call-video-stage"><video ref={remoteVideoRef} autoPlay playsInline className="call-remote-video" />{!['connected', 'student-muted'].includes(status) && <span className="call-remote-placeholder">{status === 'calling' ? 'Đang chờ học sinh kết nối...' : 'Chưa nhận được video học sinh'}</span>}<video ref={localVideoRef} autoPlay muted playsInline className="call-local-video" /></div>
    <div className="call-panel-status"><span className={`call-status-dot ${status}`} />{statusLabel(status)}{error && <small>{error}</small>}</div>
    {mode === 'call' && <div className="call-panel-actions"><Button variant="outline" onClick={toggleMic}>{micEnabled ? 'Tắt mic' : 'Bật mic'}</Button><Button variant="outline" onClick={toggleCamera}>{cameraEnabled ? 'Tắt camera' : 'Bật camera'}</Button><Button variant="danger" className="call-end-button" onClick={closeCall}>Kết thúc cuộc gọi</Button></div>}
  </Card>;
}
