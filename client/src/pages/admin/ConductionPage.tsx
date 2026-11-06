import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Ambulance,
  Bell,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flame,
  MapPin,
  Pencil,
  Plus,
  Printer,
  Route,
  Trash2,
  TriangleAlert,
  Truck,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { transportsApi, resourcesApi, mapApi, notificationsApi } from '@/services/api';
import { LIVE } from '@/lib/liveTiming';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { QueryState } from '@/components/ui/QueryState';
import { FreshnessLine, liveSyncToFreshness } from '@/components/ui/FreshnessLine';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MapView } from '@/components/map/MapView';
import { TransportLocationPicker } from '@/components/map/TransportLocationPicker';
import { useAdminLiveSync } from '@/hooks/LiveSyncContext';
import { useMapConfig } from '@/hooks/useMapConfig';
import { fromOperationalTime, toOperationalTime } from '@/lib/incidentState';
import { normalizePhPhone } from '@/lib/validation';
import { forwardGeocode } from '@/lib/geocode';
import { formatManilaDate } from '@/lib/timezone';
import { SUN_VALLEY_CENTER } from '@/lib/validation';
import clsx from 'clsx';

export type TransportRow = {
  id?: string;
  displayId: string;
  patientName: string;
  transportStatus: string;
  scheduledDate: string;
  scheduledTime?: string;
  originAddress?: string;
  destinationAddress?: string;
  originLat?: number | null;
  originLng?: number | null;
  destinationLat?: number | null;
  destinationLng?: number | null;
  contactNumber?: string;
  requestingPerson?: string;
  priority?: string;
  returnTrip?: number;
  oxygenRequired?: number;
  assignedVehicleId?: string;
  assignedCrew?: string;
  notes?: string;
  cancelReason?: string;
  unitNo?: string;
  vehicleType?: string;
  vehicleStatus?: string;
};

type VehicleRow = { id?: string; unitNo: string; status: string; vehicleType?: string };

type FormState = {
  patientName: string;
  contactNumber: string;
  requestingPerson: string;
  scheduledDate: string;
  pickupTime: string;
  originAddress: string;
  destinationAddress: string;
  appointmentTime: string;
  tripType: string;
  priority: string;
  wheelchair: boolean;
  oxygen: boolean;
  companion: string;
  specialInstructions: string;
  recurringRule: string;
  reminderMinutes: string;
  assignedVehicleId: string;
  originLat?: number;
  originLng?: number;
  destLat?: number;
  destLng?: number;
};

