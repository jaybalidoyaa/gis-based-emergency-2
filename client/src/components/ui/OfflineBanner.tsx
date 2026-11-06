import { useEffect, useRef, useState } from 'react';
import { healthApi } from '@/services/api';

type ConnectivityState = 'online' | 'unstable' | 'offline';

const PING_INTERVAL_MS = 30_000;
const UNSTABLE_DEBOUNCE_MS = 15_000;

export function OfflineBanner() {
  const [connectivity, setConnectivity] = useState<ConnectivityState>(() =>
    typeof navigator === 'undefined' || navigator.onLine ? 'online' : 'offline'
  );

  // Ref to hold the debounce timer for showing unstable banner
  const unstableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearUnstableTimer() {
    if (unstableTimerRef.current !== null) {
      clearTimeout(unstableTimerRef.current);
      unstableTimerRef.current = null;
    }
  }

  async function ping() {
    // Only ping if navigator reports online
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      clearUnstableTimer();
      setConnectivity('offline');
      return;
    }
    try {
      await healthApi.check();
      // Ping succeeded — online
      clearUnstableTimer();
      setConnectivity('online');
    } catch {
      // Ping failed but navigator thinks we're online — unstable
      // Debounce: only show unstable after 15s of sustained failure
      if (unstableTimerRef.current === null) {
        unstableTimerRef.current = setTimeout(() => {
          unstableTimerRef.current = null;
          // Re-check navigator before promoting to unstable
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setConnectivity('offline');
          } else {
            setConnectivity('unstable');
          }
        }, UNSTABLE_DEBOUNCE_MS);
      }
    }
  }

  useEffect(() => {
    function handleOnline() {
      clearUnstableTimer();
      setConnectivity('online');
      // Do an immediate ping after coming back online
      void ping();
    }

    function handleOffline() {
      clearUnstableTimer();
      setConnectivity('offline');
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Start periodic ping
    void ping();
    pingTimerRef.current = setInterval(() => void ping(), PING_INTERVAL_MS);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearUnstableTimer();
      if (pingTimerRef.current !== null) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (connectivity === 'online') return null;

  if (connectivity === 'unstable') {
    return (
      <div
        className="fixed left-0 right-0 top-0 z-50 bg-gold-600 py-2 text-center text-sm font-medium text-navy-950"
        role="alert"
      >
        Connection unstable. Some features may be delayed.
      </div>
    );
  }

  // offline
  return (
    <div
      className="fixed left-0 right-0 top-0 z-50 bg-gold-600 py-2 text-center text-sm font-medium text-navy-950"
      role="alert"
    >
      Connection lost. Reconnecting… Some features are unavailable offline.
    </div>
  );
}
