export type ClosurePoint = { lng: number; lat: number; kind: 'closed' | 'heavy' };

export type TrafficRouteOption = {
  index: number;
  coordinates: [number, number][];
  durationSeconds: number;
  durationTypicalSeconds: number | null;
  delaySeconds: number;
  distanceMeters: number;
  closures: ClosurePoint[];
  steps: { instruction: string; distanceM: number; durationS: number; location: [number, number] }[];
};

type DirectionsJson = {
  routes?: {
    distance?: number;
    duration?: number;
    duration_typical?: number;
    geometry?: { coordinates?: [number, number][] };
    legs?: {
      annotation?: {
        congestion?: string[];
        closure?: Array<boolean | number | string>;
      };
      steps?: {
        distance?: number;
        duration?: number;
        maneuver?: { location?: [number, number]; instruction?: string };
      }[];
    }[];
  }[];
};

function midpoint(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function sampleFlags(
  coords: [number, number][],
  flags: boolean[],
  kind: ClosurePoint['kind'],
  maxPoints: number
): ClosurePoint[] {
  if (coords.length < 2 || !flags.length) return [];
  const hits: ClosurePoint[] = [];
  const n = Math.min(flags.length, coords.length - 1);
  for (let i = 0; i < n; i++) {
    if (!flags[i]) continue;
    const [lng, lat] = midpoint(coords[i], coords[i + 1]);
    hits.push({ lng, lat, kind });
  }
  if (hits.length <= maxPoints) return hits;
  const step = Math.ceil(hits.length / maxPoints);
  return hits.filter((_, i) => i % step === 0).slice(0, maxPoints);
}

export function formatDurationMinutes(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
  }
  return `${m} min`;
}

export function formatDelayLabel(delaySeconds: number): string {
  if (delaySeconds < 45) return 'On time';
  return `+${formatDurationMinutes(delaySeconds)} traffic`;
}

export async function fetchDrivingTrafficRoutes(
  token: string,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<TrafficRouteOption[]> {
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?alternatives=true&geometries=geojson&overview=full&steps=true` +
    `&annotations=congestion,duration,closure&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as DirectionsJson;
  const routes = json.routes ?? [];
  return routes
    .map((route, index) => {
      const coordinates = (route.geometry?.coordinates ?? []) as [number, number][];
      if (coordinates.length < 2) return null;
      const typical = route.duration_typical ?? null;
      const duration = route.duration ?? 0;
      const delay = typical != null ? Math.max(0, duration - typical) : 0;
      const congestion = route.legs?.flatMap((leg) => leg.annotation?.congestion ?? []) ?? [];
      const rawClosure = route.legs?.flatMap((leg) => leg.annotation?.closure ?? []) ?? [];
      const closedFlags = rawClosure.map((v) => v === true || v === 1 || v === 'true' || v === 'closed');
      const heavyFlags = congestion.map((c) => c === 'severe' || c === 'heavy');
      const closures = [
        ...sampleFlags(coordinates, closedFlags, 'closed', 6),
        ...sampleFlags(coordinates, heavyFlags, 'heavy', 4),
      ];
      const steps =
        route.legs?.flatMap((leg) =>
          (leg.steps ?? []).map((s) => ({
            instruction: s.maneuver?.instruction || 'Continue',
            distanceM: s.distance ?? 0,
            durationS: s.duration ?? 0,
            location: (s.maneuver?.location ?? coordinates[coordinates.length - 1]) as [number, number],
          }))
        ) ?? [];
      return {
        index,
        coordinates,
        durationSeconds: duration,
        durationTypicalSeconds: typical,
        delaySeconds: delay,
        distanceMeters: route.distance ?? 0,
        closures,
        steps,
      } satisfies TrafficRouteOption;
    })
    .filter((r): r is TrafficRouteOption => !!r);
}
