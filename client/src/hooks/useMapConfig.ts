import { useQuery } from '@tanstack/react-query';
import { MAPBOX_OPS_STYLE } from '@/lib/mapboxStyle';
import { api } from '@/services/api';

export interface MapConfig {
  mapboxToken: string;
  mapStyle: string;
}

export function useMapConfig() {
  return useQuery({
    queryKey: ['map-config'],
    queryFn: async (): Promise<MapConfig> => {
      const fromEnv = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
      if (fromEnv) {
        return { mapboxToken: fromEnv, mapStyle: MAPBOX_OPS_STYLE };
      }
      const res = await api<{ success: boolean; data: MapConfig }>('/config');
      return res.data;
    },
    staleTime: Infinity,
  });
}
