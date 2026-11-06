import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  FileSpreadsheet,
  Filter,
  HeartPulse,
  Import,
  Pencil,
  Plus,
  Search,
  Umbrella,
  UserPlus,
  UserX,
  Users,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import {
  attendanceApi,
  leaveApi,
  personnelApi,
  shiftsApi,
  reportsApi,
  type AttendanceRecord,
} from '@/services/api';
import { LIVE } from '@/lib/liveTiming';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryState } from '@/components/ui/QueryState';
import { FreshnessLine, liveSyncToFreshness } from '@/components/ui/FreshnessLine';
import {
  AttendanceActionDialogs,
  type AttendanceDialog,
} from '@/components/attendance/AttendanceActionDialogs';
import { useAdminLiveSync } from '@/hooks/LiveSyncContext';
import { formatManilaDate, formatManilaTime } from '@/lib/timezone';
import { isAttendanceAbsent, isAttendancePresent } from '@/lib/workforceMetrics';
import clsx from 'clsx';

type TabId = 'Daily Attendance' | 'Weekly Summary' | 'Monthly Report' | 'Attendance Logs' | 'Leave Requests';

const TABS: TabId[] = ['Daily Attendance', 'Weekly Summary', 'Monthly Report', 'Attendance Logs', 'Leave Requests'];

const PAGE_SIZE = 8;

type AttStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'ON LEAVE' | 'REST DAY' | 'OTHER';

