import { Marker } from 'react-map-gl/mapbox';
import { Source, Layer } from 'react-map-gl/mapbox';
import { Ban, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import type { ClosurePoint, TrafficRouteOption } from '@/lib/mapDirections';
import { formatDelayLabel, formatDurationMinutes } from '@/lib/mapDirections';

export function MapTrafficSource({ idPrefix }: { idPrefix: string }) {
  return (
    <Source id={`${idPrefix}-mapbox-traffic`} type="vector" url="mapbox://mapbox.mapbox-traffic-v1">
      <Layer
        id={`${idPrefix}-traffic-flow`}
        type="line"
        source-layer="traffic"
        minzoom={8}
        layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        paint={{
          'line-width': 2.4,
          'line-opacity': 0.88,
          'line-color': [
            'match',
            ['get', 'congestion'],
            'low',
            '#22c55e',
            'moderate',
            '#eab308',
            'heavy',
            '#f97316',
            'severe',
            '#ef4444',
            'closed',
            '#111827',
            '#64748b',
          ],
        }}
      />
    </Source>
  );
}

export function MapAlternativeRouteSource({
  idPrefix,
  options,
  selectedIndex,
}: {
  idPrefix: string;
  options: TrafficRouteOption[];
  selectedIndex: number;
}) {
  const features: GeoJSON.Feature[] = options.map((opt) => ({
    type: 'Feature',
    properties: { index: opt.index, selected: opt.index === selectedIndex ? 1 : 0 },
    geometry: { type: 'LineString', coordinates: opt.coordinates },
  }));
  if (!features.length) return null;
  return (
    <Source id={`${idPrefix}-alt-routes`} type="geojson" data={{ type: 'FeatureCollection', features }}>
      <Layer
        id={`${idPrefix}-alt-routes-alt`}
        type="line"
        filter={['==', ['get', 'selected'], 0]}
        layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        paint={{
          'line-color': '#94a3b8',
          'line-width': 4,
          'line-opacity': 0.7,
          'line-dasharray': [1.2, 1.4],
        }}
      />
      <Layer
        id={`${idPrefix}-alt-routes-main`}
        type="line"
        filter={['==', ['get', 'selected'], 1]}
        layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        paint={{
          'line-color': '#e8b84a',
          'line-width': 5,
          'line-opacity': 0.95,
        }}
      />
    </Source>
  );
}

export function MapClosureMarkers({ closures }: { closures: ClosurePoint[] }) {
  return (
    <>
      {closures.map((c, i) => (
        <Marker key={`${c.kind}-${c.lng}-${c.lat}-${i}`} longitude={c.lng} latitude={c.lat} anchor="center">
          <span
            className={clsx(
              'flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink-50 shadow-md',
              c.kind === 'closed' ? 'bg-navy-950 text-alert-400' : 'bg-amber-500 text-navy-950'
            )}
            title={c.kind === 'closed' ? 'Closed road' : 'Heavy traffic'}
          >
            {c.kind === 'closed' ? (
              <Ban className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
            )}
          </span>
        </Marker>
      ))}
    </>
  );
}

export function MapTrafficLegend({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        'pointer-events-none rounded-md border border-navy-600 bg-navy-950/95 px-2.5 py-2 text-[10px] text-ink-200 shadow-sm',
        className
      )}
    >
      <p className="mb-1 font-semibold uppercase tracking-wide text-ink-400">Live traffic</p>
      <ul className="space-y-0.5">
        <li className="flex items-center gap-1.5">
          <span className="h-1.5 w-4 rounded-sm bg-emerald-500" /> Flowing
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-1.5 w-4 rounded-sm bg-yellow-500" /> Moderate
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-1.5 w-4 rounded-sm bg-orange-500" /> Heavy
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-1.5 w-4 rounded-sm bg-red-500" /> Severe
        </li>
        <li className="flex items-center gap-1.5">
          <Ban className="h-3 w-3 text-alert-400" /> Closed road
        </li>
        <li className="flex items-center gap-1.5">
          <TriangleAlert className="h-3 w-3 text-amber-400" /> Delay on route
        </li>
      </ul>
    </div>
  );
}

export function MapRouteAlternativesBar({
  options,
  selectedIndex,
  onSelect,
}: {
  options: TrafficRouteOption[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  if (options.length < 1) return null;
  return (
    <div className="pointer-events-auto flex max-w-full flex-wrap gap-1.5">
      {options.map((opt) => {
        const selected = opt.index === selectedIndex;
        return (
          <button
            key={opt.index}
            type="button"
            onClick={() => onSelect(opt.index)}
            className={clsx(
              'rounded-md border px-2 py-1.5 text-left text-[11px] font-medium shadow-sm',
              selected
                ? 'border-gold-500/70 bg-navy-900 text-gold-300'
                : 'border-navy-600 bg-navy-950/95 text-ink-300 hover:bg-navy-900'
            )}
          >
            <span className="block">{opt.index === 0 ? 'Fastest' : `Alt ${opt.index}`}</span>
            <span className="block font-mono text-[10px] text-ink-400">
              {formatDurationMinutes(opt.durationSeconds)} · {formatDelayLabel(opt.delaySeconds)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
