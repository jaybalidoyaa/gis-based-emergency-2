import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ImageIcon,
  MapPin,
  MoreHorizontal,
  Pencil,
  Phone,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/authStore';
import { incidentsApi, mapApi } from '@/services/api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { MapView } from '@/components/map/MapView';
import { IncidentTimeline } from '@/components/dispatch/IncidentTimeline';
import { IncidentStatusStepper } from '@/components/incidents/IncidentStatusStepper';
import {
  IncidentActionDialogs,
  type IncidentDialog,
} from '@/components/incidents/IncidentActionDialogs';
import { IncidentMediaGallery } from '@/components/incidents/IncidentMediaGallery';
import { ConfirmActionDialog } from '@/components/ui/ConfirmActionDialog';
import { Button } from '@/components/ui/button';
import { getIncidentTypeVisual } from '@/lib/opsVisuals';
import { formatManilaDateTime } from '@/lib/timezone';
import { LIVE } from '@/lib/liveTiming';
import { useLiveMapData } from '@/hooks/useLiveMapData';
import { PRIORITIES } from '@/lib/validation';
import { canVerifyIncident } from '@/lib/incidentState';
import type { Incident } from '@/types';

const TABS = [
  { id: 'All', label: 'All' },
  { id: 'Open', label: 'Open' },
  { id: 'Ongoing', label: 'Ongoing' },
  { id: 'Resolved', label: 'Resolved' },
  { id: 'Closed', label: 'Closed' },
] as const;

function canViewCaller(role?: string) {
  return ['SYSTEM_ADMINISTRATOR', 'CENTRAL_DISPATCHER', 'DEPARTMENT_DISPATCHER'].includes(role ?? '');
}

