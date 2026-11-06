import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AdminSidebar } from '@/components/layout/AdminSidebar';
import { AdminHeader } from '@/components/layout/AdminHeader';
import { LiveSyncProvider } from '@/hooks/LiveSyncContext';
import { NotificationHost } from '@/components/notifications/NotificationHost';
import clsx from 'clsx';

class OutletErrorBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Admin page crashed', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-alert-500/40 bg-alert-500/10 p-4 text-sm text-alert-400" role="alert">
          <p className="font-semibold">This page failed to load.</p>
          <p className="mt-1 text-ink-300">{this.state.error.message}</p>
          <button
            type="button"
            className="mt-3 text-gold-400 underline"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function AdminLayout() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function onResize() {
      if (window.innerWidth >= 1024) setMobileOpen(false);
      // Auto-collapse sidebar on tablet (768–1023px)
      if (window.innerWidth >= 768 && window.innerWidth < 1024) setCollapsed(true);
      if (window.innerWidth >= 1024) setCollapsed(false);
    }
    // Run once on mount
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Always close mobile drawer + exit leftover map fullscreen on route change
  useEffect(() => {
    setMobileOpen(false);
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  }, [location.pathname]);

  return (
    <LiveSyncProvider>
      <div className="min-h-[100dvh] max-w-[100vw] overflow-x-hidden bg-navy-950">
        {mobileOpen && (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            aria-label="Close navigation overlay"
            onClick={() => setMobileOpen(false)}
          />
        )}
        <div
          className={clsx(
            'fixed inset-y-0 left-0 z-50 w-max max-w-[85vw] transition-transform lg:translate-x-0',
            mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          )}
        >
          <AdminSidebar collapsed={collapsed && !mobileOpen} onNavigate={() => setMobileOpen(false)} />
        </div>
        <AdminHeader
          collapsed={collapsed}
          onToggleSidebar={() => {
            if (window.innerWidth < 1024) setMobileOpen((v) => !v);
            else setCollapsed((v) => !v);
          }}
        />
        <main
          className={clsx(
            'ops-scroll flex h-[100dvh] max-h-[100dvh] max-w-full flex-col overflow-x-hidden overflow-y-auto pt-header transition-all',
            'pl-0',
            collapsed ? 'lg:pl-16' : 'lg:pl-sidebar'
          )}
        >
          <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col p-3 sm:p-4 md:p-6">
            <OutletErrorBoundary resetKey={location.pathname}>
              <Outlet key={location.pathname} />
            </OutletErrorBoundary>
          </div>
        </main>
        <NotificationHost />
      </div>
    </LiveSyncProvider>
  );
}
