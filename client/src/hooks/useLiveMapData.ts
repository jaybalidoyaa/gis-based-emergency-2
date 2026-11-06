import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mapApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { LIVE } from '@/lib/liveTiming';
import type { MapData, MapUnit } from '@/types';

type LivePin = {
  _id: string;
  gpsStale?: boolean;
  currentLocation?: { latitude: number; longitude: number; updatedAt?: string };
};

function coordsChanged(
  a?: { latitude: number; longitude: number; updatedAt?: string },
  b?: { latitude: number; longitude: number; updatedAt?: string }
) {
  if (!a && !b) return false;
  if (!a || !b) return true;
  return (
    a.latitude !== b.latitude ||
    a.longitude !== b.longitude ||
    a.updatedAt !== b.updatedAt
  );
}

function patchUnit(base: MapUnit, live?: LivePin): MapUnit {
  if (!live?.currentLocation) return base;
  if (
    !coordsChanged(base.currentLocation, live.currentLocation) &&
    base.gpsStale === (live.gpsStale ?? base.gpsStale)
  ) {
    return base;
  }
  return {
    ...base,
    gpsStale: live.gpsStale ?? base.gpsStale,
    currentLocation: {
      latitude: live.currentLocation.latitude,
      longitude: live.currentLocation.longitude,
      updatedAt:
        live.currentLocation.updatedAt ||
        base.currentLocation?.updatedAt ||
        new Date().toISOString(),
    },
  };
}

/**
 * Full map payload (incidents/facilities/routes) + 1s fleet GPS overlay for smooth live track.
 */
export function useLiveMapData(base?: MapData) {
  const { accessToken } = useAuthStore();
  const fleetQuery = useQuery({
    queryKey: ['map-fleet'],
    queryFn: () => mapApi.fleet(accessToken!),
    enabled: !!accessToken && !!base,
    refetchInterval: LIVE.mapLiveMs,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  return useMemo(() => {
    if (!base) return base;
    const live = fleetQuery.data?.data;
    if (!live) return base;

    const unitLive = new Map(live.units.map((u) => [u._id, u]));
    const respLive = new Map(live.responders.map((r) => [r._id, r]));

    let unitsChanged = false;
    let respondersChanged = false;
    const units = (base.units ?? []).map((u) => {
      const next = patchUnit(u, unitLive.get(u._id));
      if (next !== u) unitsChanged = true;
      return next;
    });
    const responders = (base.responders ?? []).map((r) => {
      const next = patchUnit(r, respLive.get(r._id));
      if (next !== r) respondersChanged = true;
      return next;
    });

    if (!unitsChanged && !respondersChanged) return base;
    return { ...base, units, responders };
  }, [base, fleetQuery.data]);
}
