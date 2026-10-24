'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

function cameraError(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Quyền truy cập thiết bị bị từ chối. Hãy cho phép camera trong cài đặt của trình duyệt rồi thử lại.';
  if (name === 'NotFoundError') return 'Không tìm thấy camera hoặc microphone cần dùng. Hãy kết nối thiết bị rồi thử lại.';
  if (name === 'NotReadableError') return 'Không đọc được thiết bị. Hãy đóng ứng dụng khác đang dùng camera hoặc microphone rồi thử lại.';
  return 'Không thể mở camera. Hãy kiểm tra thiết bị và thử lại.';
}

export function useIdentityCamera() {
  const videoElement = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const opening = useRef(false);
  const [state, setState] = useState<'off' | 'opening' | 'on'>('off');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  const stop = useCallback(() => {
    generation.current += 1;
    opening.current = false;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (videoElement.current) videoElement.current.srcObject = null;
    setReady(false);
    setState('off');
    setError('');
  }, []);

  useEffect(() => () => {
    generation.current += 1;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
  }, []);

  // Bind the stream even when the video mounts after getUserMedia completes.
  const videoRef = useCallback((element: HTMLVideoElement | null) => {
    videoElement.current = element;
    if (element) element.srcObject = stream.current;
  }, []);

  const open = useCallback(async (audio = false) => {
    if (opening.current) return false;
    stop();
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Trình duyệt không hỗ trợ camera ở địa chỉ này. Hãy dùng HTTPS hoặc localhost.');
      return false;
    }
    const request = generation.current;
    opening.current = true;
    setState('opening');
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio });
      if (generation.current !== request) {
        media.getTracks().forEach(track => track.stop());
        return false;
      }
      stream.current = media;
      media.getTracks().forEach(track => track.addEventListener('ended', () => {
        if (generation.current !== request) return;
        stop();
        setError('Kết nối thiết bị đã dừng. Hãy mở lại camera để tiếp tục.');
      }, { once: true }));
      if (videoElement.current) videoElement.current.srcObject = media;
      setState('on');
      return true;
    } catch (cause) {
      if (generation.current === request) { setError(cameraError(cause)); setState('off'); }
      return false;
    } finally {
      if (generation.current === request) opening.current = false;
    }
  }, [stop]);

  const capture = useCallback(async () => {
    const video = videoElement.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !stream.current?.getVideoTracks().some(track => track.readyState === 'live')) {
      throw new Error('Hãy mở camera và chờ hình ảnh xuất hiện trước khi chụp.');
    }
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * ratio);
    canvas.height = Math.round(video.videoHeight * ratio);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Không thể chụp ảnh trên trình duyệt này.');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Không thể chụp ảnh. Vui lòng thử lại.')), 'image/jpeg', 0.9));
  }, []);

  return { videoRef, state, ready, error, open, stop, capture, onReady: () => setReady(true) };
}
