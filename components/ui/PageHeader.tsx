import type { ReactNode } from 'react';

type PageHeaderProps = {
  title: ReactNode;
  actions?: ReactNode;
  mode?: 'none' | 'context';
  context?: ReactNode;
  // Retained for compatibility; introductory text is never rendered.
  eyebrow?: string;
  description?: ReactNode;
};

export function PageHeader({ title, actions, mode = 'none', context }: PageHeaderProps) {
  // Collection/profile/dashboard intros are intentionally not rendered.
  // Detail/wizard callers opt into one small contextual line.
  if (mode === 'none') return actions ? <div className="page-actions-bar">{actions}</div> : null;
  return <header className="page-context">
    <div className="page-context-identity">
      {context && <span className="page-context-prefix">{context}<span aria-hidden="true"> / </span></span>}
      <h1>{title}</h1>
    </div>
    {actions && <div className="page-context-actions">{actions}</div>}
  </header>;
}
