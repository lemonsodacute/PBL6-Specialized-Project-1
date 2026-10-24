/** Coalesce focus + visibility events from one tab activation into one refresh. */
export function subscribeVisibleRefresh(refresh: () => void) {
  let frame: number | undefined;
  const resume = () => {
    if (document.visibilityState !== 'visible' || frame !== undefined) return;
    frame = requestAnimationFrame(() => { frame = undefined; refresh(); });
  };
  window.addEventListener('focus', resume);
  document.addEventListener('visibilitychange', resume);
  return () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    window.removeEventListener('focus', resume);
    document.removeEventListener('visibilitychange', resume);
  };
}
