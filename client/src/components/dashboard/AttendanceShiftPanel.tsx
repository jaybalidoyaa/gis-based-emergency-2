import { LIVE } from '@/lib/liveTiming';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { attendanceApi, shiftsApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { formatManilaTime, manilaTodayYmd, OPS_TIMEZONE } from '@/lib/timezone';
import { QueryState } from '@/components/ui/QueryState';
import { OpsSectionHeader } from '@/components/ui/OpsSection';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { isAttendancePresent } from '@/lib/workforceMetrics';
import clsx from 'clsx';

interface ShiftRow {
  id?: string;
  teamName: string;
  startTime: string;
  endTime: string;
  shiftStatus: string;
  scheduledDate?: string;
  personnelCount?: number;
  teamLeader?: string;
}

interface AttendanceRow {
  date: string;
  status: string;
  fullName?: string;
}

function parseShiftMinutes(value: string): number | null {
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length >= 3 && digits.length <= 4) {
    const padded = digits.padStart(4, '0');
    const h = Number(padded.slice(0, 2));
    const m = Number(padded.slice(2, 4));
    if (h <= 23 && m <= 59) return h * 60 + m;
  }
  const ampm = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (/pm/i.test(ampm[3])) h += 12;
    return h * 60 + Number(ampm[2]);
  }
  return null;
}

function manilaNowMinutes(d = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: OPS_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

export function AttendanceShiftPanel() {
  const { accessToken, user } = useAuthStore();
  const [now, setNow] = useState(() => new Date());
  const canAttend = ['SYSTEM_ADMINISTRATOR', 'CENTRAL_DISPATCHER', 'DEPARTMENT_DISPATCHER'].includes(
    user?.role ?? ''
  );

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const attendanceQuery = useQuery({
    queryKey: ['attendance'],
    queryFn: () => attendanceApi.list(accessToken!),
    enabled: !!accessToken && canAttend,
    refetchInterval: LIVE.warmMs,
  });

  const shiftsQuery = useQuery({
    queryKey: ['shifts'],
    queryFn: () => shiftsApi.list(accessToken!),
    enabled: !!accessToken && canAttend,
    refetchInterval: LIVE.warmMs,
  });

  const today = manilaTodayYmd(now);
  const nowMins = manilaNowMinutes(now);

  const presentToday = useMemo(() => {
    const rows = (attendanceQuery.data?.data ?? []) as AttendanceRow[];
    return rows.filter((r) => r.date === today && isAttendancePresent(r.status)).length;
  }, [attendanceQuery.data, today]);

  const { activeShift, upcoming } = useMemo(() => {
    const shifts = (shiftsQuery.data?.data ?? []) as ShiftRow[];
    const withMeta = shifts.map((s) => {
      const start = parseShiftMinutes(s.startTime);
      const end = parseShiftMinutes(s.endTime);
      const beginsSoon =
        start != null && start >= nowMins && start - nowMins <= 120 && start - nowMins >= 0;
      const inWindow =
        start != null && end != null
          ? start <= end
            ? nowMins >= start && nowMins < end
            : nowMins >= start || nowMins < end
          : false;
      const statusOngoing = /ongoing|active|on duty/i.test(s.shiftStatus);
      return { ...s, startMins: start, endMins: end, beginsSoon, inWindow, statusOngoing };
    });

    // Prefer API "Ongoing" (same as Shifts page), then time-window match
    const active =
      withMeta.find((s) => s.statusOngoing) ??
      withMeta.find((s) => s.inWindow) ??
      null;

    const upcomingList = withMeta
      .filter((s) => s !== active)
      .filter((s) => s.beginsSoon || s.startMins == null || (s.startMins ?? 0) >= nowMins || /up next|scheduled/i.test(s.shiftStatus))
      .sort((a, b) => {
        if (a.beginsSoon !== b.beginsSoon) return a.beginsSoon ? -1 : 1;
        return (a.startMins ?? 9999) - (b.startMins ?? 9999);
      })
      .slice(0, 4);

    return { activeShift: active, upcoming: upcomingList };
  }, [shiftsQuery.data, nowMins]);

  if (!canAttend) {
    return (
      <div className="card flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden p-3 sm:p-4">
        <OpsSectionHeader title="Attendance & shifts" href="/admin/attendance" />
        <p className="text-sm text-ink-400">Attendance data requires attendance management permission.</p>
      </div>
    );
  }

  const loading = attendanceQuery.isLoading || shiftsQuery.isLoading;
  const errored = attendanceQuery.isError || shiftsQuery.isError;

  return (
    <div className="card flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden p-3 sm:p-4">
      <OpsSectionHeader
        title="Attendance & shifts"
        href="/admin/attendance"
        linkLabel="Calendar"
        className="shrink-0"
        action={
          <p className="flex items-center gap-1.5 font-mono text-[11px] text-ink-400">
            <Clock className="h-3.5 w-3.5 text-gold-500" aria-hidden="true" />
            {formatManilaTime(now)}
          </p>
        }
      />

      <QueryState
        isLoading={loading}
        isError={errored}
        error={(attendanceQuery.error || shiftsQuery.error) as Error}
        onRetry={() => {
          void attendanceQuery.refetch();
          void shiftsQuery.refetch();
        }}
        showLastUpdated={false}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="mb-3 grid shrink-0 grid-cols-2 gap-2">
          <div className="min-w-0 rounded-md border border-ok-500/30 bg-ok-500/10 p-2">
            <p className="text-[10px] uppercase tracking-wide text-ink-400">Present today</p>
            <p className="font-mono text-xl font-bold text-ok-400">{presentToday}</p>
          </div>
          <div className="min-w-0 rounded-md border border-navy-700 bg-navy-900/80 p-2">
            <p className="text-[10px] uppercase tracking-wide text-ink-400">Active shift</p>
            <p className="truncate text-sm font-semibold text-ink-50">{activeShift?.teamName ?? '—'}</p>
          </div>
        </div>

        <h4 className="mb-2 shrink-0 text-sm font-medium text-ink-200">Upcoming team shifts</h4>
        {upcoming.length === 0 ? (
          <p className="text-sm text-ink-400">No upcoming shifts scheduled.</p>
        ) : (
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto sidebar-scroll">
            {upcoming.map((s, i) => (
              <li key={s.id ?? i}>
                <Link
                  to="/admin/shifts"
                  className={clsx(
                    'block rounded-md border p-2.5 transition-colors sm:p-3',
                    s.beginsSoon
                      ? 'border-gold-500/50 bg-gold-500/5'
                      : 'border-navy-700 bg-navy-900/70 hover:bg-navy-800',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500'
                  )}
                  aria-label={`${s.teamName} shift ${s.startTime} to ${s.endTime}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="truncate font-medium text-ink-50">{s.teamName}</p>
                    <StatusBadge status={s.shiftStatus} />
                  </div>
                  <p className="mt-1 font-mono text-xs text-ink-400">
                    {s.scheduledDate || today} · {s.startTime} – {s.endTime}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}
