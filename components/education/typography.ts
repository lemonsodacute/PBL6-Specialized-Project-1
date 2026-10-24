import localFont from 'next/font/local';
import styles from './Typography.module.css';

// Self-hosted, Vietnamese-complete subsets. Only the two education surfaces opt in.
const display = localFont({
  src: './fonts/baloo2-latin-vietnamese.woff2',
  variable: '--font-education-display',
  weight: '700 800',
  style: 'normal',
  display: 'swap',
  fallback: ['Arial'],
});

const heading = localFont({
  src: './fonts/nunito-latin-vietnamese.woff2',
  variable: '--font-education-heading',
  weight: '600 800',
  style: 'normal',
  display: 'swap',
  fallback: ['Arial'],
});

export const educationTypography = `${display.variable} ${heading.variable} ${styles.education}`;
