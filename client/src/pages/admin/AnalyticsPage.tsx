import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  MapPin,
  Siren,
  Truck,
  XCircle,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { analyticsApi } from '@/services/api';
import { QueryState } from '@/components/ui/QueryState';
import { PageHeader } from '@/components/ui/PageHeader';
import { OpsSectionHeader } from '@/components/ui/OpsSection';
import { KpiCard } from '@/components/ui/KpiCard';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { FreshnessLine, liveSyncToFreshness } from '@/components/ui/FreshnessLine';
import { useAdminLiveSync } from '@/hooks/LiveSyncContext';
import clsx from 'clsx';

type AnalyticsData = {
  totalIncidents?: number;
  byCategory?: Record<string, number>;
  byStatus?: Record<string, number>;
  byPriority?: Record<string, number>;
  peakHours?: number[];
  avgAckSeconds?: number;
  avgDispatchSeconds?: number;
  avgTravelSeconds?: number;
  avgOnSceneSeconds?: number;
  unitUtilization?: number;
  unitsReady?: number;
  unitsTotal?: number;
  cancelled?: number;
  falseAlarm?: number;
  reopened?: number;
  resolved?: number;
  active?: number;
  heatmap?: { lat: number; lng: number; weight: number }[];
  responseTrend?: { date: string; count: number; avgResponse?: number | null }[];
  kmeansGroups?: { group: number; size: number; centroid: { lat: number; lng: number } }[];
  dataNotes?: string;
  trainingExcluded?: boolean;
};

const CHART_COLORS = [
  '#e8b84a',
  '#38bdf8',
  '#4fb87e',
  '#d4453a',
  '#a78bfa',
  '#fb923c',
  '#22d3ee',
  '#f472b6',
  '#94a3b8',
  '#84cc16',
];

const PRESETS = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
] as const;

function ymdDaysAgo(days: number) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function formatDuration(seconds?: number) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function entriesFromRecord(rec?: Record<string, number>) {
  return Object.entries(rec ?? {})
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
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

function DonutChart({
  items,
  totalLabel,
  size = 140,
}: {
  items: { label: string; count: number; color: string }[];
  totalLabel?: string;
  size?: number;
}) {
  const total = items.reduce((a, b) => a + b.count, 0);
  const pct = roundPercents(
    items.map((i) => i.count),
    total
  );
  let cursor = 0;
  const stops: string[] = [];
  if (total === 0) {
    stops.push('#1e2a3a 0% 100%');
  } else {
    items.forEach((item, i) => {
      if (item.count === 0) return;
      const start = cursor;
      cursor += pct[i];
      stops.push(`${item.color} ${start}% ${cursor}%`);
    });
  }
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
      <div
        className="relative shrink-0"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`Donut chart total ${total}`}
      >
        <div className="h-full w-full rounded-full" style={{ background: `conic-gradient(${stops.join(', ')})` }} />
        <div className="absolute inset-[28%] flex flex-col items-center justify-center rounded-full bg-navy-900">
          <span className="font-mono text-xl font-bold leading-none text-ink-50">{total}</span>
          <span className="mt-0.5 text-[9px] uppercase tracking-wide text-ink-400">{totalLabel ?? 'Total'}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-1.5">
        {items.map((item, i) => (
          <li
            key={item.label}
            className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-navy-700 bg-navy-950/50 px-2.5 py-1.5"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: item.color }} aria-hidden />
              <span className="truncate text-xs text-ink-200">{item.label}</span>
            </span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-ink-50">
              {item.count}
              <span className="text-ink-500"> · {total ? pct[i] : 0}%</span>
            </span>
          </li>
        ))}
        {!items.length && <li className="text-sm text-ink-500">No data in range</li>}
      </ul>
    </div>
  );
}

function HBarChart({ items }: { items: { label: string; count: number; color: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label} className="min-w-0">
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-ink-200">{item.label}</span>
            <span className="shrink-0 font-mono tabular-nums text-ink-400">{item.count}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-navy-800">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${(item.count / max) * 100}%`, background: item.color }}
            />
          </div>
        </li>
      ))}
      {!items.length && <li className="text-sm text-ink-500">No data in range</li>}
    </ul>
  );
}

