'use client';

import { useId, useRef, type ReactNode } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Video, Mic, ScanFace, ArrowRight } from 'lucide-react';
import styles from './PublicHome.module.css';
import { ProctoOwlArtwork } from '@/components/brand/ProctoOwlMascot';

gsap.registerPlugin(useGSAP);

/** One ref-backed gaze drives both pupils and both light layers. */
export function PublicHero({ children }: { children: ReactNode }) {
  const hero = useRef<HTMLElement>(null);
  const owl = useRef<SVGSVGElement>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const origins = useRef<(SVGCircleElement | null)[]>([]);
  const pupils = useRef<(SVGGElement | null)[]>([]);
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const ambientPaths = useRef<(SVGPathElement | null)[]>([]);
  const gradients = useRef<(SVGLinearGradientElement | null)[]>([]);
  const ambientGradients = useRef<(SVGLinearGradientElement | null)[]>([]);
  const filters = useRef<(SVGFilterElement | null)[]>([]);
  const preview = useRef<HTMLDivElement>(null);
  const illustration = useRef<HTMLElement>(null);
  const gaze = useRef({ x: 0, y: 0, opacity: .78 });
  const uid = `owl-${useId().replace(/:/g, '')}`;

  useGSAP(() => {
    const root = hero.current, lights = overlay.current;
    if (!root || !lights) return;
    gsap.registerPlugin(ScrollTrigger);
    const media = gsap.matchMedia();

    media.add({
      all: 'all',
      finePointer: '(min-width: 601px) and (hover: hover) and (pointer: fine)',
      reducedMotion: '(prefers-reduced-motion: reduce)',
    }, context => {
      const enabled = Boolean(context.conditions?.finePointer && !context.conditions?.reducedMotion);
      root.dataset.eyeTracking = enabled ? 'enabled' : 'static';
      let visible = true, measureFrame = 0;
      let geometry = { pageX: 0, pageY: 0, width: 0, height: 0, diagonal: 0, pupilScale: 1, eyes: [{x:0,y:0},{x:0,y:0}] };
      const current = gaze.current;
      let pointer: { clientX: number; clientY: number } | null = null;

      const idle = () => {
        const centerX = (geometry.eyes[0].x + geometry.eyes[1].x) / 2;
        const centerY = (geometry.eyes[0].y + geometry.eyes[1].y) / 2;
        // The stacked layout needs a local pool of light near the owl, rather than
        // a screen-height cone crossing all the mobile copy above it.
        return geometry.width <= 820
          ? { x: Math.max(24, centerX - Math.min(300, geometry.width * .45)), y: centerY - 64,
              opacity: geometry.width <= 568 ? .58 : .68 }
          : { x: geometry.width * .06, y: geometry.height * .42, opacity: .78 };
      };
      const paint = () => {
        if (!visible || document.hidden || !geometry.width) return;
        lights.style.opacity = current.opacity.toFixed(3);
        const bounds = [0, 1].map(() => ({ left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }));
        geometry.eyes.forEach((eye, index) => {
          const dx = current.x - eye.x, dy = current.y - eye.y, distance = Math.hypot(dx, dy);
          const angle = Math.atan2(dy, dx);
          const nx = Math.cos(angle), ny = Math.sin(angle);
          const compact = geometry.width <= 820;
          // Pupil position and both light layers share this one smoothed target.
          // Ease toward the neutral center nearby so the origin never passes the pointer.
          const pupilOffset = Math.min(9, distance / geometry.pupilScale * .2);
          const pupilX = nx * pupilOffset, pupilY = ny * pupilOffset;
          const originX = eye.x + pupilX * geometry.pupilScale, originY = eye.y + pupilY * geometry.pupilScale;
          pupils.current[index]?.setAttribute('transform', `translate(${pupilX.toFixed(2)} ${pupilY.toFixed(2)})`);
          const targetDistance = Math.hypot(current.x - originX, current.y - originY);
          // Fade beyond the pointer, not at it. Desktop reach follows the entire
          // hero diagonal; only the small-screen decorative pool has a pixel cap.
          const maxLength = compact ? 330 : geometry.diagonal * 1.2;
          const length = Math.min(maxLength, Math.max(compact ? 110 : 180,
            targetDistance * (compact ? 1.08 : 1.18) + (compact ? 24 : 100)));
          const ambientLength = Math.min(compact ? 360 : maxLength, length * 1.1);
          const spread = Math.min(compact ? 90 : geometry.diagonal * .32, length * .32);
          const ambientSpread = Math.min(compact ? 125 : geometry.diagonal * .46, ambientLength * .46);
          const layers = [
            { path: paths.current[index], gradient: gradients.current[index], reach: length, width: spread },
            { path: ambientPaths.current[index], gradient: ambientGradients.current[index], reach: ambientLength, width: ambientSpread },
          ];
          layers.forEach(({ path, gradient, reach, width }, layer) => {
            const endX = originX + nx * reach, endY = originY + ny * reach;
            // The SVG cone pivots at its eye-side apex (equivalent to 0% 50%).
            // A flat far edge keeps the maximum reach within the diagonal cap.
            path?.setAttribute('d', `M ${originX} ${originY} L ${endX - ny * width} ${endY + nx * width} Q ${endX} ${endY} ${endX + ny * width} ${endY - nx * width} Z`);
            gradient?.setAttribute('x1', String(originX)); gradient?.setAttribute('y1', String(originY));
            gradient?.setAttribute('x2', String(endX)); gradient?.setAttribute('y2', String(endY));
            // Bound the blur to its actual cones, including their control points.
            // A hero-sized filter region would otherwise introduce another box
            // when the now-unclipped light extends beyond the section vertically.
            const box = bounds[layer];
            box.left = Math.min(box.left, originX, endX - Math.abs(ny * width));
            box.right = Math.max(box.right, originX, endX + Math.abs(ny * width));
            box.top = Math.min(box.top, originY, endY - Math.abs(nx * width));
            box.bottom = Math.max(box.bottom, originY, endY + Math.abs(nx * width));
          });
        });
        bounds.forEach((box, index) => {
          const filter = filters.current[index];
          filter?.setAttribute('x', String(box.left - 48));
          filter?.setAttribute('y', String(box.top - 48));
          filter?.setAttribute('width', String(box.right - box.left + 96));
          filter?.setAttribute('height', String(box.bottom - box.top + 96));
        });
      };

      // Reuse three tweens for the lifetime of this media-query context. A ticker
      // paints after GSAP updates all three values, at most once per frame.
      const xTo = gsap.quickTo(current, 'x', { duration: .38, ease: 'power3.out' });
      const opacityTo = gsap.quickTo(current, 'opacity', { duration: .24, ease: 'power2.out' });
      const yTo = gsap.quickTo(current, 'y', { duration: .38, ease: 'power3.out' });
      let painting = false;
      const render = () => {
        paint();
        if (!yTo.tween.isActive()) { gsap.ticker.remove(render); painting = false; }
      };
      const stop = () => {
        xTo.tween.pause(); yTo.tween.pause(); opacityTo.tween.pause();
        gsap.ticker.remove(render); painting = false;
        cancelAnimationFrame(measureFrame); measureFrame = 0;
      };
      const aim = (target: typeof current, animate = enabled) => {
        if (animate && visible && !document.hidden) {
          xTo(target.x, current.x); opacityTo(target.opacity, current.opacity); yTo(target.y, current.y);
          if (!painting) { painting = true; gsap.ticker.add(render); }
        } else {
          stop(); Object.assign(current, target); paint();
        }
      };
      const pointerTarget = (clientX: number, clientY: number) => ({
        x: gsap.utils.clamp(0, geometry.width, clientX + scrollX - geometry.pageX),
        y: gsap.utils.clamp(0, geometry.height, clientY + scrollY - geometry.pageY),
        opacity: geometry.width <= 820 ? .84 : 1,
      });
      const measure = () => {
        measureFrame = 0;
        if (!visible || document.hidden) return;
        // Geometry is read together, only after resize/scroll/entry, never in the
        // high-frequency pointer handler. Keep the owl itself stationary.
        const rect = root.getBoundingClientRect();
        const matrix = owl.current?.getScreenCTM();
        if (!rect.width || !rect.height || !matrix || origins.current.length !== 2 || origins.current.some(node => !node)) return;
        geometry = { pageX: rect.left + scrollX, pageY: rect.top + scrollY, width: rect.width, height: rect.height,
          diagonal: Math.hypot(rect.width, rect.height), pupilScale: Math.hypot(matrix.a, matrix.b),
          eyes: origins.current.map(node => {
            const eye = new DOMPoint(node!.cx.baseVal.value, node!.cy.baseVal.value).matrixTransform(matrix);
            return { x: eye.x - rect.left, y: eye.y - rect.top };
          }) };
        lights.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
        if (pointer && enabled) aim(pointerTarget(pointer.clientX, pointer.clientY));
        else aim(idle(), false);
      };
      const requestMeasure = () => {
        if (visible && !document.hidden && !measureFrame) measureFrame = requestAnimationFrame(measure);
      };
      const move = (event: PointerEvent) => {
        if (!enabled || !visible || event.pointerType === 'touch') return;
        pointer = { clientX: event.clientX, clientY: event.clientY };
        aim(pointerTarget(event.clientX, event.clientY));
      };
      const enter = (event: PointerEvent) => { requestMeasure(); move(event); };
      const leave = () => { pointer = null; aim(idle()); };
      const visibility = () => {
        if (document.hidden) { stop(); pointer = null; }
        else requestMeasure();
      };
      const size = new ResizeObserver(requestMeasure);
      size.observe(root); if (owl.current) size.observe(owl.current);
      const intersection = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (!visible) { stop(); pointer = null; } else requestMeasure();
      }, { threshold: 0 });
      intersection.observe(root);
      root.addEventListener('pointerenter', enter, { passive: true });
      root.addEventListener('pointermove', move, { passive: true });
      root.addEventListener('pointerleave', leave, { passive: true });
      document.addEventListener('visibilitychange', visibility);
      window.addEventListener('resize', requestMeasure, { passive: true });
      window.addEventListener('scroll', requestMeasure, { passive: true });
      measure();
      return () => {
        stop(); size.disconnect(); intersection.disconnect();
        root.removeEventListener('pointerenter', enter); root.removeEventListener('pointermove', move); root.removeEventListener('pointerleave', leave);
        document.removeEventListener('visibilitychange', visibility);
        window.removeEventListener('resize', requestMeasure);
        window.removeEventListener('scroll', requestMeasure);
      };
    });

    let entrancePlayed = false;
    media.add({ all: 'all', reducedMotion: '(prefers-reduced-motion: reduce)' }, context => {
      if (entrancePlayed) return;
      entrancePlayed = true;
      if (context.conditions?.reducedMotion) return;
      const copy = root.querySelector<HTMLElement>(`.${styles.heroCopy}`);
      if (!copy || !illustration.current) return;
      const entrance = gsap.timeline({
        defaults: { ease: 'power3.out', clearProps: 'transform,opacity' },
        // Allow a negative start so content already in view plays at scrollY=0.
        scrollTrigger: { trigger: copy, start: 'top 90%', once: true },
      });
      entrance.from(copy.children, { y: 14, opacity: 0, duration: .6, stagger: .055 });
      // In the stacked layout the illustration enters later than the headline.
      // Fade it in place to keep the pupil and spotlight geometry synchronized.
      const illustrationEntrance = gsap.timeline({
        defaults: { ease: 'power2.out', clearProps: 'opacity' },
        scrollTrigger: { trigger: illustration.current, start: 'top 90%', once: true },
      });
      illustrationEntrance.from(owl.current, { opacity: 0, duration: .5 })
        .from(preview.current, { opacity: 0, duration: .6 }, .08);
      // A keyboard user can reach a CTA before its entrance finishes.
      const finish = (event: FocusEvent) => {
        if (!(event.target instanceof Node)) return;
        const animation = copy.contains(event.target) ? entrance : illustrationEntrance;
        animation.progress(1);
        animation.scrollTrigger?.kill();
      };
      root.addEventListener('focusin', finish);
      return () => root.removeEventListener('focusin', finish);
    });
    return () => { media.revert(); };
  }, { scope: hero });

  return <section ref={hero} id="trang-chu" data-eye-tracking="static" aria-labelledby="hero-title" className={styles.hero}>
    {/* The full-width section owns light and coordinates; only content is centered. */}
    <svg ref={overlay} className={styles.eyeLights} data-eye-spotlights="" viewBox="0 0 1200 640" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        {[0,1].map(index=><linearGradient ref={node=>{gradients.current[index]=node;}} id={`${uid}-beam-${index}`} gradientUnits="userSpaceOnUse" key={index}><stop stopColor="#7DE3DD" stopOpacity=".24"/><stop offset=".25" stopColor="#5EE7DF" stopOpacity=".23"/><stop offset=".55" stopColor="#64D8D1" stopOpacity=".18"/><stop offset=".82" stopColor="#7DE3DD" stopOpacity=".07"/><stop offset="1" stopColor="#7DE3DD" stopOpacity="0"/></linearGradient>)}
        {[0,1].map(index=><linearGradient ref={node=>{ambientGradients.current[index]=node;}} id={`${uid}-ambient-${index}`} gradientUnits="userSpaceOnUse" key={index}><stop stopColor="#7DE3DD" stopOpacity=".12"/><stop offset=".35" stopColor="#64D8D1" stopOpacity=".10"/><stop offset=".7" stopColor="#7DE3DD" stopOpacity=".05"/><stop offset="1" stopColor="#7DE3DD" stopOpacity="0"/></linearGradient>)}
        {[5,14].map((amount,index)=><filter ref={node=>{filters.current[index]=node;}} id={`${uid}-soft-${index}`} filterUnits="userSpaceOnUse" x="-48" y="-48" width="1296" height="736" colorInterpolationFilters="sRGB" key={index}><feGaussianBlur stdDeviation={amount}/></filter>)}
      </defs>
      <g filter={`url(#${uid}-soft-1)`}>{[0,1].map(index=><path ref={node=>{ambientPaths.current[index]=node;}} data-eye-ambient={index===0?'left':'right'} fill={`url(#${uid}-ambient-${index})`} key={index}/>)}</g>
      <g filter={`url(#${uid}-soft-0)`}>{[0,1].map(index=><path ref={node=>{paths.current[index]=node;}} data-eye-beam={index===0?'left':'right'} fill={`url(#${uid}-beam-${index})`} key={index}/>)}</g>
    </svg>
    <div className={`${styles.container} ${styles.heroContent}`}>
    {children}
    <figure ref={illustration} className={styles.productPreview} aria-labelledby="preview-caption">
      <div className={styles.owlOrbit} aria-hidden="true" />
      <svg ref={owl} className={styles.owlCanvas} data-owl="proctoowl" viewBox="0 0 520 500" fill="none" aria-hidden="true">
        <ProctoOwlArtwork idPrefix={uid} eyeOrigins={origins} pupils={pupils} />
      </svg>
      <div ref={preview} className={styles.monitorPreview}>
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
    </div>
  </section>;
}
