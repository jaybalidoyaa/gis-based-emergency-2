import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Flame,
  Ambulance,
  LifeBuoy,
  Truck,
  Shield,
  Send,
  FileText,
  X,
  Megaphone,
  AlertTriangle,
  Headset,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import {
  respondersApi,
  incidentsApi,
  mapApi,
  transportsApi,
  chatApi,
  analyticsApi,
  settingsApi,
  notificationsApi,
} from '@/services/api';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { QueryState } from '@/components/ui/QueryState';
import { PageHeader } from '@/components/ui/PageHeader';
import { FreshnessLine, liveSyncToFreshness } from '@/components/ui/FreshnessLine';
import { ConfirmActionDialog, type ConfirmActionRequest } from '@/components/ui/ConfirmActionDialog';
import { MapView } from '@/components/map/MapView';
import { useAdminLiveSync } from '@/hooks/LiveSyncContext';
import { useLiveMapData } from '@/hooks/useLiveMapData';
import { SmartIntakeDialog } from '@/components/intake/SmartIntakeDialog';
import { DispatchActionDialogs, type DispatchPanel } from '@/components/dispatch/DispatchActionDialogs';
import {
  canAssignIncident,
  canCancelIncident,
  canReopenIncident,
  canVerifyIncident,
  isIncidentReadonly,
} from '@/lib/incidentState';
import { getIncidentTypeVisual, getUnitTypeVisual, resolveUnitStatus } from '@/lib/opsVisuals';
import { formatManilaTime, formatManilaDateTime, manilaTodayYmd } from '@/lib/timezone';
import { LIVE } from '@/lib/liveTiming';
import type { Incident, MapUnit } from '@/types';
import clsx from 'clsx';

type PendingAction =
  | { kind: 'verify' }
  | { kind: 'falseAlarm' }
  | { kind: 'cancel' }
  | { kind: 'reopen' }
  | { kind: 'assign'; responderId: string; label: string };

type TransportRow = {
  id?: string;
  scheduledTime?: string;
  scheduledDate?: string;
  originAddress?: string;
  destinationAddress?: string;
  vehicleId?: string;
  assignedTeam?: string;
  transportStatus?: string;
};

type ChatMessage = {
  _id: string;
  message: string;
  createdAt: string;
  senderName?: string;
};

type AuditRow = {
  action?: string;
  resourceType?: string;
  resourceId?: string;
  incidentDisplayId?: string;
  createdAt?: string;
  actorName?: string;
  actorRole?: string;
};

const QUEUE_PAGE_SIZE = 5;

const UNIT_ICONS = {
  fire: Flame,
  ambulance: Ambulance,
  rescue: LifeBuoy,
  fleet: Truck,
  generic: Shield,
} as const;

function unitIconFor(unit: MapUnit) {
  const visual = getUnitTypeVisual(unit);
  return UNIT_ICONS[visual.icon] ?? Truck;
}

function conductionStatus(s: TransportRow): string {
  const st = s.transportStatus ?? 'Scheduled';
  if (st === 'Completed') return 'Done';
  if (st === 'Cancelled') return 'Cancelled';
  if (st === 'Scheduled') return 'Upcoming';
  return st;
}

function assignedUnitLabel(inc: Incident): string {
  const a = inc.assignments?.find((x) => x.responderId || x.vehicleId);
  if (!a) return '—';
  return (
    a.responderId?.callsign ||
    a.vehicleId?.unitNo ||
    a.responderId?.fullName ||
    a.responderId?.userId?.fullName ||
    '—'
  );
}