function PeakHoursChart({ hours }: { hours: number[] }) {
  const max = Math.max(1, ...hours);
  const peakHour = hours.indexOf(Math.max(...hours));
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-400">
        <span>Asia/Manila clock</span>
        {Math.max(...hours) > 0 ? (
          <span>
            Peak · <span className="font-mono text-gold-400">{String(peakHour).padStart(2, '0')}:00</span> (
            {hours[peakHour]} calls)
          </span>
        ) : null}
      </div>
      <div className="flex h-40 items-end gap-0.5 sm:gap-1">
        {hours.map((n, hour) => (
          <div key={hour} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${hour}:00 — ${n}`}>
            <span className="font-mono text-[9px] text-ink-500">{n || ''}</span>
            <div
              className={clsx(
                'w-full rounded-t transition-[height] duration-500',
                hour === peakHour && n > 0 ? 'bg-gold-400' : 'bg-gold-500/55'
              )}
              style={{ height: `${(n / max) * 100}%`, minHeight: n ? 3 : 0 }}
            />
            {hour % 3 === 0 ? <span className="text-[9px] text-ink-500">{hour}</span> : <span className="h-3" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendLineChart({
  rows,
}: {
  rows: { date: string; count: number; avgResponse?: number | null }[];
}) {
  const width = 640;
  const height = 180;
  const pad = { t: 16, r: 12, b: 28, l: 36 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const points = rows.map((r, i) => {
    const x = pad.l + (rows.length <= 1 ? innerW / 2 : (i / (rows.length - 1)) * innerW);
    const y = pad.t + innerH - (r.count / maxCount) * innerH;
    return { x, y, ...r };
  });
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area =
    points.length > 0
      ? `${line} L${points[points.length - 1].x.toFixed(1)},${(pad.t + innerH).toFixed(1)} L${points[0].x.toFixed(1)},${(
          pad.t + innerH
        ).toFixed(1)} Z`
      : '';

  if (!rows.length) {
    return <p className="py-8 text-center text-sm text-ink-500">No daily trend in this range</p>;
  }

  return (
    <div className="min-w-0 overflow-x-auto sidebar-scroll">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full min-w-[420px]" role="img" aria-label="Incident volume trend">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = pad.t + innerH * (1 - t);
          return (
            <g key={t}>
              <line x1={pad.l} y1={y} x2={width - pad.r} y2={y} stroke="#1e2a3a" strokeWidth={1} />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" className="fill-ink-500" fontSize={10}>
                {Math.round(maxCount * t)}
              </text>
            </g>
          );
        })}
        {area ? <path d={area} fill="rgba(232,184,74,0.16)" /> : null}
        {line ? <path d={line} fill="none" stroke="#e8b84a" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" /> : null}
        {points.map((p) => (
          <circle key={p.date} cx={p.x} cy={p.y} r={3.2} fill="#e8b84a" stroke="#0b1220" strokeWidth={1.5}>
            <title>{`${p.date}: ${p.count} incidents${p.avgResponse ? ` · avg response ${formatDuration(p.avgResponse)}` : ''}`}</title>
          </circle>
        ))}
        {points
          .filter((_, i) => i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 5) === 0)
          .map((p) => (
            <text key={`lbl-${p.date}`} x={p.x} y={height - 8} textAnchor="middle" className="fill-ink-500" fontSize={9}>
              {p.date.slice(5)}
            </text>
          ))}
      </svg>
    </div>
  );
}

function PipelineBars({
  ack,
  dispatch,
  travel,
  scene,
}: {
  ack: number;
  dispatch: number;
  travel: number;
  scene: number;
}) {
  const steps = [
    {
      label: 'Dispatched→Ack',
      value: ack,
      color: '#38bdf8',
      tooltip: 'Time from first dispatch action to first unit acknowledgement. Entries missing either timestamp are excluded.',
    },
    {
      label: 'Verified→Dispatched',
      value: dispatch,
      color: '#a78bfa',
      tooltip: 'Time from incident verification to dispatch action.',
    },
    {
      label: 'En Route→Scene',
      value: travel,
      color: '#e8b84a',
      tooltip: 'Time from unit en-route status to arrival on scene.',
    },
    {
      label: 'Scene→Resolved',
      value: scene,
      color: '#4fb87e',
      tooltip: 'Time from on-scene arrival to incident resolution.',
    },
  ];
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="space-y-3">
      <div className="flex h-36 items-end gap-3">
        {steps.map((s) => (
          <div key={s.label} className="flex min-w-0 flex-1 flex-col items-center gap-2" title={s.tooltip}>
            <span className="font-mono text-[11px] text-ink-300">{formatDuration(s.value)}</span>
            <div
              className="w-full max-w-[64px] rounded-t-md"
              style={{ height: `${(s.value / max) * 100}%`, minHeight: s.value ? 8 : 2, background: s.color }}
              aria-label={`${s.label}: ${formatDuration(s.value)}`}
            />
            <span className="text-center text-[10px] text-ink-400 leading-tight">{s.label}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-500">Average stage times for incidents with complete timestamps in range.</p>
      <p className="rounded-md border border-navy-700 bg-navy-950/40 px-3 py-2 text-[11px] text-ink-400">
        <strong className="text-ink-300">Acknowledgement</strong> = time from first dispatch to first unit acknowledgement.
        Calculated server-side from <code className="font-mono text-ink-300">dispatched_at → acknowledged_at</code>.
        Entries with missing or negative timestamps are excluded.
      </p>
    </div>
  );
}

export function AnalyticsPage() {
  const { accessToken } = useAuthStore();
  const live = useAdminLiveSync();
  const [from, setFrom] = useState(() => ymdDaysAgo(30));
  const [to, setTo] = useState(() => todayYmd());
  const [preset, setPreset] = useState<string>('30d');
  const [includeTraining, setIncludeTraining] = useState(false);

  const { data, isLoading, isError, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['analytics', from, to, includeTraining],
    queryFn: () =>
      analyticsApi.get(accessToken!, {
        from,
        to,
        ...(includeTraining ? { includeTraining: '1' } : {}),
      }),
    enabled: !!accessToken,
  });
  const stats = data?.data as AnalyticsData | undefined;

  const categoryItems = useMemo(() => {
    return entriesFromRecord(stats?.byCategory).map((e, i) => ({
      ...e,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [stats?.byCategory]);

  const statusItems = useMemo(() => {
    return entriesFromRecord(stats?.byStatus).map((e, i) => ({
      ...e,
      color: CHART_COLORS[(i + 2) % CHART_COLORS.length],
    }));
  }, [stats?.byStatus]);

  const priorityItems = useMemo(() => {
    const order = ['Critical', 'High', 'Moderate', 'Low', 'Unknown'];
    const rec = { ...(stats?.byPriority ?? {}) };
    if (rec.Medium) {
      rec.Moderate = (rec.Moderate ?? 0) + rec.Medium;
      delete rec.Medium;
    }
    const colors: Record<string, string> = {
      Critical: '#d4453a',
      High: '#fb923c',
      Moderate: '#e8b84a',
      Low: '#38bdf8',
      Unknown: '#6b7a8d',
    };
    const keys = [...order.filter((k) => rec[k]), ...Object.keys(rec).filter((k) => !order.includes(k))];
    return keys.map((label) => ({ label, count: rec[label] ?? 0, color: colors[label] ?? '#94a3b8' }));
  }, [stats?.byPriority]);

  const outcomeItems = useMemo(() => {
    return [
      { label: 'Resolved / Closed', count: stats?.resolved ?? 0, color: '#4fb87e' },
      { label: 'Active / Open', count: stats?.active ?? 0, color: '#e8b84a' },
      { label: 'Cancelled', count: stats?.cancelled ?? 0, color: '#6b7a8d' },
      { label: 'False alarm', count: stats?.falseAlarm ?? 0, color: '#d4453a' },
    ].filter((i) => i.count > 0 || (stats?.totalIncidents ?? 0) === 0);
  }, [stats]);

  function applyPreset(days: number, id: string) {
    setPreset(id);
    setFrom(ymdDaysAgo(days));
    setTo(todayYmd());
  }

  const peakHours = stats?.peakHours ?? Array.from({ length: 24 }, () => 0);
  const trend = stats?.responseTrend ?? [];

  return (
    <div className="analytics-page mx-auto flex w-full min-w-0 flex-col gap-4 pb-6">
      <PageHeader
        eyebrow="Coordination"
        title="Operations Analytics"
        subtitle="Incident volume, response pipeline, and spatial patterns for Barangay Sun Valley"
        meta={
          <FreshnessLine
            state={liveSyncToFreshness(live.state, live.lastUpdated)}
            lastUpdated={dataUpdatedAt || live.lastUpdated}
            compact
          />
        }
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  size="sm"
                  variant={preset === p.id ? 'default' : 'outline'}
                  className="min-h-[36px]"
                  onClick={() => applyPreset(p.days, p.id)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="an-from">From</Label>
                <input
                  id="an-from"
                  type="date"
                  className="input-field max-w-[160px]"
                  value={from}
                  onChange={(e) => {
                    setPreset('custom');
                    setFrom(e.target.value);
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="an-to">To</Label>
                <input
                  id="an-to"
                  type="date"
                  className="input-field max-w-[160px]"
                  value={to}
                  onChange={(e) => {
                    setPreset('custom');
                    setTo(e.target.value);
                  }}
                />
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 pb-1 text-xs text-ink-300">
                <input
                  type="checkbox"
                  className="accent-gold-500"
                  checked={includeTraining}
                  onChange={(e) => setIncludeTraining(e.target.checked)}
                />
                Include training / audit incidents
              </label>
            </div>
          </div>
        }
      />

      <QueryState
        isLoading={isLoading}
        isError={isError}
        error={error as Error}
        onRetry={() => refetch()}
        lastUpdated={dataUpdatedAt}
        showLastUpdated={false}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
          <KpiCard title="Incidents" value={stats?.totalIncidents ?? 0} icon={Siren} tone="gold" subtitle={`${from} → ${to}`} />
          <KpiCard
            title="Avg travel"
            value={formatDuration(stats?.avgTravelSeconds)}
            icon={Clock3}
            tone="info"
            subtitle="En route → on scene"
          />
          <KpiCard
            title="Resolved"
            value={stats?.resolved ?? 0}
            icon={CheckCircle2}
            tone="ok"
            subtitle={`${stats?.active ?? 0} still active`}
          />
          <KpiCard
            title="Unit utilization"
            value={`${stats?.unitUtilization ?? 0}%`}
            icon={Truck}
            tone={(stats?.unitUtilization ?? 0) > 75 ? 'alert' : 'default'}
            subtitle={`${stats?.unitsReady ?? 0}/${stats?.unitsTotal ?? 0} ready`}
          />
          <KpiCard title="Avg acknowledgement" value={formatDuration(stats?.avgAckSeconds)} icon={Activity} subtitle="Dispatched → Acknowledged" tooltip="Time from dispatch to unit acknowledgement. Excludes incidents with missing timestamps." />
          <KpiCard title="Avg on-scene" value={formatDuration(stats?.avgOnSceneSeconds)} icon={MapPin} subtitle="On Scene → Resolved" />
          <KpiCard title="Cancelled" value={stats?.cancelled ?? 0} icon={XCircle} tone="info" />
          <KpiCard title="False alarms" value={stats?.falseAlarm ?? 0} icon={AlertTriangle} tone="alert" />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="card min-w-0 overflow-hidden p-3 sm:p-4">
            <OpsSectionHeader title="Incident type mix" />
            <DonutChart items={categoryItems} totalLabel="Types" />
          </div>
          <div className="card min-w-0 overflow-hidden p-3 sm:p-4">
            <OpsSectionHeader title="Outcomes" />
            <DonutChart items={outcomeItems} totalLabel="Cases" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="card min-w-0 overflow-hidden p-3 sm:p-4">
            <OpsSectionHeader title="Priority breakdown" />
            <HBarChart items={priorityItems} />
          </div>
          <div className="card min-w-0 overflow-hidden p-3 sm:p-4">
            <OpsSectionHeader title="Status distribution" />
            <HBarChart items={statusItems.slice(0, 8)} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="card min-w-0 overflow-hidden p-3 sm:p-4">
            <OpsSectionHeader title="Peak call hours" />
            <PeakHoursChart hours={peakHours} />
          </div>
          <div className="card min-w-0 overflow-hidden p-3 sm:p-4">
            <OpsSectionHeader title="Response pipeline" />
            <PipelineBars
              ack={stats?.avgAckSeconds ?? 0}
              dispatch={stats?.avgDispatchSeconds ?? 0}
              travel={stats?.avgTravelSeconds ?? 0}
              scene={stats?.avgOnSceneSeconds ?? 0}
            />
          </div>
        </div>

        <div className="card min-w-0 overflow-hidden p-3 sm:p-4">
          <OpsSectionHeader title="Daily incident volume" />
          <TrendLineChart rows={trend} />
          {trend.some((r) => r.avgResponse) ? (
            <p className="mt-2 text-xs text-ink-500">
              Hover points for average response (reported → on scene) when timestamps are available.
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="card min-w-0 overflow-hidden p-3 sm:p-4">
            <OpsSectionHeader title="Hotspot clusters" />
            <p className="mb-3 text-xs text-ink-500">
              Descriptive K-means groups of incident locations — planning aid only, not a forecast.
            </p>
            {(stats?.kmeansGroups ?? []).length ? (
              <ul className="space-y-2">
                {(stats?.kmeansGroups ?? []).map((g) => {
                  const maxSize = Math.max(1, ...(stats?.kmeansGroups ?? []).map((x) => x.size));
                  return (
                    <li key={g.group} className="rounded-md border border-navy-700 bg-navy-950/40 p-2.5">
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium text-ink-100">Cluster {g.group}</span>
                        <span className="font-mono text-xs text-ink-400">{g.size} incidents</span>
                      </div>
                      <div className="mb-1.5 h-2 overflow-hidden rounded-full bg-navy-800">
                        <div
                          className="h-full rounded-full bg-[#38bdf8]"
                          style={{ width: `${(g.size / maxSize) * 100}%` }}
                        />
                      </div>
                      <p className="font-mono text-[11px] text-ink-500">
                        Centroid {g.centroid.lat.toFixed(4)}, {g.centroid.lng.toFixed(4)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-ink-500">Not enough points to cluster.</p>
            )}
            {stats?.dataNotes ? <p className="mt-2 text-xs text-gold-400">{stats.dataNotes}</p> : null}
          </div>

          <div className="card min-w-0 overflow-hidden p-3 sm:p-4">
            <OpsSectionHeader title="Heatmap density" />
            <p className="mb-3 text-xs text-ink-500">
              {(stats?.heatmap ?? []).length} mapped points in range. Open Map Monitoring for live GIS overlay.
            </p>
            <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-navy-700 bg-[#0b1220]">
              {(stats?.heatmap ?? []).length ? (
                <div className="absolute inset-0">
                  {(stats?.heatmap ?? []).slice(0, 200).map((p, i) => {
                    const lats = (stats?.heatmap ?? []).map((h) => h.lat);
                    const lngs = (stats?.heatmap ?? []).map((h) => h.lng);
                    const minLat = Math.min(...lats);
                    const maxLat = Math.max(...lats);
                    const minLng = Math.min(...lngs);
                    const maxLng = Math.max(...lngs);
                    const x = maxLng === minLng ? 50 : ((p.lng - minLng) / (maxLng - minLng)) * 100;
                    const y = maxLat === minLat ? 50 : (1 - (p.lat - minLat) / (maxLat - minLat)) * 100;
                    return (
                      <span
                        key={i}
                        className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-alert-400/70 shadow-[0_0_10px_rgba(212,69,58,0.55)]"
                        style={{ left: `${x}%`, top: `${y}%` }}
                        title={`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-ink-500">No mapped incidents</div>
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-950/90 to-transparent p-3">
                <p className="flex items-center gap-1.5 text-[11px] text-ink-300">
                  <BarChart3 className="h-3.5 w-3.5 text-gold-500" aria-hidden />
                  Relative plot of incident coordinates in selected dates
                </p>
              </div>
            </div>
          </div>
        </div>
      </QueryState>
    </div>
  );
}
