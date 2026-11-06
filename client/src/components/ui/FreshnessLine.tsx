import clsx from 'clsx';
import { formatLastUpdated } from '@/lib/timezone';

export type FreshnessState = 'live' | 'reconnecting' | 'offline' | 'delayed' | 'stale' | 'loading' | 'unavailable';

const STATE_META: Record<
  FreshnessState,
  { label: string; dot: string; text: string; pulse: boolean }
> = {
  live: { label: 'Live', dot: 'bg-ok-400', text: 'text-ok-400', pulse: true },
  reconnecting: { label: 'Reconnecting', dot: 'bg-gold-400', text: 'text-gold-400', pulse: true },
  delayed: { label: 'Delayed', dot: 'bg-gold-400', text: 'text-gold-400', pulse: false },
  stale: { label: 'Stale', dot: 'bg-gold-400', text: 'text-gold-400', pulse: false },
  offline: { label: 'Offline', dot: 'bg-alert-400', text: 'text-alert-400', pulse: false },
  loading: { label: 'Loading', dot: 'bg-ink-400', text: 'text-ink-400', pulse: true },
  unavailable: { label: 'Unavailable', dot: 'bg-alert-400', text: 'text-alert-400', pulse: false },
};

interface FreshnessLineProps {
  state: FreshnessState;
  lastUpdated?: Date | string | number | null;
  hint?: string;
  compact?: boolean;
  className?: string;
}

export function FreshnessLine({ state, lastUpdated, hint, compact, className }: FreshnessLineProps) {
  const meta = STATE_META[state];
  const updated =
    lastUpdated == null
      ? null
      : typeof lastUpdated === 'number' || typeof lastUpdated === 'string'
        ? formatLastUpdated(new Date(lastUpdated))
        : formatLastUpdated(lastUpdated);

  return (
    <div className={clsx('flex flex-wrap items-center gap-2', className)}>
      <div
        className={clsx(
          'flex items-center gap-2 rounded-md border border-navy-700 bg-navy-900',
          compact ? 'px-2 py-1' : 'px-3 py-2'
        )}
        role="status"
        aria-live="polite"
      >
        <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
          {meta.pulse && (
            <span className={clsx('absolute inline-flex h-full w-full animate-ping rounded-full opacity-50', meta.dot)} />
          )}
          <span className={clsx('relative inline-flex h-2.5 w-2.5 rounded-full', meta.dot)} />
        </span>
        <div className="min-w-0">
          <p className={clsx('font-mono text-[11px] font-medium', meta.text)}>{meta.label}</p>
          {!compact && (
            <p className="font-mono text-[11px] text-ink-400">
              Last updated: {updated ?? '—'}
              {hint ? ` · ${hint}` : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Map admin live-sync state into FreshnessLine state. */
export function liveSyncToFreshness(
  state: 'live' | 'reconnecting' | 'offline',
  lastUpdated?: Date | null,
  maxAgeMs = 45_000
): FreshnessState {
  if (state === 'offline') return 'offline';
  if (state === 'reconnecting') return 'reconnecting';
  if (lastUpdated && Date.now() - lastUpdated.getTime() > maxAgeMs) return 'delayed';
  return 'live';
}
