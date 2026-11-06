import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileSpreadsheet,
  Flame,
  HeartPulse,
  Moon,
  Pencil,
  Plus,
  Search,
  Shield,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { shiftsApi, mapApi, settingsApi, type ShiftRow } from '@/services/api';
import { LIVE } from '@/lib/liveTiming';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryState } from '@/components/ui/QueryState';
import { FreshnessLine, liveSyncToFreshness } from '@/components/ui/FreshnessLine';
import { MapView } from '@/components/map/MapView';
import { ShiftActionDialogs, type ShiftDialog } from '@/components/shifts/ShiftActionDialogs';
import { useAdminLiveSync } from '@/hooks/LiveSyncContext';
import { formatManilaDate, formatManilaDateTime, formatManilaTime } from '@/lib/timezone';
import { SUN_VALLEY_CENTER } from '@/lib/validation';
import clsx from 'clsx';

type FilterId = 'All' | 'Ongoing' | 'Upcoming' | 'Completed' | 'Night Shift';

const FILTERS: FilterId[] = ['All', 'Ongoing', 'Upcoming', 'Completed', 'Night Shift'];

const TEAM_META: Record<string, { color: string; Icon: LucideIcon; zone: string }> = {
  'team alpha': { color: '#d4453a', Icon: Flame, zone: 'Fire & Rescue Zone 1' },
  'team bravo': { color: '#3b82f6', Icon: HeartPulse, zone: 'Medical Zone 2' },
  'team charlie': { color: '#4fb87e', Icon: Shield, zone: 'Patrol Zone 3' },
  'team delta': { color: '#a78bfa', Icon: Users, zone: 'BDRRMO Zone 4' },
  'team echo': { color: '#e8b84a', Icon: Moon, zone: 'Night Coverage Zone 5' },
};

function teamMeta(name: string) {
  return TEAM_META[name.toLowerCase()] || { color: '#6b7a8d', Icon: Users, zone: 'Operations Zone' };
}

function parseMins(value: string): number | null {
  const digits = String(value).replace(/[^0-9]/g, '');
  if (digits.length >= 3 && digits.length <= 4) {
    const padded = digits.padStart(4, '0');
    const h = Number(padded.slice(0, 2));
    const m = Number(padded.slice(2, 4));
    if (h <= 23 && m <= 59) return h * 60 + m;
  }
  return null;
}

function to12h(value: string) {
  const mins = parseMins(value);
  if (mins == null) return value;
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function isNightShift(s: ShiftRow) {
  const start = parseMins(s.startTime);
  const end = parseMins(s.endTime);
  if (start == null || end == null) return /night/i.test(s.teamName) || /night/i.test(s.shiftStatus);
  return start > end || start >= 18 || start < 6;
}

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s.includes('ongoing')) return 'bg-ok-500/20 text-ok-300 border-ok-500/40';
  if (s.includes('up next') || s.includes('upcoming')) return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
  if (s.includes('complete')) return 'bg-purple-500/20 text-purple-300 border-purple-500/40';
  if (s.includes('break')) return 'bg-navy-700 text-ink-300 border-navy-600';
  if (s.includes('overtime')) return 'bg-orange-500/20 text-orange-300 border-orange-500/40';
  if (s.includes('planned')) return 'bg-alert-500/15 text-alert-300 border-alert-500/30';
  return 'bg-navy-700 text-ink-300 border-navy-600';
}

function roundPercents(counts: number[], total: number) {
  if (total <= 0) return counts.map(() => 0);
  const raw = counts.map((c) => (c / total) * 100);
  const floored = raw.map((v) => Math.floor(v));
  let rem = 100 - floored.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  const out = [...floored];
  for (let k = 0; k < order.length && rem > 0; k += 1) {
    out[order[k].i] += 1;
    rem -= 1;
  }
  return out;
}

function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - day);
  x.setHours(12, 0, 0, 0);
  return x;
}

