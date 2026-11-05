'use client';
import { useEffect, useState } from 'react';
import { Select } from '@/components/ui';
import type { ClassroomTransport } from '@/lib/classroom';

export function DeviceSettings({ engine, onError }: { engine: ClassroomTransport; onError: (message: string) => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => { void navigator.mediaDevices?.enumerateDevices().then(result => { if (active) setDevices(result); }).catch(() => onError('Không đọc được danh sách thiết bị.')); };
    refresh(); navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => { active = false; navigator.mediaDevices?.removeEventListener('devicechange', refresh); };
  }, [onError]);
  const change = async (kind: MediaDeviceKind, value: string) => {
    setBusy(true);
    try { await engine.switchDevice(kind, value); setSelected(previous => ({ ...previous, [kind]: value })); }
    catch { onError('Không đổi được thiết bị. Kiểm tra kết nối và quyền truy cập.'); }
    finally { setBusy(false); }
  };
  return <div className="classroom-device-fields">{(['audioinput', 'videoinput', 'audiooutput'] as MediaDeviceKind[]).filter(kind => kind !== 'audiooutput' || 'setSinkId' in HTMLMediaElement.prototype).map(kind => <label key={kind}>{({ audioinput: 'Microphone', videoinput: 'Camera', audiooutput: 'Loa / tai nghe' })[kind]}<Select aria-label={`Đổi ${kind}`} disabled={busy} value={selected[kind] || ''} onChange={event => void change(kind, event.target.value)}><option value="" disabled>Chọn thiết bị</option>{devices.filter(device => device.kind === kind).map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Thiết bị ${index + 1}`}</option>)}</Select></label>)}</div>;
}
