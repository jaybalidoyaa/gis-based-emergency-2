import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { mapApi } from '@/services/api';
import { MonitorMapView } from '@/components/map/MonitorMapView';
import { useLiveMapData } from '@/hooks/useLiveMapData';
import { LIVE } from '@/lib/liveTiming';

/** Full-viewport map wall — no page chrome / no page scroll. */
export function MapMonitoringPage() {
  const navigate = useNavigate();
  const { accessToken } = useAuthStore();
  const { data, isError, error, refetch } = useQuery({
    queryKey: ['map-data'],
    queryFn: () => mapApi.data(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });
  const liveData = useLiveMapData(data?.data);

  return (
    <div className="monitor-page -m-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden sm:-m-4 md:-m-6">
      {isError && (
        <div
          className="shrink-0 border-b border-alert-500/40 bg-alert-500/10 px-3 py-2 text-sm text-alert-400"
          role="alert"
        >
          Map overlay data failed to load.{' '}
          <button type="button" className="underline" onClick={() => refetch()}>
            Retry
          </button>
          {error instanceof Error ? ` — ${error.message}` : ''}
        </div>
      )}
      <div className="min-h-0 min-w-0 flex-1">
        <MonitorMapView
          data={liveData}
          height="100%"
          className="h-full w-full rounded-none border-0"
          showBoundary
          showFacilities
          onIncidentClick={(inc) => navigate(`/admin/incidents/${inc._id}`)}
        />
      </div>
    </div>
  );
}
