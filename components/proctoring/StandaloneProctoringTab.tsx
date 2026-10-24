'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type CaptureStatus = 'idle' | 'requesting-permissions' | 'connecting' | 'streaming' | 'reconnecting' | 'error' | 'stopped';

type Props = {
  /** FastAPI WebSocket endpoint, e.g. ws://localhost:8000/ws/proctoring/{attemptId}. */
  websocketUrl: string;
  attemptId: string;
  /** Optional bearer/session token forwarded in the initial WebSocket message. */
  authToken?: string;
  /** Optional hook for persisting status in the parent exam page. */
  onStatusChange?: (status: CaptureStatus) => void;
  /** The server can accept JSON base64 frames or binary blobs. JSON is the default. */
  frameFormat?: 'base64-json' | 'binary';
};

const FPS = 3;
const FRAME_INTERVAL_MS = 1000 / FPS;
const JPEG_QUALITY = 0.65;
const MAX_RECONNECT_DELAY_MS = 10_000;

/**
 * Standalone webcam + screen proctoring transport.
 *
 * This component intentionally contains transport/capture only. AI inference,
 * violation persistence and exam business rules belong on the FastAPI server.
 * Real WebRTC/Zoom video calling is a separate feature; this sends sampled
 * frames for proctoring analysis.
 */
