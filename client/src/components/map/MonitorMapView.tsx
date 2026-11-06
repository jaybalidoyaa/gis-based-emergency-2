import { useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef, type MutableRefObject } from 'react';
import MapGL, {
  Marker,
  Popup,
  NavigationControl,
  ScaleControl,
  FullscreenControl,
  Source,
  Layer,
  type MapRef,
} from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { MapData, Incident, MapUnit, MapRoute, MapFacility } from '@/types';
import { useMapConfig } from '@/hooks/useMapConfig';
import { SUN_VALLEY_CENTER } from '@/lib/validation';
import {
  FACILITY_MARKER_META,
  getIncidentMonitorColor,
  getIncidentTypeVisual,
  getUnitTypeVisual,
  resolveUnitStatus,
} from '@/lib/opsVisuals';
import { LIVE } from '@/lib/liveTiming';
import { formatManilaTime } from '@/lib/timezone';
import { buildSeparateFleet, clusterProximityByKind, fleetDisplayName, fleetCallsign, isPersonPin } from '@/lib/fleetMerge';
import { useSmoothCoordMap } from '@/hooks/useSmoothCoordMap';
import {
  BOUNDARY_DATA,
  ncrFillLayer,
  ncrLineLayer,
  cityFillLayer,
  cityLineLayer,
  sunValleyFillLayer,
  sunValleyLineCasingLayer,
  sunValleyLineLayer,
  sunValleySectorFillLayer,
  sunValleySectorLineLayer,
  fanOverlappingPositions,
} from '@/lib/mapBoundaries';
import {
  NCR_BOUNDS,
  facilitiesToHospitalGeoJSON,
  hospitalClusterCountLayer,
  hospitalClusterLayer,
  hospitalHaloLayer,
  hospitalPointLayer,
  hospitalPopupFromProps,
  isHospitalFacility,
} from '@/lib/hospitalMapLayers';
import {
  Ambulance,
  Flame,
  Crosshair,
  Globe2,
  Hospital,
  HeartPulse,
  Landmark,
  MapPin,
  School,
  Shield,
  Siren,
  Truck,
  Droplets,
  TriangleAlert,
  User,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { MAPBOX_OPS_CONFIG, MAPBOX_OPS_STYLE } from '@/lib/mapboxStyle';
import { fetchDrivingTrafficRoutes, type ClosurePoint, type TrafficRouteOption } from '@/lib/mapDirections';
import {
  MapAlternativeRouteSource,
  MapClosureMarkers,
  MapRouteAlternativesBar,
  MapTrafficLegend,
  MapTrafficSource,
} from '@/components/map/MapTrafficOverlay';

export interface MonitorMapHandle {
  fitAll: () => void;
  locateSunValley: () => void;
  focusUnit: (unit: MapUnit) => void;
}

interface MonitorMapProps {
  data?: MapData;
  height?: string;
  className?: string;
  selectedIncidentId?: string | null;
  onIncidentClick?: (incident: Incident) => void;
  onUnitClick?: (unit: MapUnit) => void;
  showBoundary?: boolean;
  showRegionalContext?: boolean;
  showFacilities?: boolean;
  filters?: {
    incidentType?: string;
    priority?: string;
    status?: string;
    unitType?: string;
    search?: string;
    facilityCategory?: string;
  };
}

const CLOSED = new Set(['Closed', 'Resolved', 'False Alarm', 'Cancelled', 'Duplicate', 'Rejected']);

/** Person vs truck are mutually exclusive. */
function fleetMapIcon(unit: MapUnit): LucideIcon {
  if (isPersonPin(unit)) return User;
  return getUnitTypeVisual(unit).icon === 'ambulance' ? Ambulance : Truck;
}

const FACILITY_ICONS: Record<string, LucideIcon> = {
  hospital: Hospital,
  health: HeartPulse,
  police: Shield,
  fire: Flame,
  hall: Landmark,
  school: School,
  base: Siren,
  hydrant: Flame,
  water: Droplets,
  risk: TriangleAlert,
  generic: MapPin,
};

type SpeedSample = { lat: number; lng: number; at: number };
type SpeedMap = Map<string, { prev?: SpeedSample; kmh: number }>;

function haversineKm(a: SpeedSample, b: SpeedSample) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function estimateSpeeds(units: MapUnit[], store: MutableRefObject<SpeedMap>): Map<string, number> {
  const out = new Map<string, number>();
  const now = Date.now();
  for (const u of units) {
    const loc = u.currentLocation;
    if (!loc) continue;
    const sample: SpeedSample = { lat: loc.latitude, lng: loc.longitude, at: now };
    const prevEntry = store.current.get(u._id);
    let kmh = prevEntry?.kmh ?? 0;
    if (prevEntry?.prev) {
      const dtH = (sample.at - prevEntry.prev.at) / 3_600_000;
      if (dtH > 0.00005) {
        const dist = haversineKm(prevEntry.prev, sample);
        const raw = dist / dtH;
        // Smooth + clamp noise from GPS jitter
        if (raw < 160) kmh = Math.round(prevEntry.kmh * 0.35 + raw * 0.65);
      }
    }
    if ((u.status || u.operationalStatus || '').toLowerCase().includes('on scene')) kmh = 0;
    store.current.set(u._id, { prev: sample, kmh });
    out.set(u._id, kmh);
  }
  return out;
}

function circlePolygon(lng: number, lat: number, radiusM = 180, steps = 48): GeoJSON.Feature {
  const coords: [number, number][] = [];
  const latRad = (lat * Math.PI) / 180;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos(latRad);
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    coords.push([lng + (radiusM * Math.cos(a)) / mPerDegLng, lat + (radiusM * Math.sin(a)) / mPerDegLat]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] },
  };
}

