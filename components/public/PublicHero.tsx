'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Video, Mic, ScanFace, ArrowRight } from 'lucide-react';
import styles from './PublicHome.module.css';
import { ProctoOwlArtwork } from '@/components/brand/ProctoOwlMascot';

/** Decorative pointer work stays outside React rendering and stops when settled. */
export function PublicHero({ children }: { children: ReactNode }) {
  const hero = useRef<HTMLElement>(null);
  const owl = useRef<SVGSVGElement>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const origins = useRef<(SVGCircleElement | null)[]>([]);
  const pupils = useRef<(SVGGElement | null)[]>([]);
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const gradients = useRef<(SVGLinearGradientElement | null)[]>([]);
  const glow = useRef<SVGCircleElement>(null);
  const uid = `owl-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    const root = hero.current, lights = overlay.current;
    if (!root || !lights) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const fine = matchMedia('(hover: hover) and (pointer: fine)');
    let enabled = false, visible = true, frame = 0, previousTime = 0;
    let geometry = { pageX: 0, pageY: 0, width: 0, height: 0, eyes: [{x:0,y:0},{x:0,y:0}] };
    let target = { x: 0, y: 0, opacity: 0 }, current = { ...target };
    let pointer: { pageX: number; pageY: number } | null = null;

    const stop = () => { cancelAnimationFrame(frame); frame = 0; previousTime = 0; };
    const reset = () => {
      stop(); target.opacity = current.opacity = 0; lights.style.opacity = '0';
      pupils.current.forEach(node => node?.setAttribute('transform', 'translate(0 0)'));
    };
    const measure = () => {
      const rect = root.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      geometry = { pageX: rect.left + scrollX, pageY: rect.top + scrollY, width: rect.width, height: rect.height,
        eyes: origins.current.map(node => { const eye = node!.getBoundingClientRect(); return { x: eye.left + eye.width / 2 - rect.left, y: eye.top + eye.height / 2 - rect.top }; }) };
      lights.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
      if (!target.opacity) {
        target = { x: (geometry.eyes[0].x + geometry.eyes[1].x) / 2, y: geometry.eyes[0].y + 150, opacity: 0 };
        current = { ...target };
      } else if (pointer) {
        target.x = Math.max(0, Math.min(rect.width, pointer.pageX - geometry.pageX));
        target.y = Math.max(0, Math.min(rect.height, pointer.pageY - geometry.pageY));
      }
    };
    const paint = (time: number) => {
      frame = 0;
      if (!enabled || !visible || !geometry.width) return;
      // Use elapsed time so a delayed frame catches up instead of extending lag.
      const alpha = 1 - Math.exp(-(previousTime ? time - previousTime : 16) / 85);
      previousTime = time;
      current.x += (target.x - current.x) * alpha;
      current.y += (target.y - current.y) * alpha;
      current.opacity += (target.opacity - current.opacity) * alpha;
      lights.style.opacity = current.opacity.toFixed(3);
      geometry.eyes.forEach((eye, index) => {
        const dx = current.x - eye.x, dy = current.y - eye.y, distance = Math.hypot(dx, dy) || 1;
        // A broad cone grows with distance instead of flattening into a thin ray.
        const nx = dx / distance, ny = dy / distance, spread = Math.min(150, distance * .24);
        pupils.current[index]?.setAttribute('transform', `translate(${(nx * 9 * current.opacity).toFixed(2)} ${(ny * 9 * current.opacity).toFixed(2)})`);
        paths.current[index]?.setAttribute('d', `M ${eye.x} ${eye.y} L ${current.x - ny * spread} ${current.y + nx * spread} Q ${current.x + nx * spread * .3} ${current.y + ny * spread * .3} ${current.x + ny * spread} ${current.y - nx * spread} Z`);
        const gradient = gradients.current[index];
        gradient?.setAttribute('x1', String(eye.x)); gradient?.setAttribute('y1', String(eye.y));
        gradient?.setAttribute('x2', String(current.x)); gradient?.setAttribute('y2', String(current.y));
      });
      glow.current?.setAttribute('cx', String(current.x)); glow.current?.setAttribute('cy', String(current.y));
      if (Math.abs(target.x-current.x) + Math.abs(target.y-current.y) > .2 || Math.abs(target.opacity-current.opacity) > .002) frame = requestAnimationFrame(paint);
      else { previousTime = 0; if (!target.opacity) reset(); }
    };
    const requestPaint = () => { if (enabled && visible && !frame) frame = requestAnimationFrame(paint); };
    const move = (event: PointerEvent) => {
      if (!enabled || !visible || event.pointerType === 'touch') return;
      pointer = { pageX: event.pageX, pageY: event.pageY };
      target = { x: Math.max(0, Math.min(geometry.width, event.pageX - geometry.pageX)), y: Math.max(0, Math.min(geometry.height, event.pageY - geometry.pageY)), opacity: 1 };
      requestPaint();
    };
    const enter = (event: PointerEvent) => { measure(); move(event); };
    const leave = () => { target = { x: (geometry.eyes[0].x + geometry.eyes[1].x) / 2, y: geometry.eyes[0].y + 150, opacity: 0 }; requestPaint(); };
    const capability = () => {
      enabled = fine.matches && !reduced.matches;
      root.dataset.eyeTracking = enabled ? 'enabled' : 'static';
      reset(); if (enabled) measure();
    };
    const visibility = () => { if (document.hidden) reset(); };
    const resize = () => { measure(); if (target.opacity) requestPaint(); };
    const size = new ResizeObserver(resize);
    size.observe(root); if (owl.current) size.observe(owl.current);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (!visible) reset(); }, { threshold: 0 });
    intersection.observe(root);
    root.addEventListener('pointerenter', enter, { passive: true });
    root.addEventListener('pointermove', move, { passive: true });
    root.addEventListener('pointerleave', leave, { passive: true });
    reduced.addEventListener('change', capability); fine.addEventListener('change', capability);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('resize', resize, { passive: true });
    capability();
    return () => {
      reset(); size.disconnect(); intersection.disconnect();
      root.removeEventListener('pointerenter', enter); root.removeEventListener('pointermove', move); root.removeEventListener('pointerleave', leave);
      reduced.removeEventListener('change', capability); fine.removeEventListener('change', capability); document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <section ref={hero} id="trang-chu" data-eye-tracking="static" aria-labelledby="hero-title" className={`${styles.container} ${styles.hero}`}>
    {children}
    <figure className={styles.productPreview} aria-labelledby="preview-caption">
      <div className={styles.owlOrbit} aria-hidden="true" />
      <svg ref={owl} className={styles.owlCanvas} data-owl="proctoowl" viewBox="0 0 520 500" fill="none" aria-hidden="true">
        <ProctoOwlArtwork idPrefix={uid} eyeOrigins={origins} pupils={pupils} />
      </svg>
      <div className={styles.monitorPreview}>
        <div className={styles.previewTopbar}><span>Giám sát kỳ thi</span><span className={styles.previewLabel}>Giao diện minh họa</span></div>
        <div className={styles.previewBody}>
          <div className={styles.previewGrid} aria-hidden="true">
            {'ABCDEFGH'.split('').map((letter,index)=><div key={letter} className={`${styles.previewSeat} ${index===3?styles.previewSeatSelected:''}`}>
              <span className={styles.previewSeatDot}/><span className={styles.previewAvatar}>{letter}</span><span>Thí sinh {letter}</span>
            </div>)}
          </div>
          <div className={styles.previewReview}>
            <div className={styles.previewEvent}><span className={styles.previewEventIcon}><ScanFace size={17} aria-hidden="true"/></span><h2>Lịch sử sự kiện</h2><span className={styles.previewExample}>Ví dụ minh họa</span></div>
            <p className={styles.previewScenario}>Nhiều khuôn mặt trong khung hình.</p>
            <p className={styles.previewNote}>Giảng viên xem xét và đưa ra quyết định.</p>
            <div className={styles.previewReviewFooter}><span><Video size={15} aria-hidden="true"/><Mic size={13} aria-hidden="true"/>Camera & microphone</span><a href="#tinh-nang">Tìm hiểu tính năng<ArrowRight size={13} aria-hidden="true"/></a></div>
          </div>
        </div>
      </div>
      <figcaption id="preview-caption">Minh họa sản phẩm · Không phải dữ liệu phiên thi thực tế.</figcaption>
    </figure>
    <svg ref={overlay} className={styles.eyeLights} viewBox="0 0 1200 640" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        {[0,1].map(index=><linearGradient ref={node=>{gradients.current[index]=node;}} id={`${uid}-beam-${index}`} gradientUnits="userSpaceOnUse" key={index}><stop stopColor="#84D8CA" stopOpacity=".5"/><stop offset=".35" stopColor="#65BFB8" stopOpacity=".32"/><stop offset=".8" stopColor="#65BFB8" stopOpacity=".14"/><stop offset="1" stopColor="#65BFB8" stopOpacity="0"/></linearGradient>)}
        <radialGradient id={`${uid}-spot`}><stop stopColor="#83C5BE" stopOpacity=".24"/><stop offset="1" stopColor="#83C5BE" stopOpacity="0"/></radialGradient>
        <filter id={`${uid}-soft`} x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="6"/></filter>
      </defs>
      <g filter={`url(#${uid}-soft)`}>{[0,1].map(index=><path ref={node=>{paths.current[index]=node;}} data-eye-beam={index===0?'left':'right'} fill={`url(#${uid}-beam-${index})`} key={index}/>)}</g>
      <circle ref={glow} r="60" fill={`url(#${uid}-spot)`}/>
    </svg>
  </section>;
}
