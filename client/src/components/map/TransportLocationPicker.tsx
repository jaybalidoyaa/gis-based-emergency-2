import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import MapGL, { Marker, NavigationControl, Source, Layer, type MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapPin, Search, Crosshair, Hospital } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { forwardGeocode, reverseGeocode, type GeocodeResult, type GeocodeScope } from '@/lib/geocode';
import {
  facilitiesToHospitalGeoJSON,
  hospitalHaloLayer,
  hospitalPointLayer,
} from '@/lib/hospitalMapLayers';
import { SUN_VALLEY_CENTER } from '@/lib/validation';
import { useMapConfig } from '@/hooks/useMapConfig';
import { MAPBOX_OPS_CONFIG, MAPBOX_OPS_STYLE } from '@/lib/mapboxStyle';
import { fetchDrivingTrafficRoutes, type TrafficRouteOption } from '@/lib/mapDirections';
import {
  MapAlternativeRouteSource,
  MapClosureMarkers,
  MapRouteAlternativesBar,
  MapTrafficLegend,
  MapTrafficSource,
} from '@/components/map/MapTrafficOverlay';
import { useAuthStore } from '@/store/authStore';
import { mapApi } from '@/services/api';
import { LIVE } from '@/lib/liveTiming';
import clsx from 'clsx';

export type MapPoint = {
  address: string;
  lat?: number;
  lng?: number;
};

type ActiveEnd = 'pickup' | 'dropoff';

type Props = {
  pickup: MapPoint;
  dropoff: MapPoint;
  onPickupChange: (next: MapPoint) => void;
  onDropoffChange: (next: MapPoint) => void;
  className?: string;
  mapHeight?: string;
};

const HOSPITAL_LAYERS = ['picker-hospital-point', 'picker-hospital-halo'] as const;

