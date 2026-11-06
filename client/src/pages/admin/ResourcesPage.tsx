import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Ambulance,
  Building2,
  ChevronRight,
  Download,
  Eye,
  FileSpreadsheet,
  Filter,
  MoreHorizontal,
  Package,
  Plus,
  Radio,
  Search,
  Settings2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { resourcesApi, mapApi, settingsApi } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { QueryState } from '@/components/ui/QueryState';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MapView } from '@/components/map/MapView';
import { formatManilaDate, formatManilaTime } from '@/lib/timezone';
import { isLowStockQuantity } from '@/lib/workforceMetrics';
import { SUN_VALLEY_CENTER } from '@/lib/validation';
import clsx from 'clsx';

type TabId = 'all' | 'vehicles' | 'equipment' | 'supplies' | 'facilities' | 'comms';
type StatusFilter = 'all' | 'available' | 'deployed' | 'maintenance' | 'low' | 'oos';

interface VehicleRow {
  id?: string;
  unitNo: string;
  vehicleType: string;
  status: string;
  lat?: number | null;
  lng?: number | null;
}

interface EquipRow {
  id?: string;
  name: string;
  category: string;
  serviceability: string;
  quantity?: number;
  assignedUnit?: string;
  expirationDate?: string;
  calibrationDate?: string;
  missing?: number;
}

interface InventoryItem {
  id: string;
  name: string;
  category: TabId;
  categoryLabel: string;
  code: string;
  status: string;
  statusKind: StatusFilter;
  quantity: number | string;
  location: string;
  color: string;
  Icon: LucideIcon;
  source: 'vehicle' | 'equipment' | 'facility';
  rawVehicle?: VehicleRow;
  rawEquip?: EquipRow;
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'all', label: 'All Resources' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'supplies', label: 'Supplies' },
  { id: 'facilities', label: 'Facilities' },
  { id: 'comms', label: 'Communication Devices' },
];

const CATEGORY_META: Record<
  Exclude<TabId, 'all'>,
  { label: string; desc: string; color: string; Icon: LucideIcon }
> = {
  vehicles: { label: 'Vehicles', desc: 'Ambulances, fire & rescue units', color: '#ef4444', Icon: Ambulance },
  equipment: { label: 'Equipment', desc: 'Medical & response gear', color: '#3b82f6', Icon: Wrench },
  supplies: { label: 'Supplies', desc: 'Consumables & stock items', color: '#22c55e', Icon: Package },
  comms: { label: 'Communication Devices', desc: 'Radios and handhelds', color: '#f59e0b', Icon: Radio },
  facilities: { label: 'Facilities', desc: 'Stations, clinics & staging', color: '#a78bfa', Icon: Building2 },
};

const PAGE_SIZE = 8;

function classifyEquipCategory(category: string): Exclude<TabId, 'all' | 'vehicles' | 'facilities'> {
  const c = category.toLowerCase();
  if (/radio|comm|handheld|phone|signal/.test(c)) return 'comms';
  if (/supply|consumable|stock|ppe|bandage|oxygen|med|pharma/.test(c)) return 'supplies';
  return 'equipment';
}

function vehicleStatusKind(status: string): StatusFilter {
  const s = status.toLowerCase();
  if (/deploy|assign|en.?route|on.?scene/.test(s)) return 'deployed';
  if (/maint|service|repair/.test(s)) return 'maintenance';
  if (/out|oos|unavail/.test(s)) return 'oos';
  if (/ready|avail|standby/.test(s)) return 'available';
  return 'available';
}

function equipStatusKind(e: EquipRow): StatusFilter {
  if (e.missing || /missing/i.test(e.serviceability)) return 'oos';
  if (/maint|damaged/i.test(e.serviceability)) return 'maintenance';
  if (isLowStockQuantity(e.quantity ?? 1)) return 'low';
  if (/serviceable|ok|good|ready/i.test(e.serviceability || 'ok')) return 'available';
  return 'available';
}

function statusBadge(kind: StatusFilter) {
  const map: Record<string, string> = {
    available: 'border-ok-500/35 bg-ok-500/15 text-ok-300',
    deployed: 'border-alert-500/35 bg-alert-500/15 text-alert-300',
    maintenance: 'border-gold-500/35 bg-gold-500/15 text-gold-300',
    low: 'border-amber-500/35 bg-amber-500/15 text-amber-300',
    oos: 'border-navy-500 bg-navy-800 text-ink-400',
    all: 'border-navy-600 bg-navy-800 text-ink-300',
  };
  return map[kind] || map.all;
}

