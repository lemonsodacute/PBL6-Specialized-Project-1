'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, ConfirmDialog } from '@/components/ui';
import { ProctoOwlMascot } from '@/components/brand/ProctoOwlMascot';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/uiErrors';
import { recordingDuration, recordingLabels, type ClassRecording, type RecordingList } from '@/lib/class-recordings';

export function ClassRecordingsSection({ id, manager }: { id: string; manager: boolean }) {
  const [result, setResult] = useState<RecordingList | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ row: ClassRecording; action: 'publish' | 'delete' } | null>(null);
  const load = useCallback(async () => {
    const response = await api.liveClasses.recordings(id);
    setResult(response.data); setError('');
  }, [id]);
  useEffect(() => {
    let live = true;
    const refresh = () => void api.liveClasses.recordings(id).then(({ data }) => { if (live) { setResult(data); setError(''); } }).catch(cause => { if (live) setError(friendlyError(cause, 'Không tải được bản ghi.')); });
    refresh(); const timer = window.setInterval(refresh, 5000);
    return () => { live = false; window.clearInterval(timer); };
  }, [id]);
  const change = async (row: ClassRecording, action: 'publish' | 'unpublish' | 'delete') => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await api.recordings[action](row.id);
      setNotice('cleanup_pending' in response.data && response.data.cleanup_pending ? 'Quyền xem đã được thu hồi. Hệ thống đang hoàn tất xóa tệp bản ghi.' : '');
      await load(); setConfirm(null);
    }
    catch (cause) { setError(friendlyError(cause, 'Không thực hiện được thao tác bản ghi.')); }
    finally { setBusy(false); }
  };
  return <Card id="recordings" className="classroom-recordings" aria-labelledby="recordings-title"><h2 id="recordings-title">Bản ghi buổi học</h2>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!result && !error && <p role="status">Đang tải bản ghi…</p>}
    {result && !result.recordings.length && <div className="classroom-recordings-empty"><ProctoOwlMascot variant="compact" /><p role="status">{result.processing ? 'Bản ghi đang được xử lý.' : result.recorded ? 'Chưa có bản ghi được công khai cho sinh viên.' : 'Buổi học này không có bản ghi.'}</p></div>}
    {result?.recordings.map((row, index) => <article className="classroom-recording-row" key={row.id}>
      <div><h3>Bản ghi {index + 1}</h3><p>{recordingLabels[row.status]} · {recordingDuration(row.duration_seconds)}</p><time dateTime={row.created_at}>{new Date(row.created_at).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })}</time>{row.error_code && <p className="classroom-recording-error">{row.status === 'FAILED' ? 'Không thể xử lý bản ghi.' : row.status === 'PROCESSING' ? 'Đang xử lý bản ghi…' : 'Hệ thống đang xác nhận trạng thái ghi hình.'}</p>}</div>
      <div className="classroom-recording-actions">
        {['READY', 'PUBLISHED', 'UNPUBLISHED'].includes(row.status) && <Link className="ui-button ui-button-outline" href={`/live-class/${id}/recordings/${row.id}`}>{manager ? 'Xem lại' : 'Xem lại buổi học'}</Link>}
        {manager && ['READY', 'UNPUBLISHED'].includes(row.status) && <Button disabled={busy} onClick={() => setConfirm({ row, action: 'publish' })}>Công khai cho sinh viên</Button>}
        {manager && row.status === 'PUBLISHED' && <Button variant="outline" disabled={busy} onClick={() => void change(row, 'unpublish')}>Ẩn khỏi sinh viên</Button>}
        {manager && ['READY', 'PUBLISHED', 'UNPUBLISHED', 'FAILED'].includes(row.status) && <Button variant="ghost" disabled={busy} onClick={() => setConfirm({ row, action: 'delete' })}>Xóa bản ghi</Button>}
      </div>
    </article>)}
    <ConfirmDialog open={Boolean(confirm)} title={confirm?.action === 'delete' ? 'Xóa bản ghi?' : 'Công khai bản ghi?'} description={confirm?.action === 'delete' ? 'Không thể hoàn tác thao tác này.' : 'Sinh viên trong lớp sẽ có thể xem lại buổi học này.'} confirmLabel={confirm?.action === 'delete' ? 'Xóa bản ghi' : 'Công khai'} busy={busy} error={error} onCancel={() => setConfirm(null)} onConfirm={() => { if (confirm) void change(confirm.row, confirm.action); }} />
  </Card>;
}
