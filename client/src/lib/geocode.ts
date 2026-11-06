import { SUN_VALLEY_CENTER } from '@/lib/validation';
import { NCR_BOUNDS } from '@/lib/hospitalMapLayers';

export type GeocodeResult = {
  placeName: string;
  address: string;
  lat: number;
  lng: number;
};

/** Rough bounding box covering Barangay Sun Valley, Parañaque */
export const SUN_VALLEY_BBOX: [number, number, number, number] = [121.025, 14.482, 121.045, 14.5];

/** Metro Manila / NCR search bbox for destinations (hospitals, facilities). */
export const NCR_BBOX: [number, number, number, number] = [
  NCR_BOUNDS[0][0],
  NCR_BOUNDS[0][1],
  NCR_BOUNDS[1][0],
  NCR_BOUNDS[1][1],
];

export type GeocodeScope = 'sun-valley' | 'ncr' | 'ph';

export function isInsideSunValley(lat: number, lng: number): boolean {
  const [minLng, minLat, maxLng, maxLat] = SUN_VALLEY_BBOX;
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
}

export async function forwardGeocode(
  token: string,
  query: string,
  opts?: { scope?: GeocodeScope; limit?: number; proximity?: { lat: number; lng: number } }
): Promise<GeocodeResult[]> {
  if (!token || query.trim().length < 3) return [];

  // Accept pasted "lat, lng" / "lng, lat" so pins stay exact.
  const coordMatch = query.trim().match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
  if (coordMatch) {
    const a = Number(coordMatch[1]);
    const b = Number(coordMatch[2]);
    const lat = Math.abs(a) <= 90 ? a : b;
    const lng = Math.abs(a) <= 90 ? b : a;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return [{ placeName: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng }];
    }
  }

  const scope = opts?.scope ?? 'sun-valley';
  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`);
  url.searchParams.set('access_token', token);
  url.searchParams.set('country', 'PH');
  url.searchParams.set('limit', String(opts?.limit ?? 6));
  url.searchParams.set('types', 'address,poi,place,locality,neighborhood');
  const prox = opts?.proximity ?? SUN_VALLEY_CENTER;
  url.searchParams.set('proximity', `${prox.lng},${prox.lat}`);
  if (scope === 'sun-valley') url.searchParams.set('bbox', SUN_VALLEY_BBOX.join(','));
  else if (scope === 'ncr') url.searchParams.set('bbox', NCR_BBOX.join(','));
  // scope === 'ph' → no bbox (nationwide PH)
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    features?: { place_name: string; text: string; center: [number, number] }[];
  };
  return (data.features ?? []).map((f) => ({
    placeName: f.place_name,
    address: f.place_name,
    lng: f.center[0],
    lat: f.center[1],
  }));
}

export async function reverseGeocode(token: string, lat: number, lng: number): Promise<string> {
  if (!token) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json`);
  url.searchParams.set('access_token', token);
  url.searchParams.set('limit', '1');
  const res = await fetch(url);
  if (!res.ok) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const data = (await res.json()) as { features?: { place_name: string }[] };
  return data.features?.[0]?.place_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
