import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { eventsApi } from '@/services/api';
import { LIVE } from '@/lib/liveTiming';

export type LiveState = 'live' | 'reconnecting' | 'offline';

export function useLiveSync() {
  const { accessToken } = useAuthStore();
  const queryClient = useQueryClient();
  const [state, setState] = useState<LiveState>(navigator.onLine ? 'live' : 'offline');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const delayRef = useRef<number>(LIVE.syncMs);

  const markUpdated = useCallback(() => setLastUpdated(new Date()), []);

  useEffect(() => {
    const on = () => {
      delayRef.current = LIVE.syncMs;
      setState('reconnecting');
    };
    const off = () => setState('offline');
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    let timer: number | undefined;
    const since = { current: new Date(Date.now() - LIVE.coolMs).toISOString() };

    const tick = async () => {
      if (!navigator.onLine) {
        setState('offline');
        timer = window.setTimeout(tick, delayRef.current);
        return;
      }
      try {
        setRefreshing(true);
        const res = await eventsApi.poll(accessToken, since.current);
        if (cancelled) return;
        since.current = res.data.serverTime;
        setLastUpdated(new Date());
        setState('live');
        delayRef.current = LIVE.syncMs;
        if (res.data.incidents.length || res.data.notifications.length) {
          queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
          queryClient.invalidateQueries({ queryKey: ['dispatch-queue'] });
          queryClient.invalidateQueries({ queryKey: ['map-data'] });
          queryClient.invalidateQueries({ queryKey: ['map-fleet'] });
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          queryClient.invalidateQueries({ queryKey: ['my-assignments'] });
          queryClient.invalidateQueries({ queryKey: ['incidents'] });
          queryClient.invalidateQueries({ queryKey: ['incident'] });
          queryClient.invalidateQueries({ queryKey: ['personnel'] });
          queryClient.invalidateQueries({ queryKey: ['attendance'] });
          queryClient.invalidateQueries({ queryKey: ['shifts'] });
          queryClient.invalidateQueries({ queryKey: ['sos'] });
          queryClient.invalidateQueries({ queryKey: ['citizen-sos'] });
          queryClient.invalidateQueries({ queryKey: ['responder-me'] });
          queryClient.invalidateQueries({ queryKey: ['responders-chat'] });
          queryClient.invalidateQueries({ queryKey: ['incident-chat'] });
          queryClient.invalidateQueries({ queryKey: ['vehicles'] });
          queryClient.invalidateQueries({ queryKey: ['equipment'] });
          queryClient.invalidateQueries({ queryKey: ['transports'] });
          queryClient.invalidateQueries({ queryKey: ['audit'] });
          queryClient.invalidateQueries({ queryKey: ['profile'] });
        }
      } catch {
        if (cancelled) return;
        setState('reconnecting');
        delayRef.current = Math.min(delayRef.current * 2, LIVE.syncMaxMs);
      } finally {
        if (!cancelled) setRefreshing(false);
      }
      timer = window.setTimeout(tick, delayRef.current);
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [accessToken, queryClient]);

  return { state, lastUpdated, refreshing, markUpdated };
}
