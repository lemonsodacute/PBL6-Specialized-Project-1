// Single-use, memory-only handoff across the immediate Next.js exam navigation.
// This preserves the already confirmed devices; it is never an authorization proof.
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
