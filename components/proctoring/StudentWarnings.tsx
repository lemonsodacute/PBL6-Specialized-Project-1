'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { useDialogFocus } from '@/components/ui/useDialogFocus';
import { apiFetch } from '@/lib/api';
import { eventLabels } from '@/lib/proctoring';
import styles from './StudentWarnings.module.css';

type StoredWarning = { id: string; event_type: string; occurred_at: string; occurrence_count: number };
type BrowserWarning = { id: string; event_type: string; delivery: 'pending' | 'sent' | 'failed' };
const guidance: Record<string, string> = {
  object_phone: 'Vui lòng cất điện thoại khỏi khu vực làm bài.',
  object_book: 'Vui lòng cất sách nếu bài thi không cho phép sử dụng tài liệu.',
  object_prohibited: 'Vui lòng kiểm tra và cất vật dụng không được phép sử dụng.',
  face_not_detected: 'Vui lòng ngồi trước camera, để khuôn mặt rõ và đủ sáng.',
  person_left_frame: 'Vui lòng trở lại vị trí trước camera.',
  multiple_faces: 'Vui lòng đảm bảo chỉ có bạn trong khung hình.',
  person_in_background: 'Vui lòng đảm bảo chỉ có bạn trong khung hình.',
  gaze_away: 'Vui lòng tập trung vào màn hình làm bài.',
  head_turned: 'Vui lòng quay lại nhìn màn hình làm bài.',
  tab_switch: 'Vui lòng ở lại trang làm bài, không chuyển sang thẻ khác.',
  window_blur: 'Vui lòng quay lại cửa sổ làm bài.',
  copy: 'Vui lòng không sao chép nội dung trong khi làm bài.',
  paste: 'Vui lòng tự nhập câu trả lời, không dán nội dung từ bên ngoài.',
  right_click: 'Vui lòng không sử dụng menu chuột phải trong khi làm bài.',
  fullscreen_exit: 'Vui lòng bật lại chế độ toàn màn hình để tiếp tục.',
  audio_voice_detected: 'Vui lòng giữ yên lặng và kiểm tra âm thanh xung quanh.',
};
const labels: Record<string, string> = { ...eventLabels, tab_switch: 'Chuyển thẻ trình duyệt', right_click: 'Nhấp chuột phải' };

type StudentWarning = { key: string; type: string; detail: string };
type AcknowledgedWarnings = { attemptId: string; keys: string[]; suppressUntil: Record<string, number> };
const REPEAT_COOLDOWN_MS = 120_000;
const storageKey = (attemptId: string) => `proctoowl:warning-ack:${attemptId}`;

function loadAcknowledgements(attemptId: string): AcknowledgedWarnings {
  const empty = { attemptId, keys: [], suppressUntil: {} };
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey(attemptId)) ?? 'null') as Partial<AcknowledgedWarnings> | null;
    if (!saved || saved.attemptId !== attemptId) return empty;
    return {
      attemptId,
      keys: Array.isArray(saved.keys) ? saved.keys.filter((key): key is string => typeof key === 'string').slice(-2000) : [],
      suppressUntil: saved.suppressUntil && typeof saved.suppressUntil === 'object' ? saved.suppressUntil : {},
    };
  } catch {
    return empty;
  }
}

