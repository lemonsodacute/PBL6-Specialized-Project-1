import localFont from 'next/font/local';

// Shared by Home and the workspaces; preload Latin and Vietnamese together.
const display = localFont({
  src: './fonts/baloo2-latin-vietnamese.woff2',
  variable: '--font-public-heading',
  weight: '400 800',
  style: 'normal',
  display: 'swap',
  // The body font is the whole-heading fallback if the display face is unavailable.
  fallback: ['var(--font-public-body)', 'Arial'],
  adjustFontFallback: false,
});

const body = localFont({
  src: './fonts/nunito-latin-vietnamese.woff2',
  weight: '200 1000',
  style: 'normal',
  variable: '--font-public-body',
  display: 'swap',
  adjustFontFallback: false,
  fallback: ['Arial'],
});

// Official product typography, reused by public pages and every workspace.
export const publicTypography = `${display.variable} ${body.variable}`;
