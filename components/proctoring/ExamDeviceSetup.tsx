'use client';

import { Button, Modal, Select } from '@/components/ui';
import type { DeviceStatus, ExamMedia } from './useExamMedia';

function message(label: string, status: DeviceStatus, ready: boolean) {
  if (ready) return `${label} đã sẵn sàng`;
  if (status === 'requesting') return `Đang kiểm tra ${label.toLowerCase()}...`;
  if (status === 'idle') return `Chưa kiểm tra ${label.toLowerCase()}`;
  if (status === 'unsupported') return `Trình duyệt chưa hỗ trợ ${label.toLowerCase()}. Vui lòng dùng trình duyệt hỗ trợ thiết bị.`;
  return `Chưa thể truy cập ${label.toLowerCase()}. ${status === 'denied' ? `Vui lòng cấp quyền ${label.toLowerCase()} trong trình duyệt.` : 'Vui lòng kiểm tra kết nối thiết bị và thử lại.'}`;
}

export function ExamDeviceSetup({ open, settings = false, media, requireVideo, requireAudio, onEnter, onClose, verifying = false, entryError = '' }: {
  open: boolean; settings?: boolean; media: ExamMedia; requireVideo: boolean; requireAudio: boolean; onEnter: () => void; onClose: () => void; verifying?: boolean; entryError?: string;
}) {
  const started = (requireVideo && media.cameraStatus !== 'idle') || (requireAudio && media.microphoneStatus !== 'idle');
  return <Modal open={open} size="medium" title={settings ? 'Cài đặt thiết bị' : 'Cài đặt thiết bị trước khi thi'} className="exam-device-modal" onClose={() => { if (!verifying) onClose(); }}>
    <div className="form-stack">
      <p>Đề thi này yêu cầu bật {requireVideo && requireAudio ? 'camera và microphone' : requireVideo ? 'camera' : 'microphone'} để AI hỗ trợ giám sát trong suốt quá trình làm bài.</p>
      {requireVideo && !settings && <p>Ảnh camera mới sẽ được dùng để xác minh danh tính khi bạn chọn vào phòng thi.</p>}
      {requireVideo && <section aria-label="Trạng thái camera"><h3>Camera</h3><p role="status" className={media.cameraReady ? 'device-ready' : 'device-pending'}>{message('Camera', media.cameraStatus, media.cameraReady)}</p></section>}
      {requireAudio && <section aria-label="Trạng thái microphone"><h3>Microphone</h3><p role="status" className={media.microphoneReady ? 'device-ready' : 'device-pending'}>{message('Microphone', media.microphoneStatus, media.microphoneReady)}</p></section>}
      <div className="form-two-col">
        {requireVideo && media.cameras.length > 1 && <label>Camera<Select disabled={media.busy || verifying} value={media.selectedCamera} onChange={event => void media.acquire(event.target.value, media.selectedMicrophone)}><option value="">Camera mặc định</option>{media.cameras.map(item => <option key={item.deviceId} value={item.deviceId}>{item.label}</option>)}</Select></label>}
        {requireAudio && media.microphones.length > 1 && <label>Microphone<Select disabled={media.busy || verifying} value={media.selectedMicrophone} onChange={event => void media.acquire(media.selectedCamera, event.target.value)}><option value="">Microphone mặc định</option>{media.microphones.map(item => <option key={item.deviceId} value={item.deviceId}>{item.label}</option>)}</Select></label>}
      </div>
      {requireVideo && <div className="exam-device-preview"><video ref={media.attachVideo} autoPlay muted playsInline aria-label="Xem trước camera" /></div>}
      {requireAudio && <div><div className="mic-meter-label"><span>Âm lượng microphone</span><span>{media.level}%</span></div><div className="mic-meter" role="meter" aria-label="Âm lượng microphone" aria-valuemin={0} aria-valuemax={100} aria-valuenow={media.level}><i style={{ width: `${media.level}%` }} /></div><p className="field-helper">Phòng yên tĩnh có thể hiển thị 0%. Bạn vẫn có thể vào thi khi microphone đã sẵn sàng.</p></div>}
      {entryError && <p className="form-error" role="alert">{entryError}</p>}
      <div className="modal-actions">{settings && <Button variant="outline" onClick={onClose}>Đóng</Button>}<Button variant="outline" disabled={media.busy || verifying} onClick={() => void media.acquire()}>{media.busy ? 'Đang kiểm tra...' : started ? 'Thử lại' : 'Tiếp tục'}</Button><Button variant="success" disabled={!media.ready || media.busy || verifying} onClick={onEnter}>{verifying ? 'Đang xác minh danh tính...' : settings ? 'Áp dụng' : entryError ? 'Thử xác minh lại' : 'Vào phòng thi'}</Button></div>
    </div>
  </Modal>;
}
