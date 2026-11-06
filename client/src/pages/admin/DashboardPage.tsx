import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LIVE } from '@/lib/liveTiming';
import { AlertTriangle, Truck, Users, MapPin, Siren } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { KpiCard } from '@/components/ui/KpiCard';
import { useAuthStore } from '@/store/authStore';
import { dashboardApi, mapApi } from '@/services/api';
import { MapView, type MapViewHandle } from '@/components/map/MapView';
import { QueryState } from '@/components/ui/QueryState';
import { DashboardLiveHeader } from '@/components/dashboard/DashboardLiveHeader';
import { ActiveIncidentsPanel } from '@/components/dashboard/ActiveIncidentsPanel';
import { UnitTrackingPanel } from '@/components/dashboard/UnitTrackingPanel';
import { RecentNotificationsPanel } from '@/components/dashboard/RecentNotificationsPanel';
import { PersonnelChartPanel } from '@/components/dashboard/PersonnelChartPanel';
import { AttendanceShiftPanel } from '@/components/dashboard/AttendanceShiftPanel';
import { DigitalDocumentationPanel } from '@/components/dashboard/DigitalDocumentationPanel';
import { OpsSectionHeader } from '@/components/ui/OpsSection';
import { buildSeparateFleet } from '@/lib/fleetMerge';
import { useLiveMapData } from '@/hooks/useLiveMapData';
import type { MapUnit } from '@/types';

export function DashboardPage() {
  const { accessToken } = useAuthStore();
  const navigate = useNavigate();
  const mapRef = useRef<MapViewHandle>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

  const statsQuery = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => dashboardApi.stats(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.warmMs,
  });

  const mapQuery = useQuery({
    queryKey: ['map-data'],
    queryFn: () => mapApi.data(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });

  const stats = statsQuery.data?.data;
  const mapData = useLiveMapData(mapQuery.data?.data);
  const activeIncidents = useMemo(() => mapData?.incidents?.slice(0, 8) ?? [], [mapData?.incidents]);
  const units = useMemo(
    () =>
      buildSeparateFleet(mapData?.units ?? [], mapData?.responders ?? []).map((r) => ({
        ...r,
        unitNo: r.kind === 'responder' ? r.fullName || r.callsign || 'Responder' : r.unitNo || r.callsign || 'Unit',
        status: r.status || r.operationalStatus || r.availabilityStatus,
      })),
    [mapData?.units, mapData?.responders]
  );

  function selectUnit(unit: MapUnit) {
    setSelectedUnitId(unit._id);
    mapRef.current?.focusUnit(unit);
  }

  const activeCount = activeIncidents.length;
  const totalIncidents = stats?.totalIncidents ?? activeCount;
  const unitsAvailable = stats?.unitsAvailable ?? 0;
  const unitsTotal = Math.max(unitsAvailable + (stats?.unitsOnScene ?? 0), units.length, unitsAvailable);
  const onScene = stats?.unitsOnScene ?? 0;
  const onDuty = stats?.personnelOnDuty ?? 0;
  const mapBusy = mapQuery.isLoading && !mapData;

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1600px] space-y-4 sm:space-y-5">
      <DashboardLiveHeader />

      <QueryState
        isLoading={statsQuery.isLoading}
        isError={statsQuery.isError}
        error={statsQuery.error as Error}
        onRetry={() => statsQuery.refetch()}
        showLastUpdated={false}
      >
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="Operations summary">
          <KpiCard
            title="Total incidents"
            value={totalIncidents}
            subtitle={`${activeCount} active`}
            icon={AlertTriangle}
            tone="alert"
          />
          <KpiCard
            title="Units available"
            value={unitsAvailable}
            subtitle={`of ${unitsTotal || '—'}`}
            icon={Truck}
            tone="gold"
          />
          <KpiCard title="On scene" value={onScene} subtitle="Units committed" icon={MapPin} tone="info" />
          <KpiCard title="Personnel on duty" value={onDuty} subtitle="Available / assigned / deployed (roster)" icon={Users} tone="ok" />
        </div>
        {(stats?.pendingSos ?? 0) > 0 ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-alert-400">
            <Siren className="h-4 w-4 shrink-0" aria-hidden="true" />
            <Link to="/admin/sos" className="font-medium underline-offset-2 hover:underline">
              {stats?.pendingSos} pending SOS report{(stats?.pendingSos ?? 0) === 1 ? '' : 's'} awaiting triage
            </Link>
          </p>
        ) : null}
      </QueryState>

      {/* Map + side rail — rail height capped to map so lists scroll */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-stretch">
        <section
          className="card flex min-h-0 min-w-0 flex-col overflow-hidden p-3 sm:p-4 lg:col-span-8 h-[min(48vh,420px)] lg:h-[min(56vh,560px)]"
          aria-labelledby="live-map-heading"
        >
          <OpsSectionHeader title="Live monitoring" href="/admin/map" linkLabel="Open full map" />
          <p className="mb-2 shrink-0 text-xs text-ink-400 sm:mb-3">Barangay Sun Valley · Parañaque · NCR context</p>
          <div className="relative min-h-0 w-full flex-1 overflow-hidden rounded-lg">
            <QueryState
              isLoading={mapBusy}
              isError={mapQuery.isError}
              error={mapQuery.error as Error}
              onRetry={() => mapQuery.refetch()}
              showLastUpdated={false}
              className="h-full min-h-[240px]"
              skeleton={<div className="h-full min-h-[240px] animate-pulse rounded-lg bg-navy-800" />}
            >
              <MapView
                ref={mapRef}
                data={mapData}
                height="100%"
                className="h-full w-full"
                focusUnitId={selectedUnitId}
                onIncidentClick={(inc) => navigate(`/admin/incidents/${inc._id}`)}
                onUnitClick={selectUnit}
                showRegionalContext
                showBoundary
                showFacilities
              />
            </QueryState>
          </div>
        </section>

        <aside className="grid min-h-0 min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-4 lg:h-[min(56vh,560px)] lg:grid-cols-1 lg:grid-rows-2 lg:overflow-hidden">
          <div className="flex min-h-0 max-h-[300px] min-w-0 overflow-hidden sm:max-h-[340px] lg:max-h-none lg:h-full">
            <ActiveIncidentsPanel
              incidents={activeIncidents}
              isLoading={mapBusy}
              isError={mapQuery.isError}
              error={mapQuery.error as Error}
              onRetry={() => mapQuery.refetch()}
            />
          </div>
          <div className="flex min-h-0 max-h-[300px] min-w-0 overflow-hidden sm:max-h-[340px] lg:max-h-none lg:h-full">
            <UnitTrackingPanel
              units={units}
              isLoading={mapBusy}
              isError={mapQuery.isError}
              error={mapQuery.error as Error}
              onRetry={() => mapQuery.refetch()}
              selectedUnitId={selectedUnitId}
              onSelectUnit={selectUnit}
            />
          </div>
        </aside>
      </div>

      {/* Bottom modules — fixed height, internal scroll */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex h-[300px] min-w-0 overflow-hidden sm:h-[320px]">
          <RecentNotificationsPanel />
        </div>
        <div className="flex h-[300px] min-w-0 overflow-hidden sm:h-[320px]">
          <DigitalDocumentationPanel />
        </div>
        <div className="flex h-[300px] min-w-0 overflow-hidden sm:h-[320px]">
          <PersonnelChartPanel />
        </div>
        <div className="flex h-[300px] min-w-0 overflow-hidden sm:h-[320px]">
          <AttendanceShiftPanel />
        </div>
      </div>
    </div>
  );
}
