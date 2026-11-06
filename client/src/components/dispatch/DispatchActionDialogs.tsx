import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LocationDisplay } from '@/components/ui/LocationDisplay';
import { formatManilaDateTime, formatManilaTime } from '@/lib/timezone';
import { getUnitTypeVisual, resolveUnitStatus } from '@/lib/opsVisuals';
import { UNIT_STATUS } from '@/constants/unit-status';
import { formatGpsStatus, getGpsFreshness } from '@/constants/gps-config';
import type { Incident, MapUnit } from '@/types';
import clsx from 'clsx';

export type DispatchPanel = null | 'assign' | 'open' | 'report' | 'notify';

type NearbyUnit = {
  _id: string;
  callsign?: string;
  distanceKm: number;
  vehicleType?: string;
  status?: string;
  userId?: { fullName: string };
  crewCount?: number;
  capabilities?: string[];
};

type TimelineEv = { action?: string; details?: string; createdAt?: string };

type Props = {
  panel: DispatchPanel;
  onClose: () => void;
  selected: Incident | null;
  detail: Incident | null;
  timeline: TimelineEv[];
  nearbyUnits: NearbyUnit[];
  mapUnits: MapUnit[];
  assignedResponders: string[];
  assigning: boolean;
  notifyBusy: boolean;
  onAssign: (responderId: string, label: string) => void;
  onNotify: (message: string) => Promise<void>;
  stats: {
    totalToday: number;
    openCount: number;
    ongoingCount: number;
    resolvedToday: number;
    avgResponseMins: number | null;
  };
};

