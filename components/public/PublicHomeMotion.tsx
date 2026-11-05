'use client';

import { useRef, type ReactNode } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import styles from './PublicHome.module.css';

gsap.registerPlugin(useGSAP);

// Keep secondary content still; motion highlights headings, features and CTAs.
const revealSelectors = [styles.sectionHeading, styles.aiIntro, styles.supportIntro, styles.finalCta]
  .map(className => `.${className}`).join(',');

/** A client animation boundary; all page content remains server rendered. */
export function PublicHomeMotion({ children, className }: { children: ReactNode; className: string }) {
  const page = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const root = page.current;
    if (!root) return;
    gsap.registerPlugin(ScrollTrigger);
    const media = gsap.matchMedia();

    media.add('(prefers-reduced-motion: no-preference)', context => {
      const blocks = Array.from(root.querySelectorAll<HTMLElement>(revealSelectors));
      const cards = root.querySelectorAll<HTMLElement>(`.${styles.feature}`);
      // This media-query context also owns tweens created by later batch events.
      context.add('revealFeatures', (batch: Element[]) => {
        gsap.to(batch, {
          y: 0, opacity: 1, duration: .55, stagger: .045,
          ease: 'power2.out', overwrite: 'auto', clearProps: 'transform,opacity',
        });
      });
      const reveals = blocks.map(block => {
        const isCta = block.classList.contains(styles.finalCta) || block.classList.contains(styles.supportIntro);
        const reveal = gsap.from(block, {
          y: isCta ? 16 : 12,
          opacity: 0,
          duration: isCta ? .6 : .5,
          ease: 'power2.out',
          clearProps: 'transform,opacity',
          scrollTrigger: { trigger: block, start: 'top 90%', once: true },
        });
        // Create triggers in page order, batching only cards entering together.
        // Later cards in the stacked mobile layout wait until they are reached.
        if (block.closest('#tinh-nang')) {
          gsap.set(cards, { y: 16, opacity: 0 });
          ScrollTrigger.batch(cards, {
            start: 'top 90%', once: true, interval: .06, batchMax: 3,
            onEnter: batch => context.revealFeatures(batch),
            // Measure each card in its resting position during a layout refresh.
            onRefreshInit: trigger => gsap.set(trigger.trigger!, { y: 0 }),
          });
        }
        return reveal;
      });

      // Complete a reveal immediately when focus moves into it, even if it was
      // reached via a skip link, keyboard navigation, or an anchor jump.
      const finishFocusedSection = (event: FocusEvent) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        const index = blocks.findIndex(block => block.contains(target));
        if (index < 0) return;
        reveals[index].progress(1);
        reveals[index].scrollTrigger?.kill();
      };
      root.addEventListener('focusin', finishFocusedSection);

      // Fonts, FAQ expansion and responsive reflow can move later CTA triggers.
      // Transform/opacity animation does not resize this observer's layout box.
      let refreshFrame = 0;
      const size = new ResizeObserver(() => {
        if (!refreshFrame) refreshFrame = requestAnimationFrame(() => {
          refreshFrame = 0;
          ScrollTrigger.refresh();
        });
      });
      size.observe(root);
      return () => {
        root.removeEventListener('focusin', finishFocusedSection);
        size.disconnect();
        cancelAnimationFrame(refreshFrame);
      };
    });

    return () => { media.revert(); };
  }, { scope: page });

  return <div ref={page} className={className}>{children}</div>;
}