const EMPTY_FORM: FormState = {
  patientName: '',
  contactNumber: '',
  requestingPerson: '',
  scheduledDate: '',
  pickupTime: '08:00',
  originAddress: '',
  destinationAddress: '',
  appointmentTime: '09:00',
  tripType: 'One-way',
  priority: 'Routine',
  wheelchair: false,
  oxygen: false,
  companion: '',
  specialInstructions: '',
  recurringRule: '',
  reminderMinutes: '60',
  assignedVehicleId: '',
  originLat: undefined,
  originLng: undefined,
  destLat: undefined,
  destLng: undefined,
};

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function startOfWeek(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function toIsoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatWeekRange(start: Date) {
  const end = addDays(start, 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`;
}

function displayStatus(s: TransportRow): string {
  const st = s.transportStatus || 'Scheduled';
  if (st === 'Cancelled') return 'Canceled';
  if (st === 'Completed') return 'Completed';
  if (st === 'In Progress' || st === 'En Route' || st === 'Transporting') return 'In Progress';
  const today = todayIso();
  if (st === 'Scheduled' && s.scheduledDate > today) return 'Upcoming';
  if (st === 'Scheduled' && s.scheduledDate < today) return 'Missed';
  return 'Scheduled';
}

function statusTone(label: string): string {
  switch (label) {
    case 'In Progress':
      return 'border-gold-500/50 bg-gold-500/25 text-gold-200';
    case 'Upcoming':
      return 'border-[#3b82f6]/40 bg-[#3b82f6]/20 text-[#93c5fd]';
    case 'Completed':
      return 'border-ok-500/40 bg-ok-500/20 text-ok-300';
    case 'Canceled':
    case 'Missed':
      return 'border-alert-500/40 bg-alert-500/20 text-alert-300';
    default:
      return 'border-navy-600 bg-navy-800 text-ink-300';
  }
}

function calendarBlockClass(label: string): string {
  switch (label) {
    case 'In Progress':
      return 'border-gold-500/50 bg-gold-500/25 text-gold-100';
    case 'Upcoming':
      return 'border-[#3b82f6]/40 bg-[#3b82f6]/20 text-[#bfdbfe]';
    case 'Completed':
      return 'border-ok-500/40 bg-ok-500/20 text-ok-100';
    case 'Canceled':
    case 'Missed':
      return 'border-alert-500/40 bg-alert-500/15 text-alert-200';
    default:
      return 'border-navy-600 bg-navy-800 text-ink-200';
  }
}

function hourFromTime(t?: string) {
  if (!t) return 8;
  const hhmm = fromOperationalTime(t);
  const h = Number(hhmm.split(':')[0]);
  return Number.isFinite(h) ? h : 8;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function unitIcon(unitNo?: string, vehicleType?: string) {
  const t = `${unitNo ?? ''} ${vehicleType ?? ''}`.toLowerCase();
  if (/fire/.test(t)) return Flame;
  if (/rescue|ambulance|ems|medic/.test(t)) return Ambulance;
  return Truck;
}

export function ConductionPage() {
  const { accessToken } = useAuthStore();
  const live = useAdminLiveSync();
  const queryClient = useQueryClient();
  const mapConfig = useMapConfig();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusDate, setFocusDate] = useState(todayIso);
  const [composeOpen, setComposeOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [routePts, setRoutePts] = useState<{
    origin?: { lat: number; lng: number };
    dest?: { lat: number; lng: number };
    distanceKm?: number;
    etaMin?: number;
  }>({});

  const listQuery = useQuery({
    queryKey: ['transports'],
    queryFn: () => transportsApi.list(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.coolMs,
  });
  const vehiclesQuery = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => resourcesApi.vehicles(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.coolMs,
  });
  const mapQuery = useQuery({
    queryKey: ['map-data'],
    queryFn: () => mapApi.data(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });

  const listAll = (listQuery.data?.data ?? []) as TransportRow[];
  const vehicles = (vehiclesQuery.data?.data ?? []) as VehicleRow[];
  const mapUnits = mapQuery.data?.data?.units ?? [];

  const weekStart = useMemo(() => startOfWeek(focusDate), [focusDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekStartIso = toIsoDate(weekStart);
  const weekEndIso = toIsoDate(weekDays[6]);
  const list = useMemo(
    () => listAll.filter((r) => r.scheduledDate >= weekStartIso && r.scheduledDate <= weekEndIso),
    [listAll, weekStartIso, weekEndIso]
  );

  useEffect(() => {
    if (!list.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !list.some((r) => (r.id || r.displayId) === selectedId)) {
      setSelectedId(list[0].id || list[0].displayId);
    }
  }, [list, selectedId]);

  const selected = list.find((r) => (r.id || r.displayId) === selectedId) ?? null;
  const selectedStatus = selected ? displayStatus(selected) : null;

  useEffect(() => {
    let cancelled = false;
    async function loadRoute() {
      if (!selected?.originAddress && !selected?.destinationAddress) {
        setRoutePts({});
        return;
      }
      const token = mapConfig.data?.mapboxToken;
      const savedOrigin =
        selected.originLat != null && selected.originLng != null
          ? { lat: Number(selected.originLat), lng: Number(selected.originLng) }
          : null;
      const savedDest =
        selected.destinationLat != null && selected.destinationLng != null
          ? { lat: Number(selected.destinationLat), lng: Number(selected.destinationLng) }
          : null;

      if (!token && !savedOrigin && !savedDest) {
        setRoutePts({
          origin: SUN_VALLEY_CENTER,
          dest: { lat: SUN_VALLEY_CENTER.lat + 0.01, lng: SUN_VALLEY_CENTER.lng + 0.01 },
        });
        return;
      }

      let origin = savedOrigin;
      let dest = savedDest;
      if (token && (!origin || !dest)) {
        const [oHits, dHits] = await Promise.all([
          !origin && selected.originAddress
            ? forwardGeocode(token, selected.originAddress, { scope: 'ncr', limit: 1 })
            : Promise.resolve([]),
          !dest && selected.destinationAddress
            ? forwardGeocode(token, selected.destinationAddress, {
                scope: 'ncr',
                limit: 1,
                proximity: origin ?? SUN_VALLEY_CENTER,
              })
            : Promise.resolve([]),
        ]);
        if (cancelled) return;
        if (!origin && oHits[0]) origin = { lat: oHits[0].lat, lng: oHits[0].lng };
        if (!dest && dHits[0]) dest = { lat: dHits[0].lat, lng: dHits[0].lng };
      }
      if (cancelled) return;
      origin = origin ?? SUN_VALLEY_CENTER;
      dest = dest ?? { lat: origin.lat + 0.012, lng: origin.lng + 0.01 };

      let distanceKm = Math.round(haversineKm(origin, dest) * 10) / 10;
      let etaMin = Math.max(8, Math.round((distanceKm / 25) * 60));
      if (token) {
        try {
          const url =
            `https://api.mapbox.com/directions/v5/mapbox/driving/` +
            `${origin.lng},${origin.lat};${dest.lng},${dest.lat}` +
            `?overview=false&access_token=${token}`;
          const res = await fetch(url);
          if (res.ok) {
            const json = (await res.json()) as {
              routes?: Array<{ distance?: number; duration?: number }>;
            };
            const route = json.routes?.[0];
            if (route?.distance != null) distanceKm = Math.round((route.distance / 1000) * 10) / 10;
            if (route?.duration != null) etaMin = Math.max(1, Math.round(route.duration / 60));
          }
        } catch {
          /* keep haversine estimate */
        }
      }
      if (cancelled) return;
      setRoutePts({ origin, dest, distanceKm, etaMin });
    }
    void loadRoute();
    return () => {
      cancelled = true;
    };
  }, [
    selected?.id,
    selected?.originAddress,
    selected?.destinationAddress,
    selected?.originLat,
    selected?.originLng,
    selected?.destinationLat,
    selected?.destinationLng,
    mapConfig.data?.mapboxToken,
  ]);

  const phoneOk = !form.contactNumber || !!normalizePhPhone(form.contactNumber);
  const formValid =
    form.patientName.trim().length >= 2 &&
    !!form.scheduledDate &&
    !!form.pickupTime &&
    form.originAddress.trim().length >= 3 &&
    form.destinationAddress.trim().length >= 3 &&
    phoneOk;

  const sameSlot = list.filter(
    (s) =>
      s.scheduledDate === form.scheduledDate &&
      s.scheduledTime === toOperationalTime(form.pickupTime) &&
      s.transportStatus !== 'Cancelled' &&
      s.id !== editingId
  );

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, scheduledDate: focusDate || todayIso() });
    setComposeOpen(true);
  }

  async function openEdit() {
    if (!selected) {
      toast.error('Select a schedule first');
      return;
    }
    setEditingId(selected.id || null);
    const base: FormState = {
      patientName: selected.patientName || '',
      contactNumber: selected.contactNumber || '',
      requestingPerson: selected.requestingPerson || '',
      scheduledDate: selected.scheduledDate || '',
      pickupTime: fromOperationalTime(selected.scheduledTime || '0800H'),
      originAddress: selected.originAddress || '',
      destinationAddress: selected.destinationAddress || '',
      appointmentTime: '09:00',
      tripType: selected.returnTrip ? 'Round trip' : 'One-way',
      priority: selected.priority || 'Routine',
      wheelchair: /wheelchair/i.test(selected.notes || ''),
      oxygen: !!selected.oxygenRequired,
      companion: selected.assignedCrew || '',
      specialInstructions: selected.notes || '',
      recurringRule: '',
      reminderMinutes: '60',
      assignedVehicleId: selected.assignedVehicleId || '',
      originLat: selected.originLat != null ? Number(selected.originLat) : undefined,
      originLng: selected.originLng != null ? Number(selected.originLng) : undefined,
      destLat: selected.destinationLat != null ? Number(selected.destinationLat) : undefined,
      destLng: selected.destinationLng != null ? Number(selected.destinationLng) : undefined,
    };
    setForm(base);
    setComposeOpen(true);

    if (
      (base.originLat != null && base.originLng != null && base.destLat != null && base.destLng != null) ||
      !mapConfig.data?.mapboxToken
    ) {
      return;
    }
    const token = mapConfig.data.mapboxToken;
    const [originHits, destHits] = await Promise.all([
      base.originLat == null && base.originAddress.trim()
        ? forwardGeocode(token, base.originAddress, { scope: 'ncr', limit: 1 })
        : Promise.resolve([]),
      base.destLat == null && base.destinationAddress.trim()
        ? forwardGeocode(token, base.destinationAddress, { scope: 'ncr', limit: 1 })
        : Promise.resolve([]),
    ]);
    setForm((prev) => ({
      ...prev,
      originLat: prev.originLat ?? originHits[0]?.lat,
      originLng: prev.originLng ?? originHits[0]?.lng,
      destLat: prev.destLat ?? destHits[0]?.lat,
      destLng: prev.destLng ?? destHits[0]?.lng,
    }));
  }

  async function saveTransport() {
    if (!accessToken || !formValid || saving) return;
    if (sameSlot.length && !window.confirm(`Possible conflict with ${sameSlot.map((s) => s.displayId).join(', ')}. Continue?`)) {
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        scheduledTime: toOperationalTime(form.pickupTime),
        contactNumber: form.contactNumber ? normalizePhPhone(form.contactNumber) : undefined,
        assignedCrew: form.companion,
        notes: form.specialInstructions,
      };
      if (editingId) {
        await transportsApi.update(accessToken, editingId, payload);
        toast.success('Schedule updated');
      } else {
        const res = (await transportsApi.create(accessToken, payload)) as { data?: { conflicts?: string[]; id?: string } };
        if (res.data?.conflicts?.length) toast.message(`Same-slot schedules: ${res.data.conflicts.join(', ')}`);
        toast.success('Conduction scheduled');
        if (res.data?.id) setSelectedId(res.data.id);
      }
      setComposeOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['transports'] });
      void queryClient.invalidateQueries({ queryKey: ['dispatch-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['map-data'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save schedule');
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(status: string, extra?: Record<string, unknown>) {
    if (!accessToken || !selected?.id) return;
    setBusy(true);
    try {
      await transportsApi.update(accessToken, selected.id, { transportStatus: status, ...extra });
      toast.success(`Marked ${status}`);
      void queryClient.invalidateQueries({ queryKey: ['transports'] });
      void queryClient.invalidateQueries({ queryKey: ['dispatch-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['map-data'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function cancelSelected() {
    if (!selected?.id) return;
    const reason = window.prompt(`Cancel ${selected.displayId}? Enter reason:`);
    if (!reason?.trim()) return;
    await updateStatus('Cancelled', { cancelReason: reason.trim() });
  }

  async function removeSelected() {
    if (!selected?.id) return;
    if (!window.confirm(`Remove/cancel ${selected.displayId}?`)) return;
    await updateStatus('Cancelled', { cancelReason: 'Removed from schedule board' });
  }

  function printSelected() {
    if (!selected) {
      toast.error('Select a schedule first');
      return;
    }
    const esc = (value: unknown) =>
      String(value ?? '—')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const html = `<!doctype html><html><head><title>${esc(selected.displayId)}</title>
      <style>
        body{font-family:system-ui,sans-serif;padding:24px;color:#111}
        h1{font-size:18px;margin:0 0 16px}
        dt{color:#666;font-size:12px;margin-top:10px}
        dd{margin:2px 0 0;font-weight:600}
      </style>
      </head><body>
      <h1>Conduction / Transport Form — ${esc(selected.displayId)}</h1>
      <dl>
        <dt>Patient</dt><dd>${esc(selected.patientName)}</dd>
        <dt>Contact</dt><dd>${esc(selected.contactNumber || '—')}</dd>
        <dt>Pickup</dt><dd>${esc(selected.originAddress || '—')}</dd>
        <dt>Destination</dt><dd>${esc(selected.destinationAddress || '—')}</dd>
        <dt>Date / Time</dt><dd>${esc(`${selected.scheduledDate} ${selected.scheduledTime || ''}`.trim())}</dd>
        <dt>Unit / Crew</dt><dd>${esc(`${selected.unitNo || '—'} / ${selected.assignedCrew || '—'}`)}</dd>
        <dt>Priority</dt><dd>${esc(selected.priority || 'Routine')}</dd>
        <dt>Notes</dt><dd>${esc(selected.notes || '—')}</dd>
        <dt>Status</dt><dd>${esc(displayStatus(selected))}</dd>
      </dl>
      </body></html>`;

    // Print via hidden iframe — avoids popup blockers (noopener window.open returns null).
    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'Print conduction form');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      toast.error('Could not open print preview');
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    const runPrint = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        window.setTimeout(() => iframe.remove(), 1500);
      }
    };
    if (iframe.contentWindow?.document.readyState === 'complete') runPrint();
    else iframe.onload = runPrint;
  }

  async function notifyTeam() {
    if (!accessToken || !selected) {
      toast.error('Select a schedule first');
      return;
    }
    setBusy(true);
    try {
      const res = await notificationsApi.broadcast(accessToken, {
        title: `Conduction ${selected.displayId}`,
        message: `${selected.patientName} · ${selected.scheduledTime || ''} ${selected.scheduledDate}\nPickup: ${selected.originAddress || '—'}\nDestination: ${selected.destinationAddress || '—'}`,
        audience: 'RESPONDERS',
        kind: 'Scheduled',
        priority: selected.priority === 'Critical' ? 'Critical' : selected.priority === 'Urgent' ? 'Urgent' : 'Important',
      });
      toast.success(`Notified ${res.data.sent} responders`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Notify failed');
    } finally {
      setBusy(false);
    }
  }

  const responderUnits = useMemo(() => {
    const fromMap = mapUnits.slice(0, 8).map((u) => ({
      id: u._id,
      label: u.callsign || u.unitNo || 'Unit',
      status: u.status || u.availabilityStatus || 'Available',
      type: u.vehicleType || u.department || '',
      capacity: '—',
    }));
    if (fromMap.length) return fromMap;
    return vehicles.slice(0, 8).map((v) => ({
      id: v.id || v.unitNo,
      label: v.unitNo,
      status: v.status || 'Available',
      type: v.vehicleType || '',
      capacity: '—',
    }));
  }, [mapUnits, vehicles]);

  return (
    <div className="conduction-page -m-3 flex flex-1 flex-col sm:-m-4 md:-m-6">
      <header className="shrink-0 border-b border-navy-700 px-3 py-3 sm:px-4 md:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="font-mono text-lg font-bold uppercase tracking-[0.12em] text-ink-50 sm:text-xl">
              Conduction
            </h1>
            <p className="mt-0.5 text-sm text-ink-400">Patient transport schedules, routes, and unit readiness</p>
            <FreshnessLine
              state={liveSyncToFreshness(live.state, live.lastUpdated)}
              lastUpdated={listQuery.dataUpdatedAt}
              compact
              className="mt-1.5"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="min-h-[40px]" onClick={() => setFocusDate(todayIso())}>
              Today
            </Button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded border border-navy-600 p-2 text-ink-300 hover:bg-navy-800"
                aria-label="Previous week"
                onClick={() => setFocusDate(toIsoDate(addDays(weekStart, -7)))}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[10rem] text-center font-mono text-xs text-ink-300">{formatWeekRange(weekStart)}</span>
              <button
                type="button"
                className="rounded border border-navy-600 p-2 text-ink-300 hover:bg-navy-800"
                aria-label="Next week"
                onClick={() => setFocusDate(toIsoDate(addDays(weekStart, 7)))}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <Button type="button" className="min-h-[40px] gap-2 bg-ok-600 hover:bg-ok-500" onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden />
              Add New
            </Button>
          </div>
        </div>
      </header>

      <div className="conduction-grid flex-1 gap-3 p-3 sm:p-4 md:p-5">
        {/* Schedule list */}
        <section className="card conduction-area-list flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-navy-700 px-3 py-2.5">
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
              Schedule List
            </h2>
            <span className="font-mono text-[10px] text-ink-500">{list.length} entries</span>
          </div>
          <QueryState
            isLoading={listQuery.isLoading}
            isError={listQuery.isError}
            error={listQuery.error as Error}
            onRetry={() => listQuery.refetch()}
            isEmpty={!listQuery.isLoading && list.length === 0}
            emptyTitle="No conduction schedules"
            emptyHint="Add a patient transport to populate the board."
            showLastUpdated={false}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 overflow-auto sidebar-scroll">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="sticky top-0 z-[1] bg-navy-900/95 text-[10px] uppercase tracking-wide text-ink-500 backdrop-blur">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">Schedule ID</th>
                    <th className="px-3 py-2.5 font-medium">Patient</th>
                    <th className="px-3 py-2.5 font-medium">Pick Up</th>
                    <th className="px-3 py-2.5 font-medium">Destination</th>
                    <th className="px-3 py-2.5 font-medium">Date</th>
                    <th className="px-3 py-2.5 font-medium">Time</th>
                    <th className="px-3 py-2.5 font-medium">Unit</th>
                    <th className="px-3 py-2.5 font-medium">Team</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => {
                    const key = row.id || row.displayId;
                    const active = selectedId === key;
                    const st = displayStatus(row);
                    return (
                      <tr
                        key={key}
                        className={clsx(
                          'cursor-pointer border-t border-navy-800 transition-colors',
                          active ? 'bg-[#3b82f6]/10' : 'hover:bg-navy-800/60'
                        )}
                        onClick={() => setSelectedId(key)}
                      >
                        <td className="px-3 py-2.5 font-mono text-xs text-ink-200">{row.displayId}</td>
                        <td className="px-3 py-2.5 font-medium text-ink-50">{row.patientName}</td>
                        <td className="max-w-[140px] truncate px-3 py-2.5 text-ink-400">{row.originAddress || '—'}</td>
                        <td className="max-w-[120px] truncate px-3 py-2.5 text-ink-400">{row.destinationAddress || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-ink-300">
                          {row.scheduledDate ? formatManilaDate(`${row.scheduledDate}T12:00:00`) : '—'}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-ink-300">{row.scheduledTime || '—'}</td>
                        <td className="px-3 py-2.5 text-ink-200">{row.unitNo || '—'}</td>
                        <td className="max-w-[100px] truncate px-3 py-2.5 text-ink-400">{row.assignedCrew || '—'}</td>
                        <td className="px-3 py-2.5">
                          <span className={clsx('inline-flex rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase', statusTone(st))}>
                            {st}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </QueryState>
        </section>

        {/* Details */}
        <section className="card conduction-area-details flex min-h-0 flex-col overflow-hidden p-3 sm:p-4">
          <div className="mb-3 flex shrink-0 items-start justify-between gap-2">
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
              Schedule Details
            </h2>
            {selectedStatus && (
              <span className={clsx('rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase', statusTone(selectedStatus))}>
                {selectedStatus}
              </span>
            )}
          </div>
          {!selected ? (
            <p className="text-sm text-ink-500">Select a schedule from the list.</p>
          ) : (
            <div className="min-h-0 max-h-[min(40vh,22rem)] flex-1 space-y-2.5 overflow-y-auto text-sm sidebar-scroll lg:max-h-none">
              <DetailRow label="Schedule ID" value={selected.displayId} mono />
              <DetailRow
                label="Patient Name"
                value={`${selected.patientName}${selected.requestingPerson ? ` · Req: ${selected.requestingPerson}` : ''}`}
              />
              <DetailRow label="Pickup Location" value={selected.originAddress || '—'} />
              <DetailRow label="Destination" value={selected.destinationAddress || '—'} />
              <DetailRow label="Contact Number" value={selected.contactNumber || '—'} />
              <DetailRow
                label="Scheduled Date"
                value={
                  selected.scheduledDate === todayIso()
                    ? `${formatManilaDate(`${selected.scheduledDate}T12:00:00`)} (Today)`
                    : formatManilaDate(`${selected.scheduledDate}T12:00:00`)
                }
              />
              <DetailRow label="Time" value={selected.scheduledTime || '—'} mono />
              <DetailRow label="Assigned Unit" value={selected.unitNo || 'Unassigned'} />
              <DetailRow label="Team / Crew" value={selected.assignedCrew || '—'} />
              <DetailRow label="Priority" value={selected.priority || 'Routine'} />
              <DetailRow label="Medical Notes" value={selected.notes || '—'} />
              <div className="mt-3 flex items-center gap-2 border-t border-navy-700 pt-3 text-xs text-ink-300">
                <span
                  className={clsx(
                    'inline-block h-2 w-2 rounded-full',
                    selectedStatus === 'In Progress'
                      ? 'bg-ok-500'
                      : selectedStatus === 'Completed'
                        ? 'bg-[#3b82f6]'
                        : 'bg-gold-500'
                  )}
                />
                {selectedStatus === 'In Progress'
                  ? 'Patient en route to destination'
                  : selectedStatus === 'Completed'
                    ? 'Transport completed'
                    : selectedStatus === 'Canceled'
                      ? `Cancelled${selected.cancelReason ? `: ${selected.cancelReason}` : ''}`
                      : 'Awaiting departure / assignment'}
              </div>
            </div>
          )}
        </section>

        {/* Route */}
        <section className="card conduction-area-route overflow-hidden">
          <div className="border-b border-navy-700 px-3 py-2">
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
              Route Summary
            </h2>
          </div>
          {!selected ? (
            <p className="p-4 text-sm text-ink-500">Select a schedule to preview the route.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2 border-b border-navy-800 p-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-ink-500">From</p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-ink-100">{selected.originAddress || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-ink-500">To</p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-ink-100">{selected.destinationAddress || '—'}</p>
                </div>
              </div>
              <div className="h-[220px]">
                <MapView
                  height="220px"
                  className="rounded-none border-0"
                  zoom={13}
                  showBoundary
                  showRegionalContext={false}
                  showFacilities={false}
                  center={
                    routePts.origin
                      ? [routePts.origin.lat, routePts.origin.lng]
                      : [SUN_VALLEY_CENTER.lat, SUN_VALLEY_CENTER.lng]
                  }
                  data={{
                    incidents: [],
                    sosPending: [],
                    units: [],
                    responders: [],
                    facilities: [],
                    center: routePts.origin ?? SUN_VALLEY_CENTER,
                    routes:
                      routePts.origin && routePts.dest
                        ? [
                            {
                              id: `conduction-${selected.id || selected.displayId}`,
                              label: 'Pickup → Drop-off',
                              status: selected.transportStatus || 'Scheduled',
                              from: routePts.origin,
                              to: routePts.dest,
                              incidentId: selected.id || selected.displayId || 'conduction',
                              incidentDisplayId: selected.displayId || selected.patientName || 'Conduction',
                            },
                          ]
                        : [],
                  }}
                />
              </div>
              <div className="flex flex-wrap gap-4 p-3 text-sm text-ink-300">
                <span className="inline-flex items-center gap-1.5">
                  <Route className="h-4 w-4 text-gold-500" aria-hidden />
                  Distance {routePts.distanceKm != null ? `${routePts.distanceKm} KM` : '—'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-[#60a5fa]" aria-hidden />
                  ETA {routePts.etaMin != null ? `${routePts.etaMin} mins` : '—'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-ok-400" aria-hidden />
                  Green start · Red drop-off
                </span>
              </div>
            </>
          )}
        </section>

        {/* Quick actions */}
        <section className="card conduction-area-actions p-3 sm:p-4">
          <h2 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
            Quick Actions
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <ActionBtn tone="ok" icon={Truck} label="Add New" onClick={openCreate} disabled={busy} />
            <ActionBtn
              tone="blue"
              icon={Pencil}
              label="Edit Entry"
              onClick={() => void openEdit()}
              disabled={busy || !selected}
            />
            <ActionBtn tone="muted" icon={Trash2} label="Remove Entry" onClick={() => void removeSelected()} disabled={busy || !selected} />
            <ActionBtn tone="magenta" icon={Printer} label="Print Form" onClick={printSelected} disabled={!selected} />
            <ActionBtn tone="alert" icon={TriangleAlert} label="Cancel Schedule" onClick={() => void cancelSelected()} disabled={busy || !selected} />
            <ActionBtn tone="indigo" icon={Bell} label="Notify Team" onClick={() => void notifyTeam()} disabled={busy || !selected} />
          </div>
          {selected && selected.transportStatus !== 'Completed' && selected.transportStatus !== 'Cancelled' && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-[36px]"
                disabled={busy}
                onClick={() => void updateStatus('In Progress')}
              >
                Mark In Progress
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-[36px]"
                disabled={busy}
                onClick={() => void updateStatus('Completed')}
              >
                Complete
              </Button>
            </div>
          )}
        </section>

        {/* Weekly calendar */}
        <section className="card conduction-area-calendar flex min-h-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-navy-700 px-3 py-2.5">
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
              Weekly Calendar
            </h2>
            <span className="font-mono text-[10px] text-ink-500">{formatWeekRange(weekStart)}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto sidebar-scroll">
            <div className="grid min-w-[640px] grid-cols-[48px_repeat(7,minmax(0,1fr))]">
              <div className="sticky top-0 z-[1] border-b border-navy-800 bg-navy-900/95" />
              {weekDays.map((d) => {
                const iso = toIsoDate(d);
                const isFocus = iso === focusDate;
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => setFocusDate(iso)}
                    className={clsx(
                      'sticky top-0 z-[1] border-b border-l border-navy-800 bg-navy-900/95 px-1 py-2 text-center',
                      isFocus && 'bg-[#3b82f6]/10'
                    )}
                  >
                    <p className="font-mono text-[10px] uppercase text-ink-500">
                      {d.toLocaleDateString('en-US', { weekday: 'short' })}
                    </p>
                    <p className="text-sm font-semibold text-ink-100">{d.getDate()}</p>
                  </button>
                );
              })}
              {HOURS.map((hour) => (
                <div key={`row-${hour}`} className="contents">
                  <div className="border-b border-navy-900 px-1 py-3 text-right font-mono text-[10px] text-ink-600">
                    {hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`}
                  </div>
                  {weekDays.map((d) => {
                    const iso = toIsoDate(d);
                    const items = list.filter(
                      (s) => s.scheduledDate === iso && hourFromTime(s.scheduledTime) === hour
                    );
                    return (
                      <div key={`${iso}-${hour}`} className="min-h-[52px] border-b border-l border-navy-900 p-0.5">
                        {items.map((s) => {
                          const st = displayStatus(s);
                          return (
                            <button
                              key={s.id || s.displayId}
                              type="button"
                              onClick={() => setSelectedId(s.id || s.displayId)}
                              className={clsx(
                                'mb-0.5 w-full rounded border px-1.5 py-1 text-left text-[10px] leading-tight',
                                calendarBlockClass(st)
                              )}
                            >
                              <span className="font-mono">{(s.scheduledTime || '').slice(0, 5)}</span>
                              <span className="mt-0.5 block truncate font-semibold">{s.patientName}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-3 border-t border-navy-700 px-3 py-2 text-[10px] text-ink-400">
            {[
              ['In Progress', 'bg-gold-500'],
              ['Upcoming', 'bg-[#3b82f6]'],
              ['Scheduled', 'bg-navy-500'],
              ['Completed', 'bg-ok-500'],
              ['Canceled', 'bg-alert-500'],
            ].map(([label, dot]) => (
              <span key={label} className="inline-flex items-center gap-1.5">
                <span className={clsx('h-2 w-2 rounded-full', dot)} />
                {label}
              </span>
            ))}
          </div>
        </section>

        {/* Responder status */}
        <section className="card conduction-area-responders flex min-h-0 flex-col overflow-hidden">
          <div className="border-b border-navy-700 px-3 py-2.5">
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
              Responder Status
            </h2>
          </div>
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5 sidebar-scroll">
            {responderUnits.length === 0 ? (
              <li className="p-2 text-sm text-ink-500">No units online.</li>
            ) : (
              responderUnits.map((u) => {
                const Icon = unitIcon(u.label, u.type);
                return (
                  <li
                    key={u.id}
                    className="flex items-center gap-2.5 rounded-md border border-navy-700 bg-navy-900/40 px-2.5 py-2"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-navy-800 text-ink-100">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs font-semibold text-ink-50">{u.label}</p>
                      <p className="text-[10px] text-ink-500">{u.type || 'Fleet unit'}</p>
                    </div>
                    <StatusBadge status={u.status} className="shrink-0 text-[10px]" />
                  </li>
                );
              })
            )}
          </ul>
        </section>
      </div>

      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="max-w-3xl p-0 sm:max-w-4xl">
          <div className="border-b border-navy-700 px-5 py-4 pr-12 sm:px-6">
            <DialogHeader className="mb-0">
              <DialogTitle>{editingId ? 'Edit conduction schedule' : 'Schedule patient transport'}</DialogTitle>
              <DialogDescription>
                Search or pin pickup and destination on the map, then fill patient and trip details.
              </DialogDescription>
            </DialogHeader>
          </div>
          <DialogBody className="space-y-4 px-5 py-4 sm:px-6">
            {sameSlot.length > 0 && form.scheduledDate && (
              <p className="rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-2 text-sm text-gold-400" role="status">
                Schedule conflict warning: {sameSlot.map((s) => s.displayId).join(', ')}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1 sm:col-span-1">
                <Label htmlFor="c-patient">
                  Patient name <span className="text-alert-400">*</span>
                </Label>
                <Input
                  id="c-patient"
                  value={form.patientName}
                  onChange={(e) => setForm({ ...form, patientName: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-contact">Contact number</Label>
                <Input
                  id="c-contact"
                  type="tel"
                  value={form.contactNumber}
                  onChange={(e) => setForm({ ...form, contactNumber: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-req">Requesting person</Label>
                <Input
                  id="c-req"
                  value={form.requestingPerson}
                  onChange={(e) => setForm({ ...form, requestingPerson: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:max-w-md">
              <div className="space-y-1">
                <Label htmlFor="c-date">
                  Pickup date <span className="text-alert-400">*</span>
                </Label>
                <Input
                  id="c-date"
                  type="date"
                  value={form.scheduledDate}
                  onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-time">
                  Pickup time <span className="text-alert-400">*</span>
                </Label>
                <Input
                  id="c-time"
                  type="time"
                  value={form.pickupTime}
                  onChange={(e) => setForm({ ...form, pickupTime: e.target.value })}
                />
              </div>
            </div>

            <TransportLocationPicker
              mapHeight="260px"
              pickup={{
                address: form.originAddress,
                lat: form.originLat,
                lng: form.originLng,
              }}
              dropoff={{
                address: form.destinationAddress,
                lat: form.destLat,
                lng: form.destLng,
              }}
              onPickupChange={(next) =>
                setForm({
                  ...form,
                  originAddress: next.address,
                  originLat: next.lat,
                  originLng: next.lng,
                })
              }
              onDropoffChange={(next) =>
                setForm({
                  ...form,
                  destinationAddress: next.address,
                  destLat: next.lat,
                  destLng: next.lng,
                })
              }
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="c-veh">Assigned vehicle</Label>
                <select
                  id="c-veh"
                  className="input-field"
                  value={form.assignedVehicleId}
                  onChange={(e) => setForm({ ...form, assignedVehicleId: e.target.value })}
                >
                  <option value="">Unassigned</option>
                  {vehicles
                    .filter((v) => v.status === 'Ready' || v.status === 'Available' || v.id === form.assignedVehicleId)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.unitNo}
                      </option>
                    ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-trip">Trip type</Label>
                <select
                  id="c-trip"
                  className="input-field"
                  value={form.tripType}
                  onChange={(e) => setForm({ ...form, tripType: e.target.value })}
                >
                  <option>One-way</option>
                  <option>Round trip</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-pri">Priority</Label>
                <select
                  id="c-pri"
                  className="input-field"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                >
                  <option>Routine</option>
                  <option>Urgent</option>
                  <option>Critical</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-comp">Team / crew</Label>
              <Input
                id="c-comp"
                value={form.companion}
                onChange={(e) => setForm({ ...form, companion: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex min-h-[40px] items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.wheelchair}
                  onChange={(e) => setForm({ ...form, wheelchair: e.target.checked })}
                />
                Wheelchair required
              </label>
              <label className="flex min-h-[40px] items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.oxygen}
                  onChange={(e) => setForm({ ...form, oxygen: e.target.checked })}
                />
                Oxygen required
              </label>
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-notes">Medical / special notes</Label>
              <textarea
                id="c-notes"
                className="input-field min-h-[72px]"
                value={form.specialInstructions}
                onChange={(e) => setForm({ ...form, specialInstructions: e.target.value })}
              />
            </div>
          </DialogBody>
          <DialogFooter className="mt-0 px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" onClick={() => setComposeOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="button"
              className="min-h-[44px] min-w-[140px]"
              disabled={!formValid || saving}
              onClick={() => void saveTransport()}
            >
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Save schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-ink-500">{label}</p>
      <p className={clsx('mt-0.5 text-ink-100', mono && 'font-mono text-xs')}>{value}</p>
    </div>
  );
}

function ActionBtn({
  tone,
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  tone: 'ok' | 'blue' | 'muted' | 'magenta' | 'alert' | 'indigo';
  icon: typeof Truck;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex min-h-[52px] items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold text-ink-50 transition-opacity disabled:cursor-not-allowed disabled:opacity-40',
        tone === 'ok' && 'bg-ok-600 hover:bg-ok-500',
        tone === 'blue' && 'bg-[#2563eb] hover:bg-[#3b82f6]',
        tone === 'muted' && 'bg-navy-700 hover:bg-navy-600',
        tone === 'magenta' && 'bg-[#c026a8] hover:bg-[#db2777]',
        tone === 'alert' && 'bg-alert-600 hover:bg-alert-500',
        tone === 'indigo' && 'bg-[#1e3a8a] hover:bg-[#1d4ed8]'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="leading-tight">{label}</span>
    </button>
  );
}
