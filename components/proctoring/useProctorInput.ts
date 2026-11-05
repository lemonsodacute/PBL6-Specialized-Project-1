'use client';
import { useEffect, type RefObject } from 'react';
import { getSessionToken } from '@/lib/api';

export type GazeCalibrationSample = { timestamp: string; yaw: number | null; pitch: number | null; roll: number | null; gaze_ratio: number | null; face_detected: boolean; raw_direction: string | null };

/** No frame enters React state; no model/cadence means no camera sampling at all. */
export function useProctorInput(attemptId: string | undefined, enabled: boolean, video: RefObject<HTMLVideoElement | null>, onCalibrationEnabled?: (enabled: boolean) => void, onCalibrationSample?: (sample: GazeCalibrationSample) => void) {
  useEffect(() => {
    if (!attemptId || !enabled) return;
    let disposed = false, busy = false, interval = 0, failures = 0, checkedAt = 0, capabilityRequestFailed = false;
    let diagnostics = false, lastWarning = '';
    let timer: ReturnType<typeof setTimeout>, controller: AbortController | null = null;
    const canvas = document.createElement('canvas');
    const path = `/proctoring/sessions/${encodeURIComponent(attemptId)}`;
    const root = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '') + '/api/v1';
    const schedule = (delay: number) => { if (!disposed) timer = setTimeout(tick, delay); };
    // Only fixed categories/statuses: never URLs, attempt IDs, tokens or frame content.
    const warn = (reason: string, status?: number) => {
      if (disposed || lastWarning === reason) return;
      lastWarning = reason; console.warn('[proctor-input]', { reason, status });
    };
    const diagnose = (stage: string, detail: Record<string, unknown> = {}) => {
      if (diagnostics && !disposed) console.info('[proctor-input]', { stage, ...detail });
    };
    const capabilities = async () => {
      checkedAt = Date.now();
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15000);
      try {
        const token = getSessionToken();
        const response = await fetch(root + path + '/input-capabilities', { credentials: 'include',
          signal: controller.signal, headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (disposed) return;
        if (!response.ok) throw new Error(`Input capabilities unavailable (${response.status})`);
        const payload = await response.json() as { data?: { enabled?: boolean; frame_interval_ms?: number | null; gaze_calibration_enabled?: boolean; diagnostics_enabled?: boolean } };
        const result = payload.data;
        if (!result) throw new Error('Input capabilities response was incomplete');
        interval = result.enabled && typeof result.frame_interval_ms === 'number' && result.frame_interval_ms >= 100 ? result.frame_interval_ms : 0;
        diagnostics = Boolean(result.diagnostics_enabled);
        diagnose('capabilities', { enabled: Boolean(interval), frame_interval_ms: interval });
        if (!interval) warn('models_disabled_or_unconfigured');
        capabilityRequestFailed = false;
        onCalibrationEnabled?.(Boolean(result.gaze_calibration_enabled));
      } catch { interval = 0; capabilityRequestFailed = true; warn('capabilities_unavailable'); if (!disposed) onCalibrationEnabled?.(false); }
      finally { clearTimeout(timeout); }
      schedule(interval || (capabilityRequestFailed ? 5000 : 60000));
    };
    const tick = async () => {
      if (disposed || busy) return;
      if (!interval || Date.now() - checkedAt >= 60000) { await capabilities(); return; }
      const source = video.current;
      if (!source || source.readyState < 2 || !source.videoWidth || !source.videoHeight) { diagnose('video_not_ready'); schedule(interval); return; }
      busy = true;
      const started = performance.now();
      try {
        canvas.width = Math.min(source.videoWidth, 640);
        canvas.height = Math.max(1, Math.round(source.videoHeight * canvas.width / source.videoWidth));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Capture unavailable');
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .75));
        if (disposed || !blob) return;
        const form = new FormData(); form.append('frame', blob, 'camera.jpg');
        const token = getSessionToken(); controller = new AbortController();
        const trace = diagnostics ? crypto.randomUUID() : undefined;
        diagnose('frame_send', { trace, width: canvas.width, height: canvas.height, bytes: blob.size });
        const timeout = setTimeout(() => controller?.abort(), 15000);
        try {
          const response = await fetch(root + path + '/frame', { method: 'POST', body: form, credentials: 'include', signal: controller.signal,
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(trace ? { 'X-Proctor-Trace': trace } : {}) } });
          if (disposed) return;
          if ([403, 409].includes(response.status)) {
            const body = await response.json().catch(() => null);
            if (response.status === 409 && body?.error?.code === 'CAMERA_SESSION_REQUIRED') {
              // Session startup runs independently of capture. Keep sampling once it commits.
              warn('camera_session_pending', response.status);
              failures = Math.min(failures + 1, 5); return;
            }
            warn('attempt_inactive_or_forbidden', response.status); disposed = true; return;
          }
          if (response.status === 503) { warn('models_unavailable', response.status); interval = 0; failures = 0; return; }
          if (!response.ok) throw new Error('Monitoring input unavailable');
          const acknowledgement = await response.json();
          diagnose('frame_ack', { trace, processed: acknowledgement?.data?.processed === true, elapsed_ms: Math.round(performance.now() - started) });
          if (acknowledgement?.data?.processed !== true) throw new Error('Monitoring input deferred');
          const sample = acknowledgement?.data?.gaze_calibration_sample;
          if (sample && typeof sample.timestamp === 'string' && typeof sample.face_detected === 'boolean') onCalibrationSample?.(sample as GazeCalibrationSample);
          failures = 0; lastWarning = '';
        } finally { clearTimeout(timeout); }
      } catch { warn('frame_unavailable_or_deferred'); failures = Math.min(failures + 1, 5); }
      finally { busy = false; schedule(Math.max(0, interval - (performance.now() - started), failures ? Math.min(30000, 1000 * 2 ** failures) : 0)); }
    };
    void capabilities();
    return () => {
      disposed = true; clearTimeout(timer); controller?.abort(); canvas.width = canvas.height = 0;
      const token = getSessionToken();
      if (token) void fetch(root + path + '/input', { method: 'DELETE', credentials: 'include', keepalive: true, headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    };
  }, [attemptId, enabled, video, onCalibrationEnabled, onCalibrationSample]);
}
