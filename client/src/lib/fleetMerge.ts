import type { MapUnit } from '@/types';

/** FIRE 01 / FIRE01 → same key (matching only). */
export function normalizeFleetKey(s?: string | null): string {
  return (s ?? '').trim().toUpperCase().replace(/[\s_\-./]+/g, '');
}

export function gpsTimeMs(updatedAt?: string | null): number {
  if (!updatedAt) return 0;
  const raw = updatedAt.trim();
  const iso = /Z$/i.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export function fleetDisplayName(u: MapUnit): string {
  if (u.kind === 'responder' || u.fullName?.trim()) {
    return u.fullName?.trim() || u.callsign || u.unitNo || 'Responder';
  }
  return u.unitNo || u.callsign || 'Unit';
}

export function fleetCallsign(u: MapUnit): string {
  return (u.callsign || u.unitNo || '').trim();
}

export function isPersonPin(u: MapUnit): boolean {
  return u.kind === 'responder';
}

const INACTIVE_RESPONDER = /off duty|out of service|inactive|unavailable|off-duty/i;

/**
 * Responders with last-known (or live) GPS — stay on the map even when the PWA is closed
 * (gpsStale). Only hide explicit Off Duty / Out of Service.
 */
export function isActiveResponder(r: MapUnit): boolean {
  if (r.kind && r.kind !== 'responder') return false;
  if (!r.currentLocation) return false;
  const st = String(r.availabilityStatus || r.operationalStatus || r.status || '').trim();
  if (INACTIVE_RESPONDER.test(st)) return false;
  return true;
}

/**
 * Vehicles and responders stay as separate entity lists (never merged into one pin).
 */
export function buildSeparateFleet(vehicles: MapUnit[], responders: MapUnit[]): MapUnit[] {
  const veh = vehicles
    .filter((u) => !!u.currentLocation)
    .map((u) => ({ ...u, kind: 'vehicle' as const }));
  const people = responders
    .filter(isActiveResponder)
    .map((r) => ({
      ...r,
      kind: 'responder' as const,
      vehicleType: undefined,
    }));
  return [...veh, ...people];
}

/** @deprecated */
export function mergeFleetByCallsign(units: MapUnit[], responders: MapUnit[]): MapUnit[] {
  return buildSeparateFleet(units, responders);
}

export type FleetCluster = {
  kind: 'vehicle' | 'responder';
  lat: number;
  lng: number;
  members: MapUnit[];
};

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Cluster by proximity within the same kind only.
 * - Nearby units → one truck blip + table
 * - Nearby responders → one person blip + table
 * - A unit/responder outside the radius keeps its own blip
 * Vehicles never cluster with responders.
 */
export function clusterProximityByKind(fleet: MapUnit[], radiusM = 50): FleetCluster[] {
  const vehicles = fleet.filter((u) => u.kind === 'vehicle' && u.currentLocation);
  const people = fleet.filter((u) => u.kind === 'responder' && u.currentLocation);

  function clusterGroup(items: MapUnit[], kind: 'vehicle' | 'responder'): FleetCluster[] {
    const clusters: FleetCluster[] = [];
    for (const unit of items) {
      const loc = unit.currentLocation!;
      let joined: FleetCluster | undefined;
      for (const c of clusters) {
        if (haversineM(c.lat, c.lng, loc.latitude, loc.longitude) <= radiusM) {
          joined = c;
          break;
        }
      }
      if (joined) {
        joined.members.push(unit);
        const n = joined.members.length;
        joined.lat = (joined.lat * (n - 1) + loc.latitude) / n;
        joined.lng = (joined.lng * (n - 1) + loc.longitude) / n;
      } else {
        clusters.push({ kind, lat: loc.latitude, lng: loc.longitude, members: [unit] });
      }
    }
    for (const c of clusters) {
      c.members.sort((a, b) => {
        const aLabel = fleetDisplayName(a);
        const bLabel = fleetDisplayName(b);
        return aLabel.localeCompare(bLabel, undefined, { numeric: true });
      });
      // Anchor cluster on the freshest GPS so the blip tracks live phone movement
      let best = c.members[0];
      let bestT = gpsTimeMs(best.currentLocation?.updatedAt);
      for (const m of c.members) {
        const t = gpsTimeMs(m.currentLocation?.updatedAt);
        if (t >= bestT) {
          best = m;
          bestT = t;
        }
      }
      if (best.currentLocation) {
        c.lat = best.currentLocation.latitude;
        c.lng = best.currentLocation.longitude;
      }
    }
    return clusters;
  }

  return [...clusterGroup(vehicles, 'vehicle'), ...clusterGroup(people, 'responder')];
}
