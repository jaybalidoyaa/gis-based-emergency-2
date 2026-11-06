import { useState } from 'react';
import { LIVE } from '@/lib/liveTiming';
import { useNavigate } from 'react-router-dom';
import { Bell, LogOut, Menu, Settings, User } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { authApi, notificationsApi } from '@/services/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmActionDialog } from '@/components/ui/ConfirmActionDialog';
import { ROUTES } from '@/constants/routes';
import { asArray } from '@/lib/workforceMetrics';
import clsx from 'clsx';

interface AdminHeaderProps {
  onToggleSidebar: () => void;
  collapsed?: boolean;
}

export function AdminHeader({ onToggleSidebar, collapsed }: AdminHeaderProps) {
  const { user, accessToken, clearAuth } = useAuthStore();
  const navigate = useNavigate();
  const [signOutOpen, setSignOutOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.coolMs,
  });

  const unread = asArray<{ readAt?: string }>(data?.data).filter((n) => !n.readAt).length;
  const roleLabel = user?.role?.replace(/_/g, ' ') ?? '';

  async function handleLogout() {
    try {
      if (accessToken) await authApi.logout(accessToken);
    } finally {
      clearAuth();
      navigate(ROUTES.LOGIN);
    }
  }

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <>
      <header
        className={clsx(
          'fixed top-0 right-0 z-30 flex h-header items-center justify-between gap-2 border-b border-navy-700 bg-navy-900/90 px-3 backdrop-blur sm:px-4 md:px-6',
          'left-0',
          collapsed ? 'lg:left-16' : 'lg:left-sidebar'
        )}
      >
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={onToggleSidebar} aria-label="Toggle sidebar">
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold uppercase tracking-wide text-ink-50">Barangay Sun Valley</h1>
            <p className="hidden truncate text-xs text-ink-400 sm:block">BDRRMO / Brigada Onse — GIS dispatch & response</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="relative"
            aria-label="Notifications"
            onClick={() => navigate(ROUTES.ADMIN_NOTIFICATIONS)}
          >
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute right-1 top-1 min-w-4 rounded-full bg-alert-500 px-1 text-[10px] font-bold leading-4 text-white">
                {unread}
              </span>
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" className="gap-3 px-2">
                <div className="hidden text-right sm:block">
                  <p className="text-sm font-medium">
                    {greeting}, {user?.fullName}
                  </p>
                  <p className="text-xs text-ink-400">{roleLabel}</p>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-800 text-gold-500">
                  <User className="h-5 w-5" aria-hidden="true" />
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* TODO: Replace ADMIN_PERSONNEL with /admin/profile once a dedicated profile page exists */}
              <DropdownMenuItem onClick={() => navigate(ROUTES.ADMIN_PERSONNEL)}>
                <User className="h-4 w-4" />
                My Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate(ROUTES.ADMIN_SETTINGS)}>
                <Settings className="h-4 w-4" />
                Account Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSignOutOpen(true)}>
                <LogOut className="h-4 w-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <ConfirmActionDialog
        open={signOutOpen}
        request={{
          title: 'Sign Out',
          description: 'Are you sure you want to sign out?',
          confirmLabel: 'Sign Out',
          cancelLabel: 'Cancel',
          tone: 'destructive',
        }}
        onCancel={() => setSignOutOpen(false)}
        onConfirm={handleLogout}
      />
    </>
  );
}
