import { createContext, useContext, useCallback, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLiveSync, type LiveState } from '@/hooks/useLiveSync';

interface LiveSyncContextValue {
  state: LiveState;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
  refreshing: boolean;
}

const LiveSyncContext = createContext<LiveSyncContextValue | null>(null);

export function LiveSyncProvider({ children }: { children: ReactNode }) {
  const live = useLiveSync();
  const queryClient = useQueryClient();
  const markUpdated = live.markUpdated;

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] }),
      queryClient.invalidateQueries({ queryKey: ['map-data'] }),
      queryClient.invalidateQueries({ queryKey: ['map-fleet'] }),
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      queryClient.invalidateQueries({ queryKey: ['dispatch-queue'] }),
      queryClient.invalidateQueries({ queryKey: ['personnel'] }),
      queryClient.invalidateQueries({ queryKey: ['attendance'] }),
      queryClient.invalidateQueries({ queryKey: ['shifts'] }),
      queryClient.invalidateQueries({ queryKey: ['incidents'] }),
      queryClient.invalidateQueries({ queryKey: ['incident'] }),
      queryClient.invalidateQueries({ queryKey: ['sos'] }),
      queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
      queryClient.invalidateQueries({ queryKey: ['equipment'] }),
      queryClient.invalidateQueries({ queryKey: ['transports'] }),
      queryClient.invalidateQueries({ queryKey: ['audit'] }),
    ]);
    await queryClient.refetchQueries({ queryKey: ['dashboard-stats'] });
    await queryClient.refetchQueries({ queryKey: ['map-data'] });
    markUpdated();
  }, [queryClient, markUpdated]);

  return (
    <LiveSyncContext.Provider
      value={{
        state: live.state,
        lastUpdated: live.lastUpdated,
        refresh,
        refreshing: live.refreshing,
      }}
    >
      {children}
    </LiveSyncContext.Provider>
  );
}

export function useAdminLiveSync() {
  const ctx = useContext(LiveSyncContext);
  if (!ctx) {
    throw new Error('useAdminLiveSync must be used within LiveSyncProvider');
  }
  return ctx;
}
