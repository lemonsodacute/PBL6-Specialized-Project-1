import type { CSSProperties } from 'react';

/** Presentation only: classify the box's purpose, independently of chart colors. */
export type BorderRole = 'neutral' | 'users' | 'classes' | 'exams' | 'warning' | 'success' | 'danger';

export function borderProps(role?: BorderRole): { 'data-border-role'?: BorderRole; style?: CSSProperties } {
  return role ? { 'data-border-role': role, style: { borderColor: 'var(--card-border-color)' } } : {};
}
