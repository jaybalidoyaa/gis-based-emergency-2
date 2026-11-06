import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { Radio, Map, Bell, User, LogOut, MessageSquare } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useHealth } from '@/hooks/useHealth';
import { ImportantAlertHost } from '@/components/responder/ImportantAlertHost';
import { LiveSyncProvider } from '@/hooks/LiveSyncContext';
import { startResponderGpsTracking, stopResponderGpsTracking } from '@/lib/responderGps';
import clsx from 'clsx';

function ResponderShell() {
  const { user, accessToken, clearAuth } = useAuthStore();
  const navigate = useNavigate();
  const health = useHealth();

  useEffect(() => {
    if (!accessToken) return;
    startResponderGpsTracking(accessToken);
    return () => stopResponderGpsTracking();
  }, [accessToken]);

  const nav = [
    { to: '.', icon: Radio, label: 'Jobs', end: true },
    { to: 'map', icon: Map, label: 'Map', end: false },
    { to: 'chat', icon: MessageSquare, label: 'Chat', end: false },
    { to: 'notifications', icon: Bell, label: 'Alerts', end: false },
    { to: 'profile', icon: User, label: 'Profile', end: false },
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
    <div className="citizen-shell mx-auto flex w-full max-w-md flex-col bg-navy-950">
      <header className="citizen-header shrink-0 border-b border-navy-700 bg-navy-900 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/logo.png" alt="" className="h-10 w-10 shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-500">Responder field</p>
            <h1 className="truncate text-lg font-bold">{user?.fullName}</h1>
            <p className="truncate text-sm text-ink-400">Emergency responder — Brigada Onse</p>
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

      <ImportantAlertHost />

      <nav
        className="citizen-bottom-nav fixed bottom-0 left-0 right-0 z-50 mx-auto w-full max-w-md border-t border-navy-700 bg-navy-900 pb-[env(safe-area-inset-bottom)]"
        aria-label="Responder navigation"
      >
        <div className="flex justify-around px-1 pt-1">
          {nav.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={label}
              to={to}
              end={end}
              aria-label={label}
              className={({ isActive }) =>
                clsx(
                  'flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px]',
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
            className="flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] text-ink-400"
          >
            <LogOut className="h-6 w-6" aria-hidden="true" />
            Exit
          </button>
        </div>
      </nav>
    </div>
  );
}

export function ResponderLayout() {
  return (
    <LiveSyncProvider>
      <ResponderShell />
    </LiveSyncProvider>
  );
}
