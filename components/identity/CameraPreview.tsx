'use client';

import { useEffect, useState } from 'react';
import type { useIdentityCamera } from './useIdentityCamera';

export function CapturedImage({ image, alt, className = '' }: { image: Blob; alt: string; className?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(image);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [image]);
  return url ? <img src={url} alt={alt} className={className} /> : null;
}

export function CameraPreview({ camera, hint }: { camera: ReturnType<typeof useIdentityCamera>; hint: string }) {
  return <div className={`identity-camera ${camera.state === 'on' ? 'is-on' : ''}`}>
    <video ref={camera.videoRef} autoPlay muted playsInline onLoadedData={camera.onReady} onPlaying={camera.onReady} aria-label="Hình ảnh trực tiếp từ camera" />
    {camera.state === 'on' ? <><div className="identity-oval" aria-hidden="true" /><span className="identity-live">Camera đang bật</span><p>{hint}</p></> : <div className="identity-camera-placeholder"><span aria-hidden="true">◎</span><strong>{camera.state === 'opening' ? 'Đang chờ quyền truy cập…' : 'Camera chưa bật'}</strong><span>Hình ảnh của bạn sẽ xuất hiện tại đây</span></div>}
  </div>;
}