export function useStudentWarnings(attemptId: string, enabled: boolean) {
  const [stored, setStored] = useState<StoredWarning[]>([]);
  const [browser, setBrowser] = useState<BrowserWarning[]>([]);
  const [acknowledged, setAcknowledged] = useState<AcknowledgedWarnings | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    setStored([]); setBrowser([]); setUnavailable(false);
    setAcknowledged(loadAcknowledgements(attemptId));
  }, [attemptId]);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false, busy = false;
    const refresh = async () => {
      if (disposed || busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const result = await apiFetch<{ data: StoredWarning[] }>(`/proctoring/sessions/${encodeURIComponent(attemptId)}/warnings`, { cache: 'no-store', timeoutMs: 8000 });
        if (!Array.isArray(result.data)) throw new Error('Invalid student warnings');
        if (!disposed) { setStored(result.data); setUnavailable(false); }
      } catch { if (!disposed) setUnavailable(true); }
      finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [attemptId, enabled]);
  useEffect(() => {
    if (acknowledged?.attemptId !== attemptId) return;
    try { sessionStorage.setItem(storageKey(attemptId), JSON.stringify(acknowledged)); }
    catch { /* Warnings still work when browser storage is unavailable. */ }
  }, [attemptId, acknowledged]);

  const recordBrowser = useCallback((event_type: string) => {
    const id = crypto.randomUUID();
    setBrowser(current => [{ id, event_type, delivery: 'pending' as const }, ...current.filter(item => item.event_type !== event_type)].slice(0, 3));
    return id;
  }, []);
  const delivery = useCallback((id: string, value: BrowserWarning['delivery']) => {
    setBrowser(current => current.map(item => item.id === id ? { ...item, delivery: value } : item));
  }, []);
  const allWarnings: StudentWarning[] = [
    ...browser.map(item => ({ key: item.id, type: item.event_type, detail: item.delivery === 'sent' ? 'Đã ghi nhận để giáo viên xem xét.' : item.delivery === 'failed' ? 'Chưa gửi được cảnh báo tới máy chủ. Vui lòng kiểm tra kết nối mạng.' : 'Đang gửi cảnh báo tới máy chủ…' })),
    ...stored.map(item => ({ key: `${item.id}:${item.occurrence_count}`, type: item.event_type, detail: 'Đã ghi nhận để giáo viên xem xét.' })),
  ];

  // Coalesced occurrences during a short cooldown are acknowledged silently.
  // This prevents an old server record from reopening after the cooldown expires.
  useEffect(() => {
    if (!enabled || acknowledged?.attemptId !== attemptId) return;
    const now = Date.now();
    const seen = new Set(acknowledged.keys);
    const suppressed = allWarnings.filter(item => (acknowledged.suppressUntil[item.type] ?? 0) > now && !seen.has(item.key));
    if (!suppressed.length) return;
    setAcknowledged(current => {
      if (!current || current.attemptId !== attemptId) return current;
      const added = suppressed.map(item => item.key).filter(key => !current.keys.includes(key));
      return added.length ? { ...current, keys: [...current.keys, ...added].slice(-2000) } : current;
    });
  }, [attemptId, enabled, acknowledged, stored, browser]);

  const pending = enabled && acknowledged?.attemptId === attemptId
    ? allWarnings.filter(item => !acknowledged.keys.includes(item.key) && (acknowledged.suppressUntil[item.type] ?? 0) <= Date.now())
    : [];
  // Show one compact confirmation dialog, with each distinct warning type at most once.
  const warnings = [...new Map(pending.map(item => [item.type, item] as const)).values()];

  const acknowledge = useCallback(() => {
    if (!pending.length) return;
    const until = Date.now() + REPEAT_COOLDOWN_MS;
    setAcknowledged(current => {
      if (!current || current.attemptId !== attemptId) return current;
      const suppressUntil = { ...current.suppressUntil };
      for (const item of pending) suppressUntil[item.type] = until;
      return { ...current, suppressUntil, keys: [...new Set([...current.keys, ...pending.map(item => item.key)])].slice(-2000) };
    });
  }, [attemptId, pending]);

  return { warnings, unavailable: enabled && unavailable, recordBrowser, delivery, acknowledge };
}

export function StudentWarnings({ state, visible = true }: { state: ReturnType<typeof useStudentWarnings>; visible?: boolean }) {
  const titleId = useId(), descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const open = visible && state.warnings.length > 0 && portalHost !== null;

  // The fullscreen target may differ from document.body. Keep the warning in the fullscreen tree.
  useEffect(() => {
    const updateHost = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element };
      const fullscreen = doc.fullscreenElement ?? doc.webkitFullscreenElement;
      setPortalHost(fullscreen && fullscreen !== document.documentElement ? fullscreen as HTMLElement : document.body);
    };
    updateHost();
    document.addEventListener('fullscreenchange', updateHost);
    document.addEventListener('webkitfullscreenchange', updateHost);
    return () => {
      document.removeEventListener('fullscreenchange', updateHost);
      document.removeEventListener('webkitfullscreenchange', updateHost);
    };
  }, []);

  // The dialog traps keyboard focus. Escape deliberately does nothing until acknowledgement.
  useDialogFocus(open, dialogRef, () => {});

  return <>
    {state.unavailable && <p className={styles.connection} role="status">Chưa cập nhật được cảnh báo giám sát. Hệ thống đang thử kết nối lại.</p>}
    {open && portalHost && createPortal(
      <div className={styles.overlay} data-testid="student-warning-overlay">
        <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} className={styles.dialog} data-camera-avoid>
          <div className={styles.icon}><AlertTriangle size={28} strokeWidth={2} aria-hidden="true" /></div>
          <h2 id={titleId}>Cảnh báo giám sát</h2>
          <div id={descriptionId} className={styles.content}>
            {state.warnings.slice(0, 3).map(item => <div key={item.type} className={styles.item}>
              <strong>{labels[item.type] ?? 'Hoạt động cần chú ý'}</strong>
              <p>{guidance[item.type] ?? 'Vui lòng kiểm tra và tuân thủ quy định của bài thi.'}</p>
              <small>{item.detail}</small>
            </div>)}
            {state.warnings.length > 3 && <p className={styles.more}>Còn {state.warnings.length - 3} loại cảnh báo khác đã được ghi nhận.</p>}
          </div>
          <p className={styles.note}>Đây là tín hiệu cần giáo viên xem xét, chưa phải kết luận gian lận.</p>
          <button className={styles.confirm} type="button" onClick={state.acknowledge}>Đã hiểu, tiếp tục làm bài</button>
        </div>
      </div>,
      portalHost
    )}
  </>;
}
