"use client";

import { useEffect, useRef, useState } from 'react';
import { Button, Card } from '@/components/ui';
import { getWebRtcIceServers } from '@/lib/dataSource';

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const callUrl = (attemptId: string) => `${API_URL.replace(/^http/, 'ws')}/api/v1/ws/call/${encodeURIComponent(attemptId)}?role=student`;
type SignalMessage = { type: string; payload?: RTCSessionDescriptionInit | RTCIceCandidateInit; reason?: string; purpose?: 'call' | 'monitor' };

export function StudentCallResponder({ attemptId }: { attemptId: string }) {
  const socketRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const callStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const controlChannelRef = useRef<RTCDataChannel | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const [callActive, setCallActive] = useState(false);
  const [passiveMonitor, setPassiveMonitor] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);

  useEffect(() => {
    let disposed = false;
    const socket = new WebSocket(callUrl(attemptId));
    socketRef.current = socket;

    const cleanupPeer = () => {
      if (peerRef.current) { peerRef.current.ontrack = null; peerRef.current.onicecandidate = null; peerRef.current.ondatachannel = null; }
      peerRef.current?.close();
      peerRef.current = null;
      callStreamRef.current?.getTracks().forEach((track) => track.stop());
      callStreamRef.current = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      setCallActive(false);
      setPassiveMonitor(false);
      setMicEnabled(true);
      controlChannelRef.current = null;
      pendingCandidates.current = [];
    };

    socket.onmessage = async (event) => {
      if (disposed) return;
      const message = JSON.parse(event.data) as SignalMessage;
      if (message.type === 'call-end') {
        if (process.env.NODE_ENV === 'development') console.info('[WEBRTC] Teacher ended the call');
        cleanupPeer();
        return;
      }
      if (message.type === 'ice-candidate' && message.payload) {
        if (peerRef.current?.remoteDescription) await peerRef.current.addIceCandidate(message.payload as RTCIceCandidateInit);
        else pendingCandidates.current.push(message.payload as RTCIceCandidateInit);
        return;
      }
      if (message.type !== 'offer' || !message.payload || disposed) return;
      if (process.env.NODE_ENV === 'development') console.info('[WEBRTC] Teacher call received');
      try {
        const iceServers = await getWebRtcIceServers();
        if (disposed) return;
        if (peerRef.current) cleanupPeer();
        setPassiveMonitor(message.purpose === 'monitor');
        const sourceVideo = document.querySelector('.proctor-stream-hidden') as HTMLVideoElement | null;
        const sourceStream = sourceVideo?.srcObject instanceof MediaStream ? sourceVideo.srcObject : null;
        if (!sourceStream) throw new Error('Shared proctoring MediaStream is not ready');
        const peer = new RTCPeerConnection({ iceServers });
        const callStream = new MediaStream(sourceStream.getTracks().map((track) => track.clone()));
        peerRef.current = peer;
        callStreamRef.current = callStream;
        callStream.getTracks().forEach((track) => peer.addTrack(track, callStream));
        peer.onicecandidate = (candidateEvent) => { if (candidateEvent.candidate && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ice-candidate', payload: candidateEvent.candidate.toJSON() })); };
        peer.ondatachannel = (channelEvent) => { controlChannelRef.current = channelEvent.channel; channelEvent.channel.onopen = () => channelEvent.channel.send(JSON.stringify({ type: 'media-state', audioEnabled: true, videoEnabled: true })); };
        peer.ontrack = (trackEvent) => { if (remoteVideoRef.current && trackEvent.streams[0]) { remoteVideoRef.current.srcObject = trackEvent.streams[0]; void remoteVideoRef.current.play().catch(() => undefined); } };
        await peer.setRemoteDescription(message.payload as RTCSessionDescriptionInit);
        if (disposed || peerRef.current !== peer) return;
        for (const candidate of pendingCandidates.current.splice(0)) await peer.addIceCandidate(candidate);
        const answer = await peer.createAnswer();
        if (disposed || peerRef.current !== peer) return;
        await peer.setLocalDescription(answer);
        if (disposed || peerRef.current !== peer || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type: 'answer', payload: answer }));
        setCallActive(true);
      } catch (error) {
        if (disposed) return;
        console.error('[WEBRTC] Call could not connect', { errorType: error instanceof Error ? error.name : 'UnknownError' });
        cleanupPeer();
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'call-end' }));
      }
    };
    socket.onerror = () => console.error('[WEBRTC] Signaling connection failed');
    socket.onclose = () => { if (!disposed) cleanupPeer(); };
    return () => {
      disposed = true;
      socket.onmessage = null; socket.onerror = null; socket.onclose = null;
      socket.close();
      cleanupPeer();
    };
  }, [attemptId]);

  const toggleMic = () => {
    const next = !micEnabled;
    callStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = next; });
    setMicEnabled(next);
    controlChannelRef.current?.send(JSON.stringify({ type: 'media-state', audioEnabled: next, videoEnabled: true }));
  };

  if (!callActive || passiveMonitor) return null;
  return <Card className="student-call-banner" role="status">
    <div className="student-call-heading"><strong>🔔 Giáo viên đang gọi để nhắc nhở bạn</strong><span>Cuộc gọi thoại/video đang diễn ra</span></div>
    <video ref={remoteVideoRef} autoPlay playsInline className="student-call-video" aria-label="Video giáo viên" />
    <div className="student-call-actions"><Button variant="outline" onClick={toggleMic}>{micEnabled ? 'Tắt mic của tôi' : 'Bật mic của tôi'}</Button><span>{micEnabled ? 'Bạn có thể phản hồi giáo viên.' : 'Mic của bạn đang tắt.'}</span></div>
  </Card>;
}