function ymd(d: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function countdownTo(startTime: string) {
  const start = parseMins(startTime);
  if (start == null) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const now =
    Number(parts.find((p) => p.type === 'hour')?.value ?? 0) * 60 +
    Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  let diff = start - now;
  if (diff < 0) diff += 24 * 60;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `in ${h}h ${m}m`;
}

const QUICK_ACTIONS: { id: ShiftDialog | 'export'; label: string; icon: LucideIcon }[] = [
  { id: 'edit', label: 'Edit Schedule', icon: Pencil },
  { id: 'assign', label: 'Assign Personnel', icon: UserPlus },
  { id: 'overtime', label: 'Approve Overtime', icon: Clock3 },
  { id: 'report', label: 'Generate Shift Report', icon: FileSpreadsheet },
  { id: 'export', label: 'Export Schedule', icon: Download },
];

export function ShiftsPage() {
  const { accessToken } = useAuthStore();
  const live = useAdminLiveSync();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterId>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ShiftDialog>(null);
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeek(new Date()));

  const shiftsQuery = useQuery({
    queryKey: ['shifts'],
    queryFn: () => shiftsApi.list(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.warmMs,
  });

  const mapQuery = useQuery({
    queryKey: ['map-data'],
    queryFn: () => mapApi.data(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });

  const auditQuery = useQuery({
    queryKey: ['audit'],
    queryFn: () => settingsApi.auditLogs(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.warmMs,
  });

  const shifts = shiftsQuery.data?.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shifts.filter((s) => {
      if (filter === 'Night Shift') {
        if (!isNightShift(s)) return false;
      } else if (filter !== 'All') {
        const st = s.shiftStatus.toLowerCase();
        if (filter === 'Ongoing' && !st.includes('ongoing')) return false;
        if (filter === 'Upcoming' && !(st.includes('upcoming') || st.includes('up next'))) return false;
        if (filter === 'Completed' && !st.includes('complete')) return false;
      }
      if (!q) return true;
      return `${s.teamName} ${s.departmentName || ''} ${s.shiftLead || ''}`.toLowerCase().includes(q);
    });
  }, [shifts, search, filter]);

  useEffect(() => {
    if (!selectedId) {
      if (filtered[0]) setSelectedId(filtered[0].id);
      return;
    }
    if (!filtered.some((s) => s.id === selectedId)) {
      setSelectedId(filtered[0]?.id ?? null);
    }
  }, [filtered, selectedId]);

  const selected = shifts.find((s) => s.id === selectedId) ?? null;
  const selectedMeta = selected ? teamMeta(selected.teamName) : null;

  const statusOverview = useMemo(() => {
    const buckets = [
      { label: 'Ongoing', match: /ongoing/i, color: '#4fb87e' },
      { label: 'Upcoming', match: /upcoming|up next/i, color: '#3b82f6' },
      { label: 'Completed', match: /complete/i, color: '#a78bfa' },
      { label: 'On Break', match: /break/i, color: '#6b7a8d' },
      { label: 'Overtime', match: /overtime/i, color: '#fb923c' },
    ];
    const counts = buckets.map((b) => shifts.filter((s) => b.match.test(s.shiftStatus)).length);
    const scheduled = shifts.filter((s) => /schedul/i.test(s.shiftStatus)).length;
    // fold scheduled into upcoming for chart if needed
    if (counts[1] === 0 && scheduled > 0) counts[1] = scheduled;
    const total = shifts.length;
    const pct = roundPercents(counts, total);
    let cursor = 0;
    const stops: string[] = [];
    if (total === 0) stops.push('#1e2a3a 0% 100%');
    else {
      buckets.forEach((b, i) => {
        if (counts[i] === 0) return;
        const start = cursor;
        cursor += pct[i];
        stops.push(`${b.color} ${start}% ${cursor}%`);
      });
    }
    return {
      total,
      buckets: buckets.map((b, i) => ({ ...b, count: counts[i], percent: pct[i] })),
      gradient: `conic-gradient(${stops.join(', ')})`,
    };
  }, [shifts]);

  const todaySummary = useMemo(() => {
    const windows = [
      { label: 'Morning', start: 6, end: 14, icon: Clock3, color: '#e8b84a' },
      { label: 'Afternoon', start: 14, end: 22, icon: Users, color: '#3b82f6' },
      { label: 'Night', start: 22, end: 30, icon: Moon, color: '#a78bfa' },
    ];
    return windows.map((w) => {
      const matching = shifts.filter((s) => {
        const start = parseMins(s.startTime);
        if (start == null) return false;
        const h = Math.floor(start / 60);
        if (w.end > 24) return h >= w.start || h < w.end - 24;
        return h >= w.start && h < w.end;
      });
      const personnel = matching.reduce((sum, s) => sum + (s.personnelCount || 0), 0);
      const max = Math.max(8, personnel, matching.length * 4);
      return { ...w, count: matching.length, personnel, pct: Math.min(100, Math.round((personnel / max) * 100)) };
    });
  }, [shifts]);

  const upcoming = useMemo(() => {
    return [...shifts]
      .filter((s) => /upcoming|up next|schedul|planned/i.test(s.shiftStatus))
      .slice(0, 5)
      .map((s, i) => ({
        ...s,
        badge: i === 0 ? 'UP NEXT' : /planned/i.test(s.shiftStatus) ? 'PLANNED' : 'SCHEDULED',
        eta: countdownTo(s.startTime),
      }));
  }, [shifts]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekAnchor);
      d.setDate(weekAnchor.getDate() + i);
      return {
        date: d,
        key: ymd(d),
        label: new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', weekday: 'short', timeZone: 'Asia/Manila' }).format(d),
      };
    });
  }, [weekAnchor]);

  const weekRangeLabel = useMemo(() => {
    const a = weekDays[0]?.date;
    const b = weekDays[6]?.date;
    if (!a || !b) return 'This Week';
    return `${formatManilaDate(a)} – ${formatManilaDate(b)}`;
  }, [weekDays]);

  const activity = useMemo(() => {
    const logs = (auditQuery.data?.data ?? []) as Array<{ action?: string; resourceType?: string; createdAt?: string }>;
    const fromAudit = logs
      .filter((l) => /shift/i.test(l.action || '') || /shift/i.test(l.resourceType || ''))
      .slice(0, 8)
      .map((l, i) => ({
        id: `a-${i}`,
        text: `${l.action || 'Event'}${l.resourceType ? ` · ${l.resourceType}` : ''}`,
        at: l.createdAt ? formatManilaDateTime(l.createdAt) : '—',
        tone: /overtime|fail/i.test(l.action || '') ? 'warn' : /ongoing/i.test(l.action || '') ? 'ok' : 'info',
      }));
    if (fromAudit.length) return fromAudit;
    return shifts.slice(0, 8).map((s) => ({
      id: s.id,
      text: `${s.teamName} shift marked as ${s.shiftStatus}`,
      at: s.scheduledDate ? formatManilaDate(s.scheduledDate) : '—',
      tone: /ongoing/i.test(s.shiftStatus) ? 'ok' : /upcoming/i.test(s.shiftStatus) ? 'info' : 'warn',
    }));
  }, [auditQuery.data, shifts]);

  const mapCenter: [number, number] = useMemo(() => {
    const withGps = selected?.assignedPersonnel?.find((p) => p.lat != null && p.lng != null);
    if (withGps?.lat != null && withGps?.lng != null) return [withGps.lat, withGps.lng];
    return [SUN_VALLEY_CENTER.lat, SUN_VALLEY_CENTER.lng];
  }, [selected]);

  function exportCsv() {
    const header = ['Team', 'Date', 'Start', 'End', 'Status', 'Personnel', 'Lead', 'Department'];
    const lines = filtered.map((s) =>
      [s.teamName, s.scheduledDate || '', s.startTime, s.endTime, s.shiftStatus, s.personnelCount ?? 0, s.shiftLead || '', s.departmentName || '']
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shifts-${ymd(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Shift schedule exported');
  }

  function onQuickAction(id: ShiftDialog | 'export') {
    if (id === 'export') {
      exportCsv();
      return;
    }
    if ((id === 'edit' || id === 'assign' || id === 'overtime') && !selected) {
      toast.message('Select a shift from the list first');
    }
    setDialog(id);
  }

  const hours = [0, 6, 12, 18, 24];

  return (
    <div className="shifts-page mx-auto flex w-full min-w-0 flex-col gap-4 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-ink-50 sm:text-2xl">Shift Schedules</h1>
          <p className="mt-0.5 text-sm text-ink-400">Team duty windows, coverage, and rotations</p>
          <FreshnessLine
            state={liveSyncToFreshness(live.state, live.lastUpdated)}
            lastUpdated={shiftsQuery.dataUpdatedAt || live.lastUpdated}
            compact
            className="mt-1"
          />
        </div>
        <Button type="button" className="min-h-[44px]" onClick={() => setDialog('add')}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          Add shift
        </Button>
      </div>

      <QueryState
        isLoading={shiftsQuery.isLoading}
        isError={shiftsQuery.isError}
        error={shiftsQuery.error as Error}
        onRetry={() => shiftsQuery.refetch()}
        showLastUpdated={false}
      >
        <div className="shifts-grid">
          {/* Left list */}
          <section className="shifts-area-list card min-h-0 overflow-hidden p-3 sm:p-4">
            <h2 className="mb-3 shrink-0 text-xs font-semibold uppercase tracking-wider text-ink-300">Shift Schedules</h2>
            <div className="relative mb-3 shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden />
              <Input className="pl-9" placeholder="Search shifts or team names…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="mb-3 flex shrink-0 gap-1.5 overflow-x-auto pb-1 sidebar-scroll">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={clsx(
                    'shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors',
                    filter === f ? 'border-blue-500/50 bg-blue-500/20 text-blue-200' : 'border-navy-600 bg-navy-900/60 text-ink-400 hover:text-ink-200'
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto sidebar-scroll" role="list">
              {filtered.map((s) => {
                const meta = teamMeta(s.teamName);
                const Icon = meta.Icon;
                const active = s.id === selectedId;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(s.id)}
                      className={clsx(
                        'flex w-full gap-3 rounded-xl border p-3 text-left transition-colors',
                        active ? 'border-gold-500/40 bg-gold-500/10' : 'border-navy-700 bg-navy-900/50 hover:border-navy-600'
                      )}
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: `${meta.color}22`, color: meta.color }}>
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span>
                            <span className="block font-medium text-ink-50">{s.teamName}</span>
                            <span className="block text-xs text-ink-500">{s.departmentName || 'Operations'}</span>
                          </span>
                          <span className={clsx('shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase', statusBadge(s.shiftStatus))}>
                            {s.shiftStatus}
                          </span>
                        </span>
                        <span className="mt-1.5 flex items-end justify-between gap-2">
                          <span>
                            <span className="block text-sm font-semibold text-ink-100">{s.startTime} – {s.endTime}</span>
                            <span className="block text-[11px] text-ink-500">{to12h(s.startTime)} – {to12h(s.endTime)}</span>
                          </span>
                          <span className="shrink-0 text-[11px] text-ink-400">{s.personnelCount ?? 0} Personnel</span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && <li className="py-8 text-center text-sm text-ink-500">No shifts match this filter</li>}
            </ul>
          </section>

          {/* Center */}
          <section className="shifts-area-main min-w-0">
            {selected && selectedMeta ? (
              <div className="card flex min-h-0 flex-col overflow-hidden p-3 sm:p-4">
                <div className="mb-2 flex shrink-0 flex-wrap items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: `${selectedMeta.color}22`, color: selectedMeta.color }}>
                    <selectedMeta.Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-semibold text-ink-50">{selected.teamName}</h2>
                      <span className={clsx('shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase', statusBadge(selected.shiftStatus))}>
                        {selected.shiftStatus}
                      </span>
                    </div>
                    <p className="truncate text-xs text-ink-400">
                      {selected.startTime} – {selected.endTime}
                      {' · '}
                      {selected.shiftLead || 'No lead'}
                      {' · '}
                      {selected.personnelCount ?? 0} personnel
                      {' · '}
                      {selected.location || 'Sun Valley Operations Base'}
                    </p>
                  </div>
                </div>
                <div className="min-h-0 max-h-[7.5rem] overflow-auto rounded-lg border border-navy-700">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-navy-900 text-ink-500">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">#</th>
                        <th className="px-2 py-1.5 font-medium">Name</th>
                        <th className="px-2 py-1.5 font-medium">Role</th>
                        <th className="px-2 py-1.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selected.assignedPersonnel ?? []).map((p, i) => (
                        <tr key={p.responderId} className="border-t border-navy-800">
                          <td className="px-2 py-1.5 font-mono text-ink-500">{i + 1}</td>
                          <td className="px-2 py-1.5 text-ink-100">{p.fullName}</td>
                          <td className="px-2 py-1.5 text-ink-400">{p.role}</td>
                          <td className="px-2 py-1.5 text-ok-300">{(p.status || 'ON SHIFT').toUpperCase()}</td>
                        </tr>
                      ))}
                      {(selected.assignedPersonnel ?? []).length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-2 py-4 text-center text-ink-500">
                            No personnel assigned — use Assign Personnel
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="card flex min-h-[3.5rem] items-center justify-center px-4 py-3 text-sm text-ink-500">Select a shift from the list</div>
            )}

            <div className="card flex min-h-0 flex-col overflow-hidden p-3 sm:p-4">
              <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">Weekly Shift Calendar</h3>
                  <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] text-ink-500">
                    {Object.entries(TEAM_META).map(([k, v]) => (
                      <span key={k} className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: v.color }} />
                        {k.replace(/\b\w/g, (c) => c.toUpperCase())}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button type="button" className="rounded p-1 text-ink-400 hover:bg-navy-800" onClick={() => setWeekAnchor((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })} aria-label="Previous week">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="inline-flex items-center gap-1 px-1 text-[11px] tabular-nums text-ink-300 sm:px-2 sm:text-xs">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {weekRangeLabel}
                  </span>
                  <button type="button" className="rounded p-1 text-ink-400 hover:bg-navy-800" onClick={() => setWeekAnchor((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })} aria-label="Next week">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="shifts-week-calendar">
                <div className="shifts-week-head mb-1 shrink-0">
                  <span aria-hidden />
                  {weekDays.map((d) => {
                    const label = new Intl.DateTimeFormat('en-US', {
                      weekday: 'short',
                      day: 'numeric',
                      timeZone: 'Asia/Manila',
                    }).format(d.date);
                    return (
                      <span key={d.key} className="min-w-0 truncate text-center text-[10px] font-medium leading-tight text-ink-400">
                        {label}
                      </span>
                    );
                  })}
                </div>

                <div className="shifts-week-grid">
                  <div className="relative text-[8px] leading-none text-ink-500 sm:text-[9px]">
                    {hours.map((h) => (
                      <span
                        key={h}
                        className="absolute right-0.5 tabular-nums"
                        style={{
                          top: h === 0 ? '2px' : h === 24 ? 'auto' : `${(h / 24) * 100}%`,
                          bottom: h === 24 ? '2px' : undefined,
                          transform: h === 0 || h === 24 ? 'none' : 'translateY(-50%)',
                        }}
                      >
                        {String(h).padStart(2, '0')}
                      </span>
                    ))}
                  </div>
                  {weekDays.map((d) => {
                    const dayShifts = shifts
                      .filter((s) => s.scheduledDate && String(s.scheduledDate).startsWith(d.key))
                      .slice(0, 5);
                    return (
                      <div key={d.key} className="shifts-week-day">
                        {dayShifts.map((s, idx) => {
                          const start = parseMins(s.startTime) ?? 0;
                          let end = parseMins(s.endTime) ?? start + 480;
                          if (end <= start) end += 24 * 60;
                          const top = (start / (24 * 60)) * 100;
                          const height = Math.max(14, ((Math.min(end, start + 24 * 60) - start) / (24 * 60)) * 100);
                          const meta = teamMeta(s.teamName);
                          const teamLabel = s.teamName.replace(/^Team\s+/i, '');
                          const inset = Math.min(idx, 3) * 5;
                          return (
                            <button
                              key={`${s.id}-${d.key}`}
                              type="button"
                              title={`${s.teamName} ${s.startTime}–${s.endTime}`}
                              onClick={() => setSelectedId(s.id)}
                              className="shifts-week-block"
                              style={{
                                top: `${top}%`,
                                height: `${Math.min(height, 100 - top)}%`,
                                background: meta.color,
                                left: `${2 + inset}px`,
                                right: '2px',
                                zIndex: idx + 1,
                              }}
                            >
                              <span className="block truncate text-[9px] sm:text-[10px]">{teamLabel}</span>
                              <span className="block truncate text-[8px] opacity-90 sm:text-[9px]">{s.startTime}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="card flex min-h-0 flex-col overflow-hidden p-3 sm:p-4">
              <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">Shift Coverage Map</h3>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-ok-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok-400" />
                  Live GIS Feed
                </span>
              </div>
              <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_7.5rem]">
                <div className="min-h-[200px] overflow-hidden rounded-lg border border-navy-700 sm:min-h-[240px]">
                  <MapView
                    data={mapQuery.data?.data}
                    height="100%"
                    center={mapCenter}
                    zoom={14}
                    interactive
                    showBoundary
                    pin={
                      selected?.assignedPersonnel?.find((p) => p.lat != null)?.lat != null
                        ? {
                            lat: selected.assignedPersonnel.find((p) => p.lat != null)!.lat!,
                            lng: selected.assignedPersonnel.find((p) => p.lng != null)!.lng!,
                            label: selected.teamName,
                          }
                        : { lat: SUN_VALLEY_CENTER.lat, lng: SUN_VALLEY_CENTER.lng, label: 'Base' }
                    }
                  />
                </div>
                <div className="min-w-0 shrink-0">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-500">Team Coverage</p>
                  <ul className="space-y-2 text-[11px] text-ink-400">
                    {Object.entries(TEAM_META).map(([k, v]) => (
                      <li key={k} className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: v.color }} />
                        <span className="truncate">{v.zone}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[10px] text-ink-500">
                    Last updated: {mapQuery.dataUpdatedAt ? formatManilaTime(new Date(mapQuery.dataUpdatedAt)) : '—'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Right rail */}
          <aside className="shifts-area-rail min-w-0">
            <div className="card overflow-hidden p-3 sm:p-4">
              <h3 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wider text-ink-400">Shift Status Overview</h3>
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-hidden">
                <div className="relative h-24 w-24 shrink-0" role="img" aria-label={`Total ${statusOverview.total} shifts`}>
                  <div className="h-full w-full rounded-full" style={{ background: statusOverview.gradient }} />
                  <div className="absolute inset-[24%] flex flex-col items-center justify-center rounded-full bg-navy-900">
                    <span className="font-mono text-lg font-bold text-ink-50">{statusOverview.total}</span>
                    <span className="text-[9px] uppercase text-ink-500">Total</span>
                  </div>
                </div>
                <ul className="w-full space-y-1 overflow-hidden">
                  {statusOverview.buckets.map((b) => (
                    <li key={b.label} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-2 text-ink-300">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} />
                        {b.label}
                      </span>
                      <span className="font-mono tabular-nums text-ink-100">
                        {b.percent}% <span className="text-ink-500">({b.count})</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="card overflow-hidden p-3 sm:p-4">
              <h3 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wider text-ink-400">Today&apos;s Shift Summary</h3>
              <ul className="min-h-0 flex-1 space-y-2.5 overflow-hidden">
                {todaySummary.map((w) => (
                  <li key={w.label}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 text-ink-200">
                        <w.icon className="h-3.5 w-3.5 text-ink-500" aria-hidden />
                        {w.label}
                      </span>
                      <span className="font-mono text-ink-400">{w.personnel} pax · {w.count} shifts</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-navy-800">
                      <div className="h-full rounded-full" style={{ width: `${w.pct}%`, background: w.color }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card overflow-hidden p-3 sm:p-4">
              <h3 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wider text-ink-400">Upcoming Rotations</h3>
              <ul className="min-h-0 flex-1 space-y-2 overflow-hidden">
                {upcoming.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-navy-700 bg-navy-900/40 px-2.5 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-100">{s.teamName}</p>
                      <p className="text-[11px] text-ink-500">{s.startTime} · {s.eta}</p>
                    </div>
                    <span className={clsx('shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase', statusBadge(s.badge))}>
                      {s.badge}
                    </span>
                  </li>
                ))}
                {upcoming.length === 0 && <li className="text-sm text-ink-500">No upcoming rotations</li>}
              </ul>
            </div>

            <div className="card overflow-hidden p-3 sm:p-4">
              <h3 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wider text-ink-400">Quick Actions</h3>
              <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 content-stretch">
                {QUICK_ACTIONS.map((qa) => {
                  const Icon = qa.icon;
                  return (
                    <button
                      key={qa.id}
                      type="button"
                      className="flex min-h-0 flex-col items-center justify-center gap-1 rounded-lg border border-purple-500/35 bg-navy-900/40 px-1 py-2 text-center text-[10px] text-purple-200 transition-colors hover:bg-purple-500/10"
                      onClick={() => onQuickAction(qa.id)}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                      {qa.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="card overflow-hidden p-3 sm:p-4">
              <div className="mb-2 flex shrink-0 items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">Activity Log</h3>
                <button type="button" className="text-[11px] text-blue-300 hover:underline" onClick={() => setDialog('activity')}>
                  View All
                </button>
              </div>
              <ul className="min-h-0 flex-1 space-y-2 overflow-hidden">
                {activity.slice(0, 5).map((a) => (
                  <li key={a.id} className="flex gap-2 text-xs">
                    <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.tone === 'ok' && 'bg-ok-400', a.tone === 'info' && 'bg-blue-400', a.tone === 'warn' && 'bg-gold-400')} />
                    <span className="min-w-0">
                      <span className="block text-ink-200">{a.text}</span>
                      <span className="text-[10px] text-ink-500">{a.at}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </QueryState>

      <ShiftActionDialogs
        open={dialog}
        onOpenChange={setDialog}
        accessToken={accessToken}
        selected={selected}
        activity={activity}
      />
    </div>
  );
}
