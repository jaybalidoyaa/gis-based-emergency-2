import { useAdminLiveSync } from '@/hooks/LiveSyncContext';
import { formatLastUpdated } from '@/lib/timezone';
import clsx from 'clsx';

const STATE_META = {
  live: { label: 'Connected', dot: 'bg-ok-400', text: 'text-ok-400', pulse: true },
  reconnecting: { label: 'Reconnecting', dot: 'bg-gold-400', text: 'text-gold-400', pulse: true },
  offline: { label: 'Disconnected', dot: 'bg-alert-400', text: 'text-alert-400', pulse: false },
} as const;

export function DashboardLiveHeader() {
  const { state, lastUpdated } = useAdminLiveSync();
  const meta = STATE_META[state];

  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-gold-500">Operations</p>
        <h2 className="text-2xl font-bold text-ink-50">Live dashboard</h2>
        <p className="text-sm text-ink-400">Sun Valley, Parañaque — Brigada Onse SVFAR</p>
      </div>
      <div
        className="flex items-center gap-2 rounded-md border border-navy-700 bg-navy-900 px-3 py-2"
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
          <p className="font-mono text-[11px] text-ink-400">
            Last updated: {lastUpdated ? formatLastUpdated(lastUpdated) : '—'}
          </p>
        </div>
      </div>
    </div>
  );
}