export function DispatchActionDialogs({
  panel,
  onClose,
  selected,
  detail,
  timeline,
  nearbyUnits,
  mapUnits,
  assignedResponders,
  assigning,
  notifyBusy,
  onAssign,
  onNotify,
  stats,
}: Props) {
  const [notifyMsg, setNotifyMsg] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (panel === 'notify') setNotifyMsg('');
    if (panel === 'assign') setPicked(null);
  }, [panel]);

  type AssignChoice = {
    id: string;
    label: string;
    meta: string;
    status: string;
    vehicleType?: string;
    distanceKm?: number;
    crewCount?: number;
    capabilities?: string[];
    gpsFreshnessLabel: string;
    gpsFreshnessClass: string;
    isOutOfService: boolean;
  };

  const assignChoices = useMemo((): AssignChoice[] => {
    function gpsFreshnessInfo(updatedAt?: string): { label: string; cls: string } {
      const freshness = getGpsFreshness(updatedAt ?? null);
      const label = formatGpsStatus(updatedAt ?? null);
      const cls =
        freshness === 'LIVE'
          ? 'text-ok-400'
          : freshness === 'DELAYED'
            ? 'text-gold-400'
            : 'text-ink-500';
      return { label, cls };
    }

    let choices: AssignChoice[];

    if (nearbyUnits.length > 0) {
      choices = nearbyUnits.map((u) => {
        const gps = gpsFreshnessInfo(undefined); // NearbyUnit has no location timestamp
        const isOos = String(u.status ?? '') === UNIT_STATUS.OUT_OF_SERVICE;
        return {
          id: u._id,
          label: u.callsign ?? u.userId?.fullName ?? 'Unit',
          meta: `${u.distanceKm.toFixed(1)} km · ${u.status ?? 'Ready'}`,
          status: u.status ?? 'Ready',
          vehicleType: u.vehicleType,
          distanceKm: u.distanceKm,
          crewCount: u.crewCount,
          capabilities: u.capabilities,
          gpsFreshnessLabel: gps.label,
          gpsFreshnessClass: gps.cls,
          isOutOfService: isOos,
        };
      });
    } else {
      choices = mapUnits.map((u) => {
        const visual = getUnitTypeVisual(u);
        const gps = gpsFreshnessInfo(u.currentLocation?.updatedAt);
        const isOos =
          String(u.status ?? '') === UNIT_STATUS.OUT_OF_SERVICE ||
          String(u.operationalStatus ?? '') === UNIT_STATUS.OUT_OF_SERVICE;
        return {
          id: u._id,
          label: u.unitNo ?? u.callsign ?? 'Unit',
          meta: `${visual.label} · ${resolveUnitStatus(u.status).label}`,
          status: u.status ?? 'Ready',
          vehicleType: u.vehicleType,
          distanceKm: undefined,
          crewCount: undefined,
          capabilities: undefined,
          gpsFreshnessLabel: gps.label,
          gpsFreshnessClass: gps.cls,
          isOutOfService: isOos,
        };
      });
    }

    // Sort: available/ready first, then by distanceKm ascending
    return choices.sort((a, b) => {
      const aAvail = !a.isOutOfService && /available|ready/i.test(a.status);
      const bAvail = !b.isOutOfService && /available|ready/i.test(b.status);
      if (aAvail !== bAvail) return aAvail ? -1 : 1;
      if (a.distanceKm != null && b.distanceKm != null) return a.distanceKm - b.distanceKm;
      return 0;
    });
  }, [nearbyUnits, mapUnits]);

  const pickedLabel = assignChoices.find((c) => c.id === picked)?.label ?? 'unit';
  const inc = detail ?? selected;

  async function submitNotify() {
    if (!notifyMsg.trim()) {
      toast.message('Enter a message for the assigned team');
      return;
    }
    await onNotify(notifyMsg.trim());
    setNotifyMsg('');
  }

  return (
    <>
      <Dialog open={panel === 'assign'} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[85dvh] max-w-md overflow-hidden p-0">
          <div className="border-b border-navy-700 px-6 py-4 pr-12">
            <DialogHeader className="mb-0">
              <DialogTitle>Assign Unit</DialogTitle>
              <DialogDescription>
                {selected ? `Select a unit for ${selected.displayId}` : 'Select an incident first'}
              </DialogDescription>
            </DialogHeader>
          </div>
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto p-4 sidebar-scroll">
            {assignChoices.length === 0 && (
              <li className="rounded-md border border-navy-700 bg-navy-950/50 p-4 text-center text-sm text-ink-400">
                No ready units available.
              </li>
            )}
            {assignChoices.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  disabled={u.isOutOfService}
                  onClick={() => !u.isOutOfService && setPicked(u.id)}
                  className={clsx(
                    'flex w-full flex-col gap-1 rounded-md border px-3 py-2.5 text-left text-sm transition-colors',
                    u.isOutOfService
                      ? 'cursor-not-allowed border-navy-700 bg-navy-950/20 opacity-50'
                      : picked === u.id
                        ? 'border-gold-500 bg-gold-500/10'
                        : 'border-navy-600 bg-navy-950/40 hover:border-navy-500'
                  )}
                >
                  {/* Row 1: name + vehicle type + status badge */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="font-semibold text-ink-50">{u.label}</span>
                      {u.vehicleType && (
                        <span className="ml-1.5 text-[11px] text-ink-400">{u.vehicleType}</span>
                      )}
                    </span>
                    <StatusBadge status={u.status} className="shrink-0 text-[10px]" />
                  </div>
                  {/* Row 2: distance + GPS freshness */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                    {u.distanceKm != null && (
                      <span className="text-ink-300">
                        {u.distanceKm.toFixed(1)} km
                      </span>
                    )}
                    <span className={clsx('truncate', u.gpsFreshnessClass)}>{u.gpsFreshnessLabel}</span>
                  </div>
                  {/* Row 3: crew + capabilities */}
                  {(u.crewCount != null || (u.capabilities && u.capabilities.length > 0)) && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-400">
                      {u.crewCount != null && <span>Crew: {u.crewCount}</span>}
                      {u.capabilities?.map((c) => (
                        <span key={c} className="rounded bg-navy-800 px-1.5 py-0.5 text-[10px] text-ink-300">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              </li>
            ))}
            {assignChoices.length > 0 &&
              !nearbyUnits.length &&
              mapUnits.some((u) => !u.currentLocation?.updatedAt || getGpsFreshness(u.currentLocation.updatedAt) === 'OFFLINE') && (
                <li className="rounded-md border border-gold-600/30 bg-gold-500/10 px-3 py-2 text-[11px] text-gold-300">
                  Some units have no recent GPS fix — estimated ETAs may be inaccurate.
                </li>
              )}
          </ul>
          <div className="flex justify-end gap-2 border-t border-navy-700 px-4 py-3">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!picked || assigning}
              onClick={() => picked && onAssign(picked, pickedLabel)}
            >
              {assigning ? 'Dispatching…' : 'Dispatch unit'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={panel === 'open'} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-hidden p-0">
          <div className="border-b border-navy-700 px-6 py-4 pr-12">
            <DialogHeader className="mb-0">
              <DialogTitle>{inc?.displayId ?? 'Incident'}</DialogTitle>
              <DialogDescription>{inc?.incidentTypeId?.typeName ?? 'Details'}</DialogDescription>
            </DialogHeader>
          </div>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto p-6 sidebar-scroll">
            {!inc ? (
              <p className="text-sm text-ink-400">Select an incident from the queue or map.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={inc.status} />
                  <StatusBadge status={inc.priorityLevel} />
                </div>
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Reporter</dt>
                    <dd className="text-ink-100">{inc.callerName || inc.reportedByUserId?.fullName || '—'}</dd>
                    <dd className="font-mono text-xs text-ink-400">
                      {inc.callerPhone || inc.reportedByUserId?.contactNumber || ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Received</dt>
                    <dd className="text-ink-100">{formatManilaDateTime(inc.reportedAt)}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Location</dt>
                    <dd className="text-ink-100">
                      <LocationDisplay
                        addressText={inc.locationId?.addressText}
                        lat={inc.locationId?.latitude}
                        lng={inc.locationId?.longitude}
                      />
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Description</dt>
                    <dd className="whitespace-pre-wrap text-ink-200">{inc.description || '—'}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="mb-1 font-mono text-[10px] uppercase tracking-wide text-ink-500">Assigned</dt>
                    <dd className="text-ink-200">
                      {assignedResponders.length > 0 ? assignedResponders.join(', ') : 'No unit assigned'}
                    </dd>
                  </div>
                </dl>
                <div>
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-ink-500">Timeline</p>
                  <ul className="space-y-1.5 text-xs text-ink-300">
                    {(timeline.length
                      ? [...timeline].reverse()
                      : [{ action: inc.description || 'Report received', createdAt: inc.reportedAt }]
                    ).map((ev, i) => (
                      <li key={i} className="flex gap-2 border-l-2 border-navy-600 pl-2">
                        <span className="shrink-0 text-ink-500">{formatManilaTime(ev.createdAt)}</span>
                        <span>{ev.action || ev.details || 'Update'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Button type="button" variant="outline" className="w-full" asChild>
                  <Link to={`/admin/incidents/${inc._id}`} onClick={onClose}>
                    Open full incident page
                  </Link>
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={panel === 'report'} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-hidden p-0">
          <div className="border-b border-navy-700 px-6 py-4 pr-12">
            <DialogHeader className="mb-0">
              <DialogTitle>Incident Report</DialogTitle>
              <DialogDescription>
                {inc ? `${inc.displayId} summary` : 'Today’s operations snapshot'}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto p-6 sidebar-scroll">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-navy-600 bg-navy-950/50 p-3">
                <p className="font-mono text-[10px] uppercase text-ink-500">Total today</p>
                <p className="text-2xl font-bold text-ok-400">{stats.totalToday}</p>
              </div>
              <div className="rounded-lg border border-navy-600 bg-navy-950/50 p-3">
                <p className="font-mono text-[10px] uppercase text-ink-500">Avg response</p>
                <p className="text-2xl font-bold text-[#7aa2d4]">
                  {stats.avgResponseMins != null ? `${stats.avgResponseMins}m` : '—'}
                </p>
              </div>
              <div className="rounded-lg border border-navy-600 bg-navy-950/50 p-3">
                <p className="font-mono text-[10px] uppercase text-ink-500">Open</p>
                <p className="text-xl font-bold text-gold-400">{stats.openCount}</p>
              </div>
              <div className="rounded-lg border border-navy-600 bg-navy-950/50 p-3">
                <p className="font-mono text-[10px] uppercase text-ink-500">On going</p>
                <p className="text-xl font-bold text-alert-400">{stats.ongoingCount}</p>
              </div>
            </div>
            {inc && (
              <div className="space-y-2 rounded-lg border border-navy-600 bg-navy-950/40 p-4 text-sm">
                <p className="font-semibold text-ink-50">
                  {inc.displayId} · {inc.incidentTypeId?.typeName}
                </p>
                <p className="text-ink-300">Status: {inc.status} · Priority: {inc.priorityLevel}</p>
                <p className="text-ink-300">Location: {inc.locationId?.addressText || '—'}</p>
                <p className="text-ink-300">Units: {assignedResponders.join(', ') || 'None'}</p>
                <p className="whitespace-pre-wrap text-ink-200">{inc.description || 'No description.'}</p>
              </div>
            )}
            <Button type="button" variant="outline" className="w-full" asChild>
              <Link to="/admin/reports" onClick={onClose}>
                Open reports module
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={panel === 'notify'} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-md overflow-hidden p-0">
          <div className="border-b border-navy-700 px-6 py-4 pr-12">
            <DialogHeader className="mb-0">
              <DialogTitle>Notify Team</DialogTitle>
              <DialogDescription>
                {selected
                  ? `Important alert to units assigned to ${selected.displayId}. They can reply from the Responder PWA.`
                  : 'Select an incident with assigned units first.'}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="space-y-3 p-6">
            {assignedResponders.length > 0 ? (
              <p className="text-xs text-ink-400">
                Recipients: <span className="text-ink-200">{assignedResponders.join(', ')}</span>
              </p>
            ) : (
              <p className="rounded-md border border-alert-500/30 bg-alert-500/10 px-3 py-2 text-xs text-alert-300">
                No assigned units yet. Assign a unit before notifying.
              </p>
            )}
            <label className="block space-y-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Message</span>
              <textarea
                className="input-field min-h-[120px] w-full resize-y py-2"
                placeholder="Message for the assigned team…"
                value={notifyMsg}
                onChange={(e) => setNotifyMsg(e.target.value)}
                disabled={!selected || assignedResponders.length === 0}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={
                  notifyBusy || !selected || !notifyMsg.trim() || assignedResponders.length === 0
                }
                onClick={() => void submitNotify()}
              >
                {notifyBusy ? 'Sending…' : 'Send alert'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
