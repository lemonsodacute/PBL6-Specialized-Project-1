'use client';

import { useEffect, type RefObject } from 'react';

/** Keep the launcher clear of visible actions without moving page content. */
export function useFloatingChatPosition(trigger: RefObject<HTMLButtonElement>) {
  useEffect(() => {
    let frame = 0;
    let panels: HTMLElement[] = [];
    const update = () => {
      frame = 0;
      const button = trigger.current;
      if (!button || button.hidden) return;
      const style = getComputedStyle(button);
      const oldOffset = parseFloat(button.style.getPropertyValue('--support-chat-obstacle-offset')) || 0;
      const baseBottom = parseFloat(style.bottom) - oldOffset;
      const right = innerWidth - parseFloat(style.right);
      const left = right - parseFloat(style.width);
      const height = parseFloat(style.height);
      const top = innerHeight - baseBottom - height;
      const header = document.querySelector('.topbar')?.getBoundingClientRect();
      const minTop = Math.max(12, header?.bottom ?? 0) + 8;
      const obstacles = panels.filter(panel => panel.getClientRects().length && getComputedStyle(panel).visibility !== 'hidden')
        .map(panel => panel.getBoundingClientRect())
        .filter(rect => rect.width && rect.height && rect.left < right + 8 && rect.right > left - 8 && rect.bottom > minTop && rect.top < innerHeight);
      // Always start at rest; offsets must not accumulate while scrolling.
      let candidate = top;
      for (let pass = 0; pass <= obstacles.length; pass++) {
        const collisions = obstacles.filter(rect => candidate < rect.bottom + 8 && candidate + height > rect.top - 8);
        if (!collisions.length) break;
        candidate = Math.min(...collisions.map(rect => rect.top - height - 8));
      }
      const offset = Math.max(0, top - Math.max(minTop, candidate));
      button.style.setProperty('--support-chat-obstacle-offset', `${offset}px`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule);
    const discover = () => {
      resize.disconnect();
      panels = Array.from(document.querySelectorAll<HTMLElement>('.selection-summary-panel, [data-chat-avoid], main button, main a[href], main input, main select, main textarea'))
        .filter(panel => !panel.closest('.floating-camera, [role="dialog"]'));
      panels.forEach(panel => resize.observe(panel));
      schedule();
    };
    // The selector can arrive after an asynchronous page load or navigation.
    const mutations = new MutationObserver(discover);
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, true);
    discover();
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect();
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
    };
  }, [trigger]);
}
