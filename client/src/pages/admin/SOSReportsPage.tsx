import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Filter,
  Flame,
  MapPin,
  MessageSquarePlus,
  Phone,
  Radio,
  Siren,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { sosApi, incidentsApi, mapApi } from '@/services/api';
import { LIVE } from '@/lib/liveTiming';
import type { SOSReport, Incident } from '@/types';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { QueryState } from '@/components/ui/QueryState';
import { FreshnessLine, liveSyncToFreshness } from '@/components/ui/FreshnessLine';
import { ConfirmActionDialog, type ConfirmActionRequest } from '@/components/ui/ConfirmActionDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { MapView } from '@/components/map/MapView';
import { IncidentTimeline } from '@/components/dispatch/IncidentTimeline';
import { useAdminLiveSync } from '@/hooks/LiveSyncContext';
import { useLiveMapData } from '@/hooks/useLiveMapData';
import { getIncidentTypeVisual } from '@/lib/opsVisuals';
import {
  canReopenIncident,
  canVerifyIncident,
  isIncidentReadonly,
} from '@/lib/incidentState';
import { formatManilaDateTime, formatManilaTime } from '@/lib/timezone';
import clsx from 'clsx';

const PRIMARY_TABS = ['All', 'Pending', 'In Progress', 'Resolved'] as const;
const EXTRA_FILTERS = [
  'Cancelled',
  'Verified',
  'Converted to Incident',
  'False Alarm',
  'Duplicate',
  'Rejected',
] as const;

function canVerifySos(report: SOSReport | null): boolean {
  if (!report || report.status === 'Cancelled' || report.status === 'Rejected') return false;
  const incidentStatus = report.incidentId?.status;
  if (!incidentStatus) return false;
  if (isIncidentReadonly(incidentStatus)) return false;
  return canVerifyIncident(incidentStatus);
}

function sosTypeName(r: SOSReport): string {
  return r.incidentId?.incidentTypeId?.typeName || 'SOS Emergency';
}

function sosCitizenName(r: SOSReport, detail?: Incident | null): string {
  return (
    detail?.callerName ||
    detail?.reportedByUserId?.fullName ||
    r.incidentId?.callerName ||
    r.incidentId?.reportedByUserId?.fullName ||
    r.citizenId?.userId?.fullName ||
    '—'
  );
}

function sosCitizenPhone(r: SOSReport, detail?: Incident | null): string {
  return (
    detail?.callerPhone ||
    detail?.reportedByUserId?.contactNumber ||
    r.incidentId?.callerPhone ||
    r.incidentId?.reportedByUserId?.contactNumber ||
    r.citizenId?.userId?.contactNumber ||
    ''
  );
}

function sosAddress(r: SOSReport, detail?: Incident | null): string {
  return (
    detail?.locationId?.addressText ||
    r.incidentId?.locationId?.addressText ||
    detail?.locationId?.landmark ||
    '—'
  );
}

function displayStatus(r: SOSReport, detail?: Incident | null): string {
  return detail?.status || r.incidentId?.status || r.status || 'Pending';
}

