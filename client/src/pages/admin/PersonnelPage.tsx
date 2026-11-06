import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Award,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileSpreadsheet,
  Flame,
  MapPin,
  Pencil,
  Search,
  Shield,
  Siren,
  Upload,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import {
  personnelApi,
  attendanceApi,
  trainingApi,
  mapApi,
  settingsApi,
  unitChangeApi,
  type UnitChangeRequest,
} from '@/services/api';
import type { PersonnelMember } from '@/types';
import { LIVE } from '@/lib/liveTiming';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryState } from '@/components/ui/QueryState';
import { FreshnessLine, liveSyncToFreshness } from '@/components/ui/FreshnessLine';
import { MapView } from '@/components/map/MapView';
import { PersonnelActionDialogs, type PersonnelDialog } from '@/components/personnel/PersonnelActionDialogs';
import { useAdminLiveSync } from '@/hooks/LiveSyncContext';
import { formatRole } from '@/lib/incidentState';
import { formatManilaDate, formatManilaDateTime } from '@/lib/timezone';
import { classifyPersonnelDuty, isAttendancePresent, isAttendanceAbsent } from '@/lib/workforceMetrics';
import { SUN_VALLEY_CENTER } from '@/lib/validation';
import clsx from 'clsx';

const PAGE_SIZE = 7;

type FilterId = 'All' | 'Fire Rescue' | 'Medical Team' | 'BDRRMO' | 'Tanod' | 'Volunteers';

const FILTERS: FilterId[] = ['All', 'Fire Rescue', 'Medical Team', 'BDRRMO', 'Tanod', 'Volunteers'];

type DutyLabel = 'AVAILABLE' | 'EN ROUTE' | 'ON SCENE' | 'OFF DUTY' | 'ON LEAVE' | 'PATROL' | 'INACTIVE';

type StatusBucket = 'Available' | 'On Scene' | 'En Route' | 'Off Duty' | 'On Leave';

const STATUS_BUCKET_META: Record<StatusBucket, { color: string }> = {
  Available: { color: '#4fb87e' },
  'On Scene': { color: '#d4453a' },
  'En Route': { color: '#3b82f6' },
  'Off Duty': { color: '#6b7a8d' },
  'On Leave': { color: '#fb923c' },
};

const QUICK_ACTIONS: { id: PersonnelDialog | 'export'; label: string; icon: LucideIcon }[] = [
  { id: 'add', label: 'Add Personnel', icon: UserPlus },
  { id: 'edit', label: 'Edit Personnel', icon: Pencil },
  { id: 'assign', label: 'Assign Team', icon: Users },
  { id: 'training', label: 'Schedule Training', icon: Award },
  { id: 'report', label: 'Generate Report', icon: FileSpreadsheet },
  { id: 'attendance', label: 'View Attendance', icon: CalendarCheck },
  { id: 'certs', label: 'Manage Certifications', icon: Shield },
  { id: 'export', label: 'Export Records', icon: Download },
  { id: 'import', label: 'Import Personnel', icon: Upload },
];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function matchesFilter(p: PersonnelMember, filter: FilterId) {
  if (filter === 'All') return true;
  const hay = `${p.departmentName || ''} ${p.departmentCode || ''} ${p.roleName || ''}`.toLowerCase();
  if (filter === 'Fire Rescue') return /fire|brigada|rescue/.test(hay);
  if (filter === 'Medical Team') return /medical|ambulance|hospital|health/.test(hay);
  if (filter === 'BDRRMO') return /bemo|bdrr|emergency management/.test(hay);
  if (filter === 'Tanod') return /popsmo|police|tanod|security|order/.test(hay);
  if (filter === 'Volunteers') return /volunteer/.test(hay) || (!p.departmentName && p.roleName === 'EMERGENCY_RESPONDER');
  return true;
}

function dutyLabel(p: PersonnelMember): DutyLabel {
  if (p.accountStatus === 'inactive' || p.status === 'inactive') return 'INACTIVE';
  const avail = `${p.availabilityStatus || ''} ${p.operationalStatus || ''}`.toLowerCase();
  const assign = `${p.assignment?.assignmentStatus || ''}`.toLowerCase();
  if (avail.includes('leave') || assign.includes('leave')) return 'ON LEAVE';
  if (avail.includes('scene') || assign.includes('on scene') || assign.includes('arrived')) return 'ON SCENE';
  if (
    avail.includes('en route') ||
    avail.includes('enroute') ||
    assign.includes('en route') ||
    assign.includes('enroute') ||
    assign.includes('dispatched')
  ) {
    return 'EN ROUTE';
  }
  if (avail.includes('patrol') || assign.includes('patrol')) return 'PATROL';
  if (avail.includes('off') || avail.includes('unavailable') || avail.includes('offline')) return 'OFF DUTY';
  if (avail.includes('available') || avail.includes('on duty') || avail.includes('standby') || avail.includes('ready')) {
    return 'AVAILABLE';
  }
  // Active assignment accepted but not yet moving — still count as responding
  if (assign.includes('accepted') || assign === 'assigned') return 'EN ROUTE';
  if (p.responderId) return 'AVAILABLE';
  // Desk staff (dispatch/admin) with active accounts
  if ((p.accountStatus || p.status) === 'active') return 'AVAILABLE';
  return 'OFF DUTY';
}

