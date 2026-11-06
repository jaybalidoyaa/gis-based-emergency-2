import { useEffect, useMemo, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import MapGL, {
  Marker,
  Popup,
  NavigationControl,
  ScaleControl,
  GeolocateControl,
  FullscreenControl,
  Source,
  Layer,
  type MapRef,
} from 'react-map-gl/mapbox';
import type { FillLayerSpecification, LineLayerSpecification } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { MapData, Incident, MapUnit } from '@/types';
import { useMapConfig } from '@/hooks/useMapConfig';
import sunValley from '@/data/sun-valley.json';
import paranaqueCity from '@/data/paranaque-city.json';
import ncrRegion from '@/data/ncr-region.json';
import { SUN_VALLEY_CENTER } from '@/lib/validation';
import { FACILITY_MARKER_META, resolveUnitStatus, getUnitTypeVisual } from '@/lib/opsVisuals';
import { BOUNDARY_COLORS, fanOverlappingPositions } from '@/lib/mapBoundaries';
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
import { Crosshair, Box, Square, Hospital, HeartPulse, Shield, Flame, Landmark, School, Siren, Droplets, TriangleAlert, MapPin, Ambulance, Truck, User, Globe2, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { LIVE } from '@/lib/liveTiming';
import { buildSeparateFleet, clusterProximityByKind, fleetDisplayName, fleetCallsign, isPersonPin } from '@/lib/fleetMerge';
import { useSmoothCoordMap } from '@/hooks/useSmoothCoordMap';
import { MAPBOX_OPS_CONFIG, MAPBOX_OPS_STYLE, MAPBOX_SATELLITE_STYLE } from '@/lib/mapboxStyle';
import { fetchDrivingTrafficRoutes, type ClosurePoint, type TrafficRouteOption } from '@/lib/mapDirections';
import {
  MapAlternativeRouteSource,
  MapClosureMarkers,
  MapRouteAlternativesBar,
  MapTrafficLegend,
  MapTrafficSource,
} from '@/components/map/MapTrafficOverlay';

export { BOUNDARY_COLORS };

type MapViewMode = '2d' | '3d';

interface MapPin {
  lat: number;
  lng: number;
  label?: string;
  draggable?: boolean;
}

export interface MapViewHandle {
  fitAll: () => void;
  locateSunValley: () => void;
  focusUnit: (unit: MapUnit) => void;
}

interface MapViewProps {
  data?: MapData;
  center?: [number, number];
  zoom?: number;
  height?: string;
  className?: string;
  selectedIncident?: Incident | null;
  focusUnitId?: string | null;
  onIncidentClick?: (incident: Incident) => void;
  onUnitClick?: (unit: MapUnit) => void;
  pin?: MapPin | null;
  onPinMove?: (lat: number, lng: number) => void;
  interactive?: boolean;
  showBoundary?: boolean;
  showRegionalContext?: boolean;
  showFacilities?: boolean;
  showTraffic?: boolean;
  mapStyleId?: 'dark' | 'streets' | 'satellite';
  /** Initial camera mode; default flat 2D. */
  defaultViewMode?: MapViewMode;
  filters?: {
    incidentType?: string;
    priority?: string;
    status?: string;
    unitType?: string;
    department?: string;
    search?: string;
    facilityCategory?: string;
  };
}

const CLOSED_MAP_STATUSES = new Set([
  'Closed',
  'Resolved',
  'False Alarm',
  'Cancelled',
  'Duplicate',
  'Rejected',
]);

const STYLE_URLS = {
  dark: MAPBOX_OPS_STYLE,
  streets: MAPBOX_OPS_STYLE,
  satellite: MAPBOX_SATELLITE_STYLE,
};

const ncrFill: FillLayerSpecification = {
  id: 'ncr-fill',
  type: 'fill',
  source: 'ncr-region',
  paint: { 'fill-color': BOUNDARY_COLORS.ncr, 'fill-opacity': 0.05 },
};

const ncrLine: LineLayerSpecification = {
  id: 'ncr-line',
  type: 'line',
  source: 'ncr-region',
  paint: {
    'line-color': BOUNDARY_COLORS.ncr,
    'line-width': 1.75,
    'line-opacity': 0.75,
    'line-dasharray': [2, 2],
  },
};

const cityFill: FillLayerSpecification = {
  id: 'paranaque-fill',
  type: 'fill',
  source: 'paranaque-city',
  paint: { 'fill-color': BOUNDARY_COLORS.paranaque, 'fill-opacity': 0.08 },
};

const cityLine: LineLayerSpecification = {
  id: 'paranaque-line',
  type: 'line',
  source: 'paranaque-city',
  paint: {
    'line-color': BOUNDARY_COLORS.paranaque,
    'line-width': 2.5,
    'line-opacity': 0.9,
  },
};

const fillLayer: FillLayerSpecification = {
  id: 'sun-valley-fill',
  type: 'fill',
  source: 'sun-valley',
  filter: ['==', ['get', 'kind'], 'barangay'],
  paint: { 'fill-color': BOUNDARY_COLORS.sunValley, 'fill-opacity': 0.045 },
};

const lineCasingLayer: LineLayerSpecification = {
  id: 'sun-valley-line-casing',
  type: 'line',
  source: 'sun-valley',
  filter: ['==', ['get', 'kind'], 'barangay'],
  paint: {
    'line-color': '#080e16',
    'line-width': 4.5,
    'line-opacity': 0.55,
  },
};

const lineLayer: LineLayerSpecification = {
  id: 'sun-valley-line',
  type: 'line',
  source: 'sun-valley',
  filter: ['==', ['get', 'kind'], 'barangay'],
  paint: {
    'line-color': BOUNDARY_COLORS.sunValley,
    'line-width': 2,
    'line-opacity': 0.92,
  },
};

const sectorFillLayer: FillLayerSpecification = {
  id: 'sun-valley-sector-fill',
  type: 'fill',
  source: 'sun-valley',
  filter: ['==', ['get', 'kind'], 'sector'],
  paint: { 'fill-color': BOUNDARY_COLORS.sector, 'fill-opacity': 0.06 },
};

const sectorLineLayer: LineLayerSpecification = {
  id: 'sun-valley-sector-line',
  type: 'line',
  source: 'sun-valley',
  filter: ['==', ['get', 'kind'], 'sector'],
  paint: {
    'line-color': BOUNDARY_COLORS.sector,
    'line-width': 1.5,
    'line-opacity': 0.85,
  },
};

function PinMarker({ color, pulse }: { color: string; pulse?: boolean; label?: string }) {
  return (
    <div className="relative flex flex-col items-center">
      {pulse && <span className="absolute inline-flex h-5 w-5 animate-ping rounded-full opacity-40" style={{ background: color }} />}
      <span className="relative h-3.5 w-3.5 rounded-full border-2 border-ink-50" style={{ background: color }} />
    </div>
  );
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

function FacilityMarker({ category }: { category?: string }) {
  const meta = FACILITY_MARKER_META[category ?? ''] ?? { color: '#9ca3af', label: 'Facility', icon: 'generic' as const };
  const Icon = FACILITY_ICONS[meta.icon] ?? MapPin;
  return (
    <div className="map-facility-pin" title={meta.label} aria-label={meta.label}>
      <span className="map-facility-pin__badge" style={{ background: meta.color }}>
        <Icon className="h-3 w-3 text-navy-950" strokeWidth={2.5} aria-hidden="true" />
      </span>
      <span className="map-facility-pin__point" style={{ borderTopColor: meta.color }} aria-hidden />
    </div>
  );
}

/** Nudge overlapping facility markers so icons don't stack. */
function fanFacilityPositions<T extends { lng: number; lat: number }>(
  items: T[],
  spacingDeg = 0.00018
): (T & { lng: number; lat: number })[] {
  return fanOverlappingPositions(items, spacingDeg);
}

const UNIT_TYPE_ICONS: Record<string, LucideIcon> = {
  fire: Truck,
  ambulance: Ambulance,
  rescue: Truck,
  fleet: Truck,
  generic: Truck,
};

/** Round coords so co-located staging pins share one map marker (~1–2 m). */
function UnitClusterMarker({
  units,
  pulse,
  personCluster,
}: {
  units: MapUnit[];
  pulse?: boolean;
  personCluster?: boolean;
}) {
  const visuals = units.map((u) => getUnitTypeVisual(u));
  const iconKeys = new Set(visuals.map((v) => v.icon));
  const primary =
    iconKeys.size === 1
      ? visuals[0]
      : { icon: 'fleet' as const, label: 'Units', color: '#e8b84a' };
  const allPeople = personCluster ?? units.every(isPersonPin);
  const Icon = allPeople ? User : UNIT_TYPE_ICONS[primary.icon] ?? Truck;
  const color = allPeople ? '#38bdf8' : primary.color;
  const count = units.length;
  const label =
    count === 1
      ? fleetDisplayName(units[0])
      : allPeople
        ? `${count} people`
        : `${count} units`;

  return (
    <div className="relative flex flex-col items-center">
      {pulse && (
        <span
          className="absolute inline-flex h-9 w-9 animate-ping rounded-md opacity-40"
          style={{ background: color }}
        />
      )}
      <div
        className="relative flex h-8 w-8 items-center justify-center rounded-md border-2 border-ink-50 shadow-md"
        style={{ background: color }}
        aria-label={label}
      >
        <Icon className="h-4 w-4 text-navy-950" strokeWidth={2.4} aria-hidden="true" />
        {count > 1 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-navy-950 px-1 font-mono text-[9px] font-bold text-gold-400 ring-1 ring-ink-50">
            {count}
          </span>
        )}
      </div>
    </div>
  );
}

export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  {
    data,
    center = [SUN_VALLEY_CENTER.lat, SUN_VALLEY_CENTER.lng],
    zoom = 14,
    height = '400px',
    className,
    selectedIncident,
    focusUnitId,
    onIncidentClick,
    onUnitClick,
    pin,
    onPinMove,
    interactive = true,
    showBoundary = true,
    showRegionalContext = true,
    showFacilities = true,
    showTraffic = true,
    mapStyleId = 'dark',
    defaultViewMode = '2d',
    filters,
  },
  ref
) {
  const { data: config, isLoading, isError, refetch } = useMapConfig();
  const mapRef = useRef<MapRef>(null);
  const [popup, setPopup] = useState<{ lng: number; lat: number; title: string; body: string } | null>(null);
  const [mapRuntimeError, setMapRuntimeError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<MapViewMode>(defaultViewMode);
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
  const userInteracted = useRef(false);
  const initialFitDone = useRef(false);
  const terrainReady = useRef(false);

  const viewCenter = useMemo(() => {
    if (pin) return { longitude: pin.lng, latitude: pin.lat };
    if (selectedIncident?.locationId) {
      return { longitude: selectedIncident.locationId.longitude, latitude: selectedIncident.locationId.latitude };
    }
    return { longitude: center[1], latitude: center[0] };
  }, [pin, selectedIncident, center]);

  useEffect(() => {
    if (userInteracted.current && !selectedIncident && !pin) return;
    mapRef.current?.flyTo({
      center: [viewCenter.longitude, viewCenter.latitude],
      zoom: selectedIncident || pin ? Math.max(zoom, 15) : zoom,
      duration: LIVE.mapFlyMs,
    });
  }, [viewCenter.latitude, viewCenter.longitude, selectedIncident, pin, zoom]);

  useEffect(() => {
    if (!focusUnitId || !data?.units) return;
    const unit = [...(data.units ?? []), ...(data.responders ?? [])].find((u) => u._id === focusUnitId);
    const loc = unit?.currentLocation;
    if (!loc) return;
    userInteracted.current = false;
    mapRef.current?.flyTo({ center: [loc.longitude, loc.latitude], zoom: 16, duration: LIVE.mapFlyMs });
  }, [focusUnitId, data?.units, data?.responders]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const applyMode = () => {
      if (viewMode === '3d') {
        if (!map.getSource('mapbox-dem')) {
          map.addSource('mapbox-dem', {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
            maxzoom: 14,
          });
        }
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.35 });
        terrainReady.current = true;
        map.easeTo({ pitch: 58, bearing: -18, duration: LIVE.mapEaseMs });
        map.dragRotate.enable();
        map.touchZoomRotate.enableRotation();
      } else {
        if (terrainReady.current) {
          map.setTerrain(null);
        }
        map.easeTo({ pitch: 0, bearing: 0, duration: LIVE.mapEaseMs });
      }
    };

    if (map.isStyleLoaded()) {
      applyMode();
    } else {
      map.once('load', applyMode);
    }
  }, [viewMode, config?.mapboxToken, mapStyleId]);

  useEffect(() => {
    terrainReady.current = false;
  }, [mapStyleId]);

  // Build response pathways + waypoints (unit → road steps → incident GPS)
  useEffect(() => {
    const routes = data?.routes ?? [];
    const token = config?.mapboxToken;
    if (!routes.length) {
      setRouteCollection({ type: 'FeatureCollection', features: [] });
      setWaypointCollection({ type: 'FeatureCollection', features: [] });
      setAltOptions([]);
      setClosurePoints([]);
      return;
    }

    let cancelled = false;

    function sampleAlong(coords: [number, number][], maxPoints = 6): [number, number][] {
      if (coords.length <= 2) return [];
      const out: [number, number][] = [];
      const step = Math.max(1, Math.floor((coords.length - 2) / maxPoints));
      for (let i = step; i < coords.length - 1; i += step) {
        out.push(coords[i]);
        if (out.length >= maxPoints) break;
      }
      return out;
    }

    async function buildRoutes() {
      const lineFeatures: GeoJSON.Feature[] = [];
      const pointFeatures: GeoJSON.Feature[] = [];
      const allClosures: ClosurePoint[] = [];
      let alternatives: TrafficRouteOption[] = [];

      await Promise.all(
        routes.map(async (route, routeIdx) => {
          let coords: [number, number][] = [
            [route.from.lng, route.from.lat],
            [route.to.lng, route.to.lat],
          ];
          let stepWaypoints: { lng: number; lat: number; label: string }[] = [];

          if (token) {
            try {
              const options = await fetchDrivingTrafficRoutes(token, route.from, route.to);
              const primary = options[0];
              if (primary?.coordinates.length) coords = primary.coordinates;
              allClosures.push(...options.flatMap((o) => o.closures));
              if (routeIdx === 0 && options.length) {
                alternatives = options;
              }
            } catch {
              /* straight-line fallback */
            }
          }

          if (!stepWaypoints.length) {
            stepWaypoints = sampleAlong(coords).map((c, i) => ({
              lng: c[0],
              lat: c[1],
              label: `Via ${i + 1}`,
            }));
          }

          lineFeatures.push({
            type: 'Feature',
            properties: {
              id: route.id,
              label: route.label,
              status: route.status,
              incidentDisplayId: route.incidentDisplayId ?? '',
            },
            geometry: { type: 'LineString', coordinates: coords },
          });

          pointFeatures.push({
            type: 'Feature',
            properties: {
              kind: 'start',
              label: route.label,
              detail: 'Dispatched unit',
              routeId: route.id,
            },
            geometry: { type: 'Point', coordinates: [route.from.lng, route.from.lat] },
          });

          stepWaypoints.forEach((wp, i) => {
            pointFeatures.push({
              type: 'Feature',
              properties: {
                kind: 'via',
                label: `WP ${i + 1}`,
                detail: wp.label,
                routeId: route.id,
              },
              geometry: { type: 'Point', coordinates: [wp.lng, wp.lat] },
            });
          });

          pointFeatures.push({
            type: 'Feature',
            properties: {
              kind: 'end',
              label: route.incidentDisplayId || 'Scene',
              detail: 'Incident GPS',
              routeId: route.id,
            },
            geometry: { type: 'Point', coordinates: [route.to.lng, route.to.lat] },
          });
        })
      );

      if (!cancelled) {
        setRouteCollection({ type: 'FeatureCollection', features: lineFeatures });
        setWaypointCollection({ type: 'FeatureCollection', features: pointFeatures });
        setAltOptions(alternatives);
        setAltSelected(0);
        setClosurePoints(allClosures);
        const map = mapRef.current;
        if (map && routes.length > 0) {
          const lngs = routes.flatMap((r) => [r.from.lng, r.to.lng]);
          const lats = routes.flatMap((r) => [r.from.lat, r.to.lat]);
          map.fitBounds(
            [
              [Math.min(...lngs), Math.min(...lats)],
              [Math.max(...lngs), Math.max(...lats)],
            ],
            { padding: 48, duration: LIVE.mapFlyMs, maxZoom: 14 }
          );
        }
      }
    }

    void buildRoutes();
    return () => {
      cancelled = true;
    };
    // Only rebuild when route endpoints change — not on every fleet GPS patch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(
      (data?.routes ?? []).map(
        (r) =>
          `${r.id}:${r.status}:${r.from.lat.toFixed(5)},${r.from.lng.toFixed(5)}>${r.to.lat.toFixed(5)},${r.to.lng.toFixed(5)}`
      )
    ),
    config?.mapboxToken,
  ]);

  useEffect(() => {
    return () => {
      try {
        const map = mapRef.current?.getMap();
        if (map && !(map as { _removed?: boolean })._removed) map.remove();
      } catch {
        /* already gone */
      }
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, []);

  const incidents = (data?.incidents ?? []).filter((inc) => {
    if (CLOSED_MAP_STATUSES.has(inc.status)) return false;
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

  const units = (data?.units ?? []).filter((unit) => {
    if (filters?.unitType && unit.vehicleType !== filters.unitType) return false;
    if (filters?.department && (unit as { department?: string }).department !== filters.department) return false;
    return true;
  });

  /** Vehicles + active responders (separate kinds). */
  const mapFleet = useMemo(() => {
    const responders = filters?.unitType ? [] : (data?.responders ?? []);
    return buildSeparateFleet(
      units.filter((u) => !!u.currentLocation),
      responders
    );
  }, [units, data?.responders, filters?.unitType]);

  /** Same-kind proximity: nearby → one blip + table; outliers keep own blip. */
  const fleetClusters = useMemo(() => clusterProximityByKind(mapFleet, 50), [mapFleet]);
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
    const wantHospitalsOnly = filters?.facilityCategory === 'Hospital';
    const raw = (data?.facilities ?? [])
      .filter((f) => {
        if (!showFacilities) return false;
        if (wantHospitalsOnly) return false; // hospitals render as GeoJSON layer
        if (filters?.facilityCategory && (f as { category?: string }).category !== filters.facilityCategory) return false;
        if (isHospitalFacility(f as { category?: string })) return false;
        const loc = (f as { currentLocation?: { latitude: number; longitude: number } }).currentLocation;
        return !!loc;
      })
      .map((f) => {
        const loc = (f as { currentLocation: { latitude: number; longitude: number } }).currentLocation;
        return {
          f,
          lat: loc.latitude,
          lng: loc.longitude,
        };
      });
    return fanFacilityPositions(raw);
  }, [data?.facilities, showFacilities, filters?.facilityCategory]);

  const hospitalCollection = useMemo(() => {
    if (!showFacilities) return { type: 'FeatureCollection' as const, features: [] };
    if (filters?.facilityCategory && filters.facilityCategory !== 'Hospital') {
      return { type: 'FeatureCollection' as const, features: [] };
    }
    return facilitiesToHospitalGeoJSON((data?.facilities ?? []) as Parameters<typeof facilitiesToHospitalGeoJSON>[0]);
  }, [data?.facilities, showFacilities, filters?.facilityCategory]);

  const hospitalCount = hospitalCollection.features.length;

  const clusterGeoJson = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: incidents
        .filter((inc) => inc.locationId)
        .map((inc) => ({
          type: 'Feature' as const,
          properties: {
            id: inc._id,
            displayId: inc.displayId,
            priority: inc.priorityLevel,
            status: inc.status,
            typeName: inc.incidentTypeId?.typeName ?? '',
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [inc.locationId!.longitude, inc.locationId!.latitude],
          },
        })),
    }),
    [incidents]
  );

  const locateSunValley = () => {
    userInteracted.current = false;
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(
      [
        [121.023, 14.4835],
        [121.045, 14.4965],
      ],
      {
        padding: 40,
        duration: LIVE.mapFlyMs,
        maxZoom: 15,
        pitch: viewMode === '3d' ? 58 : 0,
        bearing: viewMode === '3d' ? -18 : 0,
      }
    );
  };

  const locateNcr = () => {
    userInteracted.current = false;
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(NCR_BOUNDS, {
      padding: 36,
      duration: LIVE.mapFlyMs,
      maxZoom: 11.5,
      pitch: viewMode === '3d' ? 45 : 0,
      bearing: viewMode === '3d' ? -12 : 0,
    });
  };

  useImperativeHandle(ref, () => ({
    fitAll: () => {
      const map = mapRef.current;
      if (!map) return;
      userInteracted.current = false;
      const coords: [number, number][] = [];
      incidents.forEach((i) => i.locationId && coords.push([i.locationId.longitude, i.locationId.latitude]));
      units.forEach((u) => u.currentLocation && coords.push([u.currentLocation.longitude, u.currentLocation.latitude]));
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
        { padding: 48, duration: LIVE.mapFlyMs, maxZoom: 16 }
      );
    },
    locateSunValley,
    focusUnit: (unit: MapUnit) => {
      const loc = unit.currentLocation;
      if (!loc || !mapRef.current) return;
      userInteracted.current = false;
      mapRef.current.flyTo({ center: [loc.longitude, loc.latitude], zoom: 16, duration: LIVE.mapFlyMs });
      setPopup({
        lng: loc.longitude,
        lat: loc.latitude,
        title: unit.unitNo ?? unit.callsign ?? 'Unit',
        body: `${resolveUnitStatus(unit.status || unit.operationalStatus).label}${unit.gpsStale ? ' · Location outdated' : ''}`,
      });
    },
  }));

  useEffect(() => {
    if (initialFitDone.current || !config?.mapboxToken) return;
    const t = window.setTimeout(() => {
      if (!userInteracted.current) locateSunValley();
      initialFitDone.current = true;
    }, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.mapboxToken]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onClickUnclustered = (e: any) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (!id) return;
      const inc = incidents.find((i) => i._id === id);
      if (!inc) return;
      onIncidentClick?.(inc);
      setPopup({
        lng: e.lngLat.lng,
        lat: e.lngLat.lat,
        title: inc.displayId,
        body: `${inc.incidentTypeId?.typeName ?? 'Incident'} · ${inc.priorityLevel} · ${inc.status}`,
      });
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onClickCluster = (e: any) => {
      const feature = e.features?.[0];
      const clusterId = feature?.properties?.cluster_id as number | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const source = map.getSource('incidents-cluster') as any;
      if (clusterId == null || !source?.getClusterExpansionZoom) return;
      source.getClusterExpansionZoom(clusterId, (err: Error | null, zoomLevel?: number) => {
        if (err || zoomLevel == null) return;
        const coords = feature?.geometry?.coordinates as [number, number] | undefined;
        if (!coords) return;
        map.easeTo({ center: coords, zoom: zoomLevel });
      });
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openHospitalPopup = (e: any) => {
      const feature = e.features?.[0];
      const info = hospitalPopupFromProps(feature?.properties as Record<string, unknown> | undefined);
      if (!info) return;
      e.originalEvent?.stopPropagation?.();
      const coords = (feature?.geometry?.coordinates as [number, number] | undefined) ?? [e.lngLat.lng, e.lngLat.lat];
      setPopup({
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
      const source = map.getSource('map-hospitals') as any;
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
            setPopup({
              lng: coords[0],
              lat: coords[1],
              title: first.title,
              body: `${first.body}${more}`,
            });
            return;
          });
          return;
        }
        map.easeTo({ center: coords, zoom: zoomLevel });
      });
    };
    const setHospitalCursor = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const clearCursor = () => {
      map.getCanvas().style.cursor = '';
    };

    const pointLayers = ['map-hospital-point', 'map-hospital-halo'] as const;
    const clusterLayers = ['map-hospital-clusters', 'map-hospital-cluster-count'] as const;

    const bind = () => {
      map.on('click', 'unclustered-point', onClickUnclustered);
      map.on('click', 'clusters', onClickCluster);
      for (const layer of pointLayers) {
        map.on('click', layer, openHospitalPopup);
        map.on('mouseenter', layer, setHospitalCursor);
        map.on('mouseleave', layer, clearCursor);
      }
      for (const layer of clusterLayers) {
        map.on('click', layer, onHospitalCluster);
        map.on('mouseenter', layer, setHospitalCursor);
        map.on('mouseleave', layer, clearCursor);
      }
    };

    const unbind = () => {
      map.off('click', 'unclustered-point', onClickUnclustered);
      map.off('click', 'clusters', onClickCluster);
      for (const layer of pointLayers) {
        map.off('click', layer, openHospitalPopup);
        map.off('mouseenter', layer, setHospitalCursor);
        map.off('mouseleave', layer, clearCursor);
      }
      for (const layer of clusterLayers) {
        map.off('click', layer, onHospitalCluster);
        map.off('mouseenter', layer, setHospitalCursor);
        map.off('mouseleave', layer, clearCursor);
      }
    };

    bind();
    return unbind;
  }, [incidents, onIncidentClick, hospitalCount, config?.mapboxToken]);

  useEffect(() => {
    const chosen = altOptions[altSelected];
    if (!chosen?.coordinates.length) return;
    setRouteCollection((prev) => {
      if (!prev.features.length) return prev;
      const next = { ...prev, features: [...prev.features] };
      const first = next.features[0];
      if (!first || first.geometry.type !== 'LineString') return prev;
      next.features[0] = {
        ...first,
        geometry: { type: 'LineString', coordinates: chosen.coordinates },
      };
      return next;
    });
    setClosurePoints(chosen.closures);
  }, [altSelected, altOptions]);

  if (isLoading) {
    return (
      <div style={{ height }} className={clsx('flex max-w-full items-center justify-center overflow-hidden rounded-lg border border-navy-700 bg-navy-900', className)}>
        <p className="text-sm text-ink-400">Loading Mapbox…</p>
      </div>
    );
  }

  if (isError || !config?.mapboxToken) {
    return (
      <div style={{ height }} className={clsx('flex max-w-full items-center justify-center overflow-hidden rounded-lg border border-alert-500/40 bg-navy-900 p-4 text-center', className)}>
        <div>
          <p className="text-sm text-alert-400">{isError ? 'Could not load map configuration' : 'Mapbox token is not configured'}</p>
          <button type="button" className="mt-3 text-sm text-gold-500 underline" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (mapRuntimeError) {
    return (
      <div style={{ height }} className={clsx('flex max-w-full items-center justify-center overflow-hidden rounded-lg border border-alert-500/40 bg-navy-900 p-4 text-center', className)}>
        <div>
          <p className="text-sm text-alert-400">Map failed to load</p>
          <p className="mt-1 max-w-sm text-xs text-ink-400">{mapRuntimeError}</p>
          <p className="mt-2 text-[11px] text-ink-500">If you just updated the app, hard-refresh this tab to clear a stale cache.</p>
          <button
            type="button"
            className="mt-3 text-sm text-gold-500 underline"
            onClick={() => {
              setMapRuntimeError(null);
              void refetch();
            }}
          >
            Retry map
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height, maxWidth: '100%' }} className={clsx('relative w-full min-w-0 overflow-hidden rounded-lg border border-navy-700', className)}>
      <MapGL
        ref={mapRef}
        mapboxAccessToken={config.mapboxToken}
        mapStyle={STYLE_URLS[mapStyleId] || config.mapStyle || MAPBOX_OPS_STYLE}
        config={MAPBOX_OPS_CONFIG}
        initialViewState={{
          longitude: SUN_VALLEY_CENTER.lng,
          latitude: SUN_VALLEY_CENTER.lat,
          zoom,
          pitch: defaultViewMode === '3d' ? 58 : 0,
          bearing: defaultViewMode === '3d' ? -18 : 0,
        }}
        maxPitch={85}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
        scrollZoom={interactive}
        interactiveLayerIds={[
          'unclustered-point',
          'clusters',
          'map-hospital-point',
          'map-hospital-halo',
          'map-hospital-clusters',
          'map-hospital-cluster-count',
        ]}
        onError={(e) => {
          const msg = (e?.error as Error | undefined)?.message || 'Mapbox style or assets failed to load';
          setMapRuntimeError(msg);
        }}
        dragPan={interactive}
        dragRotate={viewMode === '3d'}
        pitchWithRotate={viewMode === '3d'}
        doubleClickZoom={interactive}
        onDragStart={() => {
          userInteracted.current = true;
        }}
        onZoomStart={() => {
          userInteracted.current = true;
        }}
        onPitchStart={() => {
          userInteracted.current = true;
        }}
        onRotateStart={() => {
          userInteracted.current = true;
        }}
      >
        {showTraffic ? <MapTrafficSource idPrefix="ops" /> : null}
        {showRegionalContext && (
          <>
            <Source id="ncr-region" type="geojson" data={ncrRegion as GeoJSON.FeatureCollection}>
              <Layer {...ncrFill} />
              <Layer {...ncrLine} />
            </Source>
            <Source id="paranaque-city" type="geojson" data={paranaqueCity as GeoJSON.FeatureCollection}>
              <Layer {...cityFill} />
              <Layer {...cityLine} />
            </Source>
          </>
        )}

        {showBoundary && (
          <Source id="sun-valley" type="geojson" data={sunValley as GeoJSON.FeatureCollection}>
            <Layer {...fillLayer} />
            <Layer {...lineCasingLayer} />
            <Layer {...lineLayer} />
            <Layer {...sectorFillLayer} />
            <Layer {...sectorLineLayer} />
          </Source>
        )}

        {hospitalCount > 0 && (
          <Source
            id="map-hospitals"
            type="geojson"
            data={hospitalCollection}
            cluster
            clusterMaxZoom={13}
            clusterRadius={56}
          >
            <Layer {...hospitalClusterLayer('map')} />
            <Layer {...hospitalClusterCountLayer('map')} />
            <Layer {...hospitalHaloLayer('map')} />
            <Layer {...hospitalPointLayer('map')} />
          </Source>
        )}

        {routeCollection.features.length > 0 && (
          <Source id="response-routes" type="geojson" data={routeCollection}>
            <Layer
              id="response-routes-casing"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': '#080e16',
                'line-width': 6,
                'line-opacity': 0.55,
              }}
            />
            <Layer
              id="response-routes-line"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': '#e8b84a',
                'line-width': 3,
                'line-opacity': 0.95,
                'line-dasharray': [2, 1.25],
              }}
            />
          </Source>
        )}

        {altOptions.length > 0 && (
          <MapAlternativeRouteSource idPrefix="ops" options={altOptions} selectedIndex={altSelected} />
        )}

        {waypointCollection.features.length > 0 && (
          <Source id="response-waypoints" type="geojson" data={waypointCollection}>
            <Layer
              id="response-waypoints-via"
              type="circle"
              filter={['==', ['get', 'kind'], 'via']}
              paint={{
                'circle-radius': 5,
                'circle-color': '#f0c75e',
                'circle-stroke-width': 1.5,
                'circle-stroke-color': '#080e16',
                'circle-opacity': 0.95,
              }}
            />
            <Layer
              id="response-waypoints-start"
              type="circle"
              filter={['==', ['get', 'kind'], 'start']}
              paint={{
                'circle-radius': 8,
                'circle-color': '#4fb87e',
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff',
              }}
            />
            <Layer
              id="response-waypoints-end"
              type="circle"
              filter={['==', ['get', 'kind'], 'end']}
              paint={{
                'circle-radius': 8,
                'circle-color': '#d4453a',
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff',
              }}
            />
            <Layer
              id="response-waypoints-label"
              type="symbol"
              filter={['in', ['get', 'kind'], ['literal', ['start', 'end']]]}
              layout={{
                'text-field': ['get', 'label'],
                'text-size': 11,
                'text-offset': [0, 1.35],
                'text-anchor': 'top',
              }}
              paint={{
                'text-color': '#f4f7fb',
                'text-halo-color': '#080e16',
                'text-halo-width': 1.25,
              }}
            />
          </Source>
        )}

        <Source id="incidents-cluster" type="geojson" data={clusterGeoJson} cluster clusterMaxZoom={14} clusterRadius={42}>
          <Layer
            id="clusters"
            type="circle"
            filter={['has', 'point_count']}
            paint={{
              'circle-color': '#d4453a',
              'circle-radius': ['step', ['get', 'point_count'], 16, 5, 22, 15, 28],
              'circle-opacity': 0.85,
            }}
          />
          <Layer
            id="cluster-count"
            type="symbol"
            filter={['has', 'point_count']}
            layout={{ 'text-field': '{point_count_abbreviated}', 'text-size': 12 }}
            paint={{ 'text-color': '#ffffff' }}
          />
          <Layer
            id="unclustered-point"
            type="circle"
            filter={['!', ['has', 'point_count']]}
            paint={{ 'circle-color': '#d4453a', 'circle-radius': 7, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }}
          />
        </Source>

        <NavigationControl position="top-right" visualizePitch={viewMode === '3d'} />
        <FullscreenControl position="top-right" />
        <GeolocateControl position="top-right" trackUserLocation />
        <ScaleControl position="bottom-left" />

        {fleetClusters.map((cluster) => {
          const focused = cluster.members.some((u) => u._id === focusUnitId);
          const primary = cluster.members[0];
          const person = cluster.kind === 'responder';
          const clusterId = `${cluster.kind}:${cluster.members.map((m) => m._id).join('.')}`;
          const smooth = smoothFleet.get(clusterId);
          const lng = smooth?.lng ?? cluster.lng;
          const lat = smooth?.lat ?? cluster.lat;
          return (
            <Marker
              key={`fc-${clusterId}`}
              longitude={lng}
              latitude={lat}
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                onUnitClick?.(primary);
                const lines = cluster.members.map((u) => {
                  const name = fleetDisplayName(u);
                  const callsign = fleetCallsign(u);
                  const st = resolveUnitStatus(u.status ?? u.operationalStatus ?? u.availabilityStatus).label;
                  const cs =
                    callsign && callsign.toUpperCase() !== name.toUpperCase() ? ` · ${callsign}` : '';
                  return `${name}${cs} · ${st}${u.gpsStale ? ' · outdated' : ''}`;
                });
                setPopup({
                  lng,
                  lat,
                  title:
                    cluster.members.length === 1
                      ? fleetDisplayName(primary)
                      : person
                        ? `${cluster.members.length} responders here`
                        : `${cluster.members.length} units here`,
                  body: lines.join('\n'),
                });
              }}
            >
              <UnitClusterMarker units={cluster.members} pulse={focused} personCluster={person} />
            </Marker>
          );
        })}

        {facilities.map(({ f, lat, lng }) => {
          const fac = f as {
            _id: string;
            name?: string;
            category?: string;
            address?: string;
            contactNumber?: string;
            verificationStatus?: string;
          };
          return (
            <Marker
              key={`f-${fac._id}`}
              longitude={lng}
              latitude={lat}
              anchor="bottom"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                const meta = FACILITY_MARKER_META[fac.category ?? '']?.label ?? fac.category ?? 'Facility';
                setPopup({
                  lng,
                  lat,
                  title: fac.name ?? 'Facility',
                  body: [meta, fac.address, fac.contactNumber, fac.verificationStatus ? `Verified: ${fac.verificationStatus}` : null]
                    .filter(Boolean)
                    .join(' · '),
                });
              }}
            >
              <FacilityMarker category={fac.category} />
            </Marker>
          );
        })}

        {pin && (
          <Marker longitude={pin.lng} latitude={pin.lat} draggable={!!onPinMove} onDragEnd={(e) => onPinMove?.(e.lngLat.lat, e.lngLat.lng)}>
            <PinMarker color="#f0c75e" pulse label={pin.label ?? 'Pin'} />
          </Marker>
        )}

        <MapClosureMarkers closures={closurePoints} />

        {popup && (
          <Popup longitude={popup.lng} latitude={popup.lat} anchor="bottom" onClose={() => setPopup(null)} closeOnClick offset={16}>
            <p className="font-semibold text-ink-50">{popup.title}</p>
            <p className="whitespace-pre-line text-xs text-ink-300">{popup.body}</p>
          </Popup>
        )}
      </MapGL>

      <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col gap-2">
        <button
          type="button"
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-md border border-navy-600 bg-navy-950/95 px-2.5 py-2 text-[11px] font-medium text-gold-400 shadow-sm hover:bg-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
          onClick={locateSunValley}
          aria-label="Recenter to Sun Valley"
        >
          <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
          Sun Valley
        </button>
        <button
          type="button"
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-md border border-navy-600 bg-navy-950/95 px-2.5 py-2 text-[11px] font-medium text-ink-200 shadow-sm hover:bg-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
          onClick={locateNcr}
          aria-label="Fit map to NCR hospitals"
        >
          <Globe2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
          NCR hospitals{hospitalCount > 0 ? ` (${hospitalCount})` : ''}
        </button>
        <div
          className="pointer-events-auto inline-flex overflow-hidden rounded-md border border-navy-600 bg-navy-950/95 shadow-sm"
          role="group"
          aria-label="Map view mode"
        >
          <button
            type="button"
            className={clsx(
              'inline-flex items-center gap-1.5 px-2.5 py-2 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-500',
              viewMode === '2d' ? 'bg-navy-800 text-gold-400' : 'text-ink-300 hover:bg-navy-900 hover:text-ink-100'
            )}
            aria-pressed={viewMode === '2d'}
            onClick={() => setViewMode('2d')}
          >
            <Square className="h-3.5 w-3.5" aria-hidden="true" />
            2D
          </button>
          <button
            type="button"
            className={clsx(
              'inline-flex items-center gap-1.5 border-l border-navy-600 px-2.5 py-2 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-500',
              viewMode === '3d' ? 'bg-navy-800 text-gold-400' : 'text-ink-300 hover:bg-navy-900 hover:text-ink-100'
            )}
            aria-pressed={viewMode === '3d'}
            onClick={() => setViewMode('3d')}
          >
            <Box className="h-3.5 w-3.5" aria-hidden="true" />
            3D
          </button>
        </div>
        {showTraffic ? <MapTrafficLegend /> : null}
        <MapRouteAlternativesBar options={altOptions} selectedIndex={altSelected} onSelect={setAltSelected} />
      </div>

      <div className="pointer-events-none absolute inset-0">
        {incidents.map((inc) => {
          const loc = inc.locationId;
          if (!loc) return null;
          return (
            <button
              key={`hit-${inc._id}`}
              type="button"
              className="sr-only"
              onClick={() => onIncidentClick?.(inc)}
            >
              Select {inc.displayId}
            </button>
          );
        })}
      </div>
    </div>
  );
});
