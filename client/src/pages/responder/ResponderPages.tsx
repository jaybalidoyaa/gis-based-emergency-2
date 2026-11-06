import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/authStore';
import { respondersApi, attendanceApi, chatApi, mediaApi, profileApi, notificationsApi, mapApi } from '@/services/api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { QueryState } from '@/components/ui/QueryState';
import { LocationDisplay } from '@/components/ui/LocationDisplay';
import { ConfirmActionDialog, type ConfirmActionRequest } from '@/components/ui/ConfirmActionDialog';
import { FreshnessLine } from '@/components/ui/FreshnessLine';
import type { Assignment } from '@/types';
import { MapView } from '@/components/map/MapView';
import { GisNavigationGuide } from '@/components/map/GisNavigationGuide';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Navigation } from 'lucide-react';
import { createPortal } from 'react-dom';
import { LIVE } from '@/lib/liveTiming';
import { startResponderGpsTracking } from '@/lib/responderGps';
import { useLiveMapData } from '@/hooks/useLiveMapData';
import clsx from 'clsx';

const TEAM_OPTIONS = ['Team Alpha', 'Team Bravo', 'Team Charlie', 'Team Delta', 'Unassigned'];

function isMedicalOrVa(typeName?: string) {
  const t = (typeName || '').toLowerCase();
  return /medical|va\b|vehicular|accident|trauma|ambulance|cardiac|respiratory|ems|injury|patient/.test(t);
}

const OFFLINE_QUEUE_KEY = 'sv-offline-status-queue';

const ACTIVE_ASSIGNMENT_STATUSES = new Set(['Assigned', 'Accepted', 'En Route', 'On Scene', 'Transporting']);

function enqueueOffline(payload: Record<string, unknown>) {
  const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
  const list = raw ? JSON.parse(raw) : [];
  list.push({ ...payload, queuedAt: Date.now() });
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(list));
}

async function flushOffline(token: string) {
  const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) return;
  const list = JSON.parse(raw) as {
    kind: string;
    id?: string;
    status?: string;
    lat?: number;
    lng?: number;
    accuracy?: number;
    note?: string;
    accept?: boolean;
  }[];
  const remain = [];
  for (const item of list) {
    try {
      if (item.kind === 'status' && item.id && item.status) {
        await respondersApi.assignmentStatus(token, item.id, item.status);
      } else if (item.kind === 'accept' && item.id) {
        await respondersApi.accept(token, item.id);
      } else if (item.kind === 'backup' && item.id && item.note) {
        await respondersApi.backup(token, item.id, item.note);
      } else if (item.kind === 'gps' && item.lat != null && item.lng != null) {
        await respondersApi.updateLocation(token, item.lat, item.lng, item.accuracy);
      } else {
        remain.push(item);
      }
    } catch {
      remain.push(item);
    }
  }
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remain));
}

