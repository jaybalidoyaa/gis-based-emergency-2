/** Descriptive K-means clustering for historical incident points. Not predictive AI. */
export type Point = { lat: number; lng: number; id?: string };

function dist(a: Point, b: Point) {
  const dlat = a.lat - b.lat;
  const dlng = a.lng - b.lng;
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

export function kmeans(points: Point[], k: number, maxIter = 25): { centroid: Point; members: Point[] }[] {
  if (!points.length) return [];
  const kk = Math.max(1, Math.min(k, points.length));
  let centroids = points.slice(0, kk).map((p) => ({ lat: p.lat, lng: p.lng }));
  let groups: Point[][] = [];
  for (let iter = 0; iter < maxIter; iter++) {
    groups = Array.from({ length: kk }, () => []);
    for (const p of points) {
      let best = 0;
      let bestD = Infinity;
      centroids.forEach((c, i) => {
        const d = dist(p, c);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      groups[best].push(p);
    }
    const next = centroids.map((c, i) => {
      const g = groups[i];
      if (!g.length) return c;
      return {
        lat: g.reduce((s, p) => s + p.lat, 0) / g.length,
        lng: g.reduce((s, p) => s + p.lng, 0) / g.length,
      };
    });
    const moved = next.some((c, i) => dist(c, centroids[i]) > 1e-8);
    centroids = next;
    if (!moved) break;
  }
  return centroids.map((centroid, i) => ({ centroid, members: groups[i] ?? [] }));
}
