import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, {
  Marker,
  NavigationControl,
  Source,
  Layer,
  type MapRef,
} from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapConfig } from '@/hooks/useMapConfig';
import { MAPBOX_OPS_CONFIG, MAPBOX_OPS_STYLE } from '@/lib/mapboxStyle';
import { fetchDrivingTrafficRoutes, formatDelayLabel, type TrafficRouteOption } from '@/lib/mapDirections';
import {
  MapAlternativeRouteSource,
  MapClosureMarkers,
  MapRouteAlternativesBar,
  MapTrafficLegend,
  MapTrafficSource,
} from '@/components/map/MapTrafficOverlay';
import { Box, Square, Navigation, X, LocateFixed, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import clsx from 'clsx';
import { LIVE } from '@/lib/liveTiming';

type ViewMode = '2d' | '3d';

interface GisNavigationGuideProps {
  destination: { lat: number; lng: number; label?: string };
  origin?: { lat: number; lng: number } | null;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  className?: string;
  /** Full viewport overlay (default) vs embedded panel */
  mode?: 'overlay' | 'embedded';
}

interface StepInfo {
  instruction: string;
  distanceM: number;
  durationS: number;
  location: [number, number];
}

const STYLE = MAPBOX_OPS_STYLE;

function formatDistance(m: number) {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.max(1, Math.round(m))} m`;
}

function formatEta(seconds: number) {
  const m = Math.max(1, Math.round(seconds / 60));
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return `${h}h ${rem}m`;
  }
  return `${m} min`;
}

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * GIS turn-by-turn navigation (Mapbox Directions) — shared across responder / ops maps.
 */
export function GisNavigationGuide({
  destination,
  origin: originProp,
  title = 'Navigate to scene',
  subtitle,
  onClose,
  className,
  mode = 'overlay',
}: GisNavigationGuideProps) {
  const { data: config, isLoading, isError, refetch } = useMapConfig();
  const mapRef = useRef<MapRef>(null);
  const watchId = useRef<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [userPos, setUserPos] = useState<{ lat: number; lng: number; heading?: number } | null>(
    originProp ?? null
  );
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [steps, setSteps] = useState<StepInfo[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [remainingM, setRemainingM] = useState<number | null>(null);
  const [remainingS, setRemainingS] = useState<number | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [altOptions, setAltOptions] = useState<TrafficRouteOption[]>([]);
  const [altSelected, setAltSelected] = useState(0);

  const origin = userPos ?? originProp;

  const routeGeoJson = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features:
        routeCoords.length >= 2
          ? [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: routeCoords },
              },
            ]
          : [],
    }),
    [routeCoords]
  );

  const waypointGeoJson = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];
    if (origin) {
      features.push({
        type: 'Feature',
        properties: { kind: 'start', label: 'You' },
        geometry: { type: 'Point', coordinates: [origin.lng, origin.lat] },
      });
    }
    steps.slice(1, -1).forEach((s, i) => {
      if (i % Math.max(1, Math.ceil(steps.length / 8)) !== 0) return;
      features.push({
        type: 'Feature',
        properties: { kind: 'via', label: `WP ${i + 1}` },
        geometry: { type: 'Point', coordinates: s.location },
      });
    });
    features.push({
      type: 'Feature',
      properties: { kind: 'end', label: destination.label || 'Scene' },
      geometry: { type: 'Point', coordinates: [destination.lng, destination.lat] },
    });
    return { type: 'FeatureCollection', features };
  }, [origin, steps, destination]);

  const fetchRoute = useCallback(
    async (from: { lat: number; lng: number }) => {
      if (!config?.mapboxToken) return;
      setRouteError(null);
      try {
        const options = await fetchDrivingTrafficRoutes(config.mapboxToken, from, destination);
        const route = options[0];
        if (!route?.coordinates.length) throw new Error('No driving path found');
        setAltOptions(options);
        setAltSelected(0);
        setRouteCoords(route.coordinates);
        setRemainingM(route.distanceMeters || null);
        setRemainingS(route.durationSeconds || null);
        setSteps(
          route.steps.map((s) => ({
            instruction: s.instruction,
            distanceM: s.distanceM,
            durationS: s.durationS,
            location: s.location,
          }))
        );
        setStepIndex(0);
      } catch (err) {
        setRouteError(err instanceof Error ? err.message : 'Routing failed');
        setRouteCoords([
          [from.lng, from.lat],
          [destination.lng, destination.lat],
        ]);
        setSteps([
          {
            instruction: 'Head to incident scene',
            distanceM: haversineM(from, destination),
            durationS: 0,
            location: [destination.lng, destination.lat],
          },
        ]);
      }
    },
    [config?.mapboxToken, destination]
  );

  useEffect(() => {
    const route = altOptions[altSelected];
    if (!route) return;
    setRouteCoords(route.coordinates);
    setRemainingM(route.distanceMeters || null);
    setRemainingS(route.durationSeconds || null);
    setSteps(
      route.steps.map((s) => ({
        instruction: s.instruction,
        distanceM: s.distanceM,
        durationS: s.durationS,
        location: s.location,
      }))
    );
    setStepIndex(0);
  }, [altSelected, altOptions]);

  // Acquire GPS + watch
  useEffect(() => {
    if (!navigator.geolocation) {
      setRouteError('GPS not available on this device');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading ?? undefined,
        };
        setUserPos(next);
      },
      () => {
        if (!originProp) setRouteError('Unable to read your GPS position');
      },
      { enableHighAccuracy: true, timeout: LIVE.syncMaxMs }
    );
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setUserPos({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading ?? undefined,
        });
      },
      undefined,
      { enableHighAccuracy: true, maximumAge: LIVE.gpsMs }
    );
    return () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [originProp]);

  // Fetch / refresh route when origin known
  useEffect(() => {
    if (!origin) return;
    void fetchRoute(origin);
  }, [origin?.lat, origin?.lng, fetchRoute]);

  // Advance step + remaining distance as GPS moves
  useEffect(() => {
    if (!userPos || !steps.length) return;
    let idx = stepIndex;
    while (idx < steps.length - 1) {
      const step = steps[idx];
      const dist = haversineM(userPos, { lat: step.location[1], lng: step.location[0] });
      if (dist < 35) idx += 1;
      else break;
    }
    if (idx !== stepIndex) setStepIndex(idx);
    const toScene = haversineM(userPos, destination);
    setRemainingM(toScene);
  }, [userPos, steps, stepIndex, destination]);

  // Camera follow
  useEffect(() => {
    if (!follow || !userPos || !mapRef.current) return;
    const map = mapRef.current;
    const bearing =
      viewMode === '3d' && userPos.heading != null && !Number.isNaN(userPos.heading)
        ? userPos.heading
        : map.getBearing();
    map.easeTo({
      center: [userPos.lng, userPos.lat],
      zoom: Math.max(map.getZoom(), 16),
      pitch: viewMode === '3d' ? 60 : 0,
      bearing: viewMode === '3d' ? bearing : 0,
      duration: LIVE.mapEaseMs,
    });
  }, [userPos, follow, viewMode]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.easeTo({ pitch: viewMode === '3d' ? 60 : 0, bearing: viewMode === '3d' ? map.getBearing() : 0, duration: LIVE.mapEaseMs });
  }, [viewMode]);

  const currentStep = steps[stepIndex] ?? steps[0];
  const shellClass =
    mode === 'overlay'
      ? 'fixed inset-0 z-[80] flex flex-col bg-navy-950'
      : 'relative flex h-full min-h-[420px] flex-col overflow-hidden rounded-lg border border-navy-700 bg-navy-950';

  if (isLoading) {
    return (
      <div className={clsx(shellClass, className)}>
        <div className="flex flex-1 items-center justify-center text-sm text-ink-400">Loading GIS map…</div>
      </div>
    );
  }

  if (isError || !config?.mapboxToken) {
    return (
      <div className={clsx(shellClass, 'items-center justify-center gap-3 p-6', className)}>
        <p className="text-sm text-alert-400">Mapbox GIS config unavailable</p>
        <Button type="button" variant="outline" onClick={() => refetch()}>
          Retry
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className={clsx(shellClass, className)} role="dialog" aria-label={title}>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-navy-700 bg-navy-900/95 px-3 py-3 sm:px-4">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold-500">GIS navigation</p>
          <h2 className="truncate text-base font-bold text-ink-50 sm:text-lg">{title}</h2>
          {subtitle ? <p className="truncate text-xs text-ink-400">{subtitle}</p> : null}
        </div>
        <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={onClose} aria-label="Close navigation">
          <X className="h-5 w-5" />
        </Button>
      </header>

      {currentStep && (
        <div className="shrink-0 border-b border-navy-700 bg-navy-900 px-3 py-3 sm:px-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gold-500/20 text-gold-400">
              <Navigation className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-50 sm:text-base">{currentStep.instruction}</p>
              <p className="mt-1 font-mono text-xs text-ink-400">
                {formatDistance(currentStep.distanceM)}
                {remainingM != null ? ` · ${formatDistance(remainingM)} remaining` : ''}
                {remainingS != null ? ` · ETA ${formatEta(remainingS)}` : ''}
                {altOptions[altSelected] ? ` · ${formatDelayLabel(altOptions[altSelected].delaySeconds)}` : ''}
              </p>
            </div>
            <Volume2 className="hidden h-4 w-4 shrink-0 text-ink-500 sm:block" aria-hidden="true" />
          </div>
          {routeError ? <p className="mt-2 text-xs text-gold-400">{routeError}</p> : null}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <Map
          ref={mapRef}
          mapboxAccessToken={config.mapboxToken}
          mapStyle={STYLE}
          config={MAPBOX_OPS_CONFIG}
          initialViewState={{
            longitude: origin?.lng ?? destination.lng,
            latitude: origin?.lat ?? destination.lat,
            zoom: 15,
            pitch: 0,
          }}
          maxPitch={85}
          style={{ width: '100%', height: '100%' }}
          attributionControl={false}
          onDragStart={() => setFollow(false)}
        >
          <MapTrafficSource idPrefix="nav" />
          {altOptions.length > 1 ? (
            <MapAlternativeRouteSource idPrefix="nav" options={altOptions} selectedIndex={altSelected} />
          ) : routeGeoJson.features.length > 0 ? (
            <Source id="nav-route" type="geojson" data={routeGeoJson}>
              <Layer
                id="nav-route-casing"
                type="line"
                layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                paint={{ 'line-color': '#080e16', 'line-width': 10, 'line-opacity': 0.7 }}
              />
              <Layer
                id="nav-route-line"
                type="line"
                layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                paint={{ 'line-color': '#3b82f6', 'line-width': 5, 'line-opacity': 0.95 }}
              />
            </Source>
          ) : null}

          <Source id="nav-waypoints" type="geojson" data={waypointGeoJson}>
            <Layer
              id="nav-wp-via"
              type="circle"
              filter={['==', ['get', 'kind'], 'via']}
              paint={{
                'circle-radius': 5,
                'circle-color': '#f0c75e',
                'circle-stroke-width': 1.5,
                'circle-stroke-color': '#080e16',
              }}
            />
            <Layer
              id="nav-wp-end"
              type="circle"
              filter={['==', ['get', 'kind'], 'end']}
              paint={{
                'circle-radius': 9,
                'circle-color': '#d4453a',
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff',
              }}
            />
          </Source>

          {userPos && (
            <Marker longitude={userPos.lng} latitude={userPos.lat} anchor="center">
              <span className="relative flex h-5 w-5 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400/40" />
                <span className="relative h-3.5 w-3.5 rounded-full border-2 border-white bg-sky-400" />
              </span>
            </Marker>
          )}

          <NavigationControl position="top-right" visualizePitch={viewMode === '3d'} />
          <MapClosureMarkers closures={altOptions[altSelected]?.closures ?? []} />
        </Map>

        <div className="pointer-events-none absolute bottom-4 left-3 right-3 flex flex-wrap items-end justify-between gap-2 sm:left-4 sm:right-4">
          <div className="flex flex-col gap-2">
            <MapTrafficLegend />
            <MapRouteAlternativesBar options={altOptions} selectedIndex={altSelected} onSelect={setAltSelected} />
            <div className="pointer-events-auto inline-flex overflow-hidden rounded-md border border-navy-600 bg-navy-950/95 shadow-sm">
            <button
              type="button"
              className={clsx(
                'inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium',
                viewMode === '2d' ? 'bg-navy-800 text-gold-400' : 'text-ink-300'
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
                'inline-flex items-center gap-1.5 border-l border-navy-600 px-3 py-2 text-[11px] font-medium',
                viewMode === '3d' ? 'bg-navy-800 text-gold-400' : 'text-ink-300'
              )}
              aria-pressed={viewMode === '3d'}
              onClick={() => setViewMode('3d')}
            >
              <Box className="h-3.5 w-3.5" aria-hidden="true" />
              3D
            </button>
          </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant={follow ? 'gold' : 'outline'}
            className="pointer-events-auto"
            onClick={() => {
              setFollow(true);
              if (userPos) {
                mapRef.current?.easeTo({
                  center: [userPos.lng, userPos.lat],
                  zoom: 16.5,
                  duration: LIVE.mapFlyMs,
                });
              }
            }}
          >
            <LocateFixed className="h-4 w-4" aria-hidden="true" />
            Recenter
          </Button>
        </div>
      </div>
    </div>
  );
}
