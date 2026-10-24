'use client';
import { useEffect, type RefObject } from 'react';
import { apiFetch, getSessionToken } from '@/lib/api';

/** No frame enters React state; no model/cadence means no camera sampling at all. */
export function useProctorInput(attemptId: string | undefined, enabled: boolean, video: RefObject<HTMLVideoElement | null>) {
  useEffect(() => {
    if (!attemptId || !enabled) return;
    let disposed = false, busy = false, interval = 0, failures = 0, checkedAt = 0;
    let timer: ReturnType<typeof setTimeout>, controller: AbortController | null = null;
    const canvas = document.createElement('canvas');
    const path = `/proctoring/sessions/${encodeURIComponent(attemptId)}`;
    const root = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '') + '/api/v1';
    const schedule = (delay: number) => { if (!disposed) timer = setTimeout(tick, delay); };
    const capabilities = async () => {
      checkedAt = Date.now();
      try {
        const result = (await apiFetch<{ data: { enabled: boolean; frame_interval_ms: number | null } }>(path + '/input-capabilities')).data;
        interval = result.enabled && typeof result.frame_interval_ms === 'number' && result.frame_interval_ms >= 250 ? result.frame_interval_ms : 0;
      } catch { interval = 0; }
      schedule(interval || 60000);
    };
    const tick = async () => {
      if (disposed || busy) return;
      if (!interval || Date.now() - checkedAt >= 60000) { await capabilities(); return; }
      const source = video.current;
      if (!source || source.readyState < 2 || !source.videoWidth) { schedule(interval); return; }
      busy = true;
      try {
        canvas.width = Math.min(source.videoWidth, 640);
        canvas.height = Math.max(1, Math.round(source.videoHeight * canvas.width / source.videoWidth));
        canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .75));
        if (disposed || !blob) return;
        const form = new FormData(); form.append('frame', blob, 'camera.jpg');
        const token = getSessionToken(); controller = new AbortController();
        const timeout = setTimeout(() => controller?.abort(), 15000);
        try {
          const response = await fetch(root + path + '/frame', { method: 'POST', body: form, credentials: 'include', signal: controller.signal,
            headers: token ? { Authorization: `Bearer ${token}` } : {} });
          if ([403, 409].includes(response.status)) { disposed = true; return; }
          if (response.status === 503) { interval = 0; failures = 0; return; }
          if (!response.ok) throw new Error('Monitoring input unavailable');
          const acknowledgement = await response.json();
          if (acknowledgement?.data?.processed !== true) throw new Error('Monitoring input deferred');
          failures = 0;
        } finally { clearTimeout(timeout); }
      } catch { failures = Math.min(failures + 1, 5); }
      finally { busy = false; schedule(Math.max(interval, failures ? Math.min(30000, 1000 * 2 ** failures) : 0)); }
    };
    void capabilities();
    return () => {
      disposed = true; clearTimeout(timer); controller?.abort(); canvas.width = canvas.height = 0;
      const token = getSessionToken();
      if (token) void fetch(root + path + '/input', { method: 'DELETE', credentials: 'include', keepalive: true, headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    };
  }, [attemptId, enabled, video]);
}
