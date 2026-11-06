import type { CircleLayerSpecification, FillLayerSpecification, LineLayerSpecification } from 'mapbox-gl';
import ncrRegion from '@/data/ncr-region.json';
import paranaqueCity from '@/data/paranaque-city.json';
import sunValley from '@/data/sun-valley.json';

/** Border priority: Sun Valley (primary) > Parañaque (secondary) > NCR (tertiary). */
export const BOUNDARY_COLORS = {
  sunValley: '#e8b84a',
  /** Sector outline — warmer amber, kept distinct from barangay fill */
  sector: '#f0c75e',
  paranaque: '#38bdf8',
  ncr: '#a78bfa',
} as const;

export const BOUNDARY_DATA = {
  ncr: ncrRegion as GeoJSON.FeatureCollection,
  paranaque: paranaqueCity as GeoJSON.FeatureCollection,
  sunValley: sunValley as GeoJSON.FeatureCollection,
};

export function ncrFillLayer(idPrefix: string): FillLayerSpecification {
  return {
    id: `${idPrefix}-ncr-fill`,
    type: 'fill',
    source: `${idPrefix}-ncr`,
    paint: { 'fill-color': BOUNDARY_COLORS.ncr, 'fill-opacity': 0.03 },
  };
}

export function ncrLineLayer(idPrefix: string): LineLayerSpecification {
  return {
    id: `${idPrefix}-ncr-line`,
    type: 'line',
    source: `${idPrefix}-ncr`,
    paint: {
      'line-color': BOUNDARY_COLORS.ncr,
      'line-width': 1.25,
      'line-opacity': 0.55,
      'line-dasharray': [2, 2],
    },
  };
}

export function cityFillLayer(idPrefix: string): FillLayerSpecification {
  return {
    id: `${idPrefix}-paranaque-fill`,
    type: 'fill',
    source: `${idPrefix}-paranaque`,
    paint: { 'fill-color': BOUNDARY_COLORS.paranaque, 'fill-opacity': 0.05 },
  };
}

export function cityLineLayer(idPrefix: string): LineLayerSpecification {
  return {
    id: `${idPrefix}-paranaque-line`,
    type: 'line',
    source: `${idPrefix}-paranaque`,
    paint: {
      'line-color': BOUNDARY_COLORS.paranaque,
      'line-width': 1.75,
      'line-opacity': 0.75,
    },
  };
}

export function sunValleyFillLayer(idPrefix: string): FillLayerSpecification {
  return {
    id: `${idPrefix}-sv-fill`,
    type: 'fill',
    source: `${idPrefix}-sun-valley`,
    filter: ['==', ['get', 'kind'], 'barangay'],
    paint: { 'fill-color': BOUNDARY_COLORS.sunValley, 'fill-opacity': 0.045 },
  };
}

export function sunValleyLineLayer(idPrefix: string): LineLayerSpecification {
  return {
    id: `${idPrefix}-sv-line`,
    type: 'line',
    source: `${idPrefix}-sun-valley`,
    filter: ['==', ['get', 'kind'], 'barangay'],
    paint: {
      'line-color': BOUNDARY_COLORS.sunValley,
      'line-width': 2,
      'line-opacity': 0.92,
    },
  };
}

/** Soft outer casing under the barangay border for contrast on dark basemap. */
export function sunValleyLineCasingLayer(idPrefix: string): LineLayerSpecification {
  return {
    id: `${idPrefix}-sv-line-casing`,
    type: 'line',
    source: `${idPrefix}-sun-valley`,
    filter: ['==', ['get', 'kind'], 'barangay'],
    paint: {
      'line-color': '#080e16',
      'line-width': 4.5,
      'line-opacity': 0.55,
    },
  };
}

export function sunValleyMaskLayer(idPrefix: string): FillLayerSpecification {
  return {
    id: `${idPrefix}-sv-mask`,
    type: 'fill',
    source: `${idPrefix}-sun-valley`,
    filter: ['==', ['get', 'kind'], 'mask'],
    paint: { 'fill-color': '#020617', 'fill-opacity': 0.22 },
  };
}

export function sunValleySectorFillLayer(idPrefix: string): FillLayerSpecification {
  return {
    id: `${idPrefix}-sv-sector-fill`,
    type: 'fill',
    source: `${idPrefix}-sun-valley`,
    filter: ['==', ['get', 'kind'], 'sector'],
    paint: { 'fill-color': BOUNDARY_COLORS.sector, 'fill-opacity': 0.06 },
  };
}

export function sunValleySectorLineLayer(idPrefix: string): LineLayerSpecification {
  return {
    id: `${idPrefix}-sv-sector-line`,
    type: 'line',
    source: `${idPrefix}-sun-valley`,
    filter: ['==', ['get', 'kind'], 'sector'],
    paint: {
      'line-color': BOUNDARY_COLORS.sector,
      'line-width': 1.5,
      'line-opacity': 0.85,
    },
  };
}

/** Kept for optional use — prefer outline-only sector without pin clutter. */
export function sunValleySectorPinLayer(idPrefix: string): CircleLayerSpecification {
  return {
    id: `${idPrefix}-sv-sector-pins`,
    type: 'circle',
    source: `${idPrefix}-sun-valley`,
    filter: ['==', ['get', 'kind'], 'sector-pin'],
    paint: {
      'circle-radius': 3,
      'circle-color': BOUNDARY_COLORS.sector,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#080e16',
      'circle-opacity': 0.75,
    },
  };
}

/** Nudge overlapping map markers so icons don't stack on the same point. */
export function fanOverlappingPositions<T extends { lng: number; lat: number }>(
  items: T[],
  spacingDeg = 0.00018
): (T & { lng: number; lat: number })[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = `${item.lat.toFixed(4)}:${item.lng.toFixed(4)}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const out: (T & { lng: number; lat: number })[] = [];
  for (const list of groups.values()) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    list.forEach((item, i) => {
      const angle = (Math.PI * 2 * i) / list.length - Math.PI / 2;
      out.push({
        ...item,
        lng: item.lng + Math.cos(angle) * spacingDeg,
        lat: item.lat + Math.sin(angle) * spacingDeg,
      });
    });
  }
  return out;
}
