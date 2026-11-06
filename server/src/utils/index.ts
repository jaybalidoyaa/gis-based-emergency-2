import { Counter } from '../models/index.js';

/** Express `req.params` values may be `string | string[]` under newer @types/express. */
export function paramId(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export async function generateDisplayId(prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const counter = await Counter.findOneAndUpdate(
    { key: prefix, year },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  const seq = String(counter.seq).padStart(4, '0');
  return `${prefix}-${year}-${seq}`;
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isGpsStale(updatedAt: Date | undefined, staleMinutes: number): boolean {
  if (!updatedAt) return true;
  return Date.now() - updatedAt.getTime() > staleMinutes * 60 * 1000;
}
