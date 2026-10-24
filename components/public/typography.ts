import { Baloo_2, Nunito } from 'next/font/google';

// Shared by Home and the workspaces; preload Latin and Vietnamese together.
const display = Baloo_2({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-public-heading',
  weight: ['700', '800'],
  style: 'normal',
  display: 'swap',
  // The body font is the whole-heading fallback if the display face is unavailable.
  fallback: ['var(--font-public-body)', 'Arial'],
  adjustFontFallback: false,
});

const body = Nunito({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700', '800'],
  style: 'normal',
  variable: '--font-public-body',
  display: 'swap',
  fallback: ['Arial'],
});

// Official product typography, reused by public pages and every workspace.
export const publicTypography = `${display.variable} ${body.variable}`;