function displayStatus(kind: StatusFilter, raw: string) {
  if (kind === 'available') return 'Available';
  if (kind === 'deployed') return 'Deployed';
  if (kind === 'maintenance') return 'Maintenance';
  if (kind === 'low') return 'Low Stock';
  if (kind === 'oos') return /missing/i.test(raw) ? 'Missing' : 'Out of Service';
  return raw;
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

export function ResourcesPage() {
  const { accessToken } = useAuthStore();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>('all');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<TabId | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [mapLayers, setMapLayers] = useState({ vehicles: true, equipment: true, supplies: true, facilities: true });
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [equipOpen, setEquipOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [vehicleForm, setVehicleForm] = useState({
    unitNo: '',
    callsign: '',
    vehicleType: 'Ambulance',
    plateNumber: '',
    department: '',
    capacity: '2',
    status: 'Ready',
    notes: '',
  });
  const [equipForm, setEquipForm] = useState({ name: '', category: 'Medical', quantity: '1', serviceability: 'Serviceable' });
  const [editEquip, setEditEquip] = useState<EquipRow | null>(null);

  const vehiclesQuery = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => resourcesApi.vehicles(accessToken!),
    enabled: !!accessToken,
  });
  const equipmentQuery = useQuery({
    queryKey: ['equipment'],
    queryFn: () => resourcesApi.equipment(accessToken!),
    enabled: !!accessToken,
  });
  const mapQuery = useQuery({
    queryKey: ['map-data'],
    queryFn: () => mapApi.data(accessToken!),
    enabled: !!accessToken,
    refetchInterval: 30_000,
  });
  const auditQuery = useQuery({
    queryKey: ['audit'],
    queryFn: () => settingsApi.auditLogs(accessToken!),
    enabled: !!accessToken,
  });

  const vList = (vehiclesQuery.data?.data ?? []) as VehicleRow[];
  const eList = (equipmentQuery.data?.data ?? []) as EquipRow[];
  const facilities = ((mapQuery.data?.data as { facilities?: Array<{ id?: string; name?: string; category?: string; lat?: number; lng?: number }> })?.facilities ?? []);

  const inventory = useMemo(() => {
    const rows: InventoryItem[] = [];
    for (const v of vList) {
      const kind = vehicleStatusKind(v.status);
      rows.push({
        id: `v-${v.id || v.unitNo}`,
        name: v.unitNo,
        category: 'vehicles',
        categoryLabel: 'Vehicles',
        code: String(v.unitNo || v.id || 'UNIT').toUpperCase(),
        status: v.status,
        statusKind: kind,
        quantity: 1,
        location: v.lat != null && v.lng != null ? `${Number(v.lat).toFixed(4)}, ${Number(v.lng).toFixed(4)}` : 'Sun Valley Base',
        color: CATEGORY_META.vehicles.color,
        Icon: Ambulance,
        source: 'vehicle',
        rawVehicle: v,
      });
    }
    for (const e of eList) {
      const cat = classifyEquipCategory(e.category || '');
      const meta = CATEGORY_META[cat];
      const kind = equipStatusKind(e);
      rows.push({
        id: `e-${e.id || e.name}`,
        name: e.name,
        category: cat,
        categoryLabel: meta.label,
        code: (e.id || e.name).slice(0, 10).toUpperCase(),
        status: e.serviceability,
        statusKind: kind,
        quantity: e.quantity ?? 1,
        location: e.assignedUnit || 'Warehouse / Staging',
        color: meta.color,
        Icon: meta.Icon,
        source: 'equipment',
        rawEquip: e,
      });
    }
    for (const f of facilities) {
      rows.push({
        id: `f-${f.id || f.name}`,
        name: f.name || 'Facility',
        category: 'facilities',
        categoryLabel: 'Facilities',
        code: String(f.id || f.name || 'FAC').slice(0, 10).toUpperCase(),
        status: 'Available',
        statusKind: 'available',
        quantity: '—',
        location: f.category || 'Sun Valley',
        color: CATEGORY_META.facilities.color,
        Icon: Building2,
        source: 'facility',
      });
    }
    return rows;
  }, [vList, eList, facilities]);

  const categoryCounts = useMemo(() => {
    const counts: Record<Exclude<TabId, 'all'>, number> = {
      vehicles: 0,
      equipment: 0,
      supplies: 0,
      comms: 0,
      facilities: 0,
    };
    for (const r of inventory) {
      if (r.category !== 'all') counts[r.category as Exclude<TabId, 'all'>] += 1;
    }
    return counts;
  }, [inventory]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const activeCat = tab === 'all' ? categoryFilter : tab;
    return inventory.filter((r) => {
      if (activeCat !== 'all' && r.category !== activeCat) return false;
      if (statusFilter !== 'all' && r.statusKind !== statusFilter) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || r.location.toLowerCase().includes(q);
    });
  }, [inventory, search, tab, categoryFilter, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const pageRows = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const lowStock = useMemo(
    () =>
      inventory
        .filter((r) => r.source === 'equipment' && (r.statusKind === 'low' || isLowStockQuantity(Number(r.quantity))))
        .slice(0, 8),
    [inventory]
  );

  const statusOverview = useMemo(() => {
    const buckets = [
      { key: 'available' as const, label: 'Available', color: '#22c55e' },
      { key: 'deployed' as const, label: 'Deployed', color: '#ef4444' },
      { key: 'maintenance' as const, label: 'Maintenance', color: '#f59e0b' },
      { key: 'oos' as const, label: 'Out of Service', color: '#6b7a8d' },
      { key: 'low' as const, label: 'Low / Expired', color: '#3b82f6' },
    ];
    const counts = buckets.map((b) => inventory.filter((r) => r.statusKind === b.key).length);
    const total = inventory.length;
    const percents = roundPercents(counts, total);
    let cursor = 0;
    const stops: string[] = [];
    buckets.forEach((b, i) => {
      const next = cursor + percents[i];
      if (percents[i] > 0) stops.push(`${b.color} ${cursor}% ${next}%`);
      cursor = next;
    });
    return {
      total,
      gradient: stops.length ? `conic-gradient(${stops.join(', ')})` : 'conic-gradient(#2a3a4e 0 100%)',
      buckets: buckets.map((b, i) => ({ ...b, count: counts[i], percent: percents[i] })),
    };
  }, [inventory]);

  const utilization = useMemo(() => {
    return (Object.keys(CATEGORY_META) as Array<Exclude<TabId, 'all'>>).map((key) => {
      const items = inventory.filter((r) => r.category === key);
      const busy = items.filter((r) => r.statusKind === 'deployed' || r.statusKind === 'maintenance').length;
      const pct = items.length ? Math.round((busy / items.length) * 100) : 0;
      return { key, ...CATEGORY_META[key], pct, count: items.length };
    });
  }, [inventory]);

  const maintenance = useMemo(() => {
    const fromEquip = eList
      .filter((e) => /maint|damaged/i.test(e.serviceability) || e.calibrationDate)
      .map((e) => ({
        id: e.id || e.name,
        name: e.name,
        detail: e.serviceability || 'Inspection',
        when: e.calibrationDate ? formatManilaDate(e.calibrationDate) : 'Due soon',
        dueSoon: /maint|damaged/i.test(e.serviceability),
        Icon: Wrench,
        color: CATEGORY_META.equipment.color,
      }));
    const fromVehicles = vList
      .filter((v) => /maint|service/i.test(v.status))
      .map((v) => ({
        id: v.id || v.unitNo,
        name: v.unitNo,
        detail: 'Unit service check',
        when: 'Due soon',
        dueSoon: true,
        Icon: Ambulance,
        color: CATEGORY_META.vehicles.color,
      }));
    return [...fromEquip, ...fromVehicles].slice(0, 5);
  }, [eList, vList]);

  const activity = useMemo(() => {
    const logs = ((auditQuery.data?.data ?? []) as { action?: string; resourceType?: string; createdAt?: string }[])
      .filter((l) => /vehicle|equipment|resource|inventory|facility/i.test(`${l.action} ${l.resourceType}`))
      .slice(0, 8)
      .map((l, i) => ({
        id: `a-${i}`,
        text: `${l.action || 'Event'}${l.resourceType ? ` · ${l.resourceType}` : ''}`,
        at: l.createdAt ? formatManilaTime(l.createdAt) : '—',
        tone: /deploy|assign/i.test(l.action || '') ? 'alert' : /maint|fail|out/i.test(l.action || '') ? 'warn' : 'ok',
      }));
    if (logs.length) return logs;
    return inventory.slice(0, 6).map((r, i) => ({
      id: `f-${i}`,
      text: `${r.name} marked ${displayStatus(r.statusKind, r.status)}`,
      at: '—',
      tone: r.statusKind === 'deployed' ? 'alert' : r.statusKind === 'maintenance' ? 'warn' : 'ok',
    }));
  }, [auditQuery.data, inventory]);

  const mapCenter: [number, number] = useMemo(() => {
    const withGps = vList.find((v) => v.lat != null && v.lng != null);
    if (withGps?.lat != null && withGps?.lng != null) return [Number(withGps.lat), Number(withGps.lng)];
    return [SUN_VALLEY_CENTER.lat, SUN_VALLEY_CENTER.lng];
  }, [vList]);

  const mapPin = useMemo(() => {
    const withGps = vList.find((v) => v.lat != null && v.lng != null);
    if (withGps?.lat != null && withGps?.lng != null) {
      return { lat: Number(withGps.lat), lng: Number(withGps.lng), label: withGps.unitNo };
    }
    return { lat: SUN_VALLEY_CENTER.lat, lng: SUN_VALLEY_CENTER.lng, label: 'Base' };
  }, [vList]);

  const vehicleValid = vehicleForm.unitNo.trim().length >= 2 && vehicleForm.vehicleType.trim().length >= 2;

  function exportCsv() {
    const header = ['Name', 'Category', 'Code', 'Status', 'Quantity', 'Location'];
    const lines = filtered.map((r) =>
      [r.name, r.categoryLabel, r.code, displayStatus(r.statusKind, r.status), r.quantity, r.location]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resource-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Inventory exported');
  }

  async function saveVehicle() {
    if (!accessToken || !vehicleValid || saving) return;
    setSaving(true);
    try {
      await resourcesApi.createVehicle(accessToken, vehicleForm);
      toast.success(`${vehicleForm.unitNo} added`);
      setVehicleOpen(false);
      setVehicleForm({ unitNo: '', callsign: '', vehicleType: 'Ambulance', plateNumber: '', department: '', capacity: '2', status: 'Ready', notes: '' });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['dispatch-queue'] });
      queryClient.invalidateQueries({ queryKey: ['map-data'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add vehicle');
    } finally {
      setSaving(false);
    }
  }

  async function saveEquipment() {
    if (!accessToken || !equipForm.name.trim() || saving) return;
    setSaving(true);
    try {
      await resourcesApi.createEquipment(accessToken, { ...equipForm, quantity: Number(equipForm.quantity) || 1 });
      toast.success('Equipment added');
      setEquipOpen(false);
      setEquipForm({ name: '', category: 'Medical', quantity: '1', serviceability: 'Serviceable' });
      queryClient.invalidateQueries({ queryKey: ['equipment'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add equipment');
    } finally {
      setSaving(false);
    }
  }

  async function toggleReadiness(v: VehicleRow) {
    if (!accessToken || !v.id || saving) return;
    const isReady = v.status === 'Ready' || v.status === 'Available';
    const next = isReady ? 'Out of Service' : 'Ready';
    if (!window.confirm(`Mark ${v.unitNo} ${next}?`)) return;
    let reason = '';
    if (next === 'Out of Service') {
      reason = window.prompt(`Reason to mark ${v.unitNo} Out of Service?`) ?? '';
      if (!reason.trim()) return;
    }
    setSaving(true);
    try {
      await resourcesApi.updateVehicle(accessToken, v.id, { status: next, reason });
      toast.success(`${v.unitNo} marked ${next}`);
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['dispatch-queue'] });
      queryClient.invalidateQueries({ queryKey: ['map-data'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Readiness update failed');
    } finally {
      setSaving(false);
    }
  }

  function onQuick(action: string) {
    if (action === 'add') {
      setAddMenuOpen(true);
      return;
    }
    if (action === 'equip') {
      setEquipOpen(true);
      return;
    }
    if (action === 'vehicle') {
      setVehicleOpen(true);
      return;
    }
    if (action === 'report' || action === 'export') {
      exportCsv();
      return;
    }
    if (action === 'map') {
      window.location.assign('/admin/map');
      return;
    }
    if (action === 'low') {
      setStatusFilter('low');
      setTab('all');
      setPage(1);
      return;
    }
    if (action === 'maint') {
      setStatusFilter('maintenance');
      setTab('all');
      setPage(1);
      toast.message('Showing maintenance items', { description: 'Edit equipment or toggle vehicle readiness from the table.' });
      return;
    }
  }

  return (
    <div className="resources-page mx-auto flex w-full min-w-0 flex-col gap-4 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-ink-50 sm:text-2xl">Resource Management</h1>
          <p className="mt-0.5 text-sm text-ink-400">Manage and monitor all equipment, vehicles, supplies, and facilities</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="min-h-[44px] bg-blue-600 hover:bg-blue-500" onClick={() => setAddMenuOpen(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Add Resource
          </Button>
          <Button type="button" variant="outline" className="min-h-[44px]" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" aria-hidden />
            Export Inventory
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            onClick={() => {
              setStatusFilter((s) => (s === 'all' ? 'low' : 'all'));
              setPage(1);
            }}
          >
            <Filter className="mr-2 h-4 w-4" aria-hidden />
            Filter
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 overflow-x-auto pb-1 ops-scroll">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setCategoryFilter('all');
              setPage(1);
            }}
            className={clsx(
              'shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors',
              tab === t.id
                ? 'border-blue-500/50 bg-blue-600/30 text-blue-100'
                : 'border-navy-600 bg-navy-900/60 text-ink-400 hover:text-ink-200'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <QueryState
        isLoading={vehiclesQuery.isLoading}
        isError={vehiclesQuery.isError}
        error={vehiclesQuery.error as Error}
        onRetry={() => vehiclesQuery.refetch()}
        showLastUpdated={false}
      >
        <div className="resources-grid">
          {/* Left */}
          <aside className="resources-area-left flex min-w-0 flex-col gap-4">
            <div className="card overflow-hidden p-3 sm:p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Resource Categories</h2>
              <ul className="space-y-2">
                {(Object.keys(CATEGORY_META) as Array<Exclude<TabId, 'all'>>).map((key) => {
                  const meta = CATEGORY_META[key];
                  const Icon = meta.Icon;
                  const active = tab === key || (tab === 'all' && categoryFilter === key);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        className={clsx(
                          'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                          active ? 'border-blue-500/40 bg-blue-500/10' : 'border-navy-700 bg-navy-950/40 hover:border-navy-600'
                        )}
                        onClick={() => {
                          setTab(key);
                          setPage(1);
                        }}
                      >
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                          style={{ background: `${meta.color}22`, color: meta.color }}
                        >
                          <Icon className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-ink-50">{meta.label}</span>
                          <span className="block text-[11px] text-ink-500">{meta.desc}</span>
                          <span className="mt-0.5 block text-[11px] text-ink-400">{categoryCounts[key]} Resources</span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="card overflow-hidden p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-400">Low Stock Alerts</h2>
                <button type="button" className="text-[11px] text-blue-300 hover:underline" onClick={() => { setStatusFilter('low'); setTab('all'); setPage(1); }}>
                  View All
                </button>
              </div>
              <ul className="space-y-2">
                {lowStock.map((item) => {
                  const Icon = item.Icon;
                  const critical = typeof item.quantity === 'number' && item.quantity <= 1;
                  return (
                    <li key={item.id} className="flex items-center gap-3 rounded-lg border border-navy-800 bg-navy-950/40 px-2.5 py-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-md" style={{ background: `${item.color}22`, color: item.color }}>
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink-100">{item.name}</span>
                        <span className="text-[11px] text-ink-500">{item.quantity} remaining</span>
                      </span>
                      <span className={clsx('shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase', critical ? statusBadge('deployed') : statusBadge('low'))}>
                        {critical ? 'Critical' : 'Low Stock'}
                      </span>
                    </li>
                  );
                })}
                {lowStock.length === 0 && <li className="py-4 text-center text-sm text-ink-500">No low-stock alerts</li>}
              </ul>
            </div>

            <div className="card overflow-hidden p-3 sm:p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Resource Utilization (This Month)</h2>
              <ul className="space-y-3">
                {utilization.map((u) => (
                  <li key={u.key}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <span className="text-ink-200">{u.label}</span>
                      <span className="font-mono text-ink-400">{u.pct}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-navy-800">
                      <div className="h-full rounded-full" style={{ width: `${u.pct}%`, background: u.color }} />
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex justify-between text-[10px] text-ink-500">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>
          </aside>

          {/* Center */}
          <section className="resources-area-main flex min-w-0 flex-col gap-4">
            <div className="card overflow-hidden p-3 sm:p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-400">Resource Inventory</h2>
                <span className="text-[11px] text-ink-500">{filtered.length} resources</span>
              </div>
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden />
                  <Input
                    className="pl-9"
                    placeholder="Search resource name or ID…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
                <select
                  className="input-field sm:w-44"
                  value={tab === 'all' ? categoryFilter : tab}
                  onChange={(e) => {
                    const v = e.target.value as TabId | 'all';
                    if (tab === 'all') setCategoryFilter(v);
                    else setTab(v === 'all' ? 'all' : v);
                    setPage(1);
                  }}
                >
                  <option value="all">All Categories</option>
                  {(Object.keys(CATEGORY_META) as Array<Exclude<TabId, 'all'>>).map((k) => (
                    <option key={k} value={k}>
                      {CATEGORY_META[k].label}
                    </option>
                  ))}
                </select>
                <select
                  className="input-field sm:w-40"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as StatusFilter);
                    setPage(1);
                  }}
                >
                  <option value="all">All Status</option>
                  <option value="available">Available</option>
                  <option value="deployed">Deployed</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="low">Low Stock</option>
                  <option value="oos">Out of Service</option>
                </select>
              </div>

              <div className="overflow-x-auto ops-scroll">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-[10px] uppercase tracking-wide text-ink-500">
                    <tr className="border-b border-navy-800">
                      <th className="px-2 py-2 font-medium">Resource Name</th>
                      <th className="px-2 py-2 font-medium">Category</th>
                      <th className="px-2 py-2 font-medium">ID / Code</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                      <th className="px-2 py-2 font-medium">Qty</th>
                      <th className="px-2 py-2 font-medium">Location</th>
                      <th className="px-2 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => {
                      const Icon = r.Icon;
                      return (
                        <tr
                          key={r.id}
                          className={clsx('border-b border-navy-900/80', selectedId === r.id && 'bg-blue-500/5')}
                        >
                          <td className="px-2 py-2.5">
                            <span className="inline-flex items-center gap-2">
                              <span className="flex h-7 w-7 items-center justify-center rounded-md" style={{ background: `${r.color}22`, color: r.color }}>
                                <Icon className="h-3.5 w-3.5" aria-hidden />
                              </span>
                              <span className="font-medium text-ink-100">{r.name}</span>
                            </span>
                          </td>
                          <td className="px-2 py-2.5 text-ink-400">{r.categoryLabel}</td>
                          <td className="px-2 py-2.5 font-mono text-xs text-ink-400">{r.code}</td>
                          <td className="px-2 py-2.5">
                            <span className={clsx('inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase', statusBadge(r.statusKind))}>
                              {displayStatus(r.statusKind, r.status)}
                            </span>
                          </td>
                          <td className="px-2 py-2.5 tabular-nums text-ink-200">{r.quantity}</td>
                          <td className="max-w-[10rem] truncate px-2 py-2.5 text-ink-400">{r.location}</td>
                          <td className="px-2 py-2.5">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className="rounded p-1.5 text-ink-400 hover:bg-navy-800 hover:text-ink-100"
                                aria-label={`View ${r.name}`}
                                onClick={() => {
                                  setSelectedId(r.id);
                                  if (r.rawEquip) setEditEquip(r.rawEquip);
                                  else if (r.rawVehicle) toast.message(r.name, { description: `${r.rawVehicle.vehicleType} · ${r.rawVehicle.status}` });
                                  else toast.message(r.name, { description: r.location });
                                }}
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                              {r.rawVehicle?.id && (
                                <button
                                  type="button"
                                  className="rounded p-1.5 text-ink-400 hover:bg-navy-800 hover:text-ink-100"
                                  aria-label={`More actions for ${r.name}`}
                                  onClick={() => toggleReadiness(r.rawVehicle!)}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {pageRows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-2 py-10 text-center text-ink-500">
                          No resources match this filter
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
                <span>
                  Showing {(pageSafe - 1) * PAGE_SIZE + (filtered.length ? 1 : 0)} to{' '}
                  {Math.min(pageSafe * PAGE_SIZE, filtered.length)} of {filtered.length} resources
                </span>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(pageCount, 5) }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={clsx(
                        'min-h-8 min-w-8 rounded border px-2',
                        n === pageSafe ? 'border-blue-500/50 bg-blue-600/30 text-blue-100' : 'border-navy-700 text-ink-400 hover:bg-navy-800'
                      )}
                      onClick={() => setPage(n)}
                    >
                      {n}
                    </button>
                  ))}
                  {pageCount > 5 && (
                    <button
                      type="button"
                      className="min-h-8 rounded border border-navy-700 px-2 text-ink-400 hover:bg-navy-800"
                      onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    >
                      ›
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="card overflow-hidden p-3 sm:p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-400">Resource Location Map</h2>
                <Link to="/admin/map" className="text-[11px] text-blue-300 hover:underline">
                  View Full Map
                </Link>
              </div>
              <div className="h-[220px] overflow-hidden rounded-lg border border-navy-700 sm:h-[260px]">
                <MapView
                  data={mapQuery.data?.data}
                  height="100%"
                  center={mapCenter}
                  zoom={14}
                  interactive
                  showBoundary
                  pin={mapLayers.vehicles || mapLayers.facilities ? mapPin : undefined}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-ink-400">
                {(
                  [
                    ['vehicles', 'Vehicles', CATEGORY_META.vehicles.color],
                    ['equipment', 'Equipment', CATEGORY_META.equipment.color],
                    ['supplies', 'Supplies', CATEGORY_META.supplies.color],
                    ['facilities', 'Facilities', CATEGORY_META.facilities.color],
                  ] as const
                ).map(([key, label, color]) => (
                  <label key={key} className="inline-flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="accent-blue-500"
                      checked={mapLayers[key]}
                      onChange={(e) => setMapLayers((prev) => ({ ...prev, [key]: e.target.checked }))}
                    />
                    <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </section>

          {/* Right */}
          <aside className="resources-area-rail flex min-w-0 flex-col gap-4">
            <div className="card overflow-hidden p-3 sm:p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Resource Status Breakdown</h2>
              <div className="flex flex-col items-center gap-3">
                <div className="relative h-28 w-28" role="img" aria-label={`Total ${statusOverview.total} resources`}>
                  <div className="h-full w-full rounded-full" style={{ background: statusOverview.gradient }} />
                  <div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full bg-navy-900">
                    <span className="font-mono text-lg font-bold text-ink-50">{statusOverview.total}</span>
                    <span className="text-[9px] uppercase text-ink-500">Total</span>
                  </div>
                </div>
                <ul className="w-full space-y-1.5">
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
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Upcoming Maintenance</h2>
              <ul className="space-y-2">
                {maintenance.map((m) => {
                  const Icon = m.Icon;
                  return (
                    <li key={m.id} className="flex items-start gap-2 rounded-lg border border-navy-800 bg-navy-950/40 px-2.5 py-2">
                      <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md" style={{ background: `${m.color}22`, color: m.color }}>
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink-100">{m.name}</span>
                        <span className="block text-[11px] text-ink-500">{m.detail}</span>
                        <span className="text-[11px] text-ink-500">{m.when}</span>
                      </span>
                      <span className={clsx('shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase', m.dueSoon ? statusBadge('maintenance') : 'border-blue-500/35 bg-blue-500/15 text-blue-300')}>
                        {m.dueSoon ? 'Due Soon' : 'Scheduled'}
                      </span>
                    </li>
                  );
                })}
                {maintenance.length === 0 && <li className="py-4 text-center text-sm text-ink-500">No upcoming maintenance</li>}
              </ul>
            </div>

            <div className="card overflow-hidden p-3 sm:p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Quick Actions</h2>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Add New Resource', icon: Plus, action: 'add' },
                  { label: 'Add Vehicle', icon: Ambulance, action: 'vehicle' },
                  { label: 'Add Equipment', icon: Wrench, action: 'equip' },
                  { label: 'Generate Inventory Report', icon: FileSpreadsheet, action: 'report' },
                  { label: 'Low Stock Alerts', icon: Package, action: 'low' },
                  { label: 'Maintenance Queue', icon: Settings2, action: 'maint' },
                  { label: 'Open Live Map', icon: Building2, action: 'map' },
                  { label: 'Export CSV', icon: Download, action: 'export' },
                ].map((qa) => {
                  const Icon = qa.icon;
                  return (
                    <button
                      key={qa.label}
                      type="button"
                      className="flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-lg border border-blue-500/35 bg-navy-950/40 px-1 py-2 text-center text-[10px] text-blue-200 transition-colors hover:bg-blue-500/10"
                      onClick={() => onQuick(qa.action)}
                    >
                      <Icon className="h-4 w-4 text-blue-400" aria-hidden />
                      {qa.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="card overflow-hidden p-3 sm:p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Resource Activity Log</h2>
              <ul className="space-y-2.5">
                {activity.map((a) => (
                  <li key={a.id} className="flex gap-2 text-xs">
                    <span className="w-14 shrink-0 tabular-nums text-ink-500">{a.at}</span>
                    <span
                      className={clsx(
                        'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                        a.tone === 'ok' && 'bg-ok-400',
                        a.tone === 'alert' && 'bg-alert-400',
                        a.tone === 'warn' && 'bg-gold-400'
                      )}
                    />
                    <span className="min-w-0 text-ink-200">{a.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </QueryState>

      <Dialog open={addMenuOpen} onOpenChange={setAddMenuOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Resource</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              className="min-h-[44px]"
              onClick={() => {
                setAddMenuOpen(false);
                setVehicleOpen(true);
              }}
            >
              Add vehicle
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              onClick={() => {
                setAddMenuOpen(false);
                setEquipOpen(true);
              }}
            >
              Add equipment
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={vehicleOpen} onOpenChange={setVehicleOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto ops-scroll">
          <DialogHeader>
            <DialogTitle>Add vehicle</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="v-unit">Unit name <span className="text-alert-400">*</span></Label>
              <Input id="v-unit" required value={vehicleForm.unitNo} onChange={(e) => setVehicleForm({ ...vehicleForm, unitNo: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="v-call">Callsign</Label>
              <Input id="v-call" value={vehicleForm.callsign} onChange={(e) => setVehicleForm({ ...vehicleForm, callsign: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="v-type">Vehicle type <span className="text-alert-400">*</span></Label>
              <select id="v-type" className="input-field" required value={vehicleForm.vehicleType} onChange={(e) => setVehicleForm({ ...vehicleForm, vehicleType: e.target.value })}>
                <option>Ambulance</option>
                <option>Fire Truck</option>
                <option>Rescue</option>
                <option>Patrol</option>
                <option>Utility</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="v-plate">Plate number</Label>
              <Input id="v-plate" value={vehicleForm.plateNumber} onChange={(e) => setVehicleForm({ ...vehicleForm, plateNumber: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="v-dept">Department</Label>
              <Input id="v-dept" value={vehicleForm.department} onChange={(e) => setVehicleForm({ ...vehicleForm, department: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="v-cap">Capacity</Label>
              <Input id="v-cap" type="number" min={1} value={vehicleForm.capacity} onChange={(e) => setVehicleForm({ ...vehicleForm, capacity: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="v-notes">Notes</Label>
              <Input id="v-notes" value={vehicleForm.notes} onChange={(e) => setVehicleForm({ ...vehicleForm, notes: e.target.value })} />
            </div>
            <Button type="button" className="w-full min-h-[44px]" disabled={!vehicleValid || saving} onClick={() => void saveVehicle()}>
              {saving ? 'Saving…' : 'Save vehicle'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={equipOpen} onOpenChange={setEquipOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add equipment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="e-name">Name <span className="text-alert-400">*</span></Label>
              <Input id="e-name" required value={equipForm.name} onChange={(e) => setEquipForm({ ...equipForm, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-cat">Category</Label>
              <select id="e-cat" className="input-field" value={equipForm.category} onChange={(e) => setEquipForm({ ...equipForm, category: e.target.value })}>
                <option>Medical</option>
                <option>Supplies</option>
                <option>Communication</option>
                <option>PPE</option>
                <option>Tools</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-qty">Quantity</Label>
              <Input id="e-qty" type="number" min={1} value={equipForm.quantity} onChange={(e) => setEquipForm({ ...equipForm, quantity: e.target.value })} />
            </div>
            <Button type="button" className="w-full" disabled={!equipForm.name.trim() || saving} onClick={() => void saveEquipment()}>
              {saving ? 'Saving…' : 'Save equipment'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editEquip} onOpenChange={(v) => !v && setEditEquip(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto ops-scroll">
          <DialogHeader>
            <DialogTitle>Edit equipment</DialogTitle>
          </DialogHeader>
          {editEquip && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="ee-name">Name</Label>
                <Input id="ee-name" value={editEquip.name} onChange={(e) => setEditEquip({ ...editEquip, name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ee-qty">Quantity</Label>
                <Input
                  id="ee-qty"
                  type="number"
                  value={String(editEquip.quantity ?? 1)}
                  onChange={(e) => setEditEquip({ ...editEquip, quantity: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ee-unit">Assigned vehicle / unit</Label>
                <Input
                  id="ee-unit"
                  value={editEquip.assignedUnit ?? ''}
                  onChange={(e) => setEditEquip({ ...editEquip, assignedUnit: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ee-svc">Serviceability</Label>
                <select
                  id="ee-svc"
                  className="input-field"
                  value={editEquip.serviceability}
                  onChange={(e) => setEditEquip({ ...editEquip, serviceability: e.target.value })}
                >
                  <option>Serviceable</option>
                  <option>Damaged</option>
                  <option>Missing</option>
                  <option>Under Maintenance</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ee-exp">Expiration date</Label>
                <Input
                  id="ee-exp"
                  type="date"
                  value={editEquip.expirationDate ?? ''}
                  onChange={(e) => setEditEquip({ ...editEquip, expirationDate: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ee-cal">Inspection / calibration date</Label>
                <Input
                  id="ee-cal"
                  type="date"
                  value={editEquip.calibrationDate ?? ''}
                  onChange={(e) => setEditEquip({ ...editEquip, calibrationDate: e.target.value })}
                />
              </div>
              <label className="flex min-h-[44px] items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!editEquip.missing}
                  onChange={(e) => setEditEquip({ ...editEquip, missing: e.target.checked ? 1 : 0 })}
                />
                Mark missing / damaged inventory
              </label>
              <Button
                type="button"
                className="w-full"
                disabled={saving || !editEquip.id}
                onClick={async () => {
                  if (!accessToken || !editEquip.id) return;
                  setSaving(true);
                  try {
                    await resourcesApi.updateEquipment(accessToken, editEquip.id, {
                      name: editEquip.name,
                      quantity: editEquip.quantity,
                      assignedUnit: editEquip.assignedUnit,
                      serviceability: editEquip.serviceability,
                      expirationDate: editEquip.expirationDate,
                      calibrationDate: editEquip.calibrationDate,
                      missing: !!editEquip.missing || editEquip.serviceability === 'Missing',
                    });
                    toast.success('Equipment updated');
                    setEditEquip(null);
                    queryClient.invalidateQueries({ queryKey: ['equipment'] });
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Update failed');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
