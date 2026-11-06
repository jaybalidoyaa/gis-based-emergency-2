import type { CircleLayerSpecification, SymbolLayerSpecification } from 'mapbox-gl';

export const HOSPITAL_COLOR = '#4fb87e';
export const NCR_BOUNDS: [[number, number], [number, number]] = [
  [120.92, 14.38],
  [121.13, 14.78],
];

export function isHospitalFacility(f: { category?: string | null }): boolean {
  return (f.category ?? '').toLowerCase() === 'hospital';
}

export function facilitiesToHospitalGeoJSON(
  facilities: Array<{
    _id?: string;
    id?: string;
    name?: string;
    category?: string;
    address?: string | null;
    contactNumber?: string | null;
    verificationStatus?: string | null;
    currentLocation?: { latitude: number; longitude: number } | null;
    lat?: number;
    lng?: number;
  }>
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const f of facilities) {
    if (!isHospitalFacility(f)) continue;
    const lat = f.currentLocation?.latitude ?? f.lat;
    const lng = f.currentLocation?.longitude ?? f.lng;
    if (lat == null || lng == null) continue;
    features.push({
      type: 'Feature',
      properties: {
        id: f._id ?? f.id ?? '',
        name: f.name ?? 'Hospital',
        category: 'Hospital',
        address: f.address ?? '',
        contactNumber: f.contactNumber ?? '',
        verificationStatus: f.verificationStatus ?? '',
      },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function hospitalClusterLayer(idPrefix: string): CircleLayerSpecification {
  return {
    id: `${idPrefix}-hospital-clusters`,
    type: 'circle',
    source: `${idPrefix}-hospitals`,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': HOSPITAL_COLOR,
      'circle-radius': ['step', ['get', 'point_count'], 16, 8, 20, 25, 26, 60, 32],
      'circle-opacity': 0.88,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#080e16',
    },
  };
}

export function hospitalClusterCountLayer(idPrefix: string): SymbolLayerSpecification {
  return {
    id: `${idPrefix}-hospital-cluster-count`,
    type: 'symbol',
    source: `${idPrefix}-hospitals`,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size': 11,
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
    },
    paint: { 'text-color': '#07110c' },
  };
}

export function hospitalPointLayer(idPrefix: string): CircleLayerSpecification {
  return {
    id: `${idPrefix}-hospital-point`,
    type: 'circle',
    source: `${idPrefix}-hospitals`,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': HOSPITAL_COLOR,
      'circle-radius': 9,
      'circle-opacity': 0.95,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#080e16',
    },
  };
}

export function hospitalHaloLayer(idPrefix: string): CircleLayerSpecification {
  return {
    id: `${idPrefix}-hospital-halo`,
    type: 'circle',
    source: `${idPrefix}-hospitals`,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': HOSPITAL_COLOR,
      'circle-radius': 18,
      'circle-opacity': 0.2,
    },
  };
}

/** Non-hospital facilities for DOM markers (keep local pins crisp). */
export function localFacilitiesOnly<T extends { category?: string | null }>(items: T[]): T[] {
  return items.filter((f) => !isHospitalFacility(f));
}

export type HospitalPopupInfo = {
  lng: number;
  lat: number;
  title: string;
  body: string;
};

export function hospitalPopupFromProps(p: Record<string, unknown> | null | undefined): Omit<HospitalPopupInfo, 'lng' | 'lat'> | null {
  if (!p) return null;
  const name = String(p.name || 'Hospital');
  const address = String(p.address || '').trim();
  const contact = String(p.contactNumber || '').trim();
  const status = String(p.verificationStatus || '')
    .trim()
    .replace(/_/g, ' ');
  const lines = [
    'Hospital',
    address || null,
    contact ? `Contact: ${contact}` : null,
    status ? `Status: ${status}` : null,
  ].filter(Boolean);
  return { title: name, body: lines.join('\n') };
}
