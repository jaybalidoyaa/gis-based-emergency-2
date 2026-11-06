import { Button } from '@/components/ui/button';

interface QueryStateProps {
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  lastUpdated?: Date | string | number | null;
  /** When false, suppresses the trailing “Last updated” line (default true for backward compat). */
  showLastUpdated?: boolean;
  children?: React.ReactNode;
  skeleton?: React.ReactNode;
  className?: string;
}

function formatUpdated(value: QueryStateProps['lastUpdated']) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString();
}

export function QueryState({
  isLoading,
  isError,
  error,
  onRetry,
  isEmpty,
  emptyTitle = 'Nothing to show',
  emptyHint,
  lastUpdated,
  showLastUpdated = true,
  children,
  skeleton,
  className,
}: QueryStateProps) {
  const updated = showLastUpdated ? formatUpdated(lastUpdated) : null;

  if (isLoading) {
    return (
      <div className={className}>
        {skeleton ?? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading">
            <div className="h-4 w-1/3 animate-pulse rounded bg-navy-700" />
            <div className="h-24 animate-pulse rounded bg-navy-800" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-navy-700" />
          </div>
        )}
      </div>
    );
  }

  if (isError) {
    return (
      <div className={`rounded-lg border border-alert-500/40 bg-alert-500/10 p-6 text-center ${className ?? ''}`} role="alert">
        <p className="font-medium text-alert-400">Could not load data</p>
        <p className="mt-1 text-sm text-ink-400">{error?.message || 'Connection error. Check your network and try again.'}</p>
        {onRetry && (
          <Button type="button" variant="outline" className="mt-4" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className={`p-8 text-center text-ink-400 ${className ?? ''}`}>
        <p className="font-medium text-ink-200">{emptyTitle}</p>
        {emptyHint && <p className="mt-1 text-sm">{emptyHint}</p>}
        {updated && <p className="mt-3 font-mono text-[11px] text-ink-500">Last updated {updated}</p>}
      </div>
    );
  }

  return (
    <div className={className}>
      {children}
      {updated && <p className="mt-3 font-mono text-[11px] text-ink-500">Last updated {updated}</p>}
    </div>
  );
}
