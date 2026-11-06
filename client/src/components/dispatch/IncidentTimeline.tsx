import { LIVE } from '@/lib/liveTiming';
import { useQuery } from '@tanstack/react-query';
import { incidentsApi } from '@/services/api';
import { QueryState } from '@/components/ui/QueryState';
import clsx from 'clsx';

interface TimelineEvent {
  _id?: string;
  type?: string;
  action?: string;
  message?: string;
  note?: string;
  status?: string;
  createdAt?: string;
  timestamp?: string;
  actorName?: string;
  userId?: { fullName?: string } | string;
}

interface IncidentTimelineProps {
  token: string;
  incidentId: string;
  className?: string;
  compact?: boolean;
}

function eventLabel(ev: TimelineEvent): string {
  return (
    ev.message ||
    ev.note ||
    ev.action ||
    ev.type ||
    ev.status ||
    'Activity recorded'
  );
}

import { formatManilaDateTime } from '@/lib/timezone';

function eventTime(ev: TimelineEvent): string {
  const raw = ev.createdAt || ev.timestamp;
  if (!raw) return '—';
  return formatManilaDateTime(raw);
}

function actorName(ev: TimelineEvent): string {
  if (typeof ev.userId === 'object' && ev.userId?.fullName) return ev.userId.fullName;
  if (ev.actorName) return ev.actorName;
  return '';
}

/**
 * Compute the elapsed duration between two consecutive ISO timestamps.
 * Returns a formatted string like "+2m 15s", or null if either timestamp is missing/invalid.
 */
function computeElapsed(prevIso: string | undefined, currIso: string | undefined): string | null {
  if (!prevIso || !currIso) return null;
  const prev = Date.parse(prevIso);
  const curr = Date.parse(currIso);
  if (Number.isNaN(prev) || Number.isNaN(curr)) return null;
  const diffSec = Math.round((curr - prev) / 1000);
  if (diffSec <= 0) return null;
  const m = Math.floor(diffSec / 60);
  const s = diffSec % 60;
  if (m === 0) return `+${s}s`;
  if (s === 0) return `+${m}m`;
  return `+${m}m ${s}s`;
}

export function IncidentTimeline({ token, incidentId, className, compact }: IncidentTimelineProps) {
  const query = useQuery({
    queryKey: ['incident-timeline', incidentId],
    queryFn: () => incidentsApi.timeline(token, incidentId),
    enabled: !!token && !!incidentId,
    refetchInterval: LIVE.hotMs,
  });

  const events = (query.data?.data ?? []) as TimelineEvent[];

  return (
    <div className={clsx('flex min-h-0 flex-col', className)}>
      <h4 className={clsx('shrink-0 font-semibold text-ink-100', compact ? 'mb-1.5 text-xs' : 'mb-2 text-sm')}>
        Activity timeline
      </h4>
      <div className="min-h-0 flex-1 overflow-hidden">
        <QueryState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error as Error}
          onRetry={() => query.refetch()}
          isEmpty={!query.isLoading && events.length === 0}
          emptyTitle="No timeline events yet"
          emptyHint="Status changes and assignments will appear here."
          showLastUpdated={false}
        >
          <ol
            className={clsx(
              'relative h-full space-y-2 overflow-y-auto border-l border-navy-700 pl-3.5 sidebar-scroll',
              compact ? 'space-y-1.5' : 'space-y-3'
            )}
            aria-label="Incident activity timeline"
          >
            {events.map((ev, idx) => {
              const prevEv = idx > 0 ? events[idx - 1] : null;
              const prevRaw = prevEv ? (prevEv.createdAt || prevEv.timestamp) : undefined;
              const currRaw = ev.createdAt || ev.timestamp;
              const elapsed = computeElapsed(prevRaw, currRaw);
              return (
                <li key={ev._id ?? `${eventTime(ev)}-${idx}`} className="relative">
                  {elapsed && (
                    <span
                      className="mb-1 inline-block rounded-full bg-navy-800 px-2 py-0.5 font-mono text-[9px] text-ink-500"
                      aria-label={`Time since previous event: ${elapsed}`}
                    >
                      {elapsed}
                    </span>
                  )}
                  <span
                    className="absolute -left-[1.2rem] top-1.5 h-2 w-2 rounded-full border border-navy-600 bg-gold-500"
                    aria-hidden="true"
                  />
                  <p className={clsx('text-ink-100', compact ? 'text-xs leading-snug' : 'text-sm')}>{eventLabel(ev)}</p>
                  <p className="font-mono text-[10px] text-ink-500">
                    {eventTime(ev)}
                    {actorName(ev) ? ` · ${actorName(ev)}` : ''}
                  </p>
                </li>
              );
            })}
          </ol>
        </QueryState>
      </div>
    </div>
  );
}
