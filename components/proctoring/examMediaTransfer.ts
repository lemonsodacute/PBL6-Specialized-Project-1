// Single-use, memory-only handoff across the immediate Next.js exam navigation.
// This preserves the already confirmed devices; it is never an authorization proof.
type DeviceRequirements = { camera: boolean; microphone: boolean };
const setupKey = (attemptId: string) => `proctoowl:exam-device-setup:${attemptId}`;

/** Tab/attempt-scoped UX history, never permission or identity evidence. */
export function rememberExamDeviceSetup(attemptId: string, requirements: DeviceRequirements) {
  try { sessionStorage.setItem(setupKey(attemptId), JSON.stringify({ version: 1, ...requirements })); } catch { /* Storage can be unavailable. */ }
}
export function hasExamDeviceSetup(attemptId: string, requirements: DeviceRequirements) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(setupKey(attemptId)) || 'null');
    return saved?.version === 1 && saved.camera === requirements.camera && saved.microphone === requirements.microphone;
  } catch { return false; }
}
export function forgetExamDeviceSetup(attemptId: string) {
  try { sessionStorage.removeItem(setupKey(attemptId)); } catch { /* Optional UX history. */ }
}

let pending: { attemptId: string; stream: MediaStream; timer: ReturnType<typeof setTimeout> } | null = null;
function discard() {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.stream.getTracks().forEach(track => track.stop());
  pending = null;
  window.removeEventListener('pagehide', discard);
}
export function transferExamMedia(attemptId: string, stream: MediaStream) {
  discard();
  pending = { attemptId, stream, timer: setTimeout(discard, 10_000) };
  window.addEventListener('pagehide', discard, { once: true });
}
export function takeExamMedia(attemptId: string) {
  if (!pending || pending.attemptId !== attemptId) return null;
  const { stream, timer } = pending;
  clearTimeout(timer);
  pending = null;
  window.removeEventListener('pagehide', discard);
  return stream;
}
