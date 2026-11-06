import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';

interface OpsSectionHeaderProps {
  title: string;
  href?: string;
  linkLabel?: string;
  action?: ReactNode;
  className?: string;
}

/** Uppercase ops-console section title matching Figma module headers. */
export function OpsSectionHeader({
  title,
  href,
  linkLabel = 'View all',
  action,
  className,
}: OpsSectionHeaderProps) {
  return (
    <div className={clsx('mb-3 flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1', className)}>
      <h3 className="min-w-0 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-200">
        {title}
      </h3>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {action}
        {href ? (
          <Link to={href} className="text-xs font-medium text-gold-500 hover:underline">
            {linkLabel}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

interface OpsCardProps {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}

export function OpsCard({ children, className, padded = true }: OpsCardProps) {
  return (
    <div className={clsx('card flex h-full min-h-0 min-w-0 flex-col overflow-hidden', padded && 'p-3 sm:p-4', className)}>
      {children}
    </div>
  );
}
