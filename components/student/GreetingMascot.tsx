'use client';

import { useEffect, useRef, useState } from 'react';
import { ProctoOwlMascot } from '@/components/brand/ProctoOwlMascot';

/** A long name or translated date gets priority over the decoration. */
export function GreetingMascot({ className }: { className: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(false);
  useEffect(() => {
    const node = anchor.current, copy = node?.previousElementSibling, date = node?.nextElementSibling;
    if (!node || !copy || !date || !node.parentElement) return;
    const measure = () => {
      const owl = node.getBoundingClientRect(), text = copy.getBoundingClientRect(), note = date.getBoundingClientRect();
      setFits(owl.width > 0 && text.right + 20 <= owl.left && owl.right + 20 <= note.left);
    };
    const observer = new ResizeObserver(measure);
    [node.parentElement, copy, date].forEach(el => observer.observe(el));
    measure();
    return () => observer.disconnect();
  }, []);
  return <span ref={anchor} className={className} style={{ visibility: fits ? 'visible' : 'hidden', pointerEvents: 'none' }} aria-hidden="true">
    <ProctoOwlMascot variant="corner" />
  </span>;
}
