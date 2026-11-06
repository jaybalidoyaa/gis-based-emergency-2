/** Deterministic grid A* for short local paths (fallback when Directions fails). Not AI. */
export type LatLng = { lat: number; lng: number };

function heuristic(a: LatLng, b: LatLng) {
  const dlat = a.lat - b.lat;
  const dlng = a.lng - b.lng;
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

export function astarRoute(origin: LatLng, destination: LatLng, step = 0.0015): LatLng[] {
  const key = (p: LatLng) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
  const start = { lat: Math.round(origin.lat / step) * step, lng: Math.round(origin.lng / step) * step };
  const goal = {
    lat: Math.round(destination.lat / step) * step,
    lng: Math.round(destination.lng / step) * step,
  };
  type Node = { p: LatLng; g: number; f: number; parent?: string };
  const open = new Map<string, Node>();
  const came = new Map<string, Node>();
  open.set(key(start), { p: start, g: 0, f: heuristic(start, goal) });
  let guard = 0;
  while (open.size && guard++ < 4000) {
    let bestK = '';
    let bestF = Infinity;
    for (const [k, n] of open) {
      if (n.f < bestF) {
        bestF = n.f;
        bestK = k;
      }
    }
    const current = open.get(bestK)!;
    open.delete(bestK);
    came.set(bestK, current);
    if (bestK === key(goal)) {
      const path: LatLng[] = [];
      let ck: string | undefined = bestK;
      while (ck) {
        const n = came.get(ck);
        if (!n) break;
        path.push(n.p);
        ck = n.parent;
      }
      path.reverse();
      return [origin, ...path, destination];
    }
    for (const [dlat, dlng] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ] as const) {
      const np = { lat: +(current.p.lat + dlat).toFixed(5), lng: +(current.p.lng + dlng).toFixed(5) };
      const nk = key(np);
      if (came.has(nk) && !open.has(nk)) continue;
      const g = current.g + heuristic(current.p, np);
      const f = g + heuristic(np, goal);
      const existing = open.get(nk);
      if (!existing || g < existing.g) open.set(nk, { p: np, g, f, parent: bestK });
    }
  }
  return [origin, destination];
}

export type RouteResult = {
  provider: 'mapbox-directions' | 'astar-fallback';
  coordinates: [number, number][];
  distanceMeters?: number;
  durationSeconds?: number;
  durationTypicalSeconds?: number;
  delaySeconds?: number;
  alternatives?: {
    coordinates: [number, number][];
    distanceMeters: number;
    durationSeconds: number;
    delaySeconds: number;
  }[];
  warning?: string;
};

export async function planRoute(
  mapboxToken: string | undefined,
  origin: LatLng,
  destination: LatLng
): Promise<RouteResult> {
  if (mapboxToken) {
    try {
      const url =
        `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/` +
        `${origin.lng},${origin.lat};${destination.lng},${destination.lat}` +
        `?alternatives=true&geometries=geojson&overview=full&annotations=congestion,duration,closure&access_token=${mapboxToken}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as {
          routes?: {
            distance: number;
            duration: number;
            duration_typical?: number;
            geometry: { coordinates: [number, number][] };
          }[];
        };
        const routes = data.routes ?? [];
        const route = routes[0];
        if (route) {
          const typical = route.duration_typical;
          const delay = typical != null ? Math.max(0, route.duration - typical) : 0;
          return {
            provider: 'mapbox-directions',
            coordinates: route.geometry.coordinates,
            distanceMeters: route.distance,
            durationSeconds: route.duration,
            durationTypicalSeconds: typical,
            delaySeconds: delay,
            alternatives: routes.map((r) => ({
              coordinates: r.geometry.coordinates,
              distanceMeters: r.distance,
              durationSeconds: r.duration,
              delaySeconds: r.duration_typical != null ? Math.max(0, r.duration - r.duration_typical) : 0,
            })),
          };
        }
      }
    } catch {
      /* fall through */
    }
  }
  const pts = astarRoute(origin, destination);
  return {
    provider: 'astar-fallback',
    coordinates: pts.map((p) => [p.lng, p.lat] as [number, number]),
    warning: 'Directions service unavailable — using deterministic A* grid fallback',
  };
}
