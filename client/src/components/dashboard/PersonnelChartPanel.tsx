import { LIVE } from '@/lib/liveTiming';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { personnelApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { QueryState } from '@/components/ui/QueryState';
import { OpsSectionHeader } from '@/components/ui/OpsSection';
import { classifyPersonnelDuty, personnelUsersFromResponse } from '@/lib/workforceMetrics';
import clsx from 'clsx';

type DutyBucket = 'On Duty' | 'Off Duty' | 'On Leave' | 'Absent';

const BUCKET_META: Record<DutyBucket, { color: string }> = {
  'On Duty': { color: '#4fb87e' },
  'Off Duty': { color: '#6b7a8d' },
  'On Leave': { color: '#e8b84a' },
  Absent: { color: '#d4453a' },
};

function classifyStatus(status?: string): DutyBucket {
  const c = classifyPersonnelDuty(status);
  if (c === 'leave') return 'On Leave';
  if (c === 'off_duty') return 'Off Duty';
  if (c === 'on_duty') return 'On Duty';
  if (/absent/i.test(String(status ?? ''))) return 'Absent';
  return 'Off Duty';
}

function roundPercents(counts: number[], total: number): number[] {
  if (total <= 0) return counts.map(() => 0);
  const raw = counts.map((c) => (c / total) * 100);
  const floored = raw.map((v) => Math.floor(v));
  let rem = 100 - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floored];
  for (let k = 0; k < order.length && rem > 0; k += 1) {
    out[order[k].i] += 1;
    rem -= 1;
  }
  return out;
}

export function PersonnelChartPanel() {
  const { accessToken, user } = useAuthStore();
  const canManage = ['SYSTEM_ADMINISTRATOR', 'CENTRAL_DISPATCHER', 'DEPARTMENT_DISPATCHER'].includes(
    user?.role ?? ''
  );

  const query = useQuery({
    queryKey: ['personnel'],
    queryFn: () => personnelApi.list(accessToken!),
    enabled: !!accessToken && canManage,
    refetchInterval: LIVE.warmMs,
  });

  const people = useMemo(
    () => personnelUsersFromResponse(query.data?.data),
    [query.data?.data]
  );

  const chart = useMemo(() => {
    const order: DutyBucket[] = ['On Duty', 'Off Duty', 'On Leave', 'Absent'];
    const counts = order.map((b) =>
      people.filter((p) => classifyStatus(p.availabilityStatus || p.operationalStatus || p.status) === b).length
    );
    const total = people.length;
    const pct = roundPercents(counts, total);
    let cursor = 0;
    const stops: string[] = [];
    if (total === 0) stops.push('#1e2a3a 0% 100%');
    else {
      order.forEach((label, i) => {
        if (counts[i] === 0) return;
        const start = cursor;
        cursor += pct[i];
        stops.push(`${BUCKET_META[label].color} ${start}% ${cursor}%`);
      });
    }
    return {
      order,
      counts,
      pct,
      total,
      gradient: `conic-gradient(${stops.join(', ')})`,
    };
  }, [people]);

  return (
    <section className="card flex min-h-0 flex-col overflow-hidden">
      <OpsSectionHeader title="Personnel status" />
      <div className="min-h-0 flex-1 p-3">
        <p className="mb-3 text-xs text-ink-500">Roster duty (same rules as dashboard on-duty count)</p>
        <QueryState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error as Error}
          onRetry={() => void query.refetch()}
          isEmpty={!query.isLoading && chart.total === 0}
          emptyTitle="No personnel"
          emptyHint="Add responders in Personnel."
          showLastUpdated={false}
        >
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div
              className="relative h-36 w-36 shrink-0 rounded-full"
              style={{ background: chart.gradient }}
              aria-hidden
            >
              <div className="absolute inset-[18%] flex flex-col items-center justify-center rounded-full bg-navy-950">
                <span className="text-2xl font-bold text-ink-50">{chart.total}</span>
                <span className="font-mono text-[9px] uppercase tracking-wide text-ink-500">Roster</span>
              </div>
            </div>
            <ul className="min-w-0 w-full space-y-2 text-sm">
              {chart.order.map((label, i) => (
                <li key={label} className="flex items-center justify-between gap-2">
                  <span className="inline-flex min-w-0 items-center gap-2 text-ink-200">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: BUCKET_META[label].color }} />
                    <span className="truncate" title={label}>{label}</span>
                  </span>
                  <span className={clsx('shrink-0 font-mono text-xs', chart.counts[i] ? 'text-ink-100' : 'text-ink-500')}>
                    {chart.counts[i]} · {chart.pct[i]}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </QueryState>
      </div>
    </section>
  );
}
