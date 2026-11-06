import { LIVE } from '@/lib/liveTiming';
import { useQuery } from '@tanstack/react-query';
import { healthApi } from '@/services/api';

export function useHealth() {
  return useQuery({
    queryKey: ['system-health'],
    queryFn: () => healthApi.check(),
    refetchInterval: LIVE.coolMs,
    retry: 1,
  });
}