function statusBucket(label: DutyLabel): StatusBucket {
  if (label === 'ON SCENE') return 'On Scene';
  if (label === 'EN ROUTE') return 'En Route';
  if (label === 'ON LEAVE') return 'On Leave';
  if (label === 'AVAILABLE' || label === 'PATROL') return 'Available';
  return 'Off Duty';
}

function dutyBadgeClass(label: DutyLabel) {
  switch (label) {
    case 'AVAILABLE':
      return 'bg-ok-500/20 text-ok-300 border-ok-500/40';
    case 'EN ROUTE':
      return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
    case 'ON SCENE':
      return 'bg-alert-500/20 text-alert-300 border-alert-500/40';
    case 'ON LEAVE':
      return 'bg-orange-500/20 text-orange-300 border-orange-500/40';
    case 'PATROL':
      return 'bg-teal-500/20 text-teal-300 border-teal-500/40';
    case 'INACTIVE':
      return 'bg-navy-700 text-ink-400 border-navy-600';
    default:
      return 'bg-navy-700 text-ink-300 border-navy-600';
  }
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

function certStatus(expiresAt?: string, certificationStatus?: string) {
  const base = (certificationStatus || 'passed').toLowerCase();
  if (!expiresAt) return { label: base === 'passed' ? 'Active' : certificationStatus || 'Active', tone: 'ok' as const };
  const exp = new Date(expiresAt).getTime();
  const days = (exp - Date.now()) / (1000 * 60 * 60 * 24);
  if (Number.isFinite(days) && days < 0) return { label: 'Expired', tone: 'alert' as const };
  if (Number.isFinite(days) && days <= 60) return { label: 'Expiring Soon', tone: 'warn' as const };
  return { label: 'Active', tone: 'ok' as const };
}

function DetailField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-ink-500">{label}</p>
      <p className="truncate text-sm text-ink-100">{value?.trim() || '—'}</p>
    </div>
  );
}

