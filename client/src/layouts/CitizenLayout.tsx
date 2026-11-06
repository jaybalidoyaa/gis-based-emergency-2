import { useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Home, Siren, Bell, User, LogOut } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useHealth } from '@/hooks/useHealth';
import { NotificationHost } from '@/components/notifications/NotificationHost';
import { LiveSyncProvider } from '@/hooks/LiveSyncContext';
import { sosApi } from '@/services/api';
import { flushSosQueue } from '@/lib/offlineQueue';
import { useDevice } from '@/hooks/useDevice';
import clsx from 'clsx';

function CitizenShell() {
  const { user, accessToken, clearAuth } = useAuthStore();
  const navigate = useNavigate();
  const health = useHealth();
  const queryClient = useQueryClient();
  const device = useDevice();

  useEffect(() => {
    if (!accessToken) return;

    async function syncQueued() {
      if (!navigator.onLine || !accessToken) return;
      const result = await flushSosQueue((payload, key) =>
        sosApi.create(accessToken, payload, { idempotencyKey: key })
      );
      if (result.sent > 0) {
        toast.success(
          result.sent === 1 ? 'Queued SOS sent to Dispatch' : `${result.sent} queued SOS requests sent`
        );
        void queryClient.invalidateQueries({ queryKey: ['citizen-sos'] });
      }
    }

    void syncQueued();
    const onOnline = () => void syncQueued();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [accessToken, queryClient]);

  const nav = [
    { to: '/citizen', icon: Home, label: 'Home' },
    { to: '/citizen/sos', icon: Siren, label: 'SOS' },
    { to: '/citizen/notifications', icon: Bell, label: 'Alerts' },
    { to: '/citizen/profile', icon: User, label: 'Profile' },
  ];

  function logout() {
    clearAuth();
    navigate('/login');
  }

  const connectionLabel =
    health.isError || health.data?.status === 'down'
      ? 'Offline'
      : !navigator.onLine
        ? 'Offline'
        : health.data?.status === 'degraded'
          ? 'Limited connectivity'
          : 'Connected';

  return (
    <div
      className={clsx(
        'citizen-shell mx-auto flex w-full flex-col bg-navy-950',
        device === 'web' ? 'citizen-shell--web' : 'citizen-shell--mobile',
        device === 'ios' && 'citizen-shell--ios',
        device === 'android' && 'citizen-shell--android'
      )}
      data-device={device}
    >
      <header className="citizen-header shrink-0 border-b border-navy-700 bg-navy-900 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/logo.png" alt="" className="h-10 w-10 shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-500">Citizen emergency</p>
            <h1 className="truncate text-lg font-bold">Emergency services</h1>
            <p className="truncate text-sm text-ink-400">{user?.fullName}</p>
          </div>
        </div>
        <p
          className={clsx(
            'mt-2 font-mono text-[11px]',
            connectionLabel === 'Offline'
              ? 'text-alert-400'
              : connectionLabel === 'Limited connectivity'
                ? 'text-gold-400'
                : 'text-ok-400'
          )}
          role="status"
          aria-live="polite"
        >
          {connectionLabel}
        </p>
      </header>

      <main className="citizen-main min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
        <Outlet />
      </main>

      <NotificationHost />

      <nav
        className={clsx(
          'citizen-bottom-nav fixed bottom-0 z-50 w-full border-t border-navy-700 bg-navy-900',
          device === 'web'
            ? 'left-1/2 max-w-lg -translate-x-1/2'
            : 'left-0 right-0 max-w-full pb-[env(safe-area-inset-bottom)]'
        )}
        aria-label="Citizen navigation"
      >
        <div className="flex justify-around px-1 pt-1">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/citizen'}
              aria-label={label}
              className={({ isActive }) =>
                clsx(
                  'flex min-h-[48px] min-w-[64px] flex-col items-center justify-center gap-1 px-2 py-2 text-xs',
                  isActive ? 'font-medium text-gold-500' : 'text-ink-400'
                )
              }
            >
              <Icon className="h-6 w-6" aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
          <button
            type="button"
            onClick={logout}
            aria-label="Sign out"
            className="flex min-h-[48px] min-w-[64px] flex-col items-center justify-center gap-1 px-2 py-2 text-xs text-ink-400"
          >
            <LogOut className="h-6 w-6" aria-hidden="true" />
            Exit
          </button>
        </div>
      </nav>
    </div>
  );
}

export function CitizenLayout() {
  return (
    <LiveSyncProvider>
      <CitizenShell />
    </LiveSyncProvider>
  );
}
