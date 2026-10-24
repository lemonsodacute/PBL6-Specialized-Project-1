'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import type { ExamMedia } from './useExamMedia';

type Position = { x: number; y: number };
const margin = 12;
const avoidSelector = '[data-camera-avoid], .topbar, .sidebar, .question-index-list, .ai-chat-fab, .ai-chatbox, .student-call-banner';

export function FloatingCamera({ attemptId, media, requireVideo, requireAudio }: {
  attemptId: string; media: ExamMedia; requireVideo: boolean; requireAudio: boolean;
}) {
  const widget = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; startX: number; startY: number; position: Position } | null>(null);
  const positionRef = useRef<Position | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(false);
  const [mobile, setMobile] = useState(false);
  const key = `ai-procto-camera:${attemptId}`;

  const constrain = useCallback((desired: Position): Position | null => {
    if (!widget.current) return desired;
    const { width, height } = widget.current.getBoundingClientRect();
    const maxX = Math.max(margin, window.innerWidth - width - margin);
    const maxY = Math.max(margin, window.innerHeight - height - margin);
    const clamp = (p: Position) => ({ x: Math.min(maxX, Math.max(margin, p.x)), y: Math.min(maxY, Math.max(margin, p.y)) });
    const obstacles = Array.from(document.querySelectorAll<HTMLElement>(avoidSelector)).filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden').map(element => element.getBoundingClientRect()).filter(rect => rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth);
    const safe = (p: Position) => obstacles.every(rect => p.x + width <= rect.left - 8 || p.x >= rect.right + 8 || p.y + height <= rect.top - 8 || p.y >= rect.bottom + 8);
    const requested = clamp(desired);
    if (safe(requested)) return requested;
    const candidates = [positionRef.current, { x: margin, y: maxY }, { x: maxX, y: maxY }, { x: margin, y: margin }, { x: maxX, y: margin },
      ...obstacles.flatMap(rect => [
        { x: requested.x, y: rect.top - height - 8 }, { x: requested.x, y: rect.bottom + 8 },
        { x: rect.left - width - 8, y: requested.y }, { x: rect.right + 8, y: requested.y },
        { x: margin, y: rect.bottom + 8 }, { x: maxX, y: rect.bottom + 8 },
        { x: margin, y: rect.top - height - 8 }, { x: maxX, y: rect.top - height - 8 },
      ])].filter((p): p is Position => !!p).map(clamp).filter(safe);
    candidates.sort((a, b) => Math.hypot(a.x - requested.x, a.y - requested.y) - Math.hypot(b.x - requested.x, b.y - requested.y));
    return candidates[0] ?? null;
  }, []);

  const move = useCallback((desired: Position) => {
    const next = constrain(desired);
    if (!next) {
      if (!collapsedRef.current) { collapsedRef.current = true; setCollapsed(true); }
      return;
    }
    if (positionRef.current?.x === next.x && positionRef.current?.y === next.y) return;
    positionRef.current = next; setPosition(next);
  }, [constrain]);
  const persist = useCallback(() => {
    try { sessionStorage.setItem(key, JSON.stringify({ ...positionRef.current, collapsed: collapsedRef.current })); } catch { /* Optional per-attempt preference. */ }
  }, [key]);

  useEffect(() => {
    const small = window.matchMedia('(max-width: 767px)');
    let saved: { x?: number; y?: number; collapsed?: boolean } | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { /* Ignore invalid storage. */ }
    setMobile(small.matches); collapsedRef.current = small.matches || saved?.collapsed === true; setCollapsed(collapsedRef.current);
    const frame = requestAnimationFrame(() => move(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && !small.matches ? { x: saved.x!, y: saved.y! } : { x: margin, y: window.innerHeight }));
    const resize = () => { setMobile(small.matches); if (small.matches) { collapsedRef.current = true; setCollapsed(true); } move(positionRef.current ?? { x: margin, y: window.innerHeight - 320 }); };
    window.addEventListener('resize', resize); small.addEventListener('change', resize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); small.removeEventListener('change', resize); };
  }, [key, move]);

  useEffect(() => {
    let frame = 0;
    const adjust = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => move(positionRef.current ?? { x: margin, y: window.innerHeight - 320 })); };
    const observer = new ResizeObserver(adjust);
    if (widget.current) observer.observe(widget.current);
    document.querySelectorAll<HTMLElement>(avoidSelector).forEach(element => observer.observe(element));
    const changes = new MutationObserver(adjust); changes.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('scroll', adjust, true);
    return () => { observer.disconnect(); changes.disconnect(); window.removeEventListener('scroll', adjust, true); cancelAnimationFrame(frame); };
  }, [move]);

  function start(event: PointerEvent<HTMLDivElement>) {
    if (mobile || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    const current = positionRef.current; if (!current) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, position: current };
  }
  function update(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current; if (!current || current.pointer !== event.pointerId) return;
    move({ x: current.position.x + event.clientX - current.startX, y: current.position.y + event.clientY - current.startY });
  }
  function finish() { drag.current = null; persist(); }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (mobile || event.target !== event.currentTarget || !positionRef.current) return;
    const offsets: Record<string, Position> = { ArrowLeft: { x: -20, y: 0 }, ArrowRight: { x: 20, y: 0 }, ArrowUp: { x: 0, y: -20 }, ArrowDown: { x: 0, y: 20 } };
    const offset = offsets[event.key]; if (!offset) return;
    event.preventDefault(); move({ x: positionRef.current.x + offset.x, y: positionRef.current.y + offset.y }); persist();
  }
  const monitored = (!requireVideo || media.cameraReady) && (!requireAudio || media.microphoneReady);
  return <div ref={widget} className={`floating-camera ${collapsed ? 'collapsed' : ''}`} role="region" aria-label="Thiết bị giám sát" style={{ left: position?.x ?? margin, top: position?.y ?? margin, visibility: position ? 'visible' : 'hidden' }}>
    <div className="floating-camera-handle" tabIndex={mobile ? -1 : 0} aria-label="Di chuyển camera bằng kéo thả hoặc phím mũi tên" onPointerDown={start} onPointerMove={update} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onKeyDown={keyboard}>
      <span><i className={`exam-media-dot ${monitored ? 'active' : ''}`} aria-hidden="true" />{collapsed ? 'Giám sát thiết bị' : 'Camera giám sát'}</span>
      <button type="button" aria-label={collapsed ? 'Mở rộng camera giám sát' : 'Thu nhỏ camera giám sát'} aria-expanded={!collapsed} onClick={() => { collapsedRef.current = !collapsed; setCollapsed(!collapsed); persist(); }}>{collapsed ? '□' : '−'}</button>
    </div>
    {!collapsed && requireVideo && <video ref={media.attachVideo} autoPlay muted playsInline aria-label="Camera giám sát trực tiếp" />}
    <div className="floating-camera-status" role="status">{requireVideo && <span>Camera <i className={`exam-media-dot ${media.cameraReady ? 'active' : ''}`} aria-hidden="true" />{media.cameraReady ? 'Đang bật' : 'Chưa sẵn sàng'}</span>}{requireAudio && <span>Micro <i className={`exam-media-dot ${media.microphoneReady ? 'active' : ''}`} aria-hidden="true" />{media.microphoneReady ? 'Đang bật' : 'Chưa sẵn sàng'}</span>}</div>
  </div>;
}