export function StandaloneProctoringTab({
  websocketUrl,
  attemptId,
  authToken,
  onStatusChange,
  frameFormat = 'base64-json',
}: Props) {
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const webcamCanvasRef = useRef<HTMLCanvasElement>(null);
  const screenCanvasRef = useRef<HTMLCanvasElement>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const captureTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const frameBusyRef = useRef<Set<'webcam' | 'screen'>>(new Set());
  const stoppingRef = useRef(false);
  const startedRef = useRef(false);
  const statusRef = useRef<CaptureStatus>('idle');

  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const updateStatus = useCallback((next: CaptureStatus) => {
    statusRef.current = next;
    setStatus(next);
    onStatusChange?.(next);
  }, [onStatusChange]);

  const stopCaptureTimer = useCallback(() => {
    if (captureTimerRef.current !== null) {
      window.clearInterval(captureTimerRef.current);
      captureTimerRef.current = null;
    }
  }, []);

  const releaseMedia = useCallback(() => {
    webcamStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    webcamStreamRef.current = null;
    screenStreamRef.current = null;
    if (webcamVideoRef.current) webcamVideoRef.current.srcObject = null;
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
  }, []);

  const closeSocket = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.onclose = null;
      socket.close(1000, 'client stopped');
    }
  }, []);

  const blobToBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not encode frame'));
    reader.readAsDataURL(blob);
  });

  const sendFrame = useCallback(async (source: HTMLVideoElement, canvas: HTMLCanvasElement, sourceName: 'webcam' | 'screen') => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || frameBusyRef.current.has(sourceName)) return;
    const width = Math.min(source.videoWidth || 640, 640);
    const height = Math.max(1, Math.round(width * (source.videoHeight || 360) / (source.videoWidth || 640)));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;
    context.drawImage(source, 0, 0, width, height);
    frameBusyRef.current.add(sourceName);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
      if (!blob || socketRef.current !== socket || socket.readyState !== WebSocket.OPEN) return;
      if (frameFormat === 'binary') {
        socket.send(blob);
      } else {
        socket.send(JSON.stringify({ type: 'frame', attempt_id: attemptId, source: sourceName, timestamp: new Date().toISOString(), mime_type: blob.type, data: await blobToBase64(blob) }));
      }
    } finally {
      frameBusyRef.current.delete(sourceName);
    }
  }, [attemptId, frameFormat]);

  const captureFrames = useCallback(() => {
    const webcamVideo = webcamVideoRef.current;
    const screenVideo = screenVideoRef.current;
    const webcamCanvas = webcamCanvasRef.current;
    const screenCanvas = screenCanvasRef.current;
    if (!webcamVideo || !screenVideo || !webcamCanvas || !screenCanvas) return;
    void Promise.all([
      sendFrame(webcamVideo, webcamCanvas, 'webcam'),
      sendFrame(screenVideo, screenCanvas, 'screen'),
    ]);
  }, [sendFrame]);

  const scheduleReconnect = useCallback(() => {
    if (stoppingRef.current || reconnectTimerRef.current !== null) return;
    const attempt = reconnectAttemptRef.current++;
    const delay = Math.min(1000 * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
    updateStatus('reconnecting');
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      void connectSocket();
    }, delay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateStatus]);

  const connectSocket = useCallback(async () => {
    if (stoppingRef.current) return;
    updateStatus(reconnectAttemptRef.current ? 'reconnecting' : 'connecting');
    let socket: WebSocket;
    try {
      socket = new WebSocket(websocketUrl);
    } catch {
      setError('Không thể tạo kết nối WebSocket.');
      scheduleReconnect();
      return;
    }
    socket.binaryType = 'blob';
    socketRef.current = socket;
    socket.onopen = () => {
      reconnectAttemptRef.current = 0;
      setError(null);
      socket.send(JSON.stringify({ type: 'start', attempt_id: attemptId, token: authToken }));
      updateStatus('streaming');
      if (captureTimerRef.current === null) captureTimerRef.current = window.setInterval(captureFrames, FRAME_INTERVAL_MS);
    };
    socket.onmessage = (event) => {
      // FastAPI may send { type: 'error'|'violation'|'ack', ... }.
      try {
        const message = JSON.parse(event.data as string) as { type?: string; message?: string };
        if (message.type === 'error') setError(message.message ?? 'Server proctoring báo lỗi.');
      } catch { /* Non-JSON server messages are ignored. */ }
    };
    socket.onerror = () => setError('Kết nối proctoring gặp lỗi. Đang thử kết nối lại…');
    socket.onclose = () => {
      if (socketRef.current === socket) socketRef.current = null;
      stopCaptureTimer();
      if (!stoppingRef.current) scheduleReconnect();
    };
  }, [attemptId, authToken, captureFrames, scheduleReconnect, stopCaptureTimer, updateStatus, websocketUrl]);

  const start = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    stoppingRef.current = false;
    setError(null);
    updateStatus('requesting-permissions');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices.getDisplayMedia) throw new Error('Trình duyệt không hỗ trợ Media Capture.');
      const webcam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: true });
      webcamStreamRef.current = webcam;
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 5, max: 15 } }, audio: false });
      screenStreamRef.current = screen;
      if (webcamVideoRef.current) { webcamVideoRef.current.srcObject = webcam; await webcamVideoRef.current.play(); }
      if (screenVideoRef.current) { screenVideoRef.current.srcObject = screen; await screenVideoRef.current.play(); }
      const screenTrack = screen.getVideoTracks()[0];
      screenTrack?.addEventListener('ended', () => { setError('Bạn đã dừng chia sẻ màn hình. Hãy bật lại để tiếp tục.'); stopCaptureTimer(); updateStatus('error'); });
      webcam.getTracks().forEach((track) => track.addEventListener('ended', () => { setError('Webcam đã bị dừng hoặc ngắt kết nối.'); updateStatus('error'); }));
      await connectSocket();
      captureTimerRef.current = window.setInterval(captureFrames, FRAME_INTERVAL_MS);
    } catch (cause) {
      releaseMedia();
      startedRef.current = false;
      const message = cause instanceof DOMException && cause.name === 'NotAllowedError' ? 'Bạn cần cấp quyền cả webcam và chia sẻ màn hình để bắt đầu.' : cause instanceof Error ? cause.message : 'Không thể khởi tạo proctoring.';
      setError(message);
      updateStatus('error');
    }
  }, [captureFrames, connectSocket, releaseMedia, stopCaptureTimer, updateStatus]);

  const stop = useCallback(() => {
    stoppingRef.current = true;
    startedRef.current = false;
    stopCaptureTimer();
    closeSocket();
    releaseMedia();
    updateStatus('stopped');
  }, [closeSocket, releaseMedia, stopCaptureTimer, updateStatus]);

  useEffect(() => () => { stoppingRef.current = true; stopCaptureTimer(); closeSocket(); releaseMedia(); }, [closeSocket, releaseMedia, stopCaptureTimer]);

  return <section aria-label="Standalone proctoring" className="standalone-proctoring">
    <video ref={webcamVideoRef} muted playsInline aria-hidden="true" className="proctoring-hidden-video" />
    <video ref={screenVideoRef} muted playsInline aria-hidden="true" className="proctoring-hidden-video" />
    <canvas ref={webcamCanvasRef} aria-hidden="true" className="proctoring-hidden-canvas" />
    <canvas ref={screenCanvasRef} aria-hidden="true" className="proctoring-hidden-canvas" />
    <div><strong>Giám sát phiên thi</strong><span className={`proctoring-status proctoring-status-${status}`}>{status === 'streaming' ? 'Đang truyền webcam + màn hình' : status === 'reconnecting' ? 'Đang kết nối lại…' : status}</span></div>
    {error && <p role="alert" className="proctoring-error">{error}</p>}
    {status === 'idle' || status === 'error' || status === 'stopped' ? <button type="button" onClick={() => void start}>Cho phép webcam và chia sẻ màn hình</button> : <button type="button" onClick={stop}>Dừng giám sát</button>}
  </section>;
}