function MonitorCallout({
  color,
  title,
  meta,
  status,
  Icon,
  active,
}: {
  color: string;
  title: string;
  meta: string;
  status: string;
  Icon: LucideIcon;
  active?: boolean;
}) {
  return (
    <div className={clsx('monitor-callout', active && 'monitor-callout--active')} style={{ borderColor: color }}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: `${color}33` }}>
          <Icon className="h-3.5 w-3.5" style={{ color }} strokeWidth={2.4} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold leading-tight text-ink-50">{title}</p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-ink-400">{meta}</p>
          <p className="mt-0.5 truncate text-[11px] font-medium" style={{ color }}>
            {status}
          </p>
        </div>
      </div>
    </div>
  );
}

function ClusterUnitsCallout({
  color,
  members,
  Icon,
  kind,
}: {
  color: string;
  members: MapUnit[];
  Icon: LucideIcon;
  kind: 'vehicle' | 'responder';
}) {
  return (
    <div className={clsx('monitor-callout', 'monitor-callout--table')} style={{ borderColor: color }}>
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: `${color}33` }}>
          <Icon className="h-3.5 w-3.5" style={{ color }} strokeWidth={2.4} aria-hidden />
        </span>
        <p className="text-[12px] font-semibold leading-tight text-ink-50">
          {kind === 'responder' ? `${members.length} responders` : `${members.length} units`}
        </p>
      </div>
      <table className="monitor-unit-table mt-1.5 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-navy-600/80">
            <th className="pb-1 pr-2 font-mono text-[9px] font-semibold uppercase tracking-wide text-ink-500">
              {kind === 'responder' ? 'Name' : 'Unit'}
            </th>
            <th className="pb-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-ink-500">Status</th>
          </tr>
        </thead>
        <tbody>
          {members.map((u) => {
            const label = fleetDisplayName(u);
            const callsign = fleetCallsign(u);
            const st = resolveUnitStatus(u.status || u.operationalStatus || u.availabilityStatus);
            return (
              <tr key={u._id} className="border-b border-navy-700/50 last:border-0">
                <td className="py-1 pr-2 align-top">
                  <span className="block font-mono text-[10px] font-medium text-ink-100">{label}</span>
                  {kind === 'responder' && callsign && callsign.toUpperCase() !== label.toUpperCase() && (
                    <span className="block font-mono text-[9px] text-ink-500">{callsign}</span>
                  )}
                </td>
                <td className="py-1 align-top text-[10px] font-medium" style={{ color }}>
                  {st.label}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FacilityCallout({
  color,
  facility,
  categoryLabel,
  Icon,
}: {
  color: string;
  facility: MapFacility;
  categoryLabel: string;
  Icon: LucideIcon;
}) {
  const lines = [
    facility.address,
    facility.contactNumber ? `Tel ${facility.contactNumber}` : null,
    facility.operatingHours ? `Hours ${facility.operatingHours}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className={clsx('monitor-callout', 'monitor-callout--facility')} style={{ borderColor: color }}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: `${color}33` }}>
          <Icon className="h-3.5 w-3.5" style={{ color }} strokeWidth={2.4} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold leading-tight text-ink-50">{facility.name || categoryLabel}</p>
          <p className="mt-0.5 font-mono text-[10px] text-ink-400">{categoryLabel}</p>
          {lines.map((line) => (
            <p key={line} className="mt-0.5 text-[10px] leading-snug text-ink-300">
              {line}
            </p>
          ))}
          {facility.verificationStatus && (
            <p className="mt-1 text-[10px] font-medium capitalize" style={{ color }}>
              {facility.verificationStatus.replace(/_/g, ' ')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function IncidentPin({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <div className="relative flex h-10 w-10 items-center justify-center">
      {pulse && (
        <>
          <span className="monitor-pulse" style={{ borderColor: color }} />
          <span className="monitor-pulse monitor-pulse--delay" style={{ borderColor: color }} />
        </>
      )}
      <span
        className="relative z-[1] flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink-50 shadow-lg"
        style={{ background: color }}
      >
        <span className="h-2 w-2 rounded-full bg-ink-50" />
      </span>
    </div>
  );
}


export const MonitorMapView = forwardRef<MonitorMapHandle, MonitorMapProps>(function MonitorMapView(
  {
    data,
    height = '100%',
    className,
    selectedIncidentId,
    onIncidentClick,
    onUnitClick,
    showBoundary = true,
    showRegionalContext = true,
    showFacilities = true,
    filters,
  },
  ref
) {
  const { data: config, isLoading, isError, refetch } = useMapConfig();
  const mapRef = useRef<MapRef>(null);
  const userInteracted = useRef(false);
  const initialFitDone = useRef(false);
  const speedStore = useRef<SpeedMap>(new Map());
  const [speeds, setSpeeds] = useState<Map<string, number>>(new Map());
  const [openPopup, setOpenPopup] = useState<string | null>(null);
  const [hospitalPopup, setHospitalPopup] = useState<{ lng: number; lat: number; title: string; body: string } | null>(null);
  const [showHospitals, setShowHospitals] = useState(true);
  const [mapRuntimeError, setMapRuntimeError] = useState<string | null>(null);
  const [routeEta, setRouteEta] = useState<Map<string, { minutes: number; color: string }>>(new Map());
  const [routeCollection, setRouteCollection] = useState<GeoJSON.FeatureCollection>({
    type: 'FeatureCollection',
    features: [],
  });
  const [waypointCollection, setWaypointCollection] = useState<GeoJSON.FeatureCollection>({
    type: 'FeatureCollection',
    features: [],
  });
  const [altOptions, setAltOptions] = useState<TrafficRouteOption[]>([]);
  const [altSelected, setAltSelected] = useState(0);
  const [closurePoints, setClosurePoints] = useState<ClosurePoint[]>([]);

  const incidents = useMemo(() => {
    return (data?.incidents ?? []).filter((inc) => {
      if (CLOSED.has(inc.status)) return false;
      if (filters?.incidentType && inc.incidentTypeId?.typeName !== filters.incidentType) return false;
      if (filters?.priority && inc.priorityLevel !== filters.priority) return false;
      if (filters?.status && inc.status !== filters.status) return false;
      if (filters?.search) {
        const q = filters.search.toLowerCase();
        const hay = `${inc.displayId} ${inc.description ?? ''} ${inc.locationId?.addressText ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data?.incidents, filters]);

  const units = useMemo(() => {
    return (data?.units ?? []).filter((unit) => {
      if (filters?.unitType && unit.vehicleType !== filters.unitType) return false;
      return !!unit.currentLocation;
    });
  }, [data?.units, filters?.unitType]);

  const responders = useMemo(() => {
    return (data?.responders ?? []).filter((r) => !!r.currentLocation);
  }, [data?.responders]);

  /** Vehicles (truck) and active responders (person) — never merged across kinds. */
  const fleet = useMemo(() => buildSeparateFleet(units, responders), [units, responders]);

  /** Same-kind proximity clusters: nearby → table blip; outliers → own blip. */
  const fleetClusters = useMemo(() => clusterProximityByKind(fleet, 50), [fleet]);

  const fleetTargets = useMemo(
    () =>
      fleetClusters.map((c) => ({
        id: `${c.kind}:${c.members.map((m) => m._id).join('.')}`,
        lat: c.lat,
        lng: c.lng,
      })),
    [fleetClusters]
  );
  const smoothFleet = useSmoothCoordMap(fleetTargets, 1000);

  const facilities = useMemo(() => {
    if (!showFacilities) return [];
    const raw = (data?.facilities ?? [])
      .filter((f) => {
        if (filters?.facilityCategory && f.category !== filters.facilityCategory) return false;
        if (isHospitalFacility(f)) return false;
        return !!f.currentLocation;
      })
      .map((f) => ({
        f,
        lat: f.currentLocation!.latitude,
        lng: f.currentLocation!.longitude,
      }));
    return fanOverlappingPositions(raw);
  }, [data?.facilities, showFacilities, filters?.facilityCategory]);

  const hospitalCollection = useMemo(() => {
    if (!showFacilities || !showHospitals) return { type: 'FeatureCollection' as const, features: [] };
    if (filters?.facilityCategory && filters.facilityCategory !== 'Hospital') {
      return { type: 'FeatureCollection' as const, features: [] };
    }
    return facilitiesToHospitalGeoJSON(data?.facilities ?? []);
  }, [data?.facilities, showFacilities, showHospitals, filters?.facilityCategory]);

  const hospitalCount = useMemo(
    () => (data?.facilities ?? []).filter((f) => isHospitalFacility(f) && f.currentLocation).length,
    [data?.facilities]
  );

  const floodAreas = useMemo(() => {
    const features = incidents
      .filter((i) => i.locationId && /flood|inundat/i.test(i.incidentTypeId?.typeName ?? ''))
      .map((i) => circlePolygon(i.locationId!.longitude, i.locationId!.latitude, 220));
    return { type: 'FeatureCollection' as const, features };
  }, [incidents]);

  const incidentById = useMemo(() => new Map(incidents.map((i) => [i._id, i])), [incidents]);

  const routesSignature = useMemo(() => {
    const routes = data?.routes ?? [];
    return routes
      .map(
        (r) =>
          `${r.id}:${r.status}:${r.from.lat.toFixed(5)},${r.from.lng.toFixed(5)}>${r.to.lat.toFixed(5)},${r.to.lng.toFixed(5)}`
      )
      .join('|');
  }, [data?.routes]);

  // Live speed from GPS deltas
  useEffect(() => {
    setSpeeds(estimateSpeeds(fleet, speedStore));
  }, [fleet, data]);

  // Build colored road routes unit → scene (only when route geometry inputs change)
  useEffect(() => {
    const routes = data?.routes ?? [];
    const token = config?.mapboxToken;
    if (!routes.length) {
      setRouteCollection({ type: 'FeatureCollection', features: [] });
      setWaypointCollection({ type: 'FeatureCollection', features: [] });
      setRouteEta(new Map());
      setAltOptions([]);
      setClosurePoints([]);
      return;
    }

    let cancelled = false;

    async function build(routesIn: MapRoute[]) {
      const lines: GeoJSON.Feature[] = [];
      const points: GeoJSON.Feature[] = [];
      const eta = new Map<string, { minutes: number; color: string }>();
      const allClosures: ClosurePoint[] = [];
      let alternatives: TrafficRouteOption[] = [];

      await Promise.all(
        routesIn.map(async (route, routeIdx) => {
          const unitVisual = getUnitTypeVisual({ unitNo: route.label, callsign: route.label });
          const inc = incidentById.get(route.incidentId);
          const color = unitVisual.color || getIncidentMonitorColor(inc?.incidentTypeId?.typeName, inc?.priorityLevel);
          let coords: [number, number][] = [
            [route.from.lng, route.from.lat],
            [route.to.lng, route.to.lat],
          ];
          let durationSec = 0;

          if (token) {
            try {
              const options = await fetchDrivingTrafficRoutes(token, route.from, route.to);
              const primary = options[0];
              if (primary?.coordinates.length) coords = primary.coordinates;
              durationSec = primary?.durationSeconds ?? 0;
              allClosures.push(...options.flatMap((o) => o.closures));
              if (routeIdx === 0) alternatives = options;
            } catch {
              /* straight line */
            }
          }

          if (durationSec > 0) {
            eta.set(route.incidentId, { minutes: Math.max(1, Math.round(durationSec / 60)), color });
          }

          lines.push({
            type: 'Feature',
            properties: { id: route.id, color, label: route.label, status: route.status },
            geometry: { type: 'LineString', coordinates: coords },
          });
        })
      );

      if (cancelled) return;
      setRouteCollection({ type: 'FeatureCollection', features: lines });
      setWaypointCollection({ type: 'FeatureCollection', features: points });
      setRouteEta(eta);
      setAltOptions(alternatives);
      setAltSelected(0);
      setClosurePoints(allClosures);
    }

    void build(routes);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- routesSignature captures geometry inputs
  }, [routesSignature, config?.mapboxToken]);

  // Tear down Mapbox cleanly so sidebar navigation is not blocked by a leftover WebGL/fullscreen map
  useEffect(() => {
    return () => {
      try {
        const map = mapRef.current?.getMap();
        if (map && !(map as { _removed?: boolean })._removed) map.remove();
      } catch {
        /* already removed */
      }
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, []);

  const locateSunValley = () => {
    userInteracted.current = false;
    mapRef.current?.fitBounds(
      [
        [121.023, 14.4835],
        [121.045, 14.4965],
      ],
      { padding: 48, duration: LIVE.mapFlyMs, maxZoom: 15 }
    );
  };

  const locateNcr = () => {
    userInteracted.current = false;
    mapRef.current?.fitBounds(NCR_BOUNDS, { padding: 40, duration: LIVE.mapFlyMs, maxZoom: 11.5 });
  };

  useImperativeHandle(ref, () => ({
    fitAll: () => {
      const map = mapRef.current;
      if (!map) return;
      userInteracted.current = false;
      const coords: [number, number][] = [];
      incidents.forEach((i) => i.locationId && coords.push([i.locationId.longitude, i.locationId.latitude]));
      fleet.forEach((u) => u.currentLocation && coords.push([u.currentLocation.longitude, u.currentLocation.latitude]));
      if (!coords.length) {
        locateSunValley();
        return;
      }
      const lngs = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 72, duration: LIVE.mapFlyMs, maxZoom: 16 }
      );
    },
    locateSunValley,
    focusUnit: (unit: MapUnit) => {
      const loc = unit.currentLocation;
      if (!loc || !mapRef.current) return;
      userInteracted.current = false;
      mapRef.current.flyTo({ center: [loc.longitude, loc.latitude], zoom: 16.5, duration: LIVE.mapFlyMs });
    },
  }));

  useEffect(() => {
    if (initialFitDone.current || !config?.mapboxToken) return;
    const t = window.setTimeout(() => {
      if (!userInteracted.current) locateSunValley();
      initialFitDone.current = true;
    }, 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.mapboxToken]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onHospitalPoint = (e: any) => {
      const feature = e.features?.[0];
      const info = hospitalPopupFromProps(feature?.properties as Record<string, unknown> | undefined);
      if (!info) return;
      e.originalEvent?.stopPropagation?.();
      setOpenPopup(null);
      const coords = (feature?.geometry?.coordinates as [number, number] | undefined) ?? [e.lngLat.lng, e.lngLat.lat];
      setHospitalPopup({
        lng: coords[0],
        lat: coords[1],
        title: info.title,
        body: info.body,
      });
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onHospitalCluster = (e: any) => {
      const feature = e.features?.[0];
      const clusterId = feature?.properties?.cluster_id as number | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const source = map.getSource('monitor-hospitals') as any;
      if (clusterId == null || !source?.getClusterExpansionZoom) return;
      const coords = feature?.geometry?.coordinates as [number, number] | undefined;
      source.getClusterExpansionZoom(clusterId, (err: Error | null, zoomLevel?: number) => {
        if (err || zoomLevel == null || !coords) return;
        const currentZoom = map.getZoom();
        if (zoomLevel <= currentZoom + 0.01) {
          source.getClusterLeaves(clusterId, 8, 0, (leafErr: Error | null, leaves?: GeoJSON.Feature[]) => {
            if (leafErr || !leaves?.length) return;
            const first = hospitalPopupFromProps(leaves[0].properties as Record<string, unknown>);
            if (!first) return;
            const more = leaves.length > 1 ? `\n+${leaves.length - 1} more in this cluster — zoom in` : '';
            setOpenPopup(null);
            setHospitalPopup({
              lng: coords[0],
              lat: coords[1],
              title: first.title,
              body: `${first.body}${more}`,
            });
          });
          return;
        }
        map.easeTo({ center: coords, zoom: zoomLevel });
      });
    };
    const setCursor = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const clearCursor = () => {
      map.getCanvas().style.cursor = '';
    };
    const pointLayers = ['monitor-hospital-point', 'monitor-hospital-halo'] as const;
    const clusterLayers = ['monitor-hospital-clusters', 'monitor-hospital-cluster-count'] as const;
    for (const layer of pointLayers) {
      map.on('click', layer, onHospitalPoint);
      map.on('mouseenter', layer, setCursor);
      map.on('mouseleave', layer, clearCursor);
    }
    for (const layer of clusterLayers) {
      map.on('click', layer, onHospitalCluster);
      map.on('mouseenter', layer, setCursor);
      map.on('mouseleave', layer, clearCursor);
    }
    return () => {
      for (const layer of pointLayers) {
        map.off('click', layer, onHospitalPoint);
        map.off('mouseenter', layer, setCursor);
        map.off('mouseleave', layer, clearCursor);
      }
      for (const layer of clusterLayers) {
        map.off('click', layer, onHospitalCluster);
        map.off('mouseenter', layer, setCursor);
        map.off('mouseleave', layer, clearCursor);
      }
    };
  }, [config?.mapboxToken, hospitalCollection.features.length]);

  useEffect(() => {
    if (!selectedIncidentId) return;
    const inc = incidents.find((i) => i._id === selectedIncidentId);
    if (!inc?.locationId || !mapRef.current) return;
    userInteracted.current = false;
    mapRef.current.flyTo({
      center: [inc.locationId.longitude, inc.locationId.latitude],
      zoom: 15.5,
      duration: LIVE.mapFlyMs,
    });
  }, [selectedIncidentId, incidents]);

  if (isLoading) {
    return (
      <div className={clsx('flex items-center justify-center bg-navy-950 text-sm text-ink-400', className)} style={{ height }}>
        Loading map…
      </div>
    );
  }

  if (isError || !config?.mapboxToken) {
    return (
      <div className={clsx('flex flex-col items-center justify-center gap-2 bg-navy-950 text-sm text-ink-400', className)} style={{ height }}>
        <p>Map unavailable</p>
        <button type="button" className="text-gold-400 underline" onClick={() => void refetch()}>
          Retry
        </button>
      </div>
    );
  }

  if (mapRuntimeError) {
    return (
      <div className={clsx('flex flex-col items-center justify-center gap-2 bg-navy-950 p-4 text-center text-sm', className)} style={{ height }}>
        <p className="text-alert-400">Map failed to load</p>
        <p className="max-w-sm text-xs text-ink-400">{mapRuntimeError}</p>
        <p className="text-[11px] text-ink-500">If you just updated the app, hard-refresh this tab to clear a stale cache.</p>
        <button
          type="button"
          className="text-gold-400 underline"
          onClick={() => {
            setMapRuntimeError(null);
            void refetch();
          }}
        >
          Retry map
        </button>
      </div>
    );
  }

  return (
    <div className={clsx('monitor-map relative overflow-hidden rounded-lg', className)} style={{ height }}>
      <MapGL
        ref={mapRef}
        mapboxAccessToken={config.mapboxToken}
        initialViewState={{
          longitude: SUN_VALLEY_CENTER.lng,
          latitude: SUN_VALLEY_CENTER.lat,
          zoom: 14.2,
        }}
        mapStyle={MAPBOX_OPS_STYLE}
        config={MAPBOX_OPS_CONFIG}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
        interactiveLayerIds={[
          'monitor-hospital-point',
          'monitor-hospital-halo',
          'monitor-hospital-clusters',
          'monitor-hospital-cluster-count',
        ]}
        onError={(e) => {
          const msg = (e?.error as Error | undefined)?.message || 'Mapbox style or assets failed to load';
          setMapRuntimeError(msg);
        }}
        onClick={(e) => {
          const hitHospital = e.features?.some((f) => String(f.layer?.id ?? '').includes('hospital'));
          if (hitHospital) return;
          setOpenPopup(null);
          setHospitalPopup(null);
        }}
        onDragStart={() => {
          userInteracted.current = true;
        }}
        onZoomStart={() => {
          userInteracted.current = true;
        }}
      >
        <MapTrafficSource idPrefix="monitor" />
        {showRegionalContext && (
          <>
            <Source id="monitor-ncr" type="geojson" data={BOUNDARY_DATA.ncr}>
              <Layer {...ncrFillLayer('monitor')} />
              <Layer {...ncrLineLayer('monitor')} />
            </Source>
            <Source id="monitor-paranaque" type="geojson" data={BOUNDARY_DATA.paranaque}>
              <Layer {...cityFillLayer('monitor')} />
              <Layer {...cityLineLayer('monitor')} />
            </Source>
          </>
        )}

        {showBoundary && (
          <Source id="monitor-sun-valley" type="geojson" data={BOUNDARY_DATA.sunValley}>
            <Layer {...sunValleyFillLayer('monitor')} />
            <Layer {...sunValleyLineCasingLayer('monitor')} />
            <Layer {...sunValleyLineLayer('monitor')} />
            <Layer {...sunValleySectorFillLayer('monitor')} />
            <Layer {...sunValleySectorLineLayer('monitor')} />
          </Source>
        )}

        {hospitalCollection.features.length > 0 && (
          <Source
            id="monitor-hospitals"
            type="geojson"
            data={hospitalCollection}
            cluster
            clusterMaxZoom={13}
            clusterRadius={56}
          >
            <Layer {...hospitalClusterLayer('monitor')} />
            <Layer {...hospitalClusterCountLayer('monitor')} />
            <Layer {...hospitalHaloLayer('monitor')} />
            <Layer {...hospitalPointLayer('monitor')} />
          </Source>
        )}

        {floodAreas.features.length > 0 && (
          <Source id="monitor-flood" type="geojson" data={floodAreas}>
            <Layer
              id="monitor-flood-fill"
              type="fill"
              paint={{ 'fill-color': '#22c55e', 'fill-opacity': 0.22 }}
            />
            <Layer
              id="monitor-flood-line"
              type="line"
              paint={{ 'line-color': '#22c55e', 'line-width': 2, 'line-opacity': 0.7 }}
            />
          </Source>
        )}

        {routeCollection.features.length > 0 && (
          <Source id="monitor-routes" type="geojson" data={routeCollection}>
            <Layer
              id="monitor-routes-glow"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': ['get', 'color'],
                'line-width': 8,
                'line-opacity': 0.28,
                'line-blur': 2,
              }}
            />
            <Layer
              id="monitor-routes-line"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': ['get', 'color'],
                'line-width': 4,
                'line-opacity': 0.95,
              }}
            />
          </Source>
        )}

        {altOptions.length > 0 && (
          <MapAlternativeRouteSource idPrefix="monitor" options={altOptions} selectedIndex={altSelected} />
        )}

        {waypointCollection.features.length > 0 && (
          <Source id="monitor-waypoints" type="geojson" data={waypointCollection}>
            <Layer
              id="monitor-wp-circles"
              type="circle"
              paint={{
                'circle-radius': 4,
                'circle-color': ['get', 'color'],
                'circle-stroke-width': 1.5,
                'circle-stroke-color': '#080e16',
                'circle-opacity': 0.95,
              }}
            />
          </Source>
        )}

        <NavigationControl position="top-right" showCompass={false} />
        <FullscreenControl position="top-right" />
        <ScaleControl position="bottom-left" />

        {facilities.map(({ f, lat, lng }) => {
          const meta = FACILITY_MARKER_META[f.category ?? ''] ?? { color: '#9ca3af', label: 'Facility', icon: 'generic' as const };
          const Icon = FACILITY_ICONS[meta.icon] ?? MapPin;
          const popupKey = `fac-${f._id}`;
          const open = openPopup === popupKey;
          return (
            <Marker
              key={popupKey}
              longitude={lng}
              latitude={lat}
              anchor="bottom"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setOpenPopup((prev) => (prev === popupKey ? null : popupKey));
              }}
            >
              <button
                type="button"
                className={clsx('monitor-marker flex flex-col items-center gap-1 border-0 bg-transparent p-0', open && 'monitor-marker--open')}
                aria-expanded={open}
                aria-label={f.name ?? meta.label}
              >
                {open && (
                  <FacilityCallout color={meta.color} facility={f} categoryLabel={meta.label} Icon={Icon} />
                )}
                <div
                  className="map-facility-pin relative z-[1]"
                  aria-hidden
                >
                  <span className="map-facility-pin__badge" style={{ background: meta.color }}>
                    <Icon className="h-3 w-3 text-navy-950" strokeWidth={2.5} aria-hidden />
                  </span>
                  <span className="map-facility-pin__point" style={{ borderTopColor: meta.color }} />
                </div>
              </button>
            </Marker>
          );
        })}

        {incidents.map((inc) => {
          if (!inc.locationId) return null;
          const color = getIncidentMonitorColor(inc.incidentTypeId?.typeName, inc.priorityLevel);
          const visual = getIncidentTypeVisual(inc.incidentTypeId?.typeName);
          const Icon = visual.icon;
          const eta = routeEta.get(inc._id);
          const popupKey = `inc-${inc._id}`;
          const open = openPopup === popupKey;
          const pulse = !/on scene|resolved|closed/i.test(inc.status);
          const statusLine =
            eta && /en route|dispatched|assigned/i.test(inc.status)
              ? `${eta.minutes} mins ETA`
              : inc.status;

          return (
            <Marker
              key={popupKey}
              longitude={inc.locationId.longitude}
              latitude={inc.locationId.latitude}
              anchor="bottom"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setOpenPopup((prev) => (prev === popupKey ? null : popupKey));
                onIncidentClick?.(inc);
              }}
            >
              <button
                type="button"
                className={clsx(
                  'monitor-marker group flex flex-col items-center gap-1 border-0 bg-transparent p-0',
                  open && 'monitor-marker--open',
                  selectedIncidentId === inc._id && 'monitor-marker--selected'
                )}
                aria-expanded={open}
                aria-label={inc.displayId}
              >
                {open && (
                  <MonitorCallout
                    color={color}
                    title={inc.incidentTypeId?.typeName || inc.displayId}
                    meta={`${inc.displayId} · ${formatManilaTime(inc.reportedAt || Date.now())}`}
                    status={statusLine}
                    Icon={Icon}
                    active={selectedIncidentId === inc._id}
                  />
                )}
                <IncidentPin color={color} pulse={pulse} />
              </button>
            </Marker>
          );
        })}

        {fleetClusters.map((cluster) => {
          const primary = cluster.members[0];
          const person = cluster.kind === 'responder';
          const visual = getUnitTypeVisual(primary);
          const color = person ? '#38bdf8' : visual.color;
          const multi = cluster.members.length > 1;
          const allAmbulance =
            !person && cluster.members.every((u) => getUnitTypeVisual(u).icon === 'ambulance');
          const MarkerIcon = person ? User : allAmbulance ? Ambulance : Truck;
          const clusterId = `${cluster.kind}:${cluster.members.map((m) => m._id).join('.')}`;
          const smooth = smoothFleet.get(clusterId);
          const lng = smooth?.lng ?? cluster.lng;
          const lat = smooth?.lat ?? cluster.lat;
          const popupKey = `fleet-${clusterId}`;
          const open = openPopup === popupKey;

          if (multi) {
            return (
              <Marker
                key={popupKey}
                longitude={lng}
                latitude={lat}
                anchor="bottom"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  setOpenPopup((prev) => (prev === popupKey ? null : popupKey));
                  onUnitClick?.(primary);
                }}
              >
                <button
                  type="button"
                  className={clsx(
                    'monitor-marker flex flex-col items-center gap-1 border-0 bg-transparent p-0',
                    open && 'monitor-marker--open'
                  )}
                  aria-expanded={open}
                  aria-label={
                    person ? `${cluster.members.length} responders` : `${cluster.members.length} units`
                  }
                >
                  {open && (
                    <ClusterUnitsCallout
                      color={color}
                      members={cluster.members}
                      Icon={MarkerIcon}
                      kind={cluster.kind}
                    />
                  )}
                  <div
                    className="relative z-[1] flex h-8 w-8 items-center justify-center rounded-md border-2 border-ink-50 shadow-lg"
                    style={{ background: color }}
                  >
                    <MarkerIcon className="h-4 w-4 text-navy-950" strokeWidth={2.4} aria-hidden />
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-navy-950 px-1 font-mono text-[9px] font-bold text-gold-400 ring-1 ring-ink-50">
                      {cluster.members.length}
                    </span>
                  </div>
                </button>
              </Marker>
            );
          }

          const st = resolveUnitStatus(primary.status || primary.operationalStatus || primary.availabilityStatus);
          const kmh = speeds.get(primary._id) ?? 0;
          const speedLabel =
            /on scene/i.test(st.label) || kmh < 1 ? '0 km/h' : `${kmh.toFixed(kmh < 10 ? 1 : 0)} km/h`;
          const gpsMeta = primary.gpsStale ? 'Last known GPS' : `Live · ${speedLabel}`;
          const title = fleetDisplayName(primary);
          const callsign = fleetCallsign(primary);
          const meta =
            callsign && callsign.toUpperCase() !== title.toUpperCase()
              ? `${callsign} · ${gpsMeta}`
              : gpsMeta;
          const PinIcon = fleetMapIcon(primary);

          return (
            <Marker
              key={popupKey}
              longitude={lng}
              latitude={lat}
              anchor="bottom"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setOpenPopup((prev) => (prev === popupKey ? null : popupKey));
                onUnitClick?.(primary);
              }}
            >
              <button
                type="button"
                className={clsx(
                  'monitor-marker flex flex-col items-center gap-1 border-0 bg-transparent p-0',
                  open && 'monitor-marker--open'
                )}
                aria-expanded={open}
                aria-label={title}
              >
                {open && (
                  <MonitorCallout color={color} title={title} meta={meta} status={st.label} Icon={PinIcon} />
                )}
                <div
                  className="relative z-[1] flex h-8 w-8 items-center justify-center rounded-md border-2 border-ink-50 shadow-lg"
                  style={{ background: color }}
                >
                  <PinIcon className="h-4 w-4 text-navy-950" strokeWidth={2.4} aria-hidden />
                </div>
              </button>
            </Marker>
          );
        })}

        {hospitalPopup && (
          <Popup
            longitude={hospitalPopup.lng}
            latitude={hospitalPopup.lat}
            anchor="bottom"
            offset={14}
            onClose={() => setHospitalPopup(null)}
            closeOnClick={false}
          >
            <p className="font-semibold text-ink-50">{hospitalPopup.title}</p>
            <p className="whitespace-pre-line text-xs text-ink-300">{hospitalPopup.body}</p>
          </Popup>
        )}
        <MapClosureMarkers closures={closurePoints} />
      </MapGL>

      <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[min(100%,18rem)] flex-col gap-2">
        <div className="pointer-events-auto flex flex-wrap gap-1.5">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-navy-600 bg-navy-950/95 px-2.5 py-1.5 text-[11px] font-medium text-gold-400 shadow-sm hover:bg-navy-900"
            onClick={locateSunValley}
          >
            <Crosshair className="h-3.5 w-3.5" aria-hidden />
            Sun Valley
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-navy-600 bg-navy-950/95 px-2.5 py-1.5 text-[11px] font-medium text-ink-200 shadow-sm hover:bg-navy-900"
            onClick={locateNcr}
          >
            <Globe2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
            NCR
          </button>
          <button
            type="button"
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium shadow-sm',
              showHospitals
                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                : 'border-navy-600 bg-navy-950/95 text-ink-400 hover:bg-navy-900'
            )}
            aria-pressed={showHospitals}
            onClick={() => setShowHospitals((v) => !v)}
          >
            <Hospital className="h-3.5 w-3.5" aria-hidden />
            Hospitals {hospitalCount}
          </button>
        </div>
        <MapTrafficLegend />
        <MapRouteAlternativesBar options={altOptions} selectedIndex={altSelected} onSelect={setAltSelected} />
        <p className="pointer-events-none rounded-md border border-navy-700/80 bg-navy-950/80 px-2 py-1 text-[10px] text-ink-400">
          Green pins = NCR hospitals · traffic colors + closed-road icons on live routes
        </p>
      </div>
    </div>
  );
});
