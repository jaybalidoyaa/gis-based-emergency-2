import { LIVE } from '@/lib/liveTiming';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { notificationsApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { formatManilaDateTime } from '@/lib/timezone';
import { QueryState } from '@/components/ui/QueryState';
import { OpsSectionHeader } from '@/components/ui/OpsSection';
import { Button } from '@/components/ui/button';
import { asArray } from '@/lib/workforceMetrics';
import clsx from 'clsx';

function notificationHref(n: { incidentId?: string; type?: string }) {
  if (n.incidentId) return `/admin/incidents/${n.incidentId}`;
  const t = (n.type ?? '').toLowerCase();
  if (t.includes('sos')) return '/admin/sos';
  if (t.includes('shift') || t.includes('attendance')) return '/admin/attendance';
  if (t.includes('report')) return '/admin/reports';
  return '/admin/notifications';
}

export function RecentNotificationsPanel() {
  const { accessToken } = useAuthStore();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.coolMs,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(accessToken!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const items = [...asArray<{ sentAt: string; readAt?: string; _id: string; title: string; message?: string; type?: string; incidentId?: string; priority?: string }>(query.data?.data)].sort(
    (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()
  );
  const recent = items.slice(0, 20);

  return (
    <div className="card flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden p-3 sm:p-4">
      <OpsSectionHeader
        title="Notifications"
        href="/admin/notifications"
        linkLabel="View all"
        className="shrink-0"
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!accessToken || !items.some((n) => !n.readAt) || markRead.isPending}
            onClick={() => {
              if (!accessToken) return;
              void notificationsApi.markAllRead(accessToken).then(() =>
                queryClient.invalidateQueries({ queryKey: ['notifications'] })
              );
            }}
          >
            <CheckCheck className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Mark all as read</span>
            <span className="sm:hidden">Mark read</span>
          </Button>
        }
      />
      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error as Error}
        onRetry={() => query.refetch()}
        isEmpty={recent.length === 0}
        emptyTitle="No notifications"
        emptyHint="Operational alerts will appear here."
        showLastUpdated={false}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto sidebar-scroll pr-1">
          {recent.map((n) => {
            const unread = !n.readAt;
            const href = notificationHref(n);
            return (
              <li key={n._id}>
                <Link
                  to={href}
                  onClick={() => {
                    if (unread) markRead.mutate(n._id);
                  }}
                  className={clsx(
                    'flex gap-3 rounded-md border p-2.5 transition-colors sm:p-3',
                    unread ? 'border-gold-500/40 bg-gold-500/5' : 'border-navy-700 bg-navy-900/70',
                    'hover:bg-navy-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500'
                  )}
                  aria-label={`${n.title}. ${unread ? 'Unread' : 'Read'}. Priority ${n.priority}`}
                >
                  <span
                    className={clsx(
                      'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
                      n.priority === 'Urgent' || n.priority === 'Critical'
                        ? 'bg-alert-500/15 text-alert-400'
                        : 'bg-navy-700 text-ink-300'
                    )}
                    aria-hidden="true"
                  >
                    <Bell className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className={clsx('truncate text-sm', unread ? 'font-semibold text-ink-50' : 'font-medium text-ink-200')}>
                        {n.title}
                      </p>
                      <span className="shrink-0 font-mono text-[10px] text-ink-500">{formatManilaDateTime(n.sentAt)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-ink-400">{n.message}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </QueryState>
    </div>
  );
}