function TypeIcon({ typeName }: { typeName?: string }) {
  const visual = getIncidentTypeVisual(typeName);
  const Icon = visual.icon;
  return (
    <span
      className={clsx(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
        /fire|medical|ambulance|rescue|flood/i.test(typeName ?? '')
          ? 'bg-alert-500 text-ink-50'
          : 'bg-gold-500/20 text-gold-400'
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={2.4} aria-hidden />
    </span>
  );
}

export function SOSReportsPage() {
  const { accessToken } = useAuthStore();
  const live = useAdminLiveSync();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<string>('All');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<'verify' | 'reopen' | 'note' | null>(null);
  const [noteText, setNoteText] = useState('');

  const listQuery = useQuery({
    queryKey: ['sos', tab],
    queryFn: () => sosApi.list(accessToken!, tab === 'All' ? undefined : tab),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });

  const mapQuery = useQuery({
    queryKey: ['map-data'],
    queryFn: () => mapApi.data(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });
  const liveMapData = useLiveMapData(mapQuery.data?.data);

  const reports = listQuery.data?.data ?? [];
  const selected = useMemo(
    () => reports.find((r) => r._id === selectedId) ?? reports[0] ?? null,
    [reports, selectedId]
  );

  useEffect(() => {
    if (!reports.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !reports.some((r) => r._id === selectedId)) {
      setSelectedId(reports[0]._id);
    }
  }, [reports, selectedId]);

  const detailQuery = useQuery({
    queryKey: ['incident', selected?.incidentId?._id],
    queryFn: () => incidentsApi.get(accessToken!, selected!.incidentId!._id),
    enabled: !!accessToken && !!selected?.incidentId?._id,
    refetchInterval: LIVE.hotMs,
  });
  const detail = (detailQuery.data?.data as Incident | undefined) ?? selected?.incidentId ?? null;

  const showVerify = canVerifySos(selected);
  const showReopen =
    !!selected &&
    (selected.status === 'Cancelled' || canReopenIncident(selected.incidentId?.status));

  const confirmRequest: ConfirmActionRequest | null = (() => {
    if (!pending || !selected || pending === 'note') return null;
    if (pending === 'verify') {
      return {
        title: `Verify ${selected.displayId}?`,
        description: `Opens linked incident ${selected.incidentId?.displayId ?? ''} for dispatch.`,
        confirmLabel: 'Verify & open',
        tone: 'gold',
      };
    }
    return {
      title: `Reopen ${selected.displayId}?`,
      description: 'Reopens this SOS for further triage. Provide a reason for the audit trail.',
      confirmLabel: 'Reopen SOS',
      requireReason: true,
      reasonLabel: 'Reason for reopening',
    };
  })();

  async function runConfirm(reason?: string) {
    if (!selected || !accessToken || !pending || pending === 'note') return;
    setBusy(true);
    try {
      if (pending === 'verify') {
        const inc = selected.incidentId;
        if (!inc) return;
        await incidentsApi.verify(accessToken, inc._id, { priority: 'High' });
        toast.success('SOS verified — incident opened for dispatch');
      } else {
        await sosApi.reopen(accessToken, selected._id, reason!.trim());
        toast.success('SOS reopened');
      }
      void queryClient.invalidateQueries({ queryKey: ['sos'] });
      void queryClient.invalidateQueries({ queryKey: ['dispatch-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['incidents'] });
      setPending(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    if (!selected || !accessToken || !noteText.trim()) return;
    setBusy(true);
    try {
      await sosApi.update(accessToken, selected._id, noteText.trim());
      toast.success('Note added to SOS');
      setNoteText('');
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: ['sos'] });
      if (selected.incidentId?._id) {
        void queryClient.invalidateQueries({ queryKey: ['incident', selected.incidentId._id] });
        void queryClient.invalidateQueries({ queryKey: ['incident-timeline', selected.incidentId._id] });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save note');
    } finally {
      setBusy(false);
    }
  }

  const phone = selected ? sosCitizenPhone(selected, detail) : '';
  const typeName = selected ? sosTypeName(selected) : '';
  const statusLabel = selected ? displayStatus(selected, detail) : '';
  const priority = detail?.priorityLevel || selected?.incidentId?.priorityLevel || 'High';
  const description =
    detail?.description ||
    selected?.incidentId?.description ||
    'No description provided with this SOS request.';
  const loc = detail?.locationId || selected?.incidentId?.locationId;

  const mapFocusIncident = detail || selected?.incidentId || null;

  return (
    <div className="sos-page -m-3 flex min-h-0 flex-1 flex-col overflow-hidden sm:-m-4 md:-m-6">
      {/* Header — Figma: title + tabs + actions */}
      <header className="flex shrink-0 flex-col gap-3 border-b border-navy-700 bg-navy-950/80 px-3 py-3 sm:px-4 md:flex-row md:items-center md:justify-between md:px-6">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:gap-5">
          <div className="min-w-0">
            <h1 className="font-mono text-lg font-bold uppercase tracking-[0.12em] text-ink-50 sm:text-xl">
              SOS Reports
            </h1>
            <FreshnessLine
              state={liveSyncToFreshness(live.state, live.lastUpdated)}
              lastUpdated={listQuery.dataUpdatedAt}
              compact
              className="mt-1"
            />
          </div>
          <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="SOS status filters">
            {PRIMARY_TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={clsx(
                  'min-h-[40px] shrink-0 rounded-md px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors',
                  tab === t
                    ? 'bg-[#3b82f6] text-ink-50'
                    : 'border border-navy-600 bg-transparent text-ink-300 hover:border-navy-500 hover:text-ink-100'
                )}
              >
                {t === 'All' ? 'All Reports' : t}
              </button>
            ))}
            {EXTRA_FILTERS.includes(tab as (typeof EXTRA_FILTERS)[number]) && (
              <span className="min-h-[40px] shrink-0 rounded-md bg-gold-500/20 px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-400">
                {tab}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" variant="outline" className="min-h-[40px] gap-2" onClick={() => setFilterOpen(true)}>
            <Filter className="h-4 w-4" aria-hidden />
            Filter
          </Button>
          <Button type="button" className="min-h-[40px] gap-2 bg-[#3b82f6] hover:bg-[#60a5fa]" asChild>
            <Link to="/admin/dispatch?intake=1">
              <Siren className="h-4 w-4" aria-hidden />
              New Report
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3 sm:gap-3 sm:p-4 md:p-5 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.7fr)] lg:gap-4">
        {/* RECENT SOS list */}
        <section className="card flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-navy-700 px-3 py-2.5">
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-200">Recent SOS</h2>
            <span className="font-mono text-[10px] text-ink-500">{reports.length}</span>
          </div>
          <QueryState
            isLoading={listQuery.isLoading}
            isError={listQuery.isError}
            error={listQuery.error as Error}
            onRetry={() => listQuery.refetch()}
            isEmpty={!listQuery.isLoading && reports.length === 0}
            emptyTitle="No SOS reports in this view"
            emptyHint="Pending citizen SOS requests will appear here for triage."
            showLastUpdated={false}
            className="flex min-h-0 flex-1 flex-col"
          >
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 sidebar-scroll sm:p-2.5">
              {reports.map((r) => {
                const active = selected?._id === r._id;
                const name = sosCitizenName(r);
                const addr = sosAddress(r);
                const tName = sosTypeName(r);
                return (
                  <li key={r._id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(r._id)}
                      aria-pressed={active}
                      className={clsx(
                        'flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
                        active
                          ? 'border-alert-500/70 bg-navy-800/90'
                          : 'border-alert-500/35 bg-navy-900/40 hover:border-alert-500/55 hover:bg-navy-800/60'
                      )}
                    >
                      <TypeIcon typeName={tName} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-ink-50">{tName}</p>
                          <span className="shrink-0 font-mono text-[10px] text-ink-500">
                            {formatManilaTime(r.triggerTime)}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs text-ink-400">
                          <span className="text-ink-500">Name:</span> {name}
                        </p>
                        <p className="truncate text-xs text-ink-400">
                          <span className="text-ink-500">Location:</span> {addr}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] text-alert-400">#{r.displayId}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </QueryState>
        </section>

        {/* Detail column */}
        <section className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto sidebar-scroll lg:overflow-hidden">
          {!selected ? (
            <div className="card flex min-h-[240px] flex-1 flex-col items-center justify-center p-8 text-center text-sm text-ink-400">
              <Siren className="mb-3 h-8 w-8 text-alert-500/70" aria-hidden />
              <p className="font-medium text-ink-200">Select an SOS report</p>
              <p className="mt-1">Review location, citizen details, and dispatch actions.</p>
            </div>
          ) : (
            <>
              {/* INCIDENT LOCATION map */}
              <div className="card flex min-h-[200px] shrink-0 flex-col overflow-hidden lg:min-h-0 lg:flex-[1.15]">
                <div className="flex shrink-0 items-center justify-between border-b border-navy-700 px-3 py-2">
                  <h2 className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-200">
                    <MapPin className="h-3.5 w-3.5 text-gold-500" aria-hidden />
                    Incident Location
                  </h2>
                  {loc && (
                    <span className="font-mono text-[10px] text-ink-500">
                      {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                    </span>
                  )}
                </div>
                <div className="min-h-[180px] flex-1 lg:min-h-0">
                  <MapView
                    data={liveMapData}
                    selectedIncident={mapFocusIncident}
                    height="100%"
                    className="h-full min-h-[180px] rounded-none border-0"
                    zoom={15.5}
                    showBoundary
                    showRegionalContext
                    showFacilities
                    pin={
                      loc
                        ? {
                            lat: loc.latitude,
                            lng: loc.longitude,
                            label: selected.displayId,
                          }
                        : undefined
                    }
                  />
                </div>
              </div>

              {/* Report details + Quick actions */}
              <div className="grid shrink-0 grid-cols-1 gap-3 md:grid-cols-2">
                <div className="card overflow-hidden p-3 sm:p-4">
                  <h2 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-200">
                    Report Details
                  </h2>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                    <dt className="text-ink-500">Report ID</dt>
                    <dd className="font-mono text-ink-100">{selected.displayId}</dd>
                    <dt className="text-ink-500">Report Type</dt>
                    <dd className="text-ink-100">{typeName}</dd>
                    <dt className="text-ink-500">Status</dt>
                    <dd>
                      <StatusBadge status={statusLabel} />
                    </dd>
                    <dt className="text-ink-500">Reported At</dt>
                    <dd className="text-ink-100">{formatManilaDateTime(selected.triggerTime)}</dd>
                  </dl>
                </div>

                <div className="card overflow-hidden p-3 sm:p-4">
                  <h2 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-200">
                    Quick Actions
                  </h2>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-md bg-ok-500 px-2 py-2 text-center font-mono text-[10px] font-bold uppercase tracking-wide text-navy-950 hover:bg-ok-400 disabled:opacity-50"
                      disabled={!selected.incidentId}
                      onClick={() => {
                        if (selected.incidentId?._id) {
                          navigate(`/admin/dispatch?incident=${selected.incidentId._id}&assign=1`);
                        }
                      }}
                    >
                      <UserPlus className="h-4 w-4" aria-hidden />
                      Assign Responder
                    </button>
                    <button
                      type="button"
                      className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-md bg-[#3b82f6] px-2 py-2 text-center font-mono text-[10px] font-bold uppercase tracking-wide text-ink-50 hover:bg-[#60a5fa] disabled:opacity-50"
                      disabled={busy || (!showVerify && !showReopen)}
                      onClick={() => setPending(showVerify ? 'verify' : 'reopen')}
                    >
                      <Radio className="h-4 w-4" aria-hidden />
                      Update Status
                    </button>
                    <a
                      href={phone ? `tel:${phone.replace(/\s/g, '')}` : undefined}
                      className={clsx(
                        'flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-md border border-navy-600 bg-navy-800 px-2 py-2 text-center font-mono text-[10px] font-bold uppercase tracking-wide text-ink-100 hover:bg-navy-700',
                        !phone && 'pointer-events-none opacity-50'
                      )}
                      aria-disabled={!phone}
                    >
                      <Phone className="h-4 w-4" aria-hidden />
                      Contact Reporter
                    </a>
                    <button
                      type="button"
                      className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-md bg-[#c02675] px-2 py-2 text-center font-mono text-[10px] font-bold uppercase tracking-wide text-ink-50 hover:bg-[#db2777]"
                      onClick={() => {
                        setNoteText(detail?.dispatcherNotes || '');
                        setPending('note');
                      }}
                    >
                      <MessageSquarePlus className="h-4 w-4" aria-hidden />
                      Add Note
                    </button>
                  </div>
                  {(selected.status === 'Cancelled' ||
                    (selected.incidentId && isIncidentReadonly(selected.incidentId.status))) && (
                    <p className="mt-2 rounded-md border border-navy-600 bg-navy-800/80 px-2.5 py-1.5 text-[11px] text-ink-400" role="status">
                      Terminal SOS — verify/dispatch locked until reopen.
                    </p>
                  )}
                </div>
              </div>

              {/* Citizen / Incident / Timeline */}
              <div className="grid min-h-0 shrink-0 grid-cols-1 gap-3 lg:grid-cols-3 lg:flex-1">
                <div className="card overflow-hidden p-3 sm:p-4">
                  <h2 className="mb-3 flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-200">
                    <Users className="h-3.5 w-3.5 text-gold-500" aria-hidden />
                    Citizen Information
                  </h2>
                  <dl className="space-y-2 text-sm">
                    <div>
                      <dt className="text-[11px] text-ink-500">Name</dt>
                      <dd className="text-ink-100">{sosCitizenName(selected, detail)}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-ink-500">Contact No</dt>
                      <dd className="font-mono text-ink-100">{phone || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-ink-500">Address</dt>
                      <dd className="text-ink-100">{sosAddress(selected, detail)}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-ink-500">GPS Coordinates</dt>
                      <dd className="font-mono text-xs text-ink-300">
                        {loc ? `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}` : '—'}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="card overflow-hidden p-3 sm:p-4">
                  <h2 className="mb-3 flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-200">
                    <Flame className="h-3.5 w-3.5 text-alert-400" aria-hidden />
                    Incident Information
                  </h2>
                  <p className="text-sm leading-relaxed text-ink-200">{description}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-ink-500">Priority Level</span>
                    <StatusBadge status={priority} />
                  </div>
                  {selected.incidentId?.displayId && (
                    <p className="mt-3 font-mono text-[10px] text-ink-500">
                      Linked incident {selected.incidentId.displayId}
                    </p>
                  )}
                </div>

                <div className="card flex min-h-[160px] flex-col overflow-hidden p-3 sm:p-4">
                  <h2 className="mb-2 shrink-0 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-200">
                    Timeline
                  </h2>
                  {accessToken && selected.incidentId?._id ? (
                    <IncidentTimeline
                      token={accessToken}
                      incidentId={selected.incidentId._id}
                      compact
                      className="min-h-0 flex-1 [&_h4]:hidden"
                    />
                  ) : (
                    <p className="text-sm text-ink-500">No incident timeline yet.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      <ConfirmActionDialog
        open={pending === 'verify' || pending === 'reopen'}
        request={confirmRequest}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={(reason) => void runConfirm(reason)}
      />

      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Filter SOS reports</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {[...PRIMARY_TABS, ...EXTRA_FILTERS].map((t) => (
              <button
                key={t}
                type="button"
                className={clsx(
                  'min-h-[44px] rounded-md border px-3 py-2 text-left text-sm',
                  tab === t
                    ? 'border-gold-500/50 bg-gold-500/10 text-gold-400'
                    : 'border-navy-600 bg-navy-800 text-ink-200 hover:bg-navy-700'
                )}
                onClick={() => {
                  setTab(t);
                  setFilterOpen(false);
                }}
              >
                {t === 'All' ? 'All Reports' : t}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pending === 'note'} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add note — {selected?.displayId}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="sos-note">Update / note</Label>
              <textarea
                id="sos-note"
                className="input-field mt-1 min-h-[120px] resize-y"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Dispatcher note or citizen update…"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button type="button" disabled={busy || !noteText.trim()} onClick={() => void saveNote()}>
                Save note
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