export function TransportLocationPicker({
  pickup,
  dropoff,
  onPickupChange,
  onDropoffChange,
  className,
  mapHeight = '240px',
}: Props) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { data: config } = useMapConfig();
  const token = config?.mapboxToken;
  const mapRef = useRef<MapRef>(null);
  const [active, setActive] = useState<ActiveEnd>('pickup');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyGeo, setBusyGeo] = useState(false);
  const searchTimer = useRef<number | null>(null);
  const [altOptions, setAltOptions] = useState<TrafficRouteOption[]>([]);
  const [altSelected, setAltSelected] = useState(0);

  const mapQuery = useQuery({
    queryKey: ['map-data'],
    queryFn: () => mapApi.data(accessToken!),
    enabled: !!accessToken,
    staleTime: LIVE.coolMs,
  });

  const hospitalCollection = useMemo(
    () =>
      facilitiesToHospitalGeoJSON(
        (mapQuery.data?.data?.facilities ?? []) as Parameters<typeof facilitiesToHospitalGeoJSON>[0]
      ),
    [mapQuery.data?.data?.facilities]
  );
  const hospitalCount = hospitalCollection.features.length;

  const activePoint = active === 'pickup' ? pickup : dropoff;
  const scope: GeocodeScope = 'ncr';
  const proximity =
    activePoint.lat != null && activePoint.lng != null
      ? { lat: activePoint.lat, lng: activePoint.lng }
      : active === 'pickup'
        ? SUN_VALLEY_CENTER
        : pickup.lat != null && pickup.lng != null
          ? { lat: pickup.lat, lng: pickup.lng }
          : SUN_VALLEY_CENTER;

  useEffect(() => {
    setQuery(activePoint.address || '');
    setHits([]);
  }, [active, activePoint.address]);

  useEffect(() => {
    if (!token || query.trim().length < 3) {
      setHits([]);
      return;
    }
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      setSearching(true);
      void forwardGeocode(token, query, { scope, limit: 6, proximity })
        .then((rows) => setHits(rows))
        .finally(() => setSearching(false));
    }, 280);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [query, token, scope, proximity.lat, proximity.lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const points = [
      pickup.lat != null && pickup.lng != null ? ([pickup.lng, pickup.lat] as [number, number]) : null,
      dropoff.lat != null && dropoff.lng != null ? ([dropoff.lng, dropoff.lat] as [number, number]) : null,
    ].filter(Boolean) as [number, number][];
    if (points.length === 0) return;
    if (points.length === 1) {
      map.flyTo({ center: points[0], zoom: 14.5, duration: 600 });
      return;
    }
    const lngs = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 48, duration: 700, maxZoom: 14 }
    );
  }, [pickup.lat, pickup.lng, dropoff.lat, dropoff.lng]);

  function applyPoint(next: MapPoint) {
    if (active === 'pickup') onPickupChange(next);
    else onDropoffChange(next);
    setQuery(next.address);
    setHits([]);
  }

  async function applyCoords(lat: number, lng: number) {
    if (!token) {
      applyPoint({ address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng });
      return;
    }
    setBusyGeo(true);
    try {
      const address = await reverseGeocode(token, lat, lng);
      applyPoint({ address, lat, lng });
    } finally {
      setBusyGeo(false);
    }
  }

  function pickHit(hit: GeocodeResult) {
    applyPoint({ address: hit.address, lat: hit.lat, lng: hit.lng });
  }

  function pickHospital(name: string, address: string, lat: number, lng: number) {
    const label = address?.trim() ? `${name} — ${address}` : name;
    setActive('dropoff');
    onDropoffChange({ address: label, lat, lng });
    setQuery(label);
    setHits([]);
  }

  useEffect(() => {
    if (!token || pickup.lat == null || pickup.lng == null || dropoff.lat == null || dropoff.lng == null) {
      setAltOptions([]);
      return;
    }
    let cancelled = false;
    void fetchDrivingTrafficRoutes(token, { lat: pickup.lat, lng: pickup.lng }, { lat: dropoff.lat, lng: dropoff.lng }).then(
      (opts) => {
        if (cancelled) return;
        setAltOptions(opts);
        setAltSelected(0);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [token, pickup.lat, pickup.lng, dropoff.lat, dropoff.lng]);

  const selectedRoute = altOptions[altSelected];
  const routeGeo =
    selectedRoute?.coordinates.length
      ? ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: selectedRoute.coordinates },
        } as GeoJSON.Feature)
      : pickup.lat != null && pickup.lng != null && dropoff.lat != null && dropoff.lng != null
        ? ({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [pickup.lng, pickup.lat],
                [dropoff.lng, dropoff.lat],
              ],
            },
          } as GeoJSON.Feature)
        : null;

  return (
    <div className={clsx('space-y-3', className)}>
      <div className="flex gap-2">
        {(
          [
            { id: 'pickup' as const, label: 'Pickup', tone: 'ok' },
            { id: 'dropoff' as const, label: 'Drop-off', tone: 'alert' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            className={clsx(
              'flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
              active === tab.id
                ? tab.tone === 'ok'
                  ? 'border-ok-500/50 bg-ok-500/15 text-ok-300'
                  : 'border-alert-500/50 bg-alert-500/15 text-alert-300'
                : 'border-navy-600 bg-navy-950/50 text-ink-400 hover:text-ink-200'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="loc-search">
          {active === 'pickup' ? 'Pickup address' : 'Destination'} <span className="text-alert-400">*</span>
        </Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden />
          <Input
            id="loc-search"
            className="pl-9"
            value={query}
            placeholder={active === 'pickup' ? 'Search pickup or tap map…' : 'Search hospital / destination…'}
            onChange={(e) => {
              setQuery(e.target.value);
              if (active === 'pickup') onPickupChange({ ...pickup, address: e.target.value });
              else onDropoffChange({ ...dropoff, address: e.target.value });
            }}
            autoComplete="off"
          />
          {hits.length > 0 && (
            <ul
              className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-navy-600 bg-navy-950 shadow-xl sidebar-scroll"
              role="listbox"
            >
              {hits.map((h) => (
                <li key={`${h.lng},${h.lat},${h.placeName}`}>
                  <button
                    type="button"
                    className="w-full px-3 py-2.5 text-left text-sm text-ink-200 hover:bg-navy-800 hover:text-ink-50"
                    onClick={() => pickHit(h)}
                  >
                    <span className="block font-medium text-ink-50">{h.placeName.split(',')[0]}</span>
                    <span className="block truncate text-[11px] text-ink-500">{h.placeName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searching && <p className="mt-1 text-[11px] text-ink-500">Searching…</p>}
          {busyGeo && <p className="mt-1 text-[11px] text-ink-500">Resolving address…</p>}
        </div>
        <p className="text-[11px] text-ink-500">
          Green hospital dots are selectable. Search an address, click the map, or drag a pin.
          {hospitalCount > 0 ? ` ${hospitalCount} hospitals shown.` : ''}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-navy-700" style={{ height: mapHeight }}>
        {token ? (
          <MapGL
            ref={mapRef}
            mapboxAccessToken={token}
            mapStyle={MAPBOX_OPS_STYLE}
            config={MAPBOX_OPS_CONFIG}
            initialViewState={{
              longitude: SUN_VALLEY_CENTER.lng,
              latitude: SUN_VALLEY_CENTER.lat,
              zoom: 12.2,
            }}
            style={{ width: '100%', height: '100%' }}
            attributionControl={false}
            interactiveLayerIds={[...HOSPITAL_LAYERS]}
            cursor="crosshair"
            onClick={(e) => {
              const hospital = e.features?.find((f) => HOSPITAL_LAYERS.includes(f.layer?.id as (typeof HOSPITAL_LAYERS)[number]));
              if (hospital?.geometry?.type === 'Point') {
                const [lng, lat] = hospital.geometry.coordinates as [number, number];
                const name = String(hospital.properties?.name || 'Hospital');
                const address = String(hospital.properties?.address || '');
                pickHospital(name, address, lat, lng);
                return;
              }
              void applyCoords(e.lngLat.lat, e.lngLat.lng);
            }}
          >
            <NavigationControl position="top-right" showCompass={false} />
            <MapTrafficSource idPrefix="picker" />
            {hospitalCount > 0 && (
              <Source id="picker-hospitals" type="geojson" data={hospitalCollection}>
                <Layer {...hospitalHaloLayer('picker')} />
                <Layer {...hospitalPointLayer('picker')} />
              </Source>
            )}
            {routeGeo && altOptions.length < 2 && (
              <Source id="picker-route" type="geojson" data={routeGeo}>
                <Layer
                  id="picker-route-line"
                  type="line"
                  paint={{
                    'line-color': '#e8b84a',
                    'line-width': 3,
                    'line-opacity': 0.9,
                    'line-dasharray': [1.5, 1.2],
                  }}
                />
              </Source>
            )}
            {altOptions.length > 0 && (
              <MapAlternativeRouteSource idPrefix="picker" options={altOptions} selectedIndex={altSelected} />
            )}
            {pickup.lat != null && pickup.lng != null && (
              <Marker
                longitude={pickup.lng}
                latitude={pickup.lat}
                draggable={active === 'pickup'}
                onDragEnd={(e) => {
                  if (active !== 'pickup') return;
                  void applyCoords(e.lngLat.lat, e.lngLat.lng);
                }}
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  setActive('pickup');
                }}
              >
                <PinDot color="#4fb87e" label="Pickup" active={active === 'pickup'} />
              </Marker>
            )}
            {dropoff.lat != null && dropoff.lng != null && (
              <Marker
                longitude={dropoff.lng}
                latitude={dropoff.lat}
                draggable={active === 'dropoff'}
                onDragEnd={(e) => {
                  if (active !== 'dropoff') return;
                  void applyCoords(e.lngLat.lat, e.lngLat.lng);
                }}
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  setActive('dropoff');
                }}
              >
                <PinDot color="#d4453a" label="Drop-off" active={active === 'dropoff'} />
              </Marker>
            )}
            <MapClosureMarkers closures={altOptions.flatMap((o) => o.closures)} />
          </MapGL>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-500">Map loading…</div>
        )}
      </div>
      {altOptions.length > 0 && (
        <div className="flex flex-wrap items-start gap-2">
          <MapTrafficLegend />
          <MapRouteAlternativesBar options={altOptions} selectedIndex={altSelected} onSelect={setAltSelected} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-[36px] gap-1.5"
          onClick={() => {
            setActive('pickup');
            void applyCoords(SUN_VALLEY_CENTER.lat, SUN_VALLEY_CENTER.lng);
          }}
        >
          <Crosshair className="h-3.5 w-3.5" aria-hidden />
          Pin Sun Valley
        </Button>
        {hospitalCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded border border-ok-500/30 bg-ok-500/10 px-2 py-1 text-[11px] text-ok-300">
            <Hospital className="h-3 w-3 shrink-0" aria-hidden />
            Tap green dots for hospitals
          </span>
        )}
        {pickup.address && (
          <span className="inline-flex max-w-full items-center gap-1 rounded border border-ok-500/30 bg-ok-500/10 px-2 py-1 text-[11px] text-ok-300">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{pickup.address}</span>
          </span>
        )}
        {dropoff.address && (
          <span className="inline-flex max-w-full items-center gap-1 rounded border border-alert-500/30 bg-alert-500/10 px-2 py-1 text-[11px] text-alert-300">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{dropoff.address}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function PinDot({ color, label, active }: { color: string; label: string; active: boolean }) {
  return (
    <div className="relative flex flex-col items-center" title={label}>
      {active && (
        <span
          className="absolute -top-1 h-8 w-8 animate-ping rounded-full opacity-30"
          style={{ background: color }}
          aria-hidden
        />
      )}
      <span
        className={clsx(
          'relative z-[1] flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink-50 shadow-lg',
          active && 'ring-2 ring-gold-400/70'
        )}
        style={{ background: color }}
      >
        <MapPin className="h-4 w-4 text-ink-50" aria-hidden />
      </span>
      <span className="mt-1 rounded bg-navy-950/90 px-1.5 py-0.5 text-[10px] font-semibold text-ink-100">{label}</span>
    </div>
  );
}
