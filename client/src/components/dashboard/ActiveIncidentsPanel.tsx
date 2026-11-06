import { Link } from 'react-router-dom';
import type { Incident } from '@/types';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getIncidentTypeVisual } from '@/lib/opsVisuals';
import { elapsedLabel, formatManilaDateTime } from '@/lib/timezone';
import { QueryState } from '@/components/ui/QueryState';
import { OpsSectionHeader } from '@/components/ui/OpsSection';
import { EnvironmentBadge } from '@/constants/incident-environment';
import clsx from 'clsx';

interface ActiveIncidentsPanelProps {
  incidents: Incident[];
  isLoading: boolean;
  isError: boolean;
  error?: Error | null;
  onRetry: () => void;
}

function shortenAddress(text?: string, max = 42) {
  if (!text) return 'Address unavailable';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function ActiveIncidentsPanel({
  incidents,
  isLoading,
  isError,
  error,
  onRetry,
}: ActiveIncidentsPanelProps) {
  return (
    <div className="card flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden p-3 sm:p-4">
      <OpsSectionHeader title="Active incidents" href="/admin/incidents" className="shrink-0" />
      <QueryState
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={onRetry}
        isEmpty={incidents.length === 0}
        emptyTitle="No active incidents."
        emptyHint="New SOS and intake calls will appear here."
        showLastUpdated={false}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        skeleton={
          <div className="space-y-3" aria-busy="true" aria-label="Loading incidents">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-md bg-navy-800" />
            ))}
          </div>
        }
      >
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto sidebar-scroll pr-1" role="list">
          {incidents.map((inc) => {
            const visual = getIncidentTypeVisual(inc.incidentTypeId?.typeName);
            const Icon = visual.icon;
            const units = inc.assignments?.length ?? 0;
            const elapsed = elapsedLabel(inc.reportedAt);
            const href = `/admin/incidents/${inc._id}`;
            const label = `${inc.displayId}, ${visual.label}, ${inc.priorityLevel}, ${inc.status}`;

            return (
              <li key={inc._id}>
                <Link
                  to={href}
                  className={clsx(
                    'block rounded-md border border-navy-700 bg-navy-900/70 p-2.5 transition-colors sm:p-3',
                    'hover:border-gold-500/50 hover:bg-navy-800',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-950'
                  )}
                  aria-label={label}
                >
                  <div className="flex gap-2.5 sm:gap-3">
                    <span
                      className={clsx(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-md sm:h-10 sm:w-10',
                        visual.colorClass
                      )}
                      aria-hidden="true"
                    >
                      <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="truncate font-mono text-sm font-semibold text-ink-50">{inc.displayId}</p>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <EnvironmentBadge env={inc.environment} />
                          <StatusBadge status={inc.status} />
                        </div>
                      </div>
                      <p className="mt-0.5 truncate text-sm font-medium text-ink-100">{visual.label}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                        <StatusBadge status={inc.priorityLevel} />
                        {elapsed && <span className="font-mono text-gold-500">Elapsed {elapsed}</span>}
                      </div>
                      <p className="mt-1 truncate text-xs text-ink-400">{shortenAddress(inc.locationId?.addressText)}</p>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-ink-500">
                        <span>{formatManilaDateTime(inc.reportedAt)}</span>
                        <span>
                          {units} unit{units === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </QueryState>
    </div>
  );
}