const STATUS_META: Record<AttStatus, { color: string; badge: string }> = {
  PRESENT: { color: '#4fb87e', badge: 'bg-ok-500/20 text-ok-300 border-ok-500/40' },
  LATE: { color: '#fb923c', badge: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  ABSENT: { color: '#d4453a', badge: 'bg-alert-500/20 text-alert-300 border-alert-500/40' },
  'ON LEAVE': { color: '#3b82f6', badge: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
  'REST DAY': { color: '#6b7a8d', badge: 'bg-navy-700 text-ink-300 border-navy-600' },
  OTHER: { color: '#a78bfa', badge: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
};

const QUICK_ACTIONS: { id: AttendanceDialog | 'export'; label: string; icon: LucideIcon; tone: string }[] = [
  { id: 'add', label: 'Add Attendance Record', icon: Plus, tone: 'border-blue-500/40 text-blue-200' },
  { id: 'edit', label: 'Edit Attendance', icon: Pencil, tone: 'border-blue-500/40 text-blue-200' },
  { id: 'import', label: 'Import Attendance', icon: Import, tone: 'border-ok-500/40 text-ok-300' },
  { id: 'leave', label: 'Manage Leave Requests', icon: CalendarDays, tone: 'border-orange-500/40 text-orange-300' },
  { id: 'report', label: 'Generate Attendance Report', icon: FileSpreadsheet, tone: 'border-blue-500/40 text-blue-200' },
  { id: 'export', label: 'Export Attendance Logs', icon: Download, tone: 'border-blue-500/40 text-blue-200' },
];

function manilaYmd(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function normalizeStatus(raw?: string): AttStatus {
  const s = (raw || '').toLowerCase();
  if (s.includes('leave')) return 'ON LEAVE';
  if (s.includes('late')) return 'LATE';
  if (isAttendanceAbsent(raw)) return 'ABSENT';
  if (s.includes('rest')) return 'REST DAY';
  if (isAttendancePresent(raw)) return 'PRESENT';
  if (s.includes('off')) return 'OTHER';
  return 'OTHER';
}

function remarksFor(row: AttendanceRecord, status: AttStatus) {
  if (row.remarks?.trim()) return row.remarks;
  if (status === 'LATE' && row.checkInTime) return 'After grace period';
  if (status === 'PRESENT') return 'On Time';
  if (status === 'ABSENT') return 'No Check-In';
  if (status === 'ON LEAVE') return row.leaveType || 'Approved Leave';
  if (status === 'REST DAY') return 'Scheduled rest';
  return '—';
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

function hourInManila(iso?: string) {
  if (!iso) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso.includes('T') || iso.includes(' ') ? iso.replace(' ', 'T') + (iso.length <= 16 ? ':00' : '') : iso));
  const h = Number(parts.find((p) => p.type === 'hour')?.value);
  return Number.isFinite(h) ? h : null;
}

export function AttendancePage() {
  const { accessToken } = useAuthStore();
  const live = useAdminLiveSync();
  const [tab, setTab] = useState<TabId>('Daily Attendance');
  const [selectedDate, setSelectedDate] = useState(manilaYmd());
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<AttendanceDialog>(null);
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const attendanceQuery = useQuery({
    queryKey: ['attendance', selectedDate],
    queryFn: () => attendanceApi.list(accessToken!, selectedDate),
    enabled: !!accessToken,
    refetchInterval: LIVE.warmMs,
  });

  const allAttendanceQuery = useQuery({
    queryKey: ['attendance-all'],
    queryFn: () => attendanceApi.list(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.warmMs,
  });

  const personnelQuery = useQuery({
    queryKey: ['personnel'],
    queryFn: () => personnelApi.list(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.warmMs,
  });

  const shiftsQuery = useQuery({
    queryKey: ['shifts'],
    queryFn: () => shiftsApi.list(accessToken!),
    enabled: !!accessToken,
  });

  const leaveQuery = useQuery({
    queryKey: ['leave-requests'],
    queryFn: () => leaveApi.list(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.warmMs,
  });

  const people = personnelQuery.data?.data?.users ?? [];
  const responders = useMemo(() => people.filter((p) => p.responderId), [people]);
  const dayRows = (attendanceQuery.data?.data ?? []) as AttendanceRecord[];
  const allRows = (allAttendanceQuery.data?.data ?? []) as AttendanceRecord[];
  const leaveRequests = leaveQuery.data?.data ?? [];

  const boardRows = useMemo(() => {
    const byResponder = new Map(dayRows.map((r) => [String(r.responderId || ''), r]));
    const day = new Date(`${selectedDate}T12:00:00`);
    const dow = day.getDay(); // 0 Sun
    const isWeekend = dow === 0;

    return responders.map((p, idx) => {
      const existing = byResponder.get(String(p.responderId));
      if (existing) {
        return { ...existing, fullName: existing.fullName || p.fullName, departmentName: existing.departmentName || p.departmentName, callsign: existing.callsign || p.callsign, _index: idx };
      }
      const onLeave = leaveRequests.some(
        (lr) =>
          lr.responderId === p.responderId &&
          /approv/i.test(lr.status) &&
          lr.startDate <= selectedDate &&
          lr.endDate >= selectedDate
      );
      return {
        _id: undefined,
        responderId: p.responderId,
        userId: p.id,
        date: selectedDate,
        status: onLeave ? 'On Leave' : isWeekend ? 'Rest Day' : 'Absent',
        leaveType: onLeave ? leaveRequests.find((lr) => lr.responderId === p.responderId)?.leaveType : undefined,
        fullName: p.fullName,
        callsign: p.callsign,
        departmentName: p.departmentName,
        departmentCode: p.departmentCode,
        teamName: p.teamName,
        _index: idx,
      } as AttendanceRecord & { _index: number };
    });
  }, [responders, dayRows, selectedDate, leaveRequests]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return boardRows.filter((r) => {
      const st = normalizeStatus(r.status);
      if (deptFilter !== 'All') {
        const hay = `${r.departmentName || ''} ${r.departmentCode || ''}`.toLowerCase();
        if (!hay.includes(deptFilter.toLowerCase())) return false;
      }
      if (statusFilter !== 'All' && st !== statusFilter) return false;
      if (!q) return true;
      return `${r.fullName} ${r.callsign || ''} ${r.departmentName || ''}`.toLowerCase().includes(q);
    });
  }, [boardRows, search, deptFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageSlice = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const stats = useMemo(() => {
    const labels = boardRows.map((r) => normalizeStatus(r.status));
    const total = Math.max(boardRows.length, 1);
    const present = labels.filter((l) => l === 'PRESENT').length;
    const late = labels.filter((l) => l === 'LATE').length;
    const absent = labels.filter((l) => l === 'ABSENT').length;
    const onLeave = labels.filter((l) => l === 'ON LEAVE').length;
    const rest = labels.filter((l) => l === 'REST DAY').length;
    return {
      present,
      late,
      absent,
      onLeave,
      rest,
      totalPersonnel: boardRows.length,
      pct: (n: number) => ((n / total) * 100).toFixed(1),
    };
  }, [boardRows]);

  const overview = useMemo(() => {
    const order: AttStatus[] = ['PRESENT', 'LATE', 'ABSENT', 'ON LEAVE', 'REST DAY'];
    const counts = [
      stats.present,
      stats.late,
      stats.absent,
      stats.onLeave,
      stats.rest,
    ];
    const total = boardRows.length;
    const pct = roundPercents(counts, total);
    let cursor = 0;
    const stops: string[] = [];
    if (total === 0) stops.push('#1e2a3a 0% 100%');
    else {
      order.forEach((label, i) => {
        if (counts[i] === 0) return;
        const start = cursor;
        cursor += pct[i];
        stops.push(`${STATUS_META[label].color} ${start}% ${cursor}%`);
      });
    }
    return {
      buckets: order.map((label, i) => ({
        label: label === 'PRESENT' ? 'Present' : label === 'LATE' ? 'Late' : label === 'ABSENT' ? 'Absent' : label === 'ON LEAVE' ? 'On Leave' : 'Rest Day',
        status: label,
        count: counts[i],
        percent: pct[i],
      })),
      total,
      gradient: `conic-gradient(${stops.join(', ')})`,
    };
  }, [stats, boardRows.length]);

  const weekTrend = useMemo(() => {
    const days: { key: string; label: string; present: number; late: number; absent: number; leave: number }[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(`${selectedDate}T12:00:00`);
      d.setDate(d.getDate() - i);
      const key = manilaYmd(d);
      const label = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', timeZone: 'Asia/Manila' }).format(d);
      const dayRecs = allRows.filter((r) => String(r.date).startsWith(key));
      days.push({
        key,
        label,
        present: dayRecs.filter((r) => normalizeStatus(r.status) === 'PRESENT').length,
        late: dayRecs.filter((r) => normalizeStatus(r.status) === 'LATE').length,
        absent: dayRecs.filter((r) => normalizeStatus(r.status) === 'ABSENT').length,
        leave: dayRecs.filter((r) => normalizeStatus(r.status) === 'ON LEAVE').length,
      });
    }
    const max = Math.max(1, ...days.flatMap((d) => [d.present, d.late, d.absent, d.leave]));
    return { days, max };
  }, [allRows, selectedDate]);

  const shiftBreakdown = useMemo(() => {
    const windows = [
      { label: '0600H - 1400H', start: 6, end: 14 },
      { label: '1400H - 2200H', start: 14, end: 22 },
      { label: '2200H - 0600H', start: 22, end: 30 },
    ];
    const scheduled = Math.max(1, Math.ceil(responders.length / 3));
    return windows.map((w) => {
      const inShift = dayRows.filter((r) => {
        const h = hourInManila(r.checkInTime);
        if (h == null) return false;
        if (w.end > 24) return h >= w.start || h < w.end - 24;
        return h >= w.start && h < w.end;
      });
      const present = inShift.filter((r) => normalizeStatus(r.status) === 'PRESENT').length;
      const late = inShift.filter((r) => normalizeStatus(r.status) === 'LATE').length;
      const absent = Math.max(0, scheduled - present - late);
      const onLeave = inShift.filter((r) => normalizeStatus(r.status) === 'ON LEAVE').length;
      const rate = Math.round(((present + late) / scheduled) * 100);
      return { ...w, scheduled, present, late, absent, onLeave, rate };
    });
  }, [dayRows, responders.length]);

  const recentCheckIns = useMemo(() => {
    return [...dayRows]
      .filter((r) => r.checkInTime)
      .sort((a, b) => String(b.checkInTime).localeCompare(String(a.checkInTime)))
      .slice(0, 6);
  }, [dayRows]);

  const deptSummary = useMemo(() => {
    const map = new Map<string, { name: string; present: number; total: number; color: string }>();
    const colors = ['#d4453a', '#3b82f6', '#4fb87e', '#a78bfa', '#e8b84a'];
    boardRows.forEach((r) => {
      const name = r.departmentName || r.departmentCode || 'Unassigned';
      const row = map.get(name) || { name, present: 0, total: 0, color: colors[map.size % colors.length] };
      row.total += 1;
      const st = normalizeStatus(r.status);
      if (st === 'PRESENT' || st === 'LATE') row.present += 1;
      map.set(name, row);
    });
    return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  }, [boardRows]);

  const leaveSummary = useMemo(() => {
    const month = selectedDate.slice(0, 7);
    const counts: Record<string, number> = {
      'Sick Leave': 0,
      'Vacation Leave': 0,
      'Emergency Leave': 0,
      'Other Leave': 0,
    };
    for (const lr of leaveRequests) {
      if (!String(lr.startDate).startsWith(month) && !String(lr.endDate).startsWith(month)) continue;
      if (!/approv/i.test(lr.status)) continue;
      if (counts[lr.leaveType] != null) counts[lr.leaveType] += 1;
      else counts['Other Leave'] += 1;
    }
    // also count attendance leave types
    for (const r of allRows) {
      if (!String(r.date).startsWith(month)) continue;
      if (normalizeStatus(r.status) !== 'ON LEAVE') continue;
      const t = r.leaveType || 'Other Leave';
      if (counts[t] != null) counts[t] += 1;
      else counts['Other Leave'] += 1;
    }
    return counts;
  }, [leaveRequests, allRows, selectedDate]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    boardRows.forEach((r) => {
      if (r.departmentName) set.add(r.departmentName);
      else if (r.departmentCode) set.add(r.departmentCode);
    });
    return ['All', ...[...set].sort()];
  }, [boardRows]);

  async function exportCsv() {
    const header = ['Name', 'Department', 'Date', 'Check In', 'Status', 'Remarks'];
    const lines = filtered.map((r) => {
      const st = normalizeStatus(r.status);
      return [r.fullName, r.departmentName || '', r.date, r.checkInTime || '', st, remarksFor(r, st)]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',');
    });
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${selectedDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Attendance CSV exported');
  }

  async function exportReport() {
    if (!accessToken) return;
    try {
      const blob = await reportsApi.exportPdf(accessToken, { reportType: 'attendance' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance-report-${selectedDate}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Attendance report downloaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    }
  }

  function onQuickAction(id: AttendanceDialog | 'export') {
    if (id === 'export') {
      void exportCsv();
      return;
    }
    if (id === 'edit' && !selectedRecord) {
      toast.message('Select a record from the table first (eye icon)');
      setDialog('edit');
      return;
    }
    setDialog(id);
  }

  const shifts = (shiftsQuery.data?.data ?? []) as Array<{ teamName?: string; startTime?: string; endTime?: string; shiftStatus?: string }>;

  return (
    <div className="attendance-page mx-auto flex w-full min-w-0 flex-col gap-4 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-ink-50 sm:text-2xl">Attendance Management</h1>
          <p className="mt-0.5 text-sm text-ink-400">Monitor and manage personnel attendance records.</p>
          <FreshnessLine
            state={liveSyncToFreshness(live.state, live.lastUpdated)}
            lastUpdated={attendanceQuery.dataUpdatedAt || live.lastUpdated}
            compact
            className="mt-1"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            className="min-h-[40px] w-auto"
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value);
              setPage(1);
            }}
            aria-label="Attendance date"
          />
          <Button type="button" variant="outline" className="min-h-[40px] gap-2" onClick={() => setShowFilters((v) => !v)}>
            <Filter className="h-4 w-4" aria-hidden />
            Filter
          </Button>
          <Button type="button" className="min-h-[40px] gap-2 bg-[#3b82f6] hover:bg-[#60a5fa]" onClick={() => void exportReport()}>
            <Download className="h-4 w-4" aria-hidden />
            Export Report
          </Button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-navy-700 pb-px sidebar-scroll">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={clsx(
              'shrink-0 border-b-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors',
              tab === t ? 'border-blue-500 text-blue-300' : 'border-transparent text-ink-500 hover:text-ink-300'
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {[
          { label: 'Present Today', value: stats.present, pct: `${stats.pct(stats.present)}%`, sub: 'On Time Check-In', icon: UserPlus, tone: 'text-ok-300 bg-ok-500/15' },
          { label: 'Late Today', value: stats.late, pct: `${stats.pct(stats.late)}%`, sub: 'After Grace Period', icon: Clock3, tone: 'text-orange-300 bg-orange-500/15' },
          { label: 'Absent Today', value: stats.absent, pct: `${stats.pct(stats.absent)}%`, sub: 'No Check-In', icon: UserX, tone: 'text-alert-300 bg-alert-500/15' },
          { label: 'On Leave', value: stats.onLeave, pct: `${stats.pct(stats.onLeave)}%`, sub: 'Approved Leave', icon: CalendarCheck, tone: 'text-blue-300 bg-blue-500/15' },
          { label: 'Total Personnel', value: stats.totalPersonnel, pct: '', sub: 'All Departments', icon: Users, tone: 'text-purple-300 bg-purple-500/15' },
        ].map((card) => (
          <div key={card.label} className="card flex items-center gap-3 p-3 sm:p-4">
            <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', card.tone)}>
              <card.icon className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-ink-500">{card.label}</p>
              <p className="font-mono text-xl font-semibold tabular-nums text-ink-50">
                {card.value}
                {card.pct ? <span className="ml-1 text-xs font-normal text-ink-500">({card.pct})</span> : null}
              </p>
              <p className="truncate text-[11px] text-ink-500">{card.sub}</p>
            </div>
          </div>
        ))}
      </div>

      <QueryState
        isLoading={attendanceQuery.isLoading || personnelQuery.isLoading}
        isError={attendanceQuery.isError}
        error={attendanceQuery.error as Error}
        onRetry={() => attendanceQuery.refetch()}
        showLastUpdated={false}
      >
        {(tab === 'Daily Attendance' || tab === 'Attendance Logs') && (
          <div className="attendance-grid">
            {/* Left analytics */}
            <aside className="attendance-area-left flex min-w-0 flex-col gap-3">
              <div className="card p-3 sm:p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Attendance Overview</h3>
                <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                  <div className="relative h-28 w-28 shrink-0" role="img" aria-label={`Attendance overview total ${overview.total}`}>
                    <div className="h-full w-full rounded-full" style={{ background: overview.gradient }} />
                    <div className="absolute inset-[24%] flex flex-col items-center justify-center rounded-full bg-navy-900">
                      <span className="font-mono text-lg font-bold text-ink-50">{overview.total}</span>
                      <span className="text-[9px] uppercase text-ink-500">Total</span>
                    </div>
                  </div>
                  <ul className="w-full space-y-1.5">
                    {overview.buckets.map((b) => (
                      <li key={b.label} className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-2 text-ink-300">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_META[b.status].color }} />
                          {b.label}
                        </span>
                        <span className="font-mono tabular-nums text-ink-100">
                          {b.count} <span className="text-ink-500">/ {b.percent}%</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="card p-3 sm:p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Attendance Trend (This Week)</h3>
                <div className="mb-2 flex flex-wrap gap-3 text-[10px] text-ink-500">
                  <span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded bg-ok-400" /> Present</span>
                  <span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded bg-orange-400" /> Late</span>
                  <span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded bg-alert-400" /> Absent</span>
                  <span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded bg-blue-400" /> Leave</span>
                </div>
                <div className="flex h-28 items-end gap-2">
                  {weekTrend.days.map((d) => (
                    <div key={d.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                      <div className="flex h-20 w-full items-end gap-0.5">
                        <div className="flex-1 rounded-t bg-ok-500/70" style={{ height: `${Math.max(4, (d.present / weekTrend.max) * 100)}%` }} title={`Present ${d.present}`} />
                        <div className="flex-1 rounded-t bg-orange-500/70" style={{ height: `${Math.max(2, (d.late / weekTrend.max) * 100)}%` }} title={`Late ${d.late}`} />
                        <div className="flex-1 rounded-t bg-alert-500/70" style={{ height: `${Math.max(2, (d.absent / weekTrend.max) * 100)}%` }} title={`Absent ${d.absent}`} />
                        <div className="flex-1 rounded-t bg-blue-500/70" style={{ height: `${Math.max(2, (d.leave / weekTrend.max) * 100)}%` }} title={`Leave ${d.leave}`} />
                      </div>
                      <span className="truncate text-[9px] text-ink-500">{d.label.split(' ')[1] || d.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card overflow-hidden p-3 sm:p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Shift Attendance Breakdown</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[360px] text-left text-[11px]">
                    <thead className="text-ink-500">
                      <tr>
                        <th className="pb-2 pr-2 font-medium">Shift</th>
                        <th className="pb-2 pr-2 font-medium">Sched</th>
                        <th className="pb-2 pr-2 font-medium">P</th>
                        <th className="pb-2 pr-2 font-medium">L</th>
                        <th className="pb-2 pr-2 font-medium">A</th>
                        <th className="pb-2 pr-2 font-medium">OL</th>
                        <th className="pb-2 font-medium">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shiftBreakdown.map((s) => (
                        <tr key={s.label} className="border-t border-navy-800">
                          <td className="py-1.5 pr-2 text-ink-200">{s.label}</td>
                          <td className="py-1.5 pr-2 font-mono text-ink-400">{s.scheduled}</td>
                          <td className="py-1.5 pr-2 font-mono text-ok-300">{s.present}</td>
                          <td className="py-1.5 pr-2 font-mono text-orange-300">{s.late}</td>
                          <td className="py-1.5 pr-2 font-mono text-alert-300">{s.absent}</td>
                          <td className="py-1.5 pr-2 font-mono text-blue-300">{s.onLeave}</td>
                          <td className="py-1.5 font-mono text-ink-100">{s.rate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {shifts.length > 0 && (
                  <p className="mt-2 text-[10px] text-ink-500">{shifts.length} shift schedule(s) on file</p>
                )}
              </div>
            </aside>

            {/* Center table */}
            <section className="attendance-area-main card flex min-h-0 flex-col overflow-hidden p-3 sm:p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-300">
                  {tab === 'Attendance Logs' ? 'Attendance Logs' : "Today's Attendance Records"}
                </h2>
                <span className="font-mono text-xs text-ink-500">{formatManilaDate(selectedDate)}</span>
              </div>
              <div className={clsx('mb-3 flex flex-wrap gap-2', !showFilters && 'sm:flex')}>
                <div className="relative min-w-[160px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden />
                  <Input
                    className="pl-9"
                    placeholder="Search personnel…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
                {(showFilters || true) && (
                  <>
                    <select
                      className="input-field min-h-[40px] w-auto min-w-[140px]"
                      value={deptFilter}
                      onChange={(e) => {
                        setDeptFilter(e.target.value);
                        setPage(1);
                      }}
                    >
                      {departments.map((d) => (
                        <option key={d} value={d}>{d === 'All' ? 'All Departments' : d}</option>
                      ))}
                    </select>
                    <select
                      className="input-field min-h-[40px] w-auto min-w-[120px]"
                      value={statusFilter}
                      onChange={(e) => {
                        setStatusFilter(e.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="All">All Status</option>
                      <option value="PRESENT">Present</option>
                      <option value="LATE">Late</option>
                      <option value="ABSENT">Absent</option>
                      <option value="ON LEAVE">On Leave</option>
                      <option value="REST DAY">Rest Day</option>
                    </select>
                  </>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-auto sidebar-scroll">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="sticky top-0 bg-navy-900 text-ink-500">
                    <tr>
                      <th className="px-2 py-2 text-xs font-medium">#</th>
                      <th className="px-2 py-2 text-xs font-medium">Personnel Name</th>
                      <th className="px-2 py-2 text-xs font-medium">Department</th>
                      <th className="px-2 py-2 text-xs font-medium">Check In</th>
                      <th className="px-2 py-2 text-xs font-medium">Status</th>
                      <th className="px-2 py-2 text-xs font-medium">Remarks</th>
                      <th className="px-2 py-2 text-xs font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageSlice.map((r, i) => {
                      const st = normalizeStatus(r.status);
                      const rowNum = (safePage - 1) * PAGE_SIZE + i + 1;
                      return (
                        <tr key={`${r.responderId}-${r.date}-${i}`} className="border-t border-navy-800 hover:bg-navy-900/40">
                          <td className="px-2 py-2 font-mono text-xs text-ink-500">{rowNum}</td>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-2">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-700 text-[11px] font-semibold text-ink-100">
                                {initials(r.fullName || '?')}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate font-medium text-ink-50">{r.fullName}</span>
                                <span className="block font-mono text-[10px] text-ink-500">{r.callsign || r.responderId?.slice(0, 12) || '—'}</span>
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-xs text-ink-300">{r.departmentName || '—'}</td>
                          <td className="px-2 py-2 font-mono text-xs text-ink-300">
                            {r.checkInTime ? formatManilaTime(r.checkInTime) : '—'}
                          </td>
                          <td className="px-2 py-2">
                            <span className={clsx('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase', STATUS_META[st].badge)}>
                              {st}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-xs text-ink-400">{remarksFor(r, st)}</td>
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              className="rounded p-1.5 text-ink-400 hover:bg-navy-800 hover:text-ink-100"
                              aria-label={`View ${r.fullName}`}
                              onClick={() => {
                                setSelectedRecord(r);
                                setDialog('view');
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {pageSlice.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-ink-500">No attendance records for this filter</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-navy-700 pt-3 text-xs text-ink-500">
                <span>
                  Showing {(safePage - 1) * PAGE_SIZE + (filtered.length ? 1 : 0)} to{' '}
                  {Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length} records
                </span>
                <div className="flex items-center gap-1">
                  <button type="button" className="rounded p-1 hover:bg-navy-800 disabled:opacity-40" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {Array.from({ length: Math.min(totalPages, 6) }, (_, i) => i + 1).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      className={clsx('min-w-[1.75rem] rounded px-1.5 py-0.5 font-mono', p === safePage ? 'bg-blue-500/25 text-blue-200' : 'hover:bg-navy-800')}
                    >
                      {p}
                    </button>
                  ))}
                  <button type="button" className="rounded p-1 hover:bg-navy-800 disabled:opacity-40" disabled={safePage >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </section>

            {/* Right rail */}
            <aside className="attendance-area-rail flex min-w-0 flex-col gap-3">
              <div className="card p-3 sm:p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Recent Check-Ins</h3>
                <ul className="space-y-2.5">
                  {recentCheckIns.map((r) => (
                    <li key={`${r._id}-${r.checkInTime}`} className="flex items-center gap-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-700 text-[11px] font-semibold">
                        {initials(r.fullName || '?')}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink-100">{r.fullName}</span>
                        <span className="block truncate text-[11px] text-ink-500">{r.departmentName || r.callsign || '—'}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono text-[11px] text-ink-300">{r.checkInTime ? formatManilaTime(r.checkInTime) : '—'}</span>
                        <span className={clsx('ml-auto mt-0.5 block h-1.5 w-1.5 rounded-full', STATUS_META[normalizeStatus(r.status)].color === '#4fb87e' ? 'bg-ok-400' : 'bg-orange-400')} style={{ background: STATUS_META[normalizeStatus(r.status)].color }} />
                      </span>
                    </li>
                  ))}
                  {recentCheckIns.length === 0 && <li className="text-sm text-ink-500">No check-ins yet today</li>}
                </ul>
              </div>

              <div className="card p-3 sm:p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Department Summary</h3>
                <ul className="space-y-3">
                  {deptSummary.map((d) => (
                    <li key={d.name}>
                      <div className="mb-1 flex justify-between gap-2 text-xs">
                        <span className="truncate text-ink-200">{d.name}</span>
                        <span className="shrink-0 font-mono text-ink-400">{d.present}/{d.total}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-navy-800">
                        <div className="h-full rounded-full" style={{ width: `${d.total ? (d.present / d.total) * 100 : 0}%`, background: d.color }} />
                      </div>
                    </li>
                  ))}
                  {deptSummary.length === 0 && <li className="text-sm text-ink-500">No department data</li>}
                </ul>
              </div>

              <div className="card p-3 sm:p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Leave Summary</h3>
                <p className="mb-2 text-[10px] text-ink-500">This Month</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Sick Leave', value: leaveSummary['Sick Leave'], icon: HeartPulse, tone: 'text-alert-300 bg-alert-500/15' },
                    { label: 'Vacation Leave', value: leaveSummary['Vacation Leave'], icon: Umbrella, tone: 'text-blue-300 bg-blue-500/15' },
                    { label: 'Emergency Leave', value: leaveSummary['Emergency Leave'], icon: TriangleAlert, tone: 'text-orange-300 bg-orange-500/15' },
                    { label: 'Other Leave', value: leaveSummary['Other Leave'], icon: CalendarDays, tone: 'text-ink-300 bg-navy-700' },
                  ].map((m) => (
                    <div key={m.label} className={clsx('rounded-lg px-2 py-2', m.tone)}>
                      <m.icon className="mb-1 h-4 w-4 opacity-80" aria-hidden />
                      <p className="font-mono text-lg font-semibold tabular-nums">{m.value}</p>
                      <p className="text-[10px] leading-tight opacity-80">{m.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card p-3 sm:p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Quick Actions</h3>
                <div className="grid grid-cols-2 gap-2">
                  {QUICK_ACTIONS.map((qa) => {
                    const Icon = qa.icon;
                    return (
                      <button
                        key={qa.id}
                        type="button"
                        className={clsx(
                          'flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-lg border bg-navy-900/40 px-1 py-2 text-center text-[10px] transition-colors hover:bg-navy-800/60',
                          qa.tone
                        )}
                        onClick={() => onQuickAction(qa.id)}
                      >
                        <Icon className="h-4 w-4" aria-hidden />
                        {qa.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>
          </div>
        )}

        {tab === 'Weekly Summary' && (
          <div className="card p-4">
            <h2 className="mb-4 text-sm font-semibold text-ink-100">Weekly Summary</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="text-ink-500">
                  <tr>
                    <th className="pb-2 pr-3">Date</th>
                    <th className="pb-2 pr-3">Present</th>
                    <th className="pb-2 pr-3">Late</th>
                    <th className="pb-2 pr-3">Absent</th>
                    <th className="pb-2">On Leave</th>
                  </tr>
                </thead>
                <tbody>
                  {weekTrend.days.map((d) => (
                    <tr key={d.key} className="border-t border-navy-800">
                      <td className="py-2 pr-3 text-ink-200">{d.label}</td>
                      <td className="py-2 pr-3 font-mono text-ok-300">{d.present}</td>
                      <td className="py-2 pr-3 font-mono text-orange-300">{d.late}</td>
                      <td className="py-2 pr-3 font-mono text-alert-300">{d.absent}</td>
                      <td className="py-2 font-mono text-blue-300">{d.leave}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'Monthly Report' && (
          <div className="card space-y-4 p-4">
            <h2 className="text-sm font-semibold text-ink-100">Monthly Report — {selectedDate.slice(0, 7)}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(leaveSummary).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-navy-700 bg-navy-900/50 p-3">
                  <p className="text-[10px] uppercase text-ink-500">{k}</p>
                  <p className="font-mono text-2xl font-semibold text-ink-50">{v}</p>
                </div>
              ))}
            </div>
            <Button type="button" onClick={() => setDialog('report')}>Generate PDF report</Button>
          </div>
        )}

        {tab === 'Leave Requests' && (
          <div className="card p-4">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink-100">Leave Requests</h2>
              <Button type="button" className="min-h-[40px]" onClick={() => setDialog('leave')}>Manage leave</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="text-ink-500">
                  <tr>
                    <th className="pb-2 pr-3">Personnel</th>
                    <th className="pb-2 pr-3">Type</th>
                    <th className="pb-2 pr-3">Dates</th>
                    <th className="pb-2 pr-3">Status</th>
                    <th className="pb-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveRequests.map((lr) => (
                    <tr key={lr.id} className="border-t border-navy-800">
                      <td className="py-2 pr-3 text-ink-100">{lr.fullName}</td>
                      <td className="py-2 pr-3 text-ink-300">{lr.leaveType}</td>
                      <td className="py-2 pr-3 text-xs text-ink-400">
                        {formatManilaDate(lr.startDate)} – {formatManilaDate(lr.endDate)}
                      </td>
                      <td className="py-2 pr-3 text-xs text-ink-200">{lr.status}</td>
                      <td className="py-2 text-xs text-ink-500">{lr.reason || '—'}</td>
                    </tr>
                  ))}
                  {leaveRequests.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-ink-500">No leave requests for this view</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </QueryState>

      <AttendanceActionDialogs
        open={dialog}
        onOpenChange={setDialog}
        accessToken={accessToken}
        selectedDate={selectedDate}
        selectedRecord={selectedRecord}
        responders={responders}
        leaveRequests={leaveRequests}
      />
    </div>
  );
}