function formatTs(value?: number | string | Date | null) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function ResponderHomePage() {
  const { accessToken } = useAuthStore();
  const queryClient = useQueryClient();
  const [online, setOnline] = useState(navigator.onLine);

  const meQuery = useQuery({
    queryKey: ['responder-me'],
    queryFn: () => respondersApi.me(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });

  const { data, isLoading, isError, error, refetch, dataUpdatedAt, isFetching } = useQuery({
    queryKey: ['my-assignments'],
    queryFn: () => respondersApi.myAssignments(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });

  useEffect(() => {
    if (accessToken && navigator.onLine) void flushOffline(accessToken);
  }, [accessToken]);

  useEffect(() => {
    const on = () => {
      setOnline(true);
      if (accessToken) void flushOffline(accessToken);
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [accessToken]);

  const assignments = data?.data ?? [];
  const me = meQuery.data?.data;

  const primary = useMemo(() => {
    return (
      assignments.find((a) => ACTIVE_ASSIGNMENT_STATUSES.has(a.assignmentStatus)) ??
      assignments[0] ??
      null
    );
  }, [assignments]);
  const others = assignments.filter((a) => a._id !== primary?._id);
  const activeCount = assignments.filter((a) => ACTIVE_ASSIGNMENT_STATUSES.has(a.assignmentStatus)).length;

  return (
    <div className="space-y-3">
      {!online && (
        <div className="rounded-md border border-gold-600/40 bg-gold-500/10 px-3 py-2 text-sm text-gold-400" role="status">
          Poor connectivity — status changes queue offline and sync when you reconnect.
        </div>
      )}

      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold-500">Responder field</p>
        <h2 className="text-lg font-bold text-ink-50">My assignments</h2>
        <p className="text-sm text-ink-400">Active dispatch work assigned to you.</p>
      </header>

      <QueryState
        isLoading={meQuery.isLoading && !me}
        isError={false}
        isEmpty={false}
        showLastUpdated={false}
      >
        <div className="card p-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-lg font-bold">{String(me?.callsign ?? 'Unassigned')}</p>
              <p className="text-ink-400">
                {String(me?.department ?? '')} {me?.teamName ? `· ${me.teamName}` : ''}
              </p>
            </div>
            <FreshnessLine
              state={!online ? 'offline' : isFetching ? 'loading' : 'live'}
              lastUpdated={dataUpdatedAt}
              compact
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge status={String(me?.operationalStatus ?? 'Available')} />
            {me?.gpsUpdatedAt ? (
              <span className="text-xs text-ink-500">GPS {new Date(String(me.gpsUpdatedAt)).toLocaleTimeString()}</span>
            ) : (
              <span className="text-xs text-ink-500">GPS unavailable</span>
            )}
          </div>
        </div>
      </QueryState>

      <div className="grid grid-cols-2 gap-2" aria-label="Responder summary">
        <div className="card border-alert-500/30 bg-alert-500/10 p-4">
          <p className="font-mono text-[10px] uppercase text-ink-400">Assigned to me</p>
          <p className="font-mono text-2xl font-bold">{activeCount}</p>
        </div>
        <div className="card border-navy-600 p-4">
          <p className="font-mono text-[10px] uppercase text-ink-400">Duty status</p>
          <p className="truncate text-sm font-semibold">{String(me?.operationalStatus ?? 'Available')}</p>
        </div>
      </div>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        error={error as Error}
        onRetry={() => refetch()}
        isEmpty={assignments.length === 0}
        emptyTitle="No active dispatch assignments"
        emptyHint="When dispatch assigns you, the active incident will appear here first."
        lastUpdated={dataUpdatedAt}
        showLastUpdated={false}
      >
        {primary && (
          <div className="mb-3">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-gold-500">Current assignment</p>
            <DispatchCard
              assignment={primary}
              token={accessToken!}
              hero
              onUpdate={() => queryClient.invalidateQueries({ queryKey: ['my-assignments'] })}
            />
          </div>
        )}
        {others.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-ink-300">Other assignments</h3>
            {others.map((a) => (
              <DispatchCard
                key={a._id}
                assignment={a}
                token={accessToken!}
                onUpdate={() => queryClient.invalidateQueries({ queryKey: ['my-assignments'] })}
              />
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}

type PendingResponder =
  | { kind: 'accept' }
  | { kind: 'decline' }
  | { kind: 'status'; status: string; label: string }
  | { kind: 'backup' }
  | { kind: 'complete' };

function DispatchCard({
  assignment,
  token,
  onUpdate,
  hero,
}: {
  assignment: Assignment;
  token: string;
  onUpdate: () => void;
  hero?: boolean;
}) {
  const inc = assignment.incidentId;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [lastActionAt, setLastActionAt] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingResponder | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [vitalsOpen, setVitalsOpen] = useState(false);
  const [vitalsBusy, setVitalsBusy] = useState(false);
  const [vitals, setVitals] = useState({
    patientName: '',
    vitalRr: '',
    vitalSpo2: '',
    vitalHr: '',
    vitalBp: '',
    oxygenRequired: false,
    oxygenFlow: '',
    notes: '',
  });
  const [backupPrefill] = useState(
    () =>
      `Backup requested for ${inc?.displayId ?? 'incident'} — ${inc?.incidentTypeId?.typeName ?? 'emergency'} at ${
        inc?.locationId?.addressText ?? 'scene'
      }. Hazards: ${inc?.knownHazards || 'none stated'}.`
  );

  const showMedicalPanel = isMedicalOrVa(inc?.incidentTypeId?.typeName);

  const chatQuery = useQuery({
    queryKey: ['incident-chat', inc?._id],
    queryFn: () => chatApi.messages(token, inc!._id),
    enabled: !!inc?._id,
    refetchInterval: LIVE.hotMs,
  });
  const thread = (chatQuery.data?.data ?? []) as { _id: string; message: string; createdAt: string; senderName?: string }[];

  const confirmRequest: ConfirmActionRequest | null = (() => {
    if (!pending) return null;
    if (pending.kind === 'accept') {
      return {
        title: 'Accept assignment?',
        description: `Confirm you can respond to ${inc?.displayId ?? 'this incident'}. Mobilization (En Route) is a separate step.`,
        confirmLabel: 'Accept assignment',
        tone: 'gold',
      };
    }
    if (pending.kind === 'decline') {
      return {
        title: 'Decline assignment?',
        description: 'Provide a reason. Dispatch will reassign another unit.',
        confirmLabel: 'Decline',
        tone: 'destructive',
        requireReason: true,
        reasonLabel: 'Decline reason',
      };
    }
    if (pending.kind === 'backup') {
      return {
        title: 'Request backup?',
        description: 'Sends a backup request to Dispatch with your note.',
        confirmLabel: 'Send backup request',
        tone: 'gold',
        requireReason: true,
        reasonLabel: 'Backup details',
        defaultReason: backupPrefill,
      };
    }
    if (pending.kind === 'complete') {
      return {
        title: 'Mark assignment complete?',
        description: 'Confirms you have finished on-scene work for this assignment.',
        confirmLabel: 'Complete',
      };
    }
    return {
      title: `Set status to ${pending.label}?`,
      description: `Current status: ${assignment.assignmentStatus}. This update is visible to Dispatch.`,
      confirmLabel: `Set ${pending.label}`,
      tone: pending.status === 'On Scene' ? 'gold' : 'default',
    };
  })();

  async function run(action: () => Promise<unknown>, ok: string, offlinePayload?: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      if (!navigator.onLine) {
        if (offlinePayload) {
          enqueueOffline(offlinePayload);
          toast.message('Saved offline — will sync when you reconnect');
          setLastActionAt(Date.now());
          onUpdate();
        } else {
          toast.error('You are offline — reconnect to complete this action');
        }
        return;
      }
      await action();
      toast.success(ok);
      setLastActionAt(Date.now());
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function runConfirm(reason?: string) {
    if (!pending) return;
    const p = pending;
    setPending(null);
    if (p.kind === 'accept') {
      await run(
        () => respondersApi.accept(token, assignment._id).then(() => startResponderGpsTracking(token)),
        'Assignment acknowledged',
        { kind: 'accept', id: assignment._id }
      );
      return;
    }
    if (p.kind === 'decline') {
      await run(() => respondersApi.decline(token, assignment._id, reason!), 'Assignment declined');
      return;
    }
    if (p.kind === 'backup') {
      await run(
        () => respondersApi.backup(token, assignment._id, reason!),
        'Backup requested — Dispatch notified',
        { kind: 'backup', id: assignment._id, note: reason }
      );
      return;
    }
    if (p.kind === 'complete') {
      await run(
        () => respondersApi.assignmentStatus(token, assignment._id, 'Completed'),
        'Assignment completed',
        { kind: 'status', id: assignment._id, status: 'Completed' }
      );
      return;
    }
    await run(
      () =>
        respondersApi.assignmentStatus(token, assignment._id, p.status).then(() => {
          if (p.status === 'En Route') startResponderGpsTracking(token);
        }),
      `Status: ${p.label}`,
      { kind: 'status', id: assignment._id, status: p.status }
    );
  }

  const status = assignment.assignmentStatus;
  const canAck = status === 'Assigned';
  const canEnRoute = status === 'Accepted';
  const canOnScene = status === 'En Route';
  const canSceneActions = status === 'On Scene';
  const canTransportDone = status === 'Transporting';

  return (
    <div className={`card mb-3 space-y-3 p-4 ${hero ? 'border-gold-600/40' : ''}`}>
      <div className="flex justify-between gap-2">
        <span className="font-mono font-bold">{inc?.displayId ?? 'Assignment'}</span>
        <StatusBadge status={inc?.priorityLevel ?? 'High'} />
      </div>
      <p className={`${hero ? 'text-lg font-semibold' : 'text-sm font-medium'}`}>
        {inc?.incidentTypeId?.typeName ?? 'Incident'}
      </p>
      {inc?.description ? <p className="text-sm text-ink-400">{inc.description}</p> : null}

      <LocationDisplay
        addressText={inc?.locationId?.addressText}
        landmark={(inc as { landmark?: string } | undefined)?.landmark}
        lat={inc?.locationId?.latitude}
        lng={inc?.locationId?.longitude}
        primaryClassName={hero ? 'text-base font-medium text-ink-50' : undefined}
      />

      {inc?.knownHazards ? (
        <p className="rounded-md border border-alert-500/40 bg-alert-500/10 px-3 py-2 text-sm text-alert-400" role="status">
          Safety note — hazards: {inc.knownHazards}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-500">Your status</span>
        <StatusBadge status={status} />
        {lastActionAt ? (
          <span className="font-mono text-[11px] text-ink-500">Updated {formatTs(lastActionAt)}</span>
        ) : null}
      </div>

      {inc?.locationId ? (
        <div className="overflow-hidden rounded-md">
          <MapView
            height={hero ? '220px' : '180px'}
            zoom={15}
            selectedIncident={inc}
            pin={{ lat: inc.locationId.latitude, lng: inc.locationId.longitude }}
            showFacilities={false}
            showBoundary
            showRegionalContext
          />
        </div>
      ) : (
        <p className="rounded-md border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-ink-400" role="status">
          Map unavailable — location coordinates were not provided for this incident.
        </p>
      )}

      {inc?.locationId && (
        <Button
          type="button"
          variant="gold"
          className="min-h-[48px] w-full"
          onClick={() => {
            setNavOpen(true);
            startResponderGpsTracking(token);
          }}
        >
          <Navigation className="h-4 w-4" aria-hidden="true" />
          Navigate (GIS guide)
        </Button>
      )}

      {navOpen &&
        inc?.locationId &&
        createPortal(
          <GisNavigationGuide
            title={`Navigate · ${inc.displayId}`}
            subtitle={inc.locationId.addressText || inc.incidentTypeId?.typeName || 'Incident scene'}
            destination={{
              lat: inc.locationId.latitude,
              lng: inc.locationId.longitude,
              label: inc.displayId,
            }}
            onClose={() => setNavOpen(false)}
          />,
          document.body
        )}

      <div className="flex flex-wrap gap-2">
        {canAck && (
          <>
            <Button
              type="button"
              className="min-h-[48px] flex-1"
              onClick={() => setPending({ kind: 'accept' })}
              disabled={busy}
            >
              Accept assignment
            </Button>
            <Button type="button" variant="outline" className="min-h-[48px]" onClick={() => setPending({ kind: 'decline' })} disabled={busy}>
              Decline
            </Button>
          </>
        )}
        {canEnRoute && (
          <Button
            type="button"
            className="min-h-[48px] flex-1"
            variant="outline"
            onClick={() => setPending({ kind: 'status', status: 'En Route', label: 'En Route' })}
            disabled={busy}
          >
            En Route
          </Button>
        )}
        {canOnScene && (
          <Button
            type="button"
            className="min-h-[48px] flex-1"
            variant="gold"
            onClick={() => setPending({ kind: 'status', status: 'On Scene', label: 'On Scene' })}
            disabled={busy}
          >
            On Scene
          </Button>
        )}
        {canSceneActions && (
          <>
            <Button type="button" className="min-h-[48px] flex-1" onClick={() => setPending({ kind: 'complete' })} disabled={busy}>
              Complete
            </Button>
            <Button
              type="button"
              className="min-h-[48px]"
              variant="outline"
              onClick={() => setPending({ kind: 'status', status: 'Transporting', label: 'Transporting' })}
              disabled={busy}
            >
              Transporting
            </Button>
          </>
        )}
        {canTransportDone && (
          <Button type="button" className="min-h-[48px] flex-1" onClick={() => setPending({ kind: 'complete' })} disabled={busy}>
            Complete transport
          </Button>
        )}
        {ACTIVE_ASSIGNMENT_STATUSES.has(status) && (
          <Button type="button" variant="outline" className="min-h-[48px] w-full" onClick={() => setPending({ kind: 'backup' })} disabled={busy}>
            Request backup
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`note-${assignment._id}`}>Operational note for Dispatch</Label>
        {thread.length > 0 ? (
          <ul className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-navy-700 bg-navy-950/50 p-2 text-xs ops-scroll">
            {thread.slice(-12).map((m) => (
              <li key={m._id} className="border-b border-navy-800 pb-1 last:border-0">
                <span className="font-medium text-ink-200">{m.senderName || 'Dispatch'}</span>
                <span className="text-ink-500"> · {formatTs(m.createdAt)}</span>
                <p className="text-ink-300">{m.message}</p>
              </li>
            ))}
          </ul>
        ) : null}
        <Input
          id={`note-${assignment._id}`}
          placeholder={`Update on ${inc?.displayId ?? 'incident'}…`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px] w-full"
          disabled={!note.trim() || !inc?._id || busy}
          onClick={() =>
            void run(
              () =>
                chatApi.send(token, inc!._id, note).then(() => {
                  setNote('');
                  void chatQuery.refetch();
                }),
              'Note sent to Dispatch'
            )
          }
        >
          Send note
        </Button>
        {inc?._id ? (
          <label className="btn-secondary flex min-h-[44px] w-full cursor-pointer items-center justify-center text-sm">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={uploading || busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file || !inc._id) return;
                setUploading(true);
                void mediaApi
                  .upload(token, inc._id, file, 'Responder scene photo')
                  .then(() => toast.success('Optional scene photo uploaded'))
                  .catch((err) => toast.error(err instanceof Error ? err.message : 'Upload failed'))
                  .finally(() => setUploading(false));
              }}
            />
            {uploading ? 'Uploading photo…' : 'Add photo (optional)'}
          </label>
        ) : null}

        {(showMedicalPanel || canSceneActions || canTransportDone) && (
          <div className="rounded-md border border-navy-700 bg-navy-950/40 p-3">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left text-sm font-medium text-ink-100"
              onClick={() => setVitalsOpen((v) => !v)}
            >
              <span>Patient / medical details</span>
              <span className="text-xs text-ink-500">{vitalsOpen ? 'Hide' : 'Show'}</span>
            </button>
            {showMedicalPanel && (
              <p className="mt-1 text-[11px] text-ink-500">
                Suggested for {inc?.incidentTypeId?.typeName || 'medical / VA'} — RR, SpO₂, O₂, and notes.
              </p>
            )}
            {vitalsOpen && (
              <div className="mt-3 space-y-2">
                <Input
                  placeholder="Patient name"
                  value={vitals.patientName}
                  onChange={(e) => setVitals({ ...vitals, patientName: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="RR"
                    value={vitals.vitalRr}
                    onChange={(e) => setVitals({ ...vitals, vitalRr: e.target.value })}
                  />
                  <Input
                    placeholder="SpO₂ %"
                    value={vitals.vitalSpo2}
                    onChange={(e) => setVitals({ ...vitals, vitalSpo2: e.target.value })}
                  />
                  <Input
                    placeholder="HR"
                    value={vitals.vitalHr}
                    onChange={(e) => setVitals({ ...vitals, vitalHr: e.target.value })}
                  />
                  <Input
                    placeholder="BP"
                    value={vitals.vitalBp}
                    onChange={(e) => setVitals({ ...vitals, vitalBp: e.target.value })}
                  />
                </div>
                <label className="flex min-h-[40px] items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={vitals.oxygenRequired}
                    onChange={(e) => setVitals({ ...vitals, oxygenRequired: e.target.checked })}
                  />
                  Oxygen required
                </label>
                {vitals.oxygenRequired && (
                  <Input
                    placeholder="O₂ flow (L/min)"
                    value={vitals.oxygenFlow}
                    onChange={(e) => setVitals({ ...vitals, oxygenFlow: e.target.value })}
                  />
                )}
                <textarea
                  className="input-field min-h-[64px]"
                  placeholder="Medical / special notes"
                  value={vitals.notes}
                  onChange={(e) => setVitals({ ...vitals, notes: e.target.value })}
                />
                <Button
                  type="button"
                  className="min-h-[44px] w-full"
                  disabled={vitalsBusy}
                  onClick={() => {
                    setVitalsBusy(true);
                    void respondersApi
                      .patientReport(token, assignment._id, vitals)
                      .then(() => {
                        toast.success('Patient details sent to Dispatch');
                        onUpdate();
                      })
                      .catch((err) => toast.error(err instanceof Error ? err.message : 'Could not save'))
                      .finally(() => setVitalsBusy(false));
                  }}
                >
                  {vitalsBusy ? 'Saving…' : 'Save patient details'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmActionDialog
        open={!!pending}
        request={confirmRequest}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={(reason) => void runConfirm(reason)}
      />
    </div>
  );
}

export function ResponderStatusPage() {
  const { accessToken } = useAuthStore();
  const meQuery = useQuery({
    queryKey: ['responder-me'],
    queryFn: () => respondersApi.me(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });
  const current = String(meQuery.data?.data?.operationalStatus ?? 'Available');
  const statuses = ['Available', 'En Route', 'On Scene', 'Transporting', 'Returning', 'Out of Service'];
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function applyStatus(status: string, overrideReason?: string) {
    if (!accessToken) return;
    setBusy(true);
    try {
      await respondersApi.updateStatus(accessToken, status, overrideReason);
      toast.success(`Duty status: ${status}`);
      meQuery.refetch();
      if (status !== 'Out of Service') startResponderGpsTracking(accessToken);
      setPendingStatus(null);
    } catch (err) {
      if (!overrideReason) {
        setPendingStatus(status);
        toast.error(err instanceof Error ? err.message : 'Status change blocked');
      } else {
        toast.error(err instanceof Error ? err.message : 'Override failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function check(kind: 'in' | 'out') {
    if (!accessToken) return;
    try {
      if (kind === 'in') await attendanceApi.checkIn(accessToken);
      else await attendanceApi.checkOut(accessToken);
      toast.success(kind === 'in' ? 'Checked in' : 'Checked out');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Attendance failed');
    }
  }

  return (
    <div className="space-y-3">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold-500">Responder</p>
        <h2 className="text-lg font-bold text-ink-50">Duty status</h2>
        <p className="text-sm text-ink-400">Set availability and time in/out for this shift.</p>
      </header>

      <QueryState
        isLoading={meQuery.isLoading}
        isError={meQuery.isError}
        error={meQuery.error as Error}
        onRetry={() => meQuery.refetch()}
        isEmpty={false}
        showLastUpdated={false}
      >
        <div className="card space-y-4 p-4">
          <div>
            <p className="text-sm text-ink-400">
              Current: <StatusBadge status={current} />
            </p>
            {meQuery.dataUpdatedAt ? (
              <p className="mt-1 font-mono text-[11px] text-ink-500">Last update {formatTs(meQuery.dataUpdatedAt)}</p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {statuses.map((s) => (
              <Button
                key={s}
                type="button"
                className="min-h-[52px]"
                variant={current === s ? 'gold' : 'outline'}
                onClick={() => setPendingStatus(s)}
                disabled={busy || current === s}
              >
                {s}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" className="min-h-[48px] flex-1" onClick={() => check('in')}>
              Time in
            </Button>
            <Button type="button" variant="outline" className="min-h-[48px] flex-1" onClick={() => check('out')}>
              Time out
            </Button>
          </div>
        </div>
      </QueryState>

      <ConfirmActionDialog
        open={!!pendingStatus}
        request={
          pendingStatus
            ? {
                title: `Change duty status to ${pendingStatus}?`,
                description: `Current duty status is ${current}. Use override reason only if the system blocks the change.`,
                confirmLabel: `Set ${pendingStatus}`,
                requireReason: false,
              }
            : null
        }
        busy={busy}
        onCancel={() => setPendingStatus(null)}
        onConfirm={() => void applyStatus(pendingStatus!)}
      />
    </div>
  );
}

export function ResponderNotificationsPage() {
  const { accessToken } = useAuthStore();
  const queryClient = useQueryClient();
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [busy, setBusy] = useState(false);

  const listQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });

  async function sendReply(id: string) {
    if (!accessToken || !replyText.trim()) return;
    setBusy(true);
    try {
      await notificationsApi.reply(accessToken, id, replyText.trim());
      await notificationsApi.markRead(accessToken, id);
      toast.success('Reply sent to Dispatch');
      setReplyFor(null);
      setReplyText('');
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['responders-chat'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reply failed');
    } finally {
      setBusy(false);
    }
  }

  async function acknowledge(id: string) {
    if (!accessToken) return;
    try {
      await notificationsApi.markRead(accessToken, id);
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('Acknowledged');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div className="space-y-3">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold-500">Responder</p>
        <h2 className="text-lg font-bold text-ink-50">Alerts</h2>
        <p className="text-sm text-ink-400">Dispatch notices and assignment updates.</p>
      </header>

      <QueryState
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        error={listQuery.error as Error}
        onRetry={() => listQuery.refetch()}
        isEmpty={!listQuery.isLoading && (listQuery.data?.data ?? []).length === 0}
        emptyTitle="No notifications"
        emptyHint="Dispatch alerts will appear here."
        showLastUpdated={false}
      >
        <div className="space-y-2">
          {(listQuery.data?.data ?? []).map((n) => {
            const highlight =
              !n.readAt && ['Important', 'Critical', 'Urgent'].includes(n.priority);
            return (
              <div
                key={n._id}
                className={clsx(
                  'card min-h-[48px] space-y-2 p-4 text-sm',
                  highlight && 'border-alert-500/40'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{n.title}</p>
                  <span className="shrink-0 rounded bg-navy-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink-400">
                    {n.priority || 'Normal'}
                  </span>
                </div>
                <p className="text-ink-400">{n.message}</p>
                <div className="space-y-2 border-t border-navy-700 pt-2">
                  {replyFor === n._id ? (
                    <>
                      <Input
                        placeholder="Reply to Dispatch…"
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        className="min-h-[44px]"
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-[40px] flex-1"
                          onClick={() => {
                            setReplyFor(null);
                            setReplyText('');
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          className="min-h-[40px] flex-1"
                          disabled={busy || !replyText.trim()}
                          onClick={() => void sendReply(n._id)}
                        >
                          {busy ? 'Sending…' : 'Send reply'}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {!n.readAt ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-h-[40px]"
                          onClick={() => void acknowledge(n._id)}
                        >
                          Mark as read
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-[40px]"
                        onClick={() => {
                          setReplyFor(n._id);
                          setReplyText('');
                        }}
                      >
                        Reply
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </QueryState>
    </div>
  );
}

export function ResponderMapPage() {
  const { accessToken } = useAuthStore();
  const mapQuery = useQuery({
    queryKey: ['map-data'],
    queryFn: () => mapApi.data(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });
  const meQuery = useQuery({
    queryKey: ['responder-me'],
    queryFn: () => respondersApi.me(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });
  const live = useLiveMapData(mapQuery.data?.data);
  const me = meQuery.data?.data;
  const center: [number, number] | undefined =
    me?.lat != null && me?.lng != null ? [Number(me.lng), Number(me.lat)] : undefined;

  return (
    <div className="space-y-3">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold-500">Field map</p>
        <h2 className="text-lg font-bold text-ink-50">Live map</h2>
        <p className="text-sm text-ink-400">Incidents, hospitals, and units around Sun Valley / NCR.</p>
      </header>
      <QueryState
        isLoading={mapQuery.isLoading}
        isError={mapQuery.isError}
        error={mapQuery.error as Error}
        onRetry={() => mapQuery.refetch()}
        isEmpty={false}
        showLastUpdated={false}
      >
        <div className="overflow-hidden rounded-lg border border-navy-700" style={{ height: 'min(62dvh, 520px)' }}>
          <MapView
            data={live}
            height="100%"
            center={center}
            zoom={center ? 14 : 12.5}
            showFacilities
            showRegionalContext
            interactive
          />
        </div>
      </QueryState>
      <p className="text-[11px] text-ink-500">
        Browser zoom is locked for a stable phone layout. Use map pinch / +/- controls to zoom the map itself.
      </p>
    </div>
  );
}

export function ResponderProfilePage() {
  const { accessToken, user, refreshToken, setAuth } = useAuthStore();
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: ['responder-me'],
    queryFn: () => respondersApi.me(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.warmMs,
  });
  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: () => profileApi.get(accessToken!),
    enabled: !!accessToken,
  });
  const [form, setForm] = useState({
    fullName: user?.fullName ?? '',
    contactNumber: user?.contactNumber ?? '',
    address: '',
    emergencyContact: '',
    medicalAlerts: '',
  });
  const [saving, setSaving] = useState(false);
  const [teamName, setTeamName] = useState('Team Alpha');
  const [teamReason, setTeamReason] = useState('');
  const [teamBusy, setTeamBusy] = useState(false);
  const [vehicleId, setVehicleId] = useState('');
  const [unitReason, setUnitReason] = useState('');
  const [unitBusy, setUnitBusy] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const unitsQuery = useQuery({
    queryKey: ['responder-units'],
    queryFn: () => respondersApi.listUnits(accessToken!),
    enabled: !!accessToken,
    staleTime: LIVE.coolMs,
  });

  useEffect(() => {
    if (!profileQuery.data?.data) return;
    const p = profileQuery.data.data;
    setForm((f) => ({
      ...f,
      fullName: String(p.fullName ?? f.fullName),
      contactNumber: String(p.contactNumber ?? f.contactNumber),
      address: String(p.address ?? ''),
      emergencyContact: String(p.emergencyContact ?? ''),
      medicalAlerts: String(p.medicalAlerts ?? ''),
    }));
  }, [profileQuery.data]);

  useEffect(() => {
    const current = String(meQuery.data?.data?.teamName || 'Unassigned');
    if (TEAM_OPTIONS.includes(current)) setTeamName(current);
    const assigned = String(meQuery.data?.data?.assignedVehicleId || '');
    if (assigned) setVehicleId(assigned);
  }, [meQuery.data?.data?.teamName, meQuery.data?.data?.assignedVehicleId]);

  async function save() {
    if (!accessToken) return;
    setSaving(true);
    try {
      await profileApi.update(accessToken, form);
      toast.success('Profile saved');
      void profileQuery.refetch();
      void meQuery.refetch();
      if (user && refreshToken) {
        setAuth({ ...user, fullName: form.fullName, contactNumber: form.contactNumber }, accessToken, refreshToken);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function requestTeamChange() {
    if (!accessToken) return;
    setTeamBusy(true);
    try {
      await respondersApi.requestTeamChange(accessToken, teamName, teamReason);
      toast.success('Team change sent — waiting for Dispatch');
      setTeamReason('');
      void meQuery.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not request team change');
    } finally {
      setTeamBusy(false);
    }
  }

  async function requestUnitChange() {
    if (!accessToken || !vehicleId) return;
    setUnitBusy(true);
    try {
      await respondersApi.requestUnitChange(accessToken, vehicleId, unitReason);
      toast.success('Unit change sent — waiting for Dispatch');
      setUnitReason('');
      void meQuery.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not request unit change');
    } finally {
      setUnitBusy(false);
    }
  }

  async function applyStatus(status: string, overrideReason?: string) {
    if (!accessToken) return;
    setStatusBusy(true);
    try {
      await respondersApi.updateStatus(accessToken, status, overrideReason);
      toast.success(`Duty status: ${status}`);
      void meQuery.refetch();
      if (status !== 'Out of Service') startResponderGpsTracking(accessToken);
      setPendingStatus(null);
    } catch (err) {
      if (!overrideReason) {
        setPendingStatus(status);
        toast.error(err instanceof Error ? err.message : 'Status change blocked');
      } else {
        toast.error(err instanceof Error ? err.message : 'Override failed');
      }
    } finally {
      setStatusBusy(false);
    }
  }

  async function check(kind: 'in' | 'out') {
    if (!accessToken) return;
    try {
      if (kind === 'in') await attendanceApi.checkIn(accessToken);
      else await attendanceApi.checkOut(accessToken);
      toast.success(kind === 'in' ? 'Checked in' : 'Checked out');
      void meQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ['responder-me'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Attendance failed');
    }
  }

  const me = meQuery.data?.data;
  const pendingTeam = me?.pendingTeamChange as
    | { fromTeam?: string; toTeam?: string; reason?: string }
    | null
    | undefined;
  const pendingUnit = me?.pendingUnitChange as
    | { fromUnitLabel?: string; toUnitLabel?: string; reason?: string }
    | null
    | undefined;
  const currentStatus = String(me?.operationalStatus ?? 'Available');
  const statuses = ['Available', 'En Route', 'On Scene', 'Transporting', 'Returning', 'Out of Service'];
  const units = unitsQuery.data?.data ?? [];

  return (
    <div className="space-y-3">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold-500">Responder</p>
        <h2 className="text-lg font-bold text-ink-50">Profile</h2>
        <p className="text-sm text-ink-400">Edit details, request team or unit changes, and update duty status.</p>
      </header>

      <div className="card space-y-2 p-4 text-sm">
        <p className="text-lg font-bold">{String(me?.callsign ?? '—')}</p>
        <p className="text-ink-400">
          {String(me?.department ?? '')}
          {me?.teamName ? ` · Team ${String(me.teamName).replace(/^Team\s+/i, '')}` : ''}
        </p>
        <p className="text-ink-400">
          Unit: {me?.unitNo ? String(me.unitNo) : 'Unassigned'}
          {me?.unitType ? ` · ${String(me.unitType)}` : ''}
        </p>
        <StatusBadge status={currentStatus} />
        <p className="text-ink-400">{user?.email}</p>
      </div>

      <div className="card space-y-3 p-4">
        <h3 className="text-sm font-semibold text-ink-100">Edit info</h3>
        <div className="space-y-1">
          <Label htmlFor="rp-name">Full name</Label>
          <Input id="rp-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rp-phone">Contact number</Label>
          <Input
            id="rp-phone"
            type="tel"
            value={form.contactNumber}
            onChange={(e) => setForm({ ...form, contactNumber: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rp-address">Address</Label>
          <Input id="rp-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rp-ec">Emergency contact</Label>
          <Input
            id="rp-ec"
            value={form.emergencyContact}
            onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rp-med">Medical alerts (yours)</Label>
          <textarea
            id="rp-med"
            className="input-field min-h-[72px]"
            value={form.medicalAlerts}
            onChange={(e) => setForm({ ...form, medicalAlerts: e.target.value })}
          />
        </div>
        <Button type="button" className="min-h-[48px] w-full" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save profile'}
        </Button>
      </div>

      <div className="card space-y-3 p-4">
        <h3 className="text-sm font-semibold text-ink-100">Team change</h3>
        <p className="text-xs text-ink-500">Crew team (Alpha / Bravo / …). Needs Dispatch approval.</p>
        {pendingTeam ? (
          <div className="rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-2 text-sm text-gold-300" role="status">
            Pending team: {String(pendingTeam.fromTeam || '—')} → {String(pendingTeam.toTeam || '—')}
            {pendingTeam.reason ? <span className="mt-1 block text-xs text-gold-400/90">{pendingTeam.reason}</span> : null}
          </div>
        ) : (
          <>
            <Label htmlFor="rp-team">Requested team</Label>
            <select id="rp-team" className="input-field" value={teamName} onChange={(e) => setTeamName(e.target.value)}>
              {TEAM_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <textarea
              className="input-field min-h-[64px]"
              placeholder="Reason for Dispatch (required)"
              value={teamReason}
              onChange={(e) => setTeamReason(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              className="min-h-[48px] w-full"
              disabled={teamBusy || teamReason.trim().length < 3}
              onClick={() => void requestTeamChange()}
            >
              {teamBusy ? 'Sending…' : 'Request team change'}
            </Button>
          </>
        )}
      </div>

      <div className="card space-y-3 p-4">
        <h3 className="text-sm font-semibold text-ink-100">Unit change</h3>
        <p className="text-xs text-ink-500">Ambulance / apparatus unit. Needs Dispatch approval.</p>
        {pendingUnit ? (
          <div className="rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-2 text-sm text-gold-300" role="status">
            Pending unit: {String(pendingUnit.fromUnitLabel || '—')} → {String(pendingUnit.toUnitLabel || '—')}
            {pendingUnit.reason ? <span className="mt-1 block text-xs text-gold-400/90">{pendingUnit.reason}</span> : null}
          </div>
        ) : (
          <>
            <Label htmlFor="rp-unit">Requested unit</Label>
            <select
              id="rp-unit"
              className="input-field"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
            >
              <option value="">Select unit…</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unitNo}
                  {u.vehicleType ? ` · ${u.vehicleType}` : ''}
                  {u.status ? ` (${u.status})` : ''}
                </option>
              ))}
            </select>
            <textarea
              className="input-field min-h-[64px]"
              placeholder="Reason for Dispatch (required)"
              value={unitReason}
              onChange={(e) => setUnitReason(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              className="min-h-[48px] w-full"
              disabled={unitBusy || !vehicleId || unitReason.trim().length < 3}
              onClick={() => void requestUnitChange()}
            >
              {unitBusy ? 'Sending…' : 'Request unit change'}
            </Button>
          </>
        )}
      </div>

      <div className="card space-y-3 p-4">
        <h3 className="text-sm font-semibold text-ink-100">Duty status</h3>
        <div className="grid grid-cols-2 gap-2">
          {statuses.map((s) => (
            <Button
              key={s}
              type="button"
              variant={currentStatus === s ? 'gold' : 'outline'}
              className="min-h-[44px]"
              disabled={statusBusy}
              onClick={() => void applyStatus(s)}
            >
              {s}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" className="min-h-[44px]" onClick={() => void check('in')}>
            Time in
          </Button>
          <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => void check('out')}>
            Time out
          </Button>
        </div>
      </div>

      <ConfirmActionDialog
        open={!!pendingStatus}
        request={
          pendingStatus
            ? {
                title: `Override to ${pendingStatus}?`,
                description: 'Dispatch may have restricted this status. Provide a reason to override.',
                confirmLabel: 'Override',
                tone: 'gold',
                requireReason: true,
                reasonLabel: 'Override reason',
              }
            : null
        }
        busy={statusBusy}
        onCancel={() => setPendingStatus(null)}
        onConfirm={(reason) => {
          if (pendingStatus) void applyStatus(pendingStatus, reason);
        }}
      />
    </div>
  );
}

type ResponderChatMessage = {
  _id: string;
  message: string;
  createdAt: string;
  senderName?: string;
};

export function ResponderChatPage() {
  const { accessToken, user } = useAuthStore();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);

  const chatQuery = useQuery({
    queryKey: ['responders-chat'],
    queryFn: () => chatApi.respondersMessages(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });

  const messages = (chatQuery.data?.data ?? []) as ResponderChatMessage[];

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send() {
    if (!accessToken || !text.trim() || busy) return;
    setBusy(true);
    try {
      await chatApi.sendResponders(accessToken, text.trim());
      setText('');
      await chatQuery.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-11.5rem)] flex-col gap-3" data-page="responder-chat">
      <header className="shrink-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold-500">Responder</p>
        <h2 className="text-lg font-bold text-ink-50">Team Chat</h2>
        <p className="text-sm text-ink-400">Always-on channel with Dispatch and field units.</p>
      </header>

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <QueryState
          isLoading={chatQuery.isLoading}
          isError={chatQuery.isError}
          error={chatQuery.error as Error}
          onRetry={() => chatQuery.refetch()}
          emptyTitle="Team chat unavailable"
          emptyHint="If this keeps failing, reopen Dispatches then Chat, or ask Dispatch to message you from the Dispatch board."
          showLastUpdated={false}
          className="flex min-h-0 flex-1 flex-col"
        >
          <ul ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 sidebar-scroll">
            {messages.length === 0 && (
              <li className="py-8 text-center text-sm text-ink-500">No messages yet. Say hello to Dispatch.</li>
            )}
            {messages.map((m) => {
              const mine = m.senderName && user?.fullName && m.senderName === user.fullName;
              return (
                <li key={m._id} className={clsx('space-y-1', mine && 'text-right')}>
                  <div className={clsx('flex items-baseline gap-2', mine ? 'justify-end' : 'justify-between')}>
                    <span className="truncate text-xs font-semibold text-ink-100">{m.senderName || 'User'}</span>
                    <span className="shrink-0 font-mono text-[10px] text-ink-500">
                      {formatTs(m.createdAt) ?? '—'}
                    </span>
                  </div>
                  <p
                    className={clsx(
                      'inline-block max-w-[90%] rounded-lg px-3 py-2 text-left text-sm text-ink-100',
                      mine ? 'bg-gold-500/15 text-ink-50' : 'bg-navy-800/80 text-ink-200'
                    )}
                  >
                    {m.message}
                  </p>
                </li>
              );
            })}
          </ul>
          <form
            className="flex shrink-0 items-center gap-2 border-t border-navy-700 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <Input
              className="min-h-[44px] flex-1 rounded-full"
              placeholder="Message Dispatch…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Chat message"
            />
            <Button type="submit" className="min-h-[44px] shrink-0 rounded-full px-4" disabled={busy || !text.trim()}>
              Send
            </Button>
          </form>
        </QueryState>
      </div>
    </div>
  );
}
