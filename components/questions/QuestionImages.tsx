'use client';

import { useEffect, useState } from 'react';
import { fetchProtectedImage } from '@/lib/api';
import type { QuestionImage } from '@/types';

export function ProtectedDocumentImage({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    setUrl(''); setFailed(false);
    const timer = window.setTimeout(() => { setFailed(true); controller.abort(); }, 20_000);
    void fetchProtectedImage(path, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); }).finally(() => window.clearTimeout(timer));
    return () => { window.clearTimeout(timer); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, retry]);
  return url ? <img src={url} alt={alt} className="question-attachment-image" />
    : failed ? <div className="question-image-error" role="status">Chưa tải được hình ảnh. <button type="button" onClick={() => setRetry(value => value + 1)}>Thử lại</button></div>
    : <p className="field-helper" role="status">Đang tải hình ảnh…</p>;
}

export function QuestionImages({ images, attemptId }: { images?: QuestionImage[] | null; attemptId?: string }) {
  if (!images?.length) return null;
  return <div className="question-attachments" aria-label="Hình ảnh đi kèm câu hỏi">{images.map((image, index) =>
    <figure key={image.id}><ProtectedDocumentImage path={image.preview_url + (attemptId ? `?attempt_id=${encodeURIComponent(attemptId)}` : '')}
      alt={`Hình đi kèm câu hỏi ${index + 1}`} /></figure>)}</div>;
}