function nearestFacilityKm(
  lat?: number,
  lng?: number,
  facilities?: { category?: string; currentLocation?: { latitude: number; longitude: number }; name?: string }[]
) {
  if (lat == null || lng == null || !facilities?.length) return null;
  const fireish = facilities.filter((f) => /fire|base|emergency/i.test(f.category ?? '') || /fire|svfar|bemo/i.test(f.name ?? ''));
  const pool = fireish.length ? fireish : facilities;
  let best: { name: string; km: number } | null = null;
  for (const f of pool) {
    const loc = f.currentLocation;
    if (!loc) continue;
    const dLat = ((loc.latitude - lat) * Math.PI) / 180;
    const dLon = ((loc.longitude - lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat * Math.PI) / 180) * Math.cos((loc.latitude * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (!best || km < best.km) best = { name: f.name || f.category || 'Facility', km };
  }
  return best;
}

export function IncidentsPage() {
  const { incidentId } = useParams<{ incidentId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { accessToken, user } = useAuthStore();
  const [tab, setTab] = useState<string>('All');
  const [selected, setSelected] = useState<Incident | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [dialog, setDialog] = useState<IncidentDialog>(null);
  const [mediaTick, setMediaTick] = useState(0);
  const [verifyConfirmOpen, setVerifyConfirmOpen] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['incidents', tab],
    queryFn: () => incidentsApi.list(accessToken!, { status: tab }),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });

  const { data: detail } = useQuery({
    queryKey: ['incident', selected?._id ?? incidentId],
    queryFn: () => incidentsApi.get(accessToken!, (selected?._id ?? incidentId)!),
    enabled: !!accessToken && !!(selected?._id || incidentId),
    refetchInterval: LIVE.hotMs,
  });

  const { data: mapData } = useQuery({
    queryKey: ['map-data'],
    queryFn: () => mapApi.data(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });
  const liveMapData = useLiveMapData(mapData?.data);

  const { data: typesData } = useQuery({
    queryKey: ['incident-types'],
    queryFn: () => incidentsApi.types(accessToken!),
    enabled: !!accessToken,
  });

  useEffect(() => {
    if (!incidentId || !data?.data?.incidents) return;
    const match = data.data.incidents.find((i) => i._id === incidentId);
    if (match) {
      setSelected(match);
      setMobileDetailOpen(true);
    }
  }, [incidentId, data?.data?.incidents]);

  useEffect(() => {
    if (incidentId && detail?.data) setSelected(detail.data);
  }, [incidentId, detail?.data]);

  const incidents = useMemo(() => {
    let list = data?.data?.incidents ?? [];
    if (typeFilter !== 'all') {
      list = list.filter((i) => i.incidentTypeId?.typeName === typeFilter);
    }
    if (priorityFilter !== 'all') {
      list = list.filter((i) => {
        const p = i.priorityLevel === 'Medium' ? 'Moderate' : i.priorityLevel;
        return p === priorityFilter;
      });
    }
    if (statusFilter !== 'all') {
      list = list.filter((i) => i.status === statusFilter);
    }
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      list = list.filter((i) => new Date(i.reportedAt).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo).getTime() + 86_400_000;
      list = list.filter((i) => new Date(i.reportedAt).getTime() <= to);
    }
    return list;
  }, [data?.data?.incidents, typeFilter, priorityFilter, statusFilter, dateFrom, dateTo]);

  const full = detail?.data ?? selected;
  const showCaller = canViewCaller(user?.role);
  const typeVisual = getIncidentTypeVisual(full?.incidentTypeId?.typeName);
  const TypeIcon = typeVisual.icon;
  const near = nearestFacilityKm(
    full?.locationId?.latitude,
    full?.locationId?.longitude,
    mapData?.data?.facilities
  );

  function selectIncident(inc: Incident) {
    setSelected(inc);
    setMobileDetailOpen(true);
    navigate(`/admin/incidents/${inc._id}`, { replace: !incidentId });
  }

  function closeMobileDetail() {
    setMobileDetailOpen(false);
    if (incidentId) navigate('/admin/incidents');
  }

  function refreshIncidentQueries() {
    void queryClient.invalidateQueries({ queryKey: ['incidents'] });
    void queryClient.invalidateQueries({ queryKey: ['incident'] });
    void queryClient.invalidateQueries({ queryKey: ['dispatch-queue'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    void queryClient.invalidateQueries({ queryKey: ['sos'] });
    void queryClient.invalidateQueries({ queryKey: ['map-data'] });
    setMediaTick((n) => n + 1);
  }

  async function runVerify() {
    if (!full || !accessToken) return;
    setVerifyBusy(true);
    try {
      await incidentsApi.verify(accessToken, full._id, { priority: full.priorityLevel });
      toast.success('Incident verified');
      refreshIncidentQueries();
      setVerifyConfirmOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verify failed');
    } finally {
      setVerifyBusy(false);
    }
  }

  const detailPanel = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {!full ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-ink-400">
          Select an incident to inspect details
        </div>
      ) : (
        <div className="incidents-detail-grid p-2 sm:p-3">
          <div className="incidents-detail-head flex shrink-0 flex-wrap items-center justify-between gap-2">
            <p className="truncate font-mono text-xs font-semibold text-alert-400 sm:text-sm">{full.displayId}</p>
            <div className="flex items-center gap-1.5">
              {canVerifyIncident(full.status) && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 px-2 text-xs border-gold-500/40 text-gold-400 hover:bg-gold-500/10"
                  onClick={() => setVerifyConfirmOpen(true)}
                >
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                  Verify
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1 px-2 text-xs"
                onClick={() => setDialog('edit')}
              >
                <Pencil className="h-3 w-3" aria-hidden />
                Edit
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1 px-2 text-xs"
                onClick={() => setDialog('more')}
              >
                <MoreHorizontal className="h-3 w-3" aria-hidden />
                More
              </Button>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-navy-600 text-ink-300 lg:hidden"
                onClick={closeMobileDetail}
                aria-label="Close incident detail"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="incidents-detail-summary flex min-h-0 flex-col overflow-hidden rounded-lg border border-navy-700 bg-navy-900/50">
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto sidebar-scroll p-2.5">
              <div className="flex items-start gap-2.5">
                <span
                  className={clsx(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
                    typeVisual.colorClass
                  )}
                >
                  <TypeIcon className="h-4.5 w-4.5 h-4 w-4" strokeWidth={2.2} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-bold text-ink-50 sm:text-base">
                    {full.incidentTypeId?.typeName || 'Incident'}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={full.status} className="scale-90 origin-left" />
                    <StatusBadge status={full.priorityLevel} className="scale-90 origin-left" />
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-ink-500">
                    {formatManilaDateTime(full.reportedAt)}
                  </p>
                </div>
              </div>

              <div className="rounded-md border border-navy-700/70 bg-navy-950/35 p-2">
                <p className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wide text-ink-500">
                  <MapPin className="h-2.5 w-2.5 text-gold-500" aria-hidden />
                  Location
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-ink-100">{full.locationId?.addressText || '—'}</p>
                {full.locationId && (
                  <p className="mt-0.5 font-mono text-[10px] text-ink-500">
                    {full.locationId.latitude.toFixed(5)}, {full.locationId.longitude.toFixed(5)}
                  </p>
                )}
              </div>

              {showCaller && (full.callerName || full.callerPhone || full.reportedByUserId) && (
                <div className="rounded-md border border-navy-700/70 bg-navy-950/35 p-2">
                  <p className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wide text-ink-500">
                    <Phone className="h-2.5 w-2.5 text-gold-500" aria-hidden />
                    Reporter
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-100">
                    {full.callerName || full.reportedByUserId?.fullName || '—'}
                  </p>
                  <p className="font-mono text-[10px] text-ink-400">
                    {full.callerPhone || full.reportedByUserId?.contactNumber || '—'}
                  </p>
                </div>
              )}

              <div className="rounded-md border border-navy-700/70 bg-navy-950/35 p-2">
                <p className="font-mono text-[9px] uppercase tracking-wide text-ink-500">Description</p>
                <p className="mt-0.5 line-clamp-3 text-xs leading-snug text-ink-200">{full.description || '—'}</p>
              </div>

              {full.assignments && full.assignments.length > 0 && (
                <div className="rounded-md border border-navy-700/70 bg-navy-950/35 p-2">
                  <p className="font-mono text-[9px] uppercase tracking-wide text-ink-500">Units</p>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-ink-300">
                    {full.assignments.slice(0, 4).map((a) => (
                      <li key={a._id} className="flex justify-between gap-2">
                        <span className="truncate">{a.responderId?.callsign || a.responderId?.userId?.fullName || 'Unit'}</span>
                        <span className="shrink-0 text-ink-500">{a.assignmentStatus}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div className="incidents-detail-map flex min-h-[120px] flex-col overflow-hidden rounded-lg border border-navy-700 bg-navy-900/50 lg:min-h-0">
            <div className="min-h-0 flex-1">
              <MapView
                data={liveMapData}
                selectedIncident={full}
                height="100%"
                className="h-full min-h-[140px] rounded-none border-0"
                zoom={15.5}
                showRegionalContext
                showFacilities
              />
            </div>
            {near && (
              <p className="shrink-0 border-t border-navy-700 px-2 py-1 font-mono text-[10px] text-ok-400">
                {near.km < 1 ? `${Math.round(near.km * 1000)} m` : `${near.km.toFixed(1)} km`} to {near.name}
              </p>
            )}
          </div>

          <div className="incidents-detail-media flex min-h-0 flex-col overflow-hidden rounded-lg border border-navy-700 bg-navy-900/50 p-2">
            <p className="mb-1.5 flex shrink-0 items-center gap-1.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-ink-400">
              <ImageIcon className="h-3 w-3 text-gold-500" aria-hidden />
              Attached media
            </p>
            {accessToken && full._id ? (
              <IncidentMediaGallery token={accessToken} incidentId={full._id} refreshKey={mediaTick} />
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center text-[10px] text-ink-500">—</div>
            )}
          </div>

          <div className="incidents-detail-timeline flex min-h-0 flex-col overflow-hidden rounded-lg border border-navy-700 bg-navy-900/50 p-2">
            {accessToken && full._id ? (
              <IncidentTimeline token={accessToken} incidentId={full._id} compact className="h-full" />
            ) : (
              <p className="text-xs text-ink-400">No timeline</p>
            )}
          </div>

          <div className="incidents-detail-step shrink-0 rounded-lg border border-navy-700 bg-navy-900/50 px-2 py-1">
            <IncidentStatusStepper status={full.status} typeName={full.incidentTypeId?.typeName} />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="incidents-page -m-3 flex min-h-0 flex-col gap-2 overflow-hidden sm:-m-4 sm:gap-2.5 md:-m-6 md:gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 pt-3 sm:px-4 sm:pt-4 md:px-6 md:pt-5">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-500">Operations</p>
          <h2 className="truncate text-lg font-bold text-ink-50 sm:text-xl">Incident status progress</h2>
        </div>
        <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" asChild>
          <Link to="/admin/dispatch">Dispatch</Link>
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden px-3 pb-3 sm:gap-2.5 sm:px-4 sm:pb-4 md:px-6 md:pb-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)] lg:gap-3">
        <section className="card flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="shrink-0 space-y-2 border-b border-navy-700 p-2 sm:p-2.5">
            <div className="flex gap-1 overflow-x-auto sidebar-scroll">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-pressed={tab === t.id}
                  className={clsx(
                    'h-8 shrink-0 rounded-md px-2.5 text-[11px] font-semibold uppercase tracking-wide sm:px-3 sm:text-xs',
                    tab === t.id
                      ? 'bg-alert-500 text-ink-50'
                      : 'border border-navy-600 bg-navy-800 text-ink-300 hover:bg-navy-700'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1 rounded-md border border-navy-600 bg-navy-800 px-2 text-[11px] text-ink-200 lg:hidden"
                onClick={() => setFiltersOpen((v) => !v)}
                aria-expanded={filtersOpen}
              >
                Filters
                <ChevronDown className={clsx('h-3 w-3 transition', filtersOpen && 'rotate-180')} />
              </button>

              <div
                className={clsx(
                  'w-full flex-col gap-1.5 lg:flex lg:w-auto lg:flex-row lg:flex-wrap lg:items-center',
                  filtersOpen ? 'flex' : 'hidden lg:flex'
                )}
              >
                <label className="flex h-8 items-center gap-1 rounded-md border border-navy-600 bg-navy-800 px-1.5 text-[11px] text-ink-300">
                  <Calendar className="h-3 w-3 shrink-0 text-ink-500" aria-hidden />
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="min-w-0 max-w-[7.5rem] bg-transparent text-ink-100 outline-none"
                    aria-label="From date"
                  />
                  <span className="text-ink-600">–</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="min-w-0 max-w-[7.5rem] bg-transparent text-ink-100 outline-none"
                    aria-label="To date"
                  />
                </label>

                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="h-8 max-w-[9rem] rounded-md border border-navy-600 bg-navy-800 px-1.5 text-[11px] text-ink-100"
                  aria-label="Incident type"
                >
                  <option value="all">Type</option>
                  {(typesData?.data ?? []).map((t) => (
                    <option key={t._id} value={t.typeName}>
                      {t.typeName}
                    </option>
                  ))}
                </select>

                <select
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                  className="h-8 rounded-md border border-navy-600 bg-navy-800 px-1.5 text-[11px] text-ink-100"
                  aria-label="Priority"
                >
                  <option value="all">Priority</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-8 rounded-md border border-navy-600 bg-navy-800 px-1.5 text-[11px] text-ink-100"
                  aria-label="Status filter"
                >
                  <option value="all">Status</option>
                  {['Open', 'Assigned', 'Dispatched', 'En Route', 'On Scene', 'Resolved', 'Closed', 'Cancelled'].map(
                    (s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    )
                  )}
                </select>

                <button
                  type="button"
                  className="h-8 rounded-md border border-navy-600 px-2 text-[11px] text-ink-300 hover:bg-navy-800"
                  onClick={() => {
                    setTypeFilter('all');
                    setPriorityFilter('all');
                    setStatusFilter('all');
                    setDateFrom('');
                    setDateTo('');
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto sidebar-scroll">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="sticky top-0 z-[1] bg-navy-900 text-[9px] uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-2 py-2 font-mono font-semibold sm:px-3">ID</th>
                  <th className="px-2 py-2 font-mono font-semibold sm:px-3">Type</th>
                  <th className="hidden px-2 py-2 font-mono font-semibold md:table-cell sm:px-3">Location</th>
                  <th className="px-2 py-2 font-mono font-semibold sm:px-3">Priority</th>
                  <th className="px-2 py-2 font-mono font-semibold sm:px-3">Status</th>
                  <th className="hidden px-2 py-2 font-mono font-semibold xl:table-cell sm:px-3">Reported</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={6} className="p-4">
                      <div className="h-14 animate-pulse rounded-md bg-navy-800" />
                    </td>
                  </tr>
                )}
                {isError && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-alert-400">
                      {error instanceof Error ? error.message : 'Failed to load'}{' '}
                      <button type="button" className="underline" onClick={() => refetch()}>
                        Retry
                      </button>
                    </td>
                  </tr>
                )}
                {!isLoading && !isError && incidents.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-ink-400">
                      No incidents in this view.
                    </td>
                  </tr>
                )}
                {incidents.map((inc) => {
                  const active = selected?._id === inc._id;
                  return (
                    <tr
                      key={inc._id}
                      onClick={() => selectIncident(inc)}
                      className={clsx(
                        'cursor-pointer border-t border-navy-700/80 transition-colors',
                        active
                          ? 'bg-alert-500/10 ring-1 ring-inset ring-alert-500/45'
                          : 'hover:bg-navy-800/80'
                      )}
                    >
                      <td className="px-2 py-2 font-mono text-[11px] text-gold-400 sm:px-3">{inc.displayId}</td>
                      <td className="max-w-[7rem] truncate px-2 py-2 uppercase tracking-wide text-ink-200 sm:px-3">
                        {inc.incidentTypeId?.typeName || '—'}
                      </td>
                      <td className="hidden max-w-[9rem] truncate px-2 py-2 text-ink-400 md:table-cell sm:px-3">
                        {inc.locationId?.addressText || '—'}
                      </td>
                      <td className="px-2 py-2 sm:px-3">
                        <StatusBadge status={inc.priorityLevel} className="scale-90 origin-left" />
                      </td>
                      <td className="px-2 py-2 sm:px-3">
                        <StatusBadge status={inc.status} className="scale-90 origin-left" />
                      </td>
                      <td className="hidden px-2 py-2 font-mono text-[10px] text-ink-500 xl:table-cell sm:px-3">
                        {formatManilaDateTime(inc.reportedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card hidden min-h-0 min-w-0 flex-col overflow-hidden lg:flex">{detailPanel}</section>
      </div>

      {mobileDetailOpen && full && (
        <div className="fixed inset-0 z-50 flex flex-col bg-navy-950 lg:hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{detailPanel}</div>
        </div>
      )}

      {accessToken && (
        <IncidentActionDialogs
          dialog={dialog}
          onClose={() => setDialog(null)}
          incident={full}
          token={accessToken}
          types={typesData?.data ?? []}
          onSaved={refreshIncidentQueries}
        />
      )}

      <ConfirmActionDialog
        open={verifyConfirmOpen}
        request={{
          title: 'Verify incident',
          description: full
            ? `Confirm ${full.displayId} as a real emergency and move it to Open.`
            : 'Confirm this as a real emergency.',
          confirmLabel: 'Verify',
          tone: 'gold',
        }}
        busy={verifyBusy}
        onCancel={() => setVerifyConfirmOpen(false)}
        onConfirm={() => void runVerify()}
      />
    </div>
  );
}
