'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
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

export function useStudentWarnings(attemptId: string, enabled: boolean) {
  const [stored, setStored] = useState<StoredWarning[]>([]);
  const [browser, setBrowser] = useState<BrowserWarning[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    setStored([]); setBrowser([]); setDismissed(new Set()); setUnavailable(false);
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
  const recordBrowser = useCallback((event_type: string) => {
    const id = crypto.randomUUID();
    setBrowser(current => [{ id, event_type, delivery: 'pending' as const }, ...current.filter(item => item.event_type !== event_type)].slice(0, 3));
    return id;
  }, []);
  const delivery = useCallback((id: string, value: BrowserWarning['delivery']) => {
    setBrowser(current => current.map(item => item.id === id ? { ...item, delivery: value } : item));
  }, []);
  const dismiss = useCallback((key: string) => setDismissed(current => new Set([...current, key])), []);
  // Updated occurrences can surface again, but repeated polls never reopen a dismissed warning.
  const warnings = [
    ...browser.map(item => ({ key: item.id, type: item.event_type, detail: item.delivery === 'sent' ? 'Đã ghi nhận để giáo viên xem xét.' : item.delivery === 'failed' ? 'Chưa gửi được cảnh báo tới máy chủ. Vui lòng kiểm tra kết nối mạng.' : 'Đang gửi cảnh báo tới máy chủ…' })),
    ...stored.map(item => ({ key: `${item.id}:${item.occurrence_count}`, type: item.event_type, detail: 'Đã ghi nhận để giáo viên xem xét.' })),
  ].filter(item => !dismissed.has(item.key)).slice(0, 5);
  return { warnings, unavailable: enabled && unavailable, recordBrowser, delivery, dismiss };
}

export function StudentWarnings({ state }: { state: ReturnType<typeof useStudentWarnings> }) {
  return <div className={styles.stack} data-camera-avoid>
    <div role="alert" aria-label="Cảnh báo trong bài thi" aria-atomic="true">
      {state.warnings.length > 0 && <section className={styles.panel}>
        <div className={styles.title}><AlertTriangle size={20} aria-hidden="true" /><strong>Cảnh báo giám sát</strong></div>
        <ul className={styles.list}>{state.warnings.map(item => <li key={item.key}>
          <div><strong>{labels[item.type] ?? 'Hoạt động cần chú ý'}</strong><p>{guidance[item.type] ?? 'Vui lòng kiểm tra và tuân thủ quy định của bài thi.'}</p><small>{item.detail}</small></div>
          <button type="button" aria-label={`Đóng cảnh báo ${labels[item.type] ?? 'giám sát'}`} onClick={() => state.dismiss(item.key)}><X size={18} aria-hidden="true" /></button>
        </li>)}</ul>
        <p className={styles.note}>Cảnh báo AI cần giáo viên xem xét, chưa phải kết luận vi phạm.</p>
      </section>}
    </div>
    {state.unavailable && <p className={styles.connection} role="status">Chưa cập nhật được cảnh báo giám sát. Hệ thống đang thử kết nối lại.</p>}
  </div>;
}