export function PersonnelPage() {
  const { accessToken, user } = useAuthStore();
  const queryClient = useQueryClient();
  const live = useAdminLiveSync();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterId>('All');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<PersonnelDialog>(null);

  const personnelQuery = useQuery({
    queryKey: ['personnel'],
    queryFn: () => personnelApi.list(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.warmMs,
  });

  const attendanceQuery = useQuery({
    queryKey: ['attendance'],
    queryFn: () => attendanceApi.list(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.warmMs,
  });

  const trainingQuery = useQuery({
    queryKey: ['training'],
    queryFn: () => trainingApi.list(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.warmMs,
  });

  const mapQuery = useQuery({
    queryKey: ['map-data'],
    queryFn: () => mapApi.data(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });

  const canAudit = ['SYSTEM_ADMINISTRATOR', 'CENTRAL_DISPATCHER'].includes(user?.role ?? '');
  const auditQuery = useQuery({
    queryKey: ['audit'],
    queryFn: () => settingsApi.auditLogs(accessToken!),
    enabled: !!accessToken && canAudit,
    refetchInterval: LIVE.warmMs,
  });

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(accessToken!),
    enabled: !!accessToken,
  });

  const unitChangeQuery = useQuery({
    queryKey: ['unit-change-requests', 'Pending'],
    queryFn: () => unitChangeApi.list(accessToken!, 'Pending'),
    enabled: !!accessToken,
    refetchInterval: LIVE.warmMs,
  });
  const unitRequests = (unitChangeQuery.data?.data ?? []) as UnitChangeRequest[];
  const [unitBusyId, setUnitBusyId] = useState<string | null>(null);

  async function decideUnitChange(id: string, decision: 'approve' | 'deny') {
    if (!accessToken) return;
    setUnitBusyId(id);
    try {
      await unitChangeApi.decide(accessToken, id, decision);
      toast.success(decision === 'approve' ? 'Team change approved' : 'Team change denied');
      void unitChangeQuery.refetch();
      void personnelQuery.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update request');
    } finally {
      setUnitBusyId(null);
    }
  }

  const departments = useMemo(() => {
    const rows = ((settingsQuery.data?.data as { departments?: Array<{ id?: string; name?: string; code?: string }> })?.departments ?? [])
      .filter((d) => d.id && d.name)
      .map((d) => ({ id: String(d.id), label: String(d.name), code: String(d.code || '') }));
    return rows;
  }, [settingsQuery.data]);

  const people = useMemo(() => {
    const list = personnelQuery.data?.data?.users ?? [];
    return list.map((p) => ({
      ...p,
      status: p.status || p.accountStatus,
      accountStatus: p.accountStatus || p.status || 'active',
      roleName: p.roleName || p.roleId?.name || '',
    }));
  }, [personnelQuery.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => {
      if (!matchesFilter(p, filter)) return false;
      if (!q) return true;
      return `${p.fullName} ${p.email} ${p.callsign || ''} ${p.departmentName || ''} ${p.teamName || ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [people, filter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageSlice = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, filter]);

  useEffect(() => {
    if (!selectedId && filtered[0]) {
      setSelectedId(filtered[0].id);
      return;
    }
    if (selectedId && filtered.length > 0 && !filtered.some((p) => p.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  useEffect(() => {
    if (!selectedId || filtered.length === 0) return;
    const idx = filtered.findIndex((p) => p.id === selectedId);
    if (idx < 0) return;
    const nextPage = Math.floor(idx / PAGE_SIZE) + 1;
    if (nextPage !== safePage) setPage(nextPage);
  }, [selectedId, filtered, safePage]);

  const selected = people.find((p) => p.id === selectedId) ?? null;
  const selectedDuty = selected ? dutyLabel(selected) : null;

  const stats = useMemo(() => {
    const labels = people.map(dutyLabel);
    const total = people.length;
    // Align with dashboard "Personnel on duty" / PERSONNEL_ON_DUTY_STATUSES
    const onDuty = people.filter((p) => {
      const raw = p.availabilityStatus || p.operationalStatus || p.status;
      return classifyPersonnelDuty(raw) === 'on_duty';
    }).length;
    const responding = labels.filter((l) => l === 'EN ROUTE' || l === 'ON SCENE').length;
    const offDuty = people.filter((p) => classifyPersonnelDuty(p.availabilityStatus || p.operationalStatus || p.status) === 'off_duty').length;
    const training = trainingQuery.data?.data ?? [];
    const certsExpiring = training.filter((t) => certStatus(t.expiresAt, t.certificationStatus).tone === 'warn').length;
    return { total, onDuty, responding, offDuty, certsExpiring };
  }, [people, trainingQuery.data]);

  const statusOverview = useMemo(() => {
    const order: StatusBucket[] = ['Available', 'On Scene', 'En Route', 'Off Duty', 'On Leave'];
    const counts = order.map((b) => people.filter((p) => statusBucket(dutyLabel(p)) === b).length);
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
        stops.push(`${STATUS_BUCKET_META[label].color} ${start}% ${cursor}%`);
      });
    }
    return {
      buckets: order.map((label, i) => ({ label, count: counts[i], percent: pct[i] })),
      total,
      gradient: `conic-gradient(${stops.join(', ')})`,
    };
  }, [people]);

  const teams = useMemo(() => {
    const map = new Map<string, { name: string; department: string; count: number; deployed: number }>();
    for (const p of people) {
      const name = p.teamName?.trim() || p.departmentCode || p.departmentName?.trim() || 'Unassigned';
      const key = name.toLowerCase();
      const row = map.get(key) || {
        name,
        department: p.departmentName || p.departmentCode || '—',
        count: 0,
        deployed: 0,
      };
      row.count += 1;
      const d = dutyLabel(p);
      if (d === 'EN ROUTE' || d === 'ON SCENE' || d === 'PATROL') row.deployed += 1;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 4);
  }, [people]);

  function teamBadge(deployed: number, count: number) {
    if (deployed <= 0) return { label: 'STANDBY', className: 'border-ok-500/40 bg-ok-500/15 text-ok-300' };
    if (deployed >= count) return { label: 'DEPLOYED', className: 'border-alert-500/40 bg-alert-500/15 text-alert-300' };
    return { label: 'ACTIVE', className: 'border-blue-500/40 bg-blue-500/15 text-blue-300' };
  }

  const attendanceRows = useMemo(() => {
    return (attendanceQuery.data?.data ?? []) as Array<{
      _id?: string;
      date: string;
      status: string;
      fullName?: string;
      callsign?: string;
    }>;
  }, [attendanceQuery.data]);

  const todayYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const todayAttendance = useMemo(() => {
    const today = attendanceRows.filter((r) => String(r.date).startsWith(todayYmd));
    const present = today.filter((r) => isAttendancePresent(r.status)).length;
    const late = today.filter((r) => /late/i.test(r.status)).length;
    const absent = today.filter((r) => isAttendanceAbsent(r.status)).length;
    const onLeave = today.filter((r) => /leave/i.test(r.status)).length;
    return {
      // Attendance present ≠ roster on-duty; do not fall back to roster KPI
      present,
      late,
      absent,
      onLeave: onLeave || people.filter((p) => dutyLabel(p) === 'ON LEAVE').length,
    };
  }, [attendanceRows, todayYmd, people]);

  const weekTrend = useMemo(() => {
    const days: { key: string; label: string; count: number }[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
      const label = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        month: 'short',
        day: '2-digit',
      }).format(d);
      const count = attendanceRows.filter((r) => String(r.date).startsWith(key) && !/absent|leave/i.test(r.status)).length;
      days.push({ key, label, count });
    }
    const max = Math.max(1, ...days.map((d) => d.count));
    return { days, max };
  }, [attendanceRows]);

  const selectedTraining = useMemo(() => {
    const all = trainingQuery.data?.data ?? [];
    if (!selected?.responderId) return all.filter((t) => t.fullName === selected?.fullName).slice(0, 5);
    return all.filter((t) => t.responderId === selected.responderId).slice(0, 5);
  }, [trainingQuery.data, selected]);

  const activity = useMemo(() => {
    const logs = (auditQuery.data?.data ?? []) as Array<{ action?: string; resourceType?: string; createdAt?: string }>;
    if (logs.length > 0) {
      return logs.slice(0, 8).map((l, i) => ({
        id: `${l.createdAt}-${i}`,
        text: `${l.action || 'Event'}${l.resourceType ? ` · ${l.resourceType}` : ''}`,
        at: l.createdAt,
        tone: /deactiv|fail|error|reject/i.test(l.action || '') ? 'alert' : /train|cert/i.test(l.action || '') ? 'warn' : 'ok',
      }));
    }
    return people
      .filter((p) => p.assignment || p.gpsUpdatedAt)
      .slice(0, 8)
      .map((p) => ({
        id: p.id,
        text: p.assignment
          ? `${p.fullName} assigned to ${p.assignment.incidentDisplayId || 'incident'} (${dutyLabel(p)})`
          : `${p.fullName} GPS updated`,
        at: p.assignment?.assignedAt || p.gpsUpdatedAt,
        tone: dutyLabel(p) === 'ON SCENE' ? 'alert' : dutyLabel(p) === 'EN ROUTE' ? 'info' : 'ok',
      }));
  }, [auditQuery.data, people]);

  async function toggleStatus(p: PersonnelMember) {
    if (!accessToken || !p.id) return;
    if (p.id === user?.id) {
      toast.error('You cannot deactivate your own active session from this screen');
      return;
    }
    const current = p.accountStatus || p.status || 'active';
    const next = current === 'active' ? 'inactive' : 'active';
    const action = next === 'inactive' ? 'Deactivate' : 'Activate';
    if (!window.confirm(`${action} account for ${p.fullName}?`)) return;
    const reason = next === 'inactive' ? window.prompt(`Reason to deactivate ${p.fullName}?`) : 'Reactivated by dispatcher';
    if (next === 'inactive' && !reason?.trim()) return;
    try {
      await personnelApi.update(accessToken, p.id, { status: next, reason });
      toast.success(`${p.fullName} marked ${next}`);
      queryClient.invalidateQueries({ queryKey: ['personnel'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Status update failed');
    }
  }

  function exportCsv() {
    const header = ['Name', 'Email', 'Role', 'Department', 'Team', 'Status', 'Callsign'];
    const lines = filtered.map((p) =>
      [p.fullName, p.email, p.roleName, p.departmentName || '', p.teamName || '', dutyLabel(p), p.callsign || '']
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `personnel-${todayYmd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Personnel CSV exported');
  }

  function onQuickAction(id: PersonnelDialog | 'export') {
    if (id === 'export') {
      exportCsv();
      return;
    }
    if ((id === 'edit' || id === 'certs') && !selected) {
      toast.message('Select a person in the directory first');
    }
    setDialog(id);
  }

  const mapCenter: [number, number] =
    selected?.lat != null && selected?.lng != null
      ? [selected.lat, selected.lng]
      : [SUN_VALLEY_CENTER.lat, SUN_VALLEY_CENTER.lng];

  const pageButtons = useMemo(() => {
    const pages: (number | '…')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i += 1) pages.push(i);
      return pages;
    }
    pages.push(1);
    if (safePage > 3) pages.push('…');
    for (let i = Math.max(2, safePage - 1); i <= Math.min(totalPages - 1, safePage + 1); i += 1) pages.push(i);
    if (safePage < totalPages - 2) pages.push('…');
    pages.push(totalPages);
    return pages;
  }, [totalPages, safePage]);

  return (
    <div className="personnel-page mx-auto flex w-full min-w-0 flex-col gap-4 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-ink-50 sm:text-2xl">Personnel Management</h1>
          <p className="mt-0.5 text-sm text-ink-400">Roster, duty status, certifications, and deployment overview</p>
          <FreshnessLine
            state={liveSyncToFreshness(live.state, live.lastUpdated)}
            lastUpdated={personnelQuery.dataUpdatedAt || live.lastUpdated}
            compact
            className="mt-1"
          />
        </div>
        <Button type="button" className="min-h-[44px]" onClick={() => setDialog('add')}>
          <UserPlus className="mr-2 h-4 w-4" aria-hidden />
          Add personnel
        </Button>
      </div>

      {unitRequests.length > 0 && (
        <section className="card space-y-3 border-gold-500/30 p-4" aria-label="Pending team and unit change requests">
          <div>
            <h2 className="text-sm font-semibold text-gold-400">Pending team / unit changes</h2>
            <p className="text-xs text-ink-500">Responders requested these moves — approve or deny to apply.</p>
          </div>
          <ul className="space-y-2">
            {unitRequests.map((r) => {
              const isUnit = (r.requestType || 'team') === 'unit';
              const summary = isUnit
                ? `${r.fromUnitLabel || 'Unassigned'} → ${r.toUnitLabel || '—'}`
                : `${r.fromTeam || 'Unassigned'} → ${r.toTeam || '—'}`;
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-navy-700 bg-navy-950/50 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-50">
                      <span className="mr-2 rounded border border-navy-600 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-400">
                        {isUnit ? 'Unit' : 'Team'}
                      </span>
                      {r.fullName || 'Responder'} {r.callsign ? `(${r.callsign})` : ''}
                    </p>
                    <p className="text-xs text-ink-400">{summary}</p>
                    {r.reason ? <p className="mt-0.5 text-xs text-ink-500">{r.reason}</p> : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={unitBusyId === r.id}
                      onClick={() => void decideUnitChange(r.id, 'deny')}
                    >
                      Deny
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={unitBusyId === r.id}
                      onClick={() => void decideUnitChange(r.id, 'approve')}
                    >
                      Approve
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {[
          { label: 'Total Personnel', value: stats.total, icon: Users, tone: 'text-ok-400 bg-ok-500/15' },
          { label: 'Personnel on duty', value: stats.onDuty, icon: Shield, tone: 'text-blue-300 bg-blue-500/15' },
          { label: 'Responding', value: stats.responding, icon: Siren, tone: 'text-alert-300 bg-alert-500/15' },
          { label: 'Off Duty', value: stats.offDuty, icon: Clock3, tone: 'text-ink-300 bg-navy-700' },
          { label: 'Certifications Expiring', value: stats.certsExpiring, icon: Award, tone: 'text-orange-300 bg-orange-500/15' },
        ].map((card) => (
          <div key={card.label} className="card flex items-center gap-3 p-3 sm:p-4">
            <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', card.tone)}>
              <card.icon className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-ink-500">{card.label}</p>
              <p className="font-mono text-xl font-semibold tabular-nums text-ink-50">{card.value}</p>
            </div>
          </div>
        ))}
      </div>

      <QueryState
        isLoading={personnelQuery.isLoading}
        isError={personnelQuery.isError}
        error={personnelQuery.error as Error}
        onRetry={() => personnelQuery.refetch()}
        isEmpty={people.length === 0}
        emptyTitle="No personnel records"
        showLastUpdated={false}
      >
        <div className="personnel-grid">
          {/* Directory */}
          <section className="personnel-area-directory card flex min-h-0 flex-col overflow-hidden p-3 sm:p-4">
            <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-300">Personnel Directory</h2>
              <span className="font-mono text-xs text-ink-500">{filtered.length} Personnel</span>
            </div>
            <div className="relative mb-3 shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden />
              <Input
                className="pl-9"
                placeholder="Search personnel name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search personnel"
              />
            </div>
            <div className="mb-3 flex shrink-0 gap-1.5 overflow-x-auto pb-1 sidebar-scroll">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={clsx(
                    'shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors',
                    filter === f
                      ? 'border-blue-500/50 bg-blue-500/20 text-blue-200'
                      : 'border-navy-600 bg-navy-900/60 text-ink-400 hover:text-ink-200'
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto sidebar-scroll" role="list">
              {pageSlice.map((p) => {
                const label = dutyLabel(p);
                const active = p.id === selectedId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={clsx(
                        'flex w-full gap-3 rounded-xl border p-3 text-left transition-colors',
                        active
                          ? 'border-gold-500/40 bg-gold-500/10'
                          : 'border-navy-700 bg-navy-900/50 hover:border-navy-600 hover:bg-navy-800/60'
                      )}
                    >
                      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy-700 text-sm font-semibold text-ink-100">
                        {initials(p.fullName)}
                        <span
                          className={clsx(
                            'absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-navy-900',
                            label === 'AVAILABLE' || label === 'PATROL'
                              ? 'bg-ok-400'
                              : label === 'ON SCENE' || label === 'EN ROUTE'
                                ? 'bg-alert-400'
                                : label === 'ON LEAVE'
                                  ? 'bg-orange-400'
                                  : 'bg-ink-500'
                          )}
                          aria-hidden
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="truncate font-medium text-ink-50">{p.fullName}</span>
                          <span className={clsx('shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase', dutyBadgeClass(label))}>
                            {label}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-ink-400">
                          {p.departmentName || formatRole(p.roleName)}
                          {p.teamName ? ` / ${p.teamName}` : ''}
                        </span>
                        {p.callsign && (
                          <span className="mt-1 inline-flex rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] text-purple-300">
                            {p.callsign}
                          </span>
                        )}
                        <span className="mt-1 flex items-center gap-1 text-[11px] text-ink-500">
                          <MapPin className="h-3 w-3" aria-hidden />
                          {p.lat != null && p.lng != null
                            ? (() => {
                                const ageMs = p.gpsUpdatedAt ? Date.now() - (() => {
                                  const raw = p.gpsUpdatedAt!;
                                  const iso = /Z$/i.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`;
                                  return Date.parse(iso);
                                })() : Number.POSITIVE_INFINITY;
                                if (!Number.isFinite(ageMs) || ageMs > 30 * 60 * 1000) return 'GPS outdated';
                                return 'Live GPS';
                              })()
                            : 'At Base'}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {pageSlice.length === 0 && (
                <li className="py-8 text-center text-sm text-ink-500">No personnel match this filter</li>
              )}
            </ul>
            <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-navy-700 pt-3 text-xs text-ink-500">
              <span>
                Showing {(safePage - 1) * PAGE_SIZE + (filtered.length ? 1 : 0)} to{' '}
                {Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length} personnel
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded p-1 text-ink-400 hover:bg-navy-800 hover:text-ink-100 disabled:opacity-40"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {pageButtons.map((p, i) =>
                  p === '…' ? (
                    <span key={`e-${i}`} className="px-1">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      className={clsx(
                        'min-w-[1.75rem] rounded px-1.5 py-0.5 font-mono',
                        p === safePage ? 'bg-blue-500/25 text-blue-200' : 'text-ink-400 hover:bg-navy-800'
                      )}
                    >
                      {p}
                    </button>
                  )
                )}
                <button
                  type="button"
                  className="rounded p-1 text-ink-400 hover:bg-navy-800 hover:text-ink-100 disabled:opacity-40"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>

          {/* Detail */}
          <section className="personnel-area-detail flex min-w-0 flex-col gap-3">
            {selected ? (
              <>
                <div className="card p-3 sm:p-4">
                  <div className="flex flex-wrap gap-4">
                    <div className="flex flex-col items-center gap-2 sm:items-start">
                      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-navy-700 text-2xl font-semibold text-ink-50">
                        {initials(selected.fullName)}
                      </span>
                      <div className="text-center sm:text-left">
                        <p className="text-base font-semibold text-ink-50">{selected.fullName}</p>
                        {selectedDuty && (
                          <span className={clsx('mt-1 inline-flex rounded border px-2 py-0.5 text-[10px] font-semibold uppercase', dutyBadgeClass(selectedDuty))}>
                            {selectedDuty}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-ink-500">
                        Last GPS:{' '}
                        {selected.gpsUpdatedAt ? formatManilaDateTime(selected.gpsUpdatedAt) : '—'}
                      </p>
                    </div>
                    <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2.5">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">Basic Information</h3>
                        <DetailField label="Full Name" value={selected.fullName} />
                        <DetailField label="Position" value={formatRole(selected.roleName)} />
                        <DetailField label="Callsign / Rank" value={selected.callsign} />
                        <DetailField label="Department" value={selected.departmentName} />
                        <DetailField label="Contact Number" value={selected.contactNumber} />
                        <DetailField label="Email Address" value={selected.email} />
                        <DetailField label="Personnel ID" value={selected.id.slice(0, 12)} />
                      </div>
                      <div className="space-y-2.5">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">Assignment & Account</h3>
                        <DetailField label="Team" value={selected.teamName} />
                        <DetailField label="Operational Status" value={selected.operationalStatus || selected.availabilityStatus} />
                        <DetailField label="Account Status" value={selected.accountStatus || selected.status} />
                        <DetailField label="Date Hired" value={selected.createdAt ? formatManilaDate(selected.createdAt) : undefined} />
                        <DetailField label="Assigned Unit" value={selected.assignment?.unitNo} />
                        <DetailField
                          label="Current Incident"
                          value={
                            selected.assignment
                              ? `${selected.assignment.incidentDisplayId || ''} ${selected.assignment.incidentType || ''}`.trim()
                              : undefined
                          }
                        />
                        <button
                          type="button"
                          className="text-xs text-gold-400 underline"
                          onClick={() => toggleStatus(selected)}
                        >
                          {(selected.accountStatus || selected.status) === 'active' ? 'Deactivate account' : 'Activate account'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card overflow-hidden p-3 sm:p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">Certification & Training Records</h3>
                    <button
                      type="button"
                      className="text-[11px] text-blue-300 hover:underline"
                      onClick={() => setDialog('certs')}
                    >
                      View All Training Records
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-left text-xs">
                      <thead className="text-ink-500">
                        <tr>
                          <th className="pb-2 pr-2 font-medium">Training / Certification</th>
                          <th className="pb-2 pr-2 font-medium">Completion</th>
                          <th className="pb-2 pr-2 font-medium">Valid Until</th>
                          <th className="pb-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedTraining.map((t) => {
                          const st = certStatus(t.expiresAt, t.certificationStatus);
                          return (
                            <tr key={t.id} className="border-t border-navy-800">
                              <td className="py-2 pr-2 text-ink-100">{t.trainingName}</td>
                              <td className="py-2 pr-2 text-ink-400">
                                {t.completedAt ? formatManilaDate(t.completedAt) : '—'}
                              </td>
                              <td className="py-2 pr-2 text-ink-400">
                                {t.expiresAt ? formatManilaDate(t.expiresAt) : '—'}
                              </td>
                              <td className="py-2">
                                <span className="inline-flex items-center gap-1.5">
                                  <span
                                    className={clsx(
                                      'h-2 w-2 rounded-full',
                                      st.tone === 'ok' && 'bg-ok-400',
                                      st.tone === 'warn' && 'bg-gold-400',
                                      st.tone === 'alert' && 'bg-alert-400'
                                    )}
                                  />
                                  {st.label}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                        {selectedTraining.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-4 text-center text-ink-500">
                              No training records for this person
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {selected.assignment && (
                  <div className="card border-alert-500/20 p-3 sm:p-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Assignment Information</h3>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex gap-2">
                        <Flame className="mt-0.5 h-4 w-4 shrink-0 text-alert-400" aria-hidden />
                        <DetailField
                          label="Current Incident"
                          value={`${selected.assignment.incidentDisplayId || ''} — ${selected.assignment.addressText || selected.assignment.incidentType || '—'}`}
                        />
                      </div>
                      <DetailField label="Assigned Unit" value={selected.assignment.unitNo} />
                      <DetailField label="Team" value={selected.teamName} />
                      <DetailField label="Assigned By" value={selected.assignment.assignedBy} />
                      <DetailField
                        label="Assigned At"
                        value={selected.assignment.assignedAt ? formatManilaDateTime(selected.assignment.assignedAt) : undefined}
                      />
                      <DetailField label="Incident ID" value={selected.assignment.incidentId?.slice(0, 12)} />
                    </div>
                  </div>
                )}

                <div className="card overflow-hidden p-3 sm:p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">Live Personnel Map</h3>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-[1fr_140px]">
                    <div className="h-[220px] overflow-hidden rounded-lg border border-navy-700 sm:h-[260px]">
                      <MapView
                        data={mapQuery.data?.data}
                        height="100%"
                        center={mapCenter}
                        zoom={selected?.lat != null ? 15 : 13}
                        interactive
                        showBoundary
                        pin={
                          selected.lat != null && selected.lng != null
                            ? { lat: selected.lat, lng: selected.lng, label: selected.fullName }
                            : null
                        }
                      />
                    </div>
                    <ul className="space-y-2 text-[11px] text-ink-400">
                      <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-alert-400" /> Fire / Rescue</li>
                      <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-blue-400" /> Medical</li>
                      <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-ok-400" /> On Duty</li>
                      <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-gold-400" /> On Assignment</li>
                      <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-ink-500" /> Off Duty</li>
                      <li className="pt-2 text-[10px] text-ink-500">
                        Last map update:{' '}
                        {mapQuery.dataUpdatedAt ? formatManilaDateTime(new Date(mapQuery.dataUpdatedAt).toISOString()) : '—'}
                      </li>
                    </ul>
                  </div>
                </div>
              </>
            ) : (
              <div className="card flex min-h-[240px] items-center justify-center p-6 text-sm text-ink-500">
                Select a person from the directory
              </div>
            )}
          </section>

          {/* Rail */}
          <aside className="personnel-area-rail flex min-w-0 flex-col gap-3">
            <div className="card p-3 sm:p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Personnel Status Overview</h3>
              <div className="flex flex-col items-center gap-3">
                <div
                  className="relative h-28 w-28"
                  role="img"
                  aria-label={`Status overview. Total ${statusOverview.total}`}
                >
                  <div className="h-full w-full rounded-full" style={{ background: statusOverview.gradient }} />
                  <div className="absolute inset-[24%] flex flex-col items-center justify-center rounded-full bg-navy-900">
                    <span className="font-mono text-lg font-bold text-ink-50">{statusOverview.total}</span>
                    <span className="text-[9px] uppercase text-ink-500">Total</span>
                  </div>
                </div>
                <ul className="w-full space-y-1.5">
                  {statusOverview.buckets.map((b) => (
                    <li key={b.label} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-2 text-ink-300">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_BUCKET_META[b.label].color }} />
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
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">Team Deployment Status</h3>
                <button
                  type="button"
                  className="text-[11px] text-blue-300 hover:underline"
                  onClick={() => setDialog('assign')}
                >
                  View All Teams
                </button>
              </div>
              <ul className="space-y-2">
                {teams.map((t) => {
                  const badge = teamBadge(t.deployed, t.count);
                  return (
                  <li key={t.name} className="rounded-lg border border-navy-700 bg-navy-900/50 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink-100">{t.name}</span>
                      <span className={clsx('shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase', badge.className)}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-ink-500">
                      {t.department} · {t.count} personnel{t.deployed > 0 ? ` · ${t.deployed} responding` : ''}
                    </p>
                  </li>
                  );
                })}
                {teams.length === 0 && <li className="text-sm text-ink-500">No teams yet</li>}
              </ul>
            </div>

            <div className="card p-3 sm:p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Today&apos;s Attendance</h3>
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: 'Present', value: todayAttendance.present, tone: 'text-ok-300 bg-ok-500/15' },
                  { label: 'Late', value: todayAttendance.late, tone: 'text-gold-300 bg-gold-500/15' },
                  { label: 'Absent', value: todayAttendance.absent, tone: 'text-alert-300 bg-alert-500/15' },
                  { label: 'On Leave', value: todayAttendance.onLeave, tone: 'text-blue-300 bg-blue-500/15' },
                ].map((m) => (
                  <div key={m.label} className={clsx('rounded-lg px-2 py-2 text-center', m.tone)}>
                    <p className="font-mono text-lg font-semibold tabular-nums">{m.value}</p>
                    <p className="text-[10px] uppercase opacity-80">{m.label}</p>
                  </div>
                ))}
              </div>
              <p className="mb-2 text-[11px] text-ink-500">Attendance Trend (This Week)</p>
              <div className="flex h-24 items-end gap-1.5">
                {weekTrend.days.map((d) => (
                  <div key={d.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-blue-500/70"
                      style={{ height: `${Math.max(8, (d.count / weekTrend.max) * 100)}%` }}
                      title={`${d.label}: ${d.count}`}
                    />
                    <span className="truncate text-[9px] text-ink-500">{d.label.split(' ')[1] || d.label}</span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="mt-2 inline-block text-[11px] text-blue-300 hover:underline"
                onClick={() => setDialog('attendance')}
              >
                View Attendance Logs
              </button>
            </div>

            <div className="card p-3 sm:p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Quick Actions</h3>
              <div className="grid grid-cols-3 gap-2">
                {QUICK_ACTIONS.map((qa) => {
                  const Icon = qa.icon;
                  return (
                    <button
                      key={qa.id}
                      type="button"
                      className="flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-lg border border-blue-500/35 bg-navy-900/40 px-1 py-2 text-center text-[10px] text-blue-200 transition-colors hover:bg-blue-500/10"
                      onClick={() => onQuickAction(qa.id)}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                      {qa.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="card p-3 sm:p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">Activity Log</h3>
                <button
                  type="button"
                  className="text-[11px] text-blue-300 hover:underline"
                  onClick={() => setDialog('activity')}
                >
                  View Full Log
                </button>
              </div>
              <ul className="space-y-2.5">
                {activity.map((a) => (
                  <li key={a.id} className="flex gap-2 text-xs">
                    <span
                      className={clsx(
                        'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                        a.tone === 'alert' && 'bg-alert-400',
                        a.tone === 'warn' && 'bg-gold-400',
                        a.tone === 'info' && 'bg-blue-400',
                        a.tone === 'ok' && 'bg-ok-400'
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block text-ink-200">{a.text}</span>
                      <span className="text-[10px] text-ink-500">
                        {a.at ? formatManilaDateTime(a.at) : '—'}
                      </span>
                    </span>
                  </li>
                ))}
                {activity.length === 0 && <li className="text-sm text-ink-500">No recent activity</li>}
              </ul>
            </div>
          </aside>
        </div>
      </QueryState>

      <PersonnelActionDialogs
        open={dialog}
        onOpenChange={setDialog}
        accessToken={accessToken}
        selected={selected}
        people={people}
        training={trainingQuery.data?.data ?? []}
        attendance={attendanceRows}
        activity={activity}
        departments={departments}
      />
    </div>
  );
}
