import type { HTMLAttributes } from 'react';
import { borderProps, type BorderRole } from './Border';

type CardProps = HTMLAttributes<HTMLDivElement> & {
  borderRole?: string;
};

export function Card({
  className = '',
  borderRole,
  ...props
}: CardProps) {
  return (
    <div
      {...props}
      className={`ui-card ${className}`}
      data-border-role={borderRole}
    />
  );
}