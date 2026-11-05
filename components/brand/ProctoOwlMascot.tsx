'use client';

import { useId, type MutableRefObject } from 'react';
import styles from './ProctoOwlMascot.module.css';

type Direction = 'left' | 'right';
type ArtworkProps = {
  idPrefix: string;
  direction?: Direction;
  silhouette?: boolean;
  eyeOrigins?: MutableRefObject<(SVGCircleElement | null)[]>;
  pupils?: MutableRefObject<(SVGGElement | null)[]>;
};

const bodyPath = 'M133 177L108 63L193 91Q260 66 327 91L412 63L387 177Q414 249 396 314Q379 386 319 410H201Q141 386 124 314Q106 249 133 177Z';

/** One artwork source for Home's interactive hero and every static mascot. */
export function ProctoOwlArtwork({ idPrefix: uid, direction, silhouette, eyeOrigins, pupils }: ArtworkProps) {
  if (silhouette) return <path d={bodyPath} fill="currentColor" />;
  return <>
    <defs>
      <linearGradient id={`${uid}-body`} x1="145" y1="90" x2="388" y2="407" gradientUnits="userSpaceOnUse"><stop stopColor="var(--owl-body-top, #13838A)" /><stop offset="1" stopColor="var(--owl-body, #006D77)" /></linearGradient>
      <radialGradient id={`${uid}-eye`}><stop stopColor="#C4EFE8" stopOpacity=".18" /><stop offset="1" stopColor="#C4EFE8" stopOpacity="0" /></radialGradient>
    </defs>
    <path d={bodyPath} fill={`url(#${uid}-body)`} />
    <path d="M135 246Q122 336 185 371Q152 309 166 252L135 246ZM385 246Q398 336 335 371Q368 309 354 252L385 246Z" fill="var(--owl-wing, #005B64)" opacity=".65" />
    <path d="M180 301Q260 251 340 301L321 408H199L180 301Z" fill="#D2EAE4" />
    <path d="M198 104Q230 101 260 132Q290 101 322 104Q379 107 379 174Q379 243 315 247Q283 245 260 224Q237 245 205 247Q141 243 141 174Q141 107 198 104Z" fill="#ECF5EB" />
    <circle cx="204" cy="173" r="44" fill="#FFFDF4" />
    <circle cx="316" cy="173" r="44" fill="#FFFDF4" />
    {[204, 316].map((cx, index) => <g ref={node => { if (pupils) pupils.current[index] = node; }} data-pupil={index === 0 ? 'left' : 'right'} key={cx} transform={direction ? `translate(${direction === 'left' ? -5 : 5} 2)` : undefined}>
      <circle cx={cx} cy="174" r="28" fill="var(--owl-iris, #E9C777)" />
      <circle ref={node => { if (eyeOrigins) eyeOrigins.current[index] = node; }} data-eye-origin={index === 0 ? 'left' : 'right'} cx={cx} cy="174" r="19" fill="#183D43" />
      <circle cx={cx + 7} cy="166" r="7" fill="#FFFDF4" />
      <circle cx={cx - 7} cy="182" r="3" fill="#7BB9B3" />
    </g>)}
    <path d="M248 222Q260 215 272 222L260 240L248 222Z" fill="var(--owl-beak, #DDAE50)" />
    <path d="M165 122Q191 104 217 117M303 117Q329 104 355 122" stroke="var(--owl-wing, #00616B)" strokeWidth="7" strokeLinecap="round" />
    <circle cx="204" cy="173" r="56" fill={`url(#${uid}-eye)`} /><circle cx="316" cy="173" r="56" fill={`url(#${uid}-eye)`} />
    <path d="M246 285L260 297L274 285M246 309L260 321L274 309" stroke="#9BC8BE" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </>;
}

type MascotProps = {
  variant?: 'peek' | 'corner' | 'watermark' | 'empty-state' | 'compact';
  size?: 'sm' | 'md' | 'lg';
  direction?: Direction;
  decorative?: boolean;
  label?: string;
  className?: string;
};

/** Static, inert decoration. Pointer tracking belongs exclusively to PublicHero. */
export function ProctoOwlMascot({ variant = 'corner', size = 'md', direction = 'left', decorative = true, label = 'Cú ProctoOwl', className = '' }: MascotProps) {
  const uid = `mascot-${useId().replace(/:/g, '')}`;
  return <svg className={`${styles.mascot} ${styles[variant]} ${styles[size]} ${className}`}
    data-mascot={variant} data-direction={direction} viewBox={variant === 'peek' ? '92 48 336 290' : '92 48 336 380'} fill="none"
    aria-hidden={decorative ? true : undefined} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : label} focusable="false">
    <ProctoOwlArtwork idPrefix={uid} direction={direction} silhouette={variant === 'watermark'} />
  </svg>;
}
