import type { ReactNode } from 'react';
import clsx from 'clsx';

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}

/** Shared page title block for admin console screens. Colors stay on existing tokens. */
export function PageHeader({ eyebrow = 'Operations', title, subtitle, actions, meta, className }: PageHeaderProps) {
  return (
    <div className={clsx('flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between', className)}>
      <div className="min-w-0 flex-1">
        {eyebrow ? (
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-gold-500">{eyebrow}</p>
        ) : null}
        <h2 className="text-xl font-bold text-ink-50 sm:text-2xl">{title}</h2>
        {subtitle ? <p className="text-sm text-ink-400">{subtitle}</p> : null}
        {meta ? <div className="mt-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div> : null}
    </div>
  );
}
