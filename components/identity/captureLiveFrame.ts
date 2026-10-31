// Each call waits for a new live video frame and creates a new canvas/blob.
export async function captureLiveFrame(video: HTMLVideoElement, stream: MediaStream): Promise<Blob> {
  const ready = () => video.isConnected && video.srcObject === stream && !video.paused && video.readyState >= 2
    && video.videoWidth > 0 && stream.getVideoTracks().some(track => track.readyState === 'live' && track.enabled && !track.muted);
  if (!ready()) throw new Error('Hãy bật camera và chờ hình ảnh trực tiếp trước khi xác minh.');
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      if (handle !== undefined) video.cancelVideoFrameCallback(handle);
      reject(new Error('Chưa nhận được ảnh camera mới. Vui lòng thử lại.'));
    }, 2000);
    let handle: number | undefined;
    const done = () => { clearTimeout(timeout); resolve(); };
    if (typeof video.requestVideoFrameCallback === 'function') handle = video.requestVideoFrameCallback(done);
    else requestAnimationFrame(() => requestAnimationFrame(done));
  });
  if (!ready()) throw new Error('Camera đã thay đổi hoặc ngắt kết nối. Vui lòng kiểm tra lại thiết bị.');
  const canvas = document.createElement('canvas');
  const ratio = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * ratio);
  canvas.height = Math.round(video.videoHeight * ratio);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Không thể chụp ảnh camera. Vui lòng thử lại.');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Không thể chụp ảnh camera.')), 'image/jpeg', .9));
  if (!ready()) throw new Error('Camera đã ngắt kết nối. Vui lòng xác minh lại.');
  return blob;
}