function PanelTitle({
  title,
  href,
  linkLabel = 'View All',
  trailing,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3">
      <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-100">{title}</h3>
      <div className="flex items-center gap-2">
        {trailing}
        {href ? (
          <Link to={href} className="text-xs font-medium text-[#60a5fa] hover:underline">
            {linkLabel}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function DispatchPage() {
  const { accessToken } = useAuthStore();
  const queryClient = useQueryClient();
  const live = useAdminLiveSync();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<Incident | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [queuePage, setQueuePage] = useState(0);
  const [chatText, setChatText] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [actionPanel, setActionPanel] = useState<DispatchPanel>(null);
  const [notifyBusy, setNotifyBusy] = useState(false);

  const deepLinkIncidentId = searchParams.get('incident');
  const openIntake = searchParams.get('intake') === '1';
  const openAssign = searchParams.get('assign') === '1';
  const focusChat = searchParams.get('focus') === 'chat';

  const today = manilaTodayYmd();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['dispatch-queue'] });
    queryClient.invalidateQueries({ queryKey: ['map-data'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    queryClient.invalidateQueries({ queryKey: ['incident-timeline'] });
    queryClient.invalidateQueries({ queryKey: ['incident'] });
    queryClient.invalidateQueries({ queryKey: ['incidents'] });
    queryClient.invalidateQueries({ queryKey: ['sos'] });
    queryClient.invalidateQueries({ queryKey: ['transports'] });
    queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    queryClient.invalidateQueries({ queryKey: ['responders-chat'] });
    queryClient.invalidateQueries({ queryKey: ['audit'] });
  }, [queryClient]);

  const queueQuery = useQuery({
    queryKey: ['dispatch-queue'],
    queryFn: () => respondersApi.dispatchQueue(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });

  const mapQuery = useQuery({
    queryKey: ['map-data'],
    queryFn: () => mapApi.data(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });

  const typesQuery = useQuery({
    queryKey: ['incident-types'],
    queryFn: () => incidentsApi.types(accessToken!),
    enabled: !!accessToken,
  });

  const transportsQuery = useQuery({
    queryKey: ['transports'],
    queryFn: () => transportsApi.list(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.warmMs,
  });

  const analyticsQuery = useQuery({
    queryKey: ['dispatch-analytics-today', today],
    queryFn: () => analyticsApi.get(accessToken!, { from: today, to: today }),
    enabled: !!accessToken,
    refetchInterval: LIVE.warmMs,
  });

  const auditQuery = useQuery({
    queryKey: ['audit'],
    queryFn: () => settingsApi.auditLogs(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.coolMs,
  });

  const detailQuery = useQuery({
    queryKey: ['incident', selected?._id],
    queryFn: () => incidentsApi.get(accessToken!, selected!._id),
    enabled: !!accessToken && !!selected?._id,
    refetchInterval: LIVE.hotMs,
  });

  const deepLinkQuery = useQuery({
    queryKey: ['incident', deepLinkIncidentId],
    queryFn: () => incidentsApi.get(accessToken!, deepLinkIncidentId!),
    enabled: !!accessToken && !!deepLinkIncidentId,
  });

  useEffect(() => {
    if (openIntake) {
      setIntakeOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('intake');
      setSearchParams(next, { replace: true });
    }
  }, [openIntake, searchParams, setSearchParams]);

  useEffect(() => {
    if (!focusChat) return;
    const el = document.getElementById('dispatch-team-chat');
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const next = new URLSearchParams(searchParams);
    next.delete('focus');
    setSearchParams(next, { replace: true });
  }, [focusChat, searchParams, setSearchParams]);

  useEffect(() => {
    const linked = deepLinkQuery.data?.data;
    if (!linked?._id) return;
    setSelected(linked);
    if (openAssign) setActionPanel('assign');
    const next = new URLSearchParams(searchParams);
    next.delete('incident');
    next.delete('assign');
    setSearchParams(next, { replace: true });
  }, [deepLinkQuery.data, openAssign, searchParams, setSearchParams]);

  const nearbyQuery = useQuery({
    queryKey: ['nearby', selected?._id],
    queryFn: () => incidentsApi.nearbyUnits(accessToken!, selected!._id),
    enabled: !!accessToken && !!selected && (canAssignIncident(selected.status) || actionPanel === 'assign'),
  });

  const chatQuery = useQuery({
    queryKey: ['responders-chat'],
    queryFn: () => chatApi.respondersMessages(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)
        return;
      if (e.key === 'n') setIntakeOpen(true);
      if (e.key === 'Escape') setSelected(null);
      if (e.key === 'v' && selected && canVerifyIncident(selected.status)) {
        e.preventDefault();
        setPending({ kind: 'verify' });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const confirmRequest: ConfirmActionRequest | null = (() => {
    if (!pending || !selected) return null;
    switch (pending.kind) {
      case 'verify':
        return {
          title: `Verify ${selected.displayId}?`,
          description: 'Marks the incident verified and opens it for dispatch assignment.',
          confirmLabel: 'Verify & open',
          tone: 'gold',
        };
      case 'falseAlarm':
        return {
          title: `Mark ${selected.displayId} as false alarm?`,
          description: 'This closes the incident as a false alarm. Provide a reason for the record.',
          confirmLabel: 'Confirm false alarm',
          tone: 'destructive',
          requireReason: true,
          reasonLabel: 'Reason',
        };
      case 'cancel':
        return {
          title: `Cancel ${selected.displayId}?`,
          description: 'Cancellation makes the incident read-only until it is reopened.',
          confirmLabel: 'Cancel incident',
          tone: 'destructive',
          requireReason: true,
          reasonLabel: 'Cancellation reason',
        };
      case 'reopen':
        return {
          title: `Reopen ${selected.displayId}?`,
          description: 'Reopens a closed or cancelled incident for further dispatch action.',
          confirmLabel: 'Reopen',
          requireReason: true,
          reasonLabel: 'Reason for reopening',
        };
      case 'assign':
        return {
          title: `Dispatch ${pending.label}?`,
          description: `Assign ${pending.label} to ${selected.displayId}. The unit must acknowledge before proceeding.`,
          confirmLabel: 'Dispatch unit',
          tone: 'gold',
        };
      default:
        return null;
    }
  })();

  async function runConfirm(reason?: string) {
    if (!selected || !accessToken || !pending) return;
    setBusy(true);
    try {
      if (pending.kind === 'verify') {
      await incidentsApi.verify(accessToken, selected._id, { priority: selected.priorityLevel });
      toast.success('Incident verified');
      const refreshed = await incidentsApi.get(accessToken, selected._id);
      if (refreshed.data) setSelected(refreshed.data);
      } else if (pending.kind === 'falseAlarm') {
        await incidentsApi.falseAlarm(accessToken, selected._id, reason!.trim());
      toast.message('Marked as false alarm');
      setSelected(null);
      } else if (pending.kind === 'cancel') {
        await incidentsApi.cancel(accessToken, selected._id, reason!.trim());
      toast.message('Incident cancelled');
      setSelected(null);
      } else if (pending.kind === 'reopen') {
        await incidentsApi.reopen(accessToken, selected._id, reason!.trim());
        toast.success('Incident reopened');
        const refreshed = await incidentsApi.get(accessToken, selected._id);
        if (refreshed.data) setSelected(refreshed.data);
      } else if (pending.kind === 'assign') {
        setAssigning(true);
        await incidentsApi.assignMany(
          accessToken,
          selected._id,
          { responderIds: [pending.responderId], primaryResponderId: pending.responderId },
          crypto.randomUUID()
        );
        toast.success('Unit assigned — waiting for acknowledgement');
      }
      invalidate();
      setPending(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
      setAssigning(false);
    }
  }

  async function sendChat() {
    if (!accessToken || !chatText.trim()) return;
    setChatBusy(true);
    try {
      await chatApi.sendResponders(accessToken, chatText.trim());
      setChatText('');
      await chatQuery.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setChatBusy(false);
    }
  }

  const incidents = queueQuery.data?.data?.incidents ?? [];
  const pendingSos = queueQuery.data?.data?.pendingSos ?? 0;
  const liveMapData = useLiveMapData(mapQuery.data?.data);
  const mapUnits = liveMapData?.units ?? [];
  const transports = (transportsQuery.data?.data ?? []) as TransportRow[];
  const conductions = transports.filter((t) => !t.scheduledDate || t.scheduledDate >= today).slice(0, 6);
  const chatMessages = (chatQuery.data?.data ?? []) as ChatMessage[];
  const auditRows = (auditQuery.data?.data ?? []) as AuditRow[];
  const detail = detailQuery.data?.data ?? selected;
  const timeline = ((detail as { timeline?: { action?: string; details?: string; createdAt?: string }[] })?.timeline ??
    []) as { action?: string; details?: string; createdAt?: string }[];

  const queuePages = Math.max(1, Math.ceil(incidents.length / QUEUE_PAGE_SIZE));
  const pageIncidents = incidents.slice(queuePage * QUEUE_PAGE_SIZE, queuePage * QUEUE_PAGE_SIZE + QUEUE_PAGE_SIZE);
  const showingFrom = incidents.length === 0 ? 0 : queuePage * QUEUE_PAGE_SIZE + 1;
  const showingTo = Math.min((queuePage + 1) * QUEUE_PAGE_SIZE, incidents.length);

  useEffect(() => {
    if (queuePage > queuePages - 1) setQueuePage(0);
  }, [queuePage, queuePages]);

  const analytics = analyticsQuery.data?.data as
    | {
        totalIncidents?: number;
        avgTravelSeconds?: number;
        byStatus?: Record<string, number>;
      }
    | undefined;

  const avgResponseMins = analytics?.avgTravelSeconds
    ? Math.max(1, Math.round(analytics.avgTravelSeconds / 60))
    : null;
  const openCount = incidents.length;
  const ongoingCount = incidents.filter((i) =>
    ['Assigned', 'Dispatched', 'En Route', 'On Scene', 'Transporting', 'In Progress'].includes(i.status)
  ).length;
  const resolvedToday = analytics?.byStatus?.Resolved ?? analytics?.byStatus?.Closed ?? 0;
  const totalToday = analytics?.totalIncidents ?? incidents.length;

  const freshness = liveSyncToFreshness(live.state, live.lastUpdated);

  const nearbyUnits = (nearbyQuery.data?.data ?? []) as {
    callsign?: string;
    _id: string;
    distanceKm: number;
    vehicleType?: string;
    status?: string;
    crewCount?: number;
    userId?: { fullName: string };
  }[];

  const assignedResponders = useMemo(() => {
    const list = detail?.assignments ?? [];
    return list
      .map((a) => a.responderId?.callsign || a.responderId?.userId?.fullName)
      .filter(Boolean) as string[];
  }, [detail?.assignments]);

  const recentActivity = useMemo(() => {
    return auditRows
      .filter((a) => /INCIDENT|ASSIGN|DISPATCH|VERIFY|STATUS/i.test(String(a.action ?? '')))
      .slice(0, 8);
  }, [auditRows]);

  const pageWindow = useMemo(() => {
    const maxButtons = 5;
    if (queuePages <= maxButtons) return Array.from({ length: queuePages }, (_, i) => i);
    const start = Math.max(0, Math.min(queuePage - 2, queuePages - maxButtons));
    return Array.from({ length: maxButtons }, (_, i) => start + i);
  }, [queuePage, queuePages]);

  return (
    <div className="min-w-0 space-y-3 overflow-x-hidden md:space-y-4">
      <PageHeader
        eyebrow="Operations"
        title="Dispatch Center"
        subtitle="Live queue, map, assignment, and unit coordination — Barangay Sun Valley"
        meta={
          <FreshnessLine
            state={freshness}
            lastUpdated={live.lastUpdated ?? queueQuery.dataUpdatedAt}
            compact
            hint={!navigator.onLine ? 'Browser offline' : undefined}
          />
        }
        actions={
          <>
            <Button type="button" variant="outline" asChild>
              <Link to="/admin/sos">SOS Reports{pendingSos > 0 ? ` (${pendingSos})` : ''}</Link>
            </Button>
          <Button type="button" onClick={() => setIntakeOpen(true)}>
            New intake (N)
          </Button>
          </>
        }
      />

      {/* Figma board: Queue|Conductions → Map+Activity | Acts+Resp+Stats | Chat */}
      <div className="dispatch-board">
        {/* LIVE INCIDENT QUEUE */}
        <section className="dispatch-area-queue card flex flex-col overflow-hidden">
          <div className="shrink-0 border-b border-navy-700">
            <PanelTitle title="Live Incident Queue" href="/admin/incidents" />
          </div>
          <QueryState
            isLoading={queueQuery.isLoading}
            isError={queueQuery.isError}
            error={queueQuery.error as Error}
            onRetry={() => queueQuery.refetch()}
            isEmpty={!queueQuery.isLoading && incidents.length === 0}
            emptyTitle="No active incidents"
            emptyHint="Press N for new intake, or triage Pending SOS reports."
            lastUpdated={queueQuery.dataUpdatedAt}
            showLastUpdated={false}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto sidebar-scroll">
              <table className="w-full table-fixed text-left text-xs">
                <colgroup>
                  <col className="w-[12%]" />
                  <col className="w-[14%]" />
                  <col className="w-[12%]" />
                  <col className="w-[14%]" />
                  <col className="hidden w-[14%] xl:table-column" />
                  <col className="w-[10%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-navy-900 text-[10px] uppercase tracking-wide text-ink-400">
                  <tr>
                    <th className="truncate px-2 py-2 font-medium">Incident ID</th>
                    <th className="truncate px-2 py-2 font-medium">Type</th>
                    <th className="truncate px-2 py-2 font-medium">Priority</th>
                    <th className="truncate px-2 py-2 font-medium">Caller</th>
                    <th className="hidden truncate px-2 py-2 font-medium xl:table-cell">Location</th>
                    <th className="truncate px-2 py-2 font-medium">Time</th>
                    <th className="truncate px-2 py-2 font-medium">Status</th>
                    <th className="truncate px-2 py-2 font-medium">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {pageIncidents.map((inc) => {
                    const typeVisual = getIncidentTypeVisual(inc.incidentTypeId?.typeName);
                    const TypeIcon = typeVisual.icon;
                    return (
                    <tr
                      key={inc._id}
                      onClick={() => setSelected(inc)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelected(inc);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-pressed={selected?._id === inc._id}
                        aria-label={`Select incident ${inc.displayId}`}
                        className={clsx(
                          'cursor-pointer border-t border-navy-700/80 transition-colors hover:bg-navy-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-500',
                          selected?._id === inc._id && 'bg-navy-800',
                          inc.priorityLevel === 'Critical' && 'border-l-4 border-l-alert-500'
                        )}
                      >
                        <td className="truncate px-2 py-2 font-mono text-[11px] text-ink-100">{inc.displayId}</td>
                        <td className="px-2 py-2">
                          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                            <span className={clsx('inline-flex h-5 w-5 shrink-0 items-center justify-center rounded', typeVisual.colorClass)}>
                              <TypeIcon className="h-3 w-3" aria-hidden="true" />
                            </span>
                            <span className="truncate text-ink-100">{inc.incidentTypeId?.typeName ?? '—'}</span>
                          </span>
                        </td>
                        <td className="overflow-hidden px-2 py-2">
                          <StatusBadge status={inc.priorityLevel} className="max-w-full truncate px-1.5 text-[10px]" />
                        </td>
                        <td className="px-2 py-2">
                          <p className="truncate text-ink-100">{inc.callerName || inc.reportedByUserId?.fullName || '—'}</p>
                          <p className="truncate font-mono text-[10px] text-ink-400">
                            {inc.callerPhone || inc.reportedByUserId?.contactNumber || ''}
                          </p>
                        </td>
                        <td className="hidden truncate px-2 py-2 text-ink-300 xl:table-cell">
                          {inc.locationId?.addressText || '—'}
                        </td>
                        <td className="truncate px-2 py-2 font-mono text-[11px] text-ink-300">
                          {formatManilaTime(inc.reportedAt)}
                        </td>
                        <td className="overflow-hidden px-2 py-2">
                          <StatusBadge status={inc.status} className="max-w-full truncate px-1.5 text-[10px]" />
                      </td>
                        <td className="truncate px-2 py-2 font-mono text-[11px] text-ink-200">{assignedUnitLabel(inc)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-navy-700 px-3 py-2">
              <p className="font-mono text-[11px] text-ink-400">
                Showing {showingFrom}–{showingTo} of {incidents.length} Incidents
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={queuePage === 0}
                  onClick={() => setQueuePage((p) => Math.max(0, p - 1))}
                  className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-md bg-navy-800 text-ink-300 hover:bg-navy-700 disabled:opacity-40"
                  aria-label="Previous queue page"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                {pageWindow.map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setQueuePage(i)}
                    className={clsx(
                      'min-h-[32px] min-w-[32px] rounded-md px-2 text-xs font-medium',
                      i === queuePage ? 'bg-gold-500 text-navy-950' : 'bg-navy-800 text-ink-300 hover:bg-navy-700'
                    )}
                    aria-label={`Queue page ${i + 1}`}
                    aria-current={i === queuePage ? 'page' : undefined}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={queuePage >= queuePages - 1}
                  onClick={() => setQueuePage((p) => Math.min(queuePages - 1, p + 1))}
                  className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-md bg-navy-800 text-ink-300 hover:bg-navy-700 disabled:opacity-40"
                  aria-label="Next queue page"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </QueryState>
        </section>

        {/* SCHEDULED CONDUCTIONS */}
        <section className="dispatch-area-cond card flex flex-col overflow-hidden">
          <div className="shrink-0 border-b border-navy-700">
            <PanelTitle title="Scheduled Conductions" href="/admin/conduction" />
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto sidebar-scroll">
            {conductions.length === 0 ? (
              <p className="p-4 text-sm text-ink-400">No conductions scheduled.</p>
            ) : (
              <table className="w-full table-fixed text-left text-xs">
                <thead className="sticky top-0 z-10 bg-navy-900 text-[10px] uppercase tracking-wide text-ink-400">
                  <tr>
                    <th className="w-[12%] truncate px-2 py-2 font-medium">Time</th>
                    <th className="w-[20%] truncate px-2 py-2 font-medium">Origin</th>
                    <th className="w-[20%] truncate px-2 py-2 font-medium">Destination</th>
                    <th className="w-[16%] truncate px-2 py-2 font-medium">Unit</th>
                    <th className="w-[16%] truncate px-2 py-2 font-medium">Team</th>
                    <th className="w-[16%] truncate px-2 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {conductions.map((row, idx) => (
                    <tr key={row.id ?? idx} className="border-t border-navy-700/80">
                      <td className="truncate px-2 py-2 font-mono text-[11px] text-ink-200">{row.scheduledTime || '—'}</td>
                      <td className="truncate px-2 py-2 text-ink-300">{row.originAddress || '—'}</td>
                      <td className="truncate px-2 py-2 text-ink-300">{row.destinationAddress || '—'}</td>
                      <td className="truncate px-2 py-2 font-mono text-[11px] text-ink-200">{row.vehicleId || '—'}</td>
                      <td className="truncate px-2 py-2 text-ink-200">{row.assignedTeam || '—'}</td>
                      <td className="overflow-hidden px-2 py-2">
                        <StatusBadge status={conductionStatus(row)} className="max-w-full truncate px-1.5 text-[10px]" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* INCIDENT MAP */}
        <section className="dispatch-area-map card relative h-full overflow-hidden p-0">
          <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-md bg-navy-950/90 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-200">
            Incident Map
          </div>
          <MapView
            data={liveMapData}
            height="100%"
            className="!h-full !min-h-0 rounded-none border-0"
            selectedIncident={selected}
            zoom={selected ? 15 : 14}
            onIncidentClick={(inc) => setSelected(inc)}
          />
          {detail && (
            <div className="absolute bottom-3 left-3 right-3 z-20 max-h-[55%] overflow-y-auto rounded-lg border border-navy-600 bg-navy-950/95 p-3 shadow-xl backdrop-blur sidebar-scroll sm:right-auto sm:w-[min(100%,320px)]">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-semibold text-ink-50">{detail.incidentTypeId?.typeName ?? 'Incident'}</p>
                    {detail.priorityLevel === 'Critical' && (
                      <span className="rounded bg-alert-500 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-ink-50">
                        Critical
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-300">{detail.locationId?.addressText || '—'}</p>
                </div>
                <button
                  type="button"
                  className="rounded p-1 text-ink-400 hover:bg-navy-800 hover:text-ink-100"
                  aria-label="Close incident overlay"
                  onClick={() => setSelected(null)}
                >
                  <X className="h-4 w-4" />
                </button>
            </div>
              <p className="text-xs text-ink-300">
                {detail.callerName || detail.reportedByUserId?.fullName || 'Reporter'} ·{' '}
                {formatManilaDateTime(detail.reportedAt)}
              </p>
              <div className="mt-2">
                <StatusBadge status={detail.priorityLevel} />
        </div>
              <div className="mt-3 border-t border-navy-700 pt-2">
                <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">Situation Report</p>
                  <ul className="max-h-24 space-y-1 overflow-y-auto text-xs text-ink-300 sidebar-scroll">
                  {(timeline.length
                    ? timeline.slice(-5).reverse()
                    : [{ action: detail.description || 'Report received', createdAt: detail.reportedAt }]
                  ).map((ev, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold-500" aria-hidden="true" />
                      <span>
                        <span className="text-ink-500">{formatManilaTime(ev.createdAt)} · </span>
                        {ev.action || ev.details || 'Update'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-3 border-t border-navy-700 pt-2">
                <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
                  Assigned Unit / Responders
                </p>
                {assignedResponders.length > 0 ? (
                  <ul className="space-y-1 text-xs text-ink-200">
                    {assignedResponders.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                ) : nearbyUnits.length > 0 ? (
                  <ul className="space-y-1 text-xs">
                    {nearbyUnits.slice(0, 3).map((u) => (
                      <li key={u._id} className="flex items-center justify-between gap-2">
                        <span className="font-medium text-ink-100">{u.callsign ?? u.userId?.fullName}</span>
                        <StatusBadge status={u.status ?? 'Ready'} className="text-[10px]" />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-ink-500">No unit assigned yet.</p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* DISPATCH ACTION */}
        <section className="dispatch-area-acts card flex flex-col overflow-hidden">
          <div className="shrink-0 border-b border-navy-700">
            <PanelTitle title="Dispatch Action" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 overflow-hidden px-3 py-2">
            {selected && isIncidentReadonly(selected.status) && (
              <p className="rounded-md border border-navy-600 bg-navy-800 px-2 py-1.5 text-[11px] text-ink-300" role="status">
                {selected.status} — read-only. Reopen before dispatch.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!selected || busy || !canAssignIncident(selected?.status)}
                onClick={() => setActionPanel('assign')}
                className="flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-white hover:brightness-110 disabled:opacity-40"
                style={{ backgroundColor: '#38a169' }}
              >
                <Truck className="h-4 w-4" aria-hidden="true" />
                Assign Unit
              </button>
              <button
                type="button"
                disabled={!selected || busy || !canVerifyIncident(selected?.status)}
                onClick={() => setPending({ kind: 'verify' })}
                className="flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-white hover:brightness-110 disabled:opacity-40"
                style={{ backgroundColor: '#3182ce' }}
              >
                <Headset className="h-4 w-4" aria-hidden="true" />
                Verify Call
              </button>
              <button
                type="button"
                disabled={!selected}
                onClick={() => setActionPanel('open')}
                className="flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-white hover:brightness-110 disabled:opacity-40"
                style={{ backgroundColor: '#d69e2e' }}
              >
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                Open Incident
              </button>
              <button
                type="button"
                disabled={!selected}
                onClick={() => setActionPanel('notify')}
                className="flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-white hover:brightness-110 disabled:opacity-40"
                style={{ backgroundColor: '#d53f8c' }}
              >
                <Megaphone className="h-4 w-4" aria-hidden="true" />
                Notify Team
              </button>
              <button
                type="button"
                onClick={() => setActionPanel('report')}
                className="col-span-2 flex min-h-[36px] items-center justify-center gap-2 rounded-lg bg-navy-700 px-3 text-[11px] font-bold uppercase tracking-wide text-ink-100 hover:bg-navy-600"
              >
                <FileText className="h-4 w-4" aria-hidden="true" />
                View Report
              </button>
            </div>
            {selected && canCancelIncident(selected.status) && canVerifyIncident(selected.status) && (
              <div className="flex flex-wrap gap-1.5">
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setPending({ kind: 'falseAlarm' })}>
                  False alarm
                  </Button>
                {canReopenIncident(selected.status) && (
                  <Button type="button" size="sm" disabled={busy} onClick={() => setPending({ kind: 'reopen' })}>
                    Reopen
                  </Button>
                )}
              </div>
            )}
            {canReopenIncident(selected?.status) && selected && !canCancelIncident(selected.status) && (
              <Button type="button" size="sm" disabled={busy} onClick={() => setPending({ kind: 'reopen' })}>
                Reopen
              </Button>
            )}
            {selected && canCancelIncident(selected.status) && !canVerifyIncident(selected.status) && canReopenIncident(selected.status) && (
              <Button type="button" size="sm" disabled={busy} onClick={() => setPending({ kind: 'reopen' })}>
                Reopen
              </Button>
            )}
          </div>
        </section>

        {/* RESPONDER STATUS */}
        <section className="dispatch-area-resp card flex flex-col overflow-hidden">
          <div className="shrink-0 border-b border-navy-700">
            <PanelTitle title="Responder Status" href="/admin/map" linkLabel="Live map" />
          </div>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2 sidebar-scroll">
            {mapUnits.length === 0 && <li className="p-3 text-sm text-ink-400">No units on map.</li>}
            {mapUnits.map((unit) => {
              const Icon = unitIconFor(unit);
              const visual = getUnitTypeVisual(unit);
              const st = resolveUnitStatus(unit.status);
              const online = !unit.gpsStale && unit.status !== 'Out of Service';
              const crewHint =
                (unit as MapUnit & { crewCount?: number }).crewCount != null
                  ? `${(unit as MapUnit & { crewCount?: number }).crewCount} crew`
                  : unit.vehicleType ?? visual.label;
                  return (
                <li
                  key={unit._id}
                  className="flex items-center gap-2 rounded-md border border-navy-700/60 bg-navy-900/50 px-2.5 py-2"
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                    style={{ background: visual.color }}
                  >
                    <Icon className="h-3.5 w-3.5 text-navy-950" strokeWidth={2.4} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-ink-50">{unit.unitNo ?? unit.callsign ?? 'Unit'}</p>
                      <span
                        className={clsx('h-2 w-2 shrink-0 rounded-full', online ? 'bg-ok-400' : 'bg-ink-500')}
                        title={online ? 'Online' : 'Offline'}
                        aria-label={online ? 'Online' : 'Offline'}
                      />
                    </div>
                    <p className="truncate text-[11px] text-ink-400">{crewHint}</p>
                  </div>
                  <StatusBadge status={st.label} className="shrink-0 px-1.5 text-[10px]" />
                </li>
                  );
                })}
          </ul>
        </section>

        {/* RECENT DISPATCH ACTIVITY */}
        <section className="dispatch-area-acty card flex flex-col overflow-hidden">
          <div className="shrink-0 border-b border-navy-700">
            <PanelTitle title="Recent Dispatch Activity" />
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto sidebar-scroll">
            <table className="w-full table-fixed text-left text-xs">
              <thead className="sticky top-0 z-10 bg-navy-900 text-[10px] uppercase tracking-wide text-ink-400">
                <tr>
                  <th className="w-[14%] truncate px-2 py-2 font-medium">Time</th>
                  <th className="w-[18%] truncate px-2 py-2 font-medium">Incident ID</th>
                  <th className="w-[22%] truncate px-2 py-2 font-medium">Type</th>
                  <th className="w-[28%] truncate px-2 py-2 font-medium">Assignment</th>
                  <th className="w-[18%] truncate px-2 py-2 font-medium">Dispatcher</th>
                </tr>
              </thead>
              <tbody>
                {recentActivity.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-ink-400">
                      No recent dispatch activity.
                    </td>
                  </tr>
                )}
                {recentActivity.map((row, i) => (
                  <tr key={`${row.createdAt}-${i}`} className="border-t border-navy-700/80">
                    <td className="truncate px-2 py-2 font-mono text-[11px] text-ink-300">{formatManilaTime(row.createdAt)}</td>
                    <td className="truncate px-2 py-2 font-mono text-[11px] text-gold-400">
                      {row.incidentDisplayId || row.resourceId?.slice(0, 12) || '—'}
                    </td>
                    <td className="truncate px-2 py-2 text-ink-200">{row.resourceType ?? '—'}</td>
                    <td className="truncate px-2 py-2 text-ink-100">{row.action ?? '—'}</td>
                    <td className="truncate px-2 py-2 text-ink-300">{row.actorName || 'System'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* INCIDENT STATISTICS */}
        <section className="dispatch-area-stats card flex flex-col overflow-hidden">
          <div className="shrink-0 border-b border-navy-700">
            <PanelTitle title="Incident Statistics (Today)" />
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-6 content-stretch gap-2 overflow-hidden p-3">
            <div className="col-span-3 flex flex-col justify-center rounded-lg border border-navy-600 bg-navy-900/80 p-2.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">Total Incidents</p>
              <p className="mt-0.5 text-2xl font-bold text-ok-400">{totalToday}</p>
            </div>
            <div className="col-span-3 flex flex-col justify-center rounded-lg border border-navy-600 bg-navy-900/80 p-2.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">Avg Response Time</p>
              <p className="mt-0.5 text-2xl font-bold text-[#7aa2d4]">
                {avgResponseMins != null ? `${avgResponseMins} Mins` : '—'}
              </p>
            </div>
            <div className="col-span-2 flex flex-col justify-center rounded-lg border border-navy-600 bg-navy-900/60 p-2.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">Open</p>
              <p className="mt-0.5 text-xl font-bold text-gold-400">{openCount}</p>
            </div>
            <div className="col-span-2 flex flex-col justify-center rounded-lg border border-navy-600 bg-navy-900/60 p-2.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">On Going</p>
              <p className="mt-0.5 text-xl font-bold text-alert-400">{ongoingCount}</p>
            </div>
            <div className="col-span-2 flex flex-col justify-center rounded-lg border border-navy-600 bg-navy-900/60 p-2.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">Resolved</p>
              <p className="mt-0.5 text-xl font-bold text-ok-400">{resolvedToday}</p>
            </div>
              </div>
        </section>

        {/* CHAT — always-on responders team channel */}
        <section id="dispatch-team-chat" className="dispatch-area-chat card flex flex-col overflow-hidden">
          <div className="shrink-0 border-b border-navy-700">
            <PanelTitle title="Team Chat" trailing={<span className="font-mono text-[10px] text-[#60a5fa]">Responders</span>} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 sidebar-scroll">
              {chatMessages.length === 0 && (
                <li className="text-center text-sm text-ink-500">No messages yet. Message field units here.</li>
              )}
              {chatMessages.map((m) => (
                <li key={m._id} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-ink-100">{m.senderName || 'User'}</span>
                    <span className="shrink-0 font-mono text-[10px] text-ink-500">{formatManilaTime(m.createdAt)}</span>
                  </div>
                  <p className="rounded-lg bg-navy-800/80 px-3 py-2 text-sm text-ink-200">{m.message}</p>
                </li>
              ))}
            </ul>
            <form
              className="flex shrink-0 items-center gap-2 border-t border-navy-700 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void sendChat();
              }}
            >
              <input
                className="input-field min-h-[40px] flex-1 rounded-full px-4 text-sm"
                placeholder="Send Message...."
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                aria-label="Chat message"
              />
              <button
                type="submit"
                disabled={chatBusy || !chatText.trim()}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-alert-500 text-ink-50 hover:bg-alert-400 disabled:opacity-40"
                aria-label="Send message"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>
        </div>
        </section>
      </div>

      <DispatchActionDialogs
        panel={actionPanel}
        onClose={() => setActionPanel(null)}
        selected={selected}
        detail={detail}
        timeline={timeline}
        nearbyUnits={nearbyUnits}
        mapUnits={mapUnits}
        assignedResponders={assignedResponders}
        assigning={assigning}
        notifyBusy={notifyBusy}
        onAssign={(responderId, label) => {
          setActionPanel(null);
          setPending({ kind: 'assign', responderId, label });
        }}
        onNotify={async (message) => {
          if (!accessToken || !selected) return;
          setNotifyBusy(true);
          try {
            const res = await notificationsApi.notifyTeam(accessToken, {
              incidentId: selected._id,
              message,
              title: `Dispatch — ${selected.displayId}`,
            });
            toast.success(`Alert sent to ${res.data?.sent ?? 0} unit(s)`);
            setActionPanel(null);
            invalidate();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Notify failed');
          } finally {
            setNotifyBusy(false);
          }
        }}
        stats={{
          totalToday,
          openCount,
          ongoingCount,
          resolvedToday,
          avgResponseMins,
        }}
      />

      <ConfirmActionDialog
        open={!!pending}
        request={confirmRequest}
        busy={busy || assigning}
        onCancel={() => setPending(null)}
        onConfirm={(reason) => void runConfirm(reason)}
      />

      <SmartIntakeDialog
        open={intakeOpen}
        onOpenChange={setIntakeOpen}
        types={typesQuery.data?.data ?? []}
        token={accessToken}
        onCreated={() => {
          setIntakeOpen(false);
          invalidate();
        }}
      />
    </div>
  );
}
