import type { ButtonHTMLAttributes } from 'react';

type Variant =
  | 'primary' | 'secondary' | 'outline' | 'ghost'
  | 'info' | 'success' | 'warning' | 'danger' | 'icon'
  | 'filled-pill' | 'ghost-text' | 'ghost-outlined';
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
};
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  /* Legacy aliases kept for backward-compat; new semantic variants map to themselves */
  const appearance: string =
    { 'filled-pill': 'primary', 'ghost-text': 'ghost', 'ghost-outlined': 'outline' }[variant as string]
    ?? variant;
    const classes = [
      'ui-button',
      `ui-button-${variant}`,
      variant !== appearance ? `ui-button-${appearance}` : null,
      `ui-button-${size}`,
      className,
    ].filter(Boolean).join(' ');
    return (
      <button
        className={classes}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
      {loading && <span className="ui-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function IconButton({label,children,...props}:Omit<ButtonProps,'variant'|'aria-label'>&{label:string}){
  return <Button type="button" {...props} variant="icon" aria-label={label}>{children}</Button>;
}

