import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bell,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  Flame,
  HeartPulse,
  MapPin,
  Megaphone,
  MessageSquare,
  Plus,
  Search,
  Shield,
  Siren,
  Star,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { notificationsApi, mapApi } from '@/services/api';
import { LIVE } from '@/lib/liveTiming';
import type { NotificationItem } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { QueryState } from '@/components/ui/QueryState';
import { FreshnessLine, liveSyncToFreshness } from '@/components/ui/FreshnessLine';
import { ConfirmActionDialog } from '@/components/ui/ConfirmActionDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MapView } from '@/components/map/MapView';
import { useAdminLiveSync } from '@/hooks/LiveSyncContext';
import { formatRole } from '@/lib/incidentState';
import { formatManilaDate, formatManilaDateTime, formatManilaTime } from '@/lib/timezone';
import clsx from 'clsx';

type NotifCategory = 'Alert' | 'Announcement' | 'System' | 'Scheduled';
type BroadcastKind = 'Immediate' | 'Alert' | 'Announcement' | 'System' | 'Scheduled';
type BroadcastAudience = 'ALL' | 'RESPONDERS' | 'CITIZENS' | 'DISPATCHERS';
type BroadcastPriority = 'Critical' | 'Urgent' | 'Important' | 'Normal' | 'Info';

const TABS: { id: 'All' | NotifCategory; label: string }[] = [
  { id: 'All', label: 'All Notifications' },
  { id: 'Alert', label: 'Alerts' },
  { id: 'Announcement', label: 'Announcements' },
  { id: 'System', label: 'System' },
  { id: 'Scheduled', label: 'Scheduled' },
];

const BROADCAST_KINDS: {
  id: BroadcastKind;
  label: string;
  hint: string;
  defaultPriority: BroadcastPriority;
}[] = [
  { id: 'Immediate', label: 'Immediate', hint: 'Critical / time-sensitive ops alert', defaultPriority: 'Critical' },
  { id: 'Alert', label: 'Alert', hint: 'Urgent operational warning', defaultPriority: 'Urgent' },
  { id: 'Announcement', label: 'Announcement', hint: 'Bulletin for selected audience', defaultPriority: 'Important' },
  { id: 'System', label: 'System', hint: 'Maintenance, outage, or system notice', defaultPriority: 'Info' },
  { id: 'Scheduled', label: 'Operational notice', hint: 'Shift/drill wording — still sends immediately (scheduling not implemented)', defaultPriority: 'Normal' },
];

const BROADCAST_AUDIENCES: { id: BroadcastAudience; label: string; hint: string }[] = [
  { id: 'ALL', label: 'All users', hint: 'Dispatchers, responders, and citizens' },
  { id: 'RESPONDERS', label: 'Responders', hint: 'Active emergency responders only' },
  { id: 'CITIZENS', label: 'Citizens', hint: 'Citizen app users only' },
  { id: 'DISPATCHERS', label: 'Dispatchers', hint: 'Central / department dispatch + admins' },
];

function audienceLabel(audience?: string) {
  switch ((audience || '').toUpperCase()) {
    case 'ALL':
      return 'All users';
    case 'RESPONDERS':
      return 'Responders';
    case 'CITIZENS':
      return 'Citizens';
    case 'DISPATCHERS':
      return 'Dispatchers';
    default:
      return audience || 'Assigned recipients';
  }
}

const PAGE_SIZE = 7;

function categorize(n: NotificationItem): NotifCategory {
  const t = `${n.type} ${n.title} ${n.priority}`.toLowerCase();
  if (/announce|broadcast|bulletin|megaphone/.test(t)) return 'Announcement';
  if (/shift|attendance|schedule|conduction|transport|reminder|scheduled/.test(t)) return 'Scheduled';
  if (/sos|fire|alert|urgent|critical|backup|dispatch team|important|hazard|immediate/.test(t)) return 'Alert';
  return 'System';
}

function categoryMeta(cat: NotifCategory): { color: string; bg: string; border: string; Icon: LucideIcon } {
  switch (cat) {
    case 'Alert':
      return { color: 'text-alert-400', bg: 'bg-alert-500', border: 'border-alert-500/40', Icon: Flame };
    case 'Announcement':
      return { color: 'text-ok-400', bg: 'bg-ok-500', border: 'border-ok-500/40', Icon: Megaphone };
    case 'Scheduled':
      return { color: 'text-gold-400', bg: 'bg-gold-500', border: 'border-gold-500/40', Icon: Bell };
    default:
      return { color: 'text-[#60a5fa]', bg: 'bg-[#3b82f6]', border: 'border-[#3b82f6]/40', Icon: Shield };
  }
}

function iconForNotification(n: NotificationItem): LucideIcon {
  const t = `${n.type} ${n.title} ${n.incidentTypeName ?? ''}`.toLowerCase();
  if (/fire|structural|alarm/.test(t)) return Flame;
  if (/medical|ems|cardiac|ambulance|health/.test(t)) return HeartPulse;
  if (/sos|siren|emergency/.test(t)) return Siren;
  if (/announce|broadcast/.test(t)) return Megaphone;
  if (/chat|message|reply/.test(t)) return MessageSquare;
  if (/shift|attendance|schedule/.test(t)) return Bell;
  return categorize(n) === 'System' ? Shield : Bell;
}

function relativeStamp(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const sameDay =
    d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) ===
    now.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const yesterday = new Date(now.getTime() - 86400000);
  const isYesterday =
    d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) ===
    yesterday.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const time = formatManilaTime(d);
  if (sameDay) return time;
  if (isYesterday) return `Yesterday, ${time}`;
  return `${formatManilaDate(d)}, ${time}`;
}

export function NotificationsPage() {
  const { accessToken } = useAuthStore();
  const live = useAdminLiveSync();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('All');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<string>('All');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [dismissConfirmId, setDismissConfirmId] = useState<string | null>(null);

  const [composeTitle, setComposeTitle] = useState('');
  const [composeMessage, setComposeMessage] = useState('');
  const [composeKind, setComposeKind] = useState<BroadcastKind>('Alert');
  const [composeAudience, setComposeAudience] = useState<BroadcastAudience>('RESPONDERS');
  const [composePriority, setComposePriority] = useState<BroadcastPriority>('Urgent');
  const [composeBusy, setComposeBusy] = useState(false);

  const listQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.coolMs,
  });

  const mapQuery = useQuery({
    queryKey: ['map-data'],
    queryFn: () => mapApi.data(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });

  const trackingQuery = useQuery({
    queryKey: ['notification-tracking', selectedId],
    queryFn: () => notificationsApi.tracking(accessToken!, selectedId!),
    enabled: !!accessToken && !!selectedId,
    refetchInterval: LIVE.coolMs,
  });
  const tracking = trackingQuery.data?.data;

  const items = listQuery.data?.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((n) => {
      const cat = categorize(n);
      if (tab !== 'All' && cat !== tab) return false;
      if (unreadOnly && n.readAt) return false;
      if (priorityFilter !== 'All' && n.priority !== priorityFilter) return false;
      if (!q) return true;
      return `${n.title} ${n.message} ${n.type} ${n.incidentDisplayId ?? ''}`.toLowerCase().includes(q);
    });
  }, [items, tab, search, unreadOnly, priorityFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [tab, search, unreadOnly, priorityFilter]);

  useEffect(() => {
    if (page > pageCount - 1) setPage(0);
  }, [page, pageCount]);

  useEffect(() => {
    if (!filtered.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.some((n) => n._id === selectedId)) {
      setSelectedId(filtered[0]._id);
    }
  }, [filtered, selectedId]);

  const selected = filtered.find((n) => n._id === selectedId) ?? null;
  const selectedCat = selected ? categorize(selected) : null;
  const selectedMeta = selectedCat ? categoryMeta(selectedCat) : null;
  const SelectedIcon = selected ? iconForNotification(selected) : Bell;

  async function markRead(id: string) {
    if (!accessToken) return;
    setBusy(true);
    try {
      await notificationsApi.markRead(accessToken, id);
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['notification-tracking', id] });
      toast.success('Marked as read');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark read');
    } finally {
      setBusy(false);
    }
  }

  async function markAll() {
    if (!accessToken) return;
    setBusy(true);
    try {
      await notificationsApi.markAllRead(accessToken);
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('All notifications marked read');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeOne(id: string) {
    if (!accessToken) return;
    setBusy(true);
    try {
      await notificationsApi.remove(accessToken, id);
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('Notification deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  function openCompose() {
    const defaults = BROADCAST_KINDS.find((k) => k.id === 'Alert')!;
    setComposeTitle('');
    setComposeMessage('');
    setComposeKind('Alert');
    setComposeAudience('RESPONDERS');
    setComposePriority(defaults.defaultPriority);
    setComposeOpen(true);
  }

  function selectKind(kind: BroadcastKind) {
    setComposeKind(kind);
    const defaults = BROADCAST_KINDS.find((k) => k.id === kind);
    if (defaults) setComposePriority(defaults.defaultPriority);
  }

  async function sendBroadcast() {
    if (!accessToken) return;
    if (!composeTitle.trim() || !composeMessage.trim()) {
      toast.error('Title and message are required');
      return;
    }
    if (composeKind === 'Scheduled') {
      toast.message('Sends immediately', {
        description: 'Delayed scheduling is not available yet. This will deliver now as an operational notice.',
      });
    }
    setComposeBusy(true);
    try {
      const res = await notificationsApi.broadcast(accessToken, {
        title: composeTitle.trim(),
        message: composeMessage.trim(),
        audience: composeAudience,
        kind: composeKind,
        priority: composePriority,
      });
      toast.success(`Sent to ${res.data.sent} recipient${res.data.sent === 1 ? '' : 's'}`);
      setComposeOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['notification-tracking'] });
      void queryClient.invalidateQueries({ queryKey: ['announcements'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send notification');
    } finally {
      setComposeBusy(false);
    }
  }

  const showingFrom = filtered.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, filtered.length);

  const activity = selected
    ? [
        {
          at: selected.sentAt,
          label: `Notification sent${tracking ? ` to ${tracking.total} recipient${tracking.total === 1 ? '' : 's'}` : ''}`,
          tone: 'ok' as const,
        },
        {
          at: selected.sentAt,
          label: 'In-app notification rows created',
          tone: 'ok' as const,
        },
        {
          at: selected.sentAt,
          label:
            tracking?.pushSubscribed != null
              ? `Push: ${tracking.pushSubscribed} subscribed endpoint(s) (device delivery not confirmed)`
              : 'Push: queued only if recipient has a subscription (device delivery not confirmed)',
          tone: 'info' as const,
        },
        {
          at: '',
          label: 'SMS not configured',
          tone: 'warn' as const,
        },
        ...(tracking?.acknowledged.slice(0, 8).map((p) => ({
          at: p.readAt || '',
          label: `Acknowledged by ${p.fullName}`,
          tone: 'ok' as const,
        })) ?? []),
        ...(tracking && tracking.pendingCount > 0
          ? [
              {
                at: '',
                label: `${tracking.pendingCount} recipient${tracking.pendingCount === 1 ? '' : 's'} pending acknowledgement`,
                tone: 'warn' as const,
              },
            ]
          : []),
        ...(tracking?.replies.slice(-5).map((r) => ({
          at: r.createdAt,
          label: `Reply from ${r.fullName}`,
          tone: 'info' as const,
        })) ?? []),
      ]
    : [];

  const audienceText = audienceLabel(selected?.audience || tracking?.audience);

  return (
    <div className="notifications-page -m-3 flex min-h-0 flex-1 flex-col overflow-hidden sm:-m-4 md:-m-6">
      {/* Header */}
      <header className="shrink-0 border-b border-navy-700 px-3 py-3 sm:px-4 md:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="font-mono text-lg font-bold uppercase tracking-[0.12em] text-ink-50 sm:text-xl">
              Notifications
            </h1>
            <p className="mt-0.5 text-sm text-ink-400">Manage and monitor all system notifications and alerts</p>
            <FreshnessLine
              state={liveSyncToFreshness(live.state, live.lastUpdated)}
              lastUpdated={listQuery.dataUpdatedAt}
              compact
              className="mt-1.5"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-[40px] gap-2" disabled={busy} onClick={() => void markAll()}>
              <CheckCheck className="h-4 w-4" aria-hidden />
              Mark all read
            </Button>
            <Button type="button" variant="outline" className="min-h-[40px] gap-2" onClick={() => setFilterOpen(true)}>
              <Filter className="h-4 w-4" aria-hidden />
              Filter
            </Button>
            <Button
              type="button"
              className="min-h-[40px] gap-2 bg-[#3b82f6] hover:bg-[#60a5fa]"
              onClick={openCompose}
            >
              <Plus className="h-4 w-4" aria-hidden />
              New Notification
            </Button>
          </div>
        </div>

        <div className="mt-3 flex gap-1 overflow-x-auto pb-0.5" role="tablist" aria-label="Notification categories">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                'min-h-[40px] shrink-0 border-b-2 px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors',
                tab === t.id
                  ? 'border-[#3b82f6] text-[#60a5fa]'
                  : 'border-transparent text-ink-400 hover:text-ink-200'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 sm:p-4 md:p-5 lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.35fr)_minmax(220px,0.72fr)] lg:gap-4 lg:overflow-hidden">
        {/* List */}
        <section className="card flex min-h-0 min-w-0 flex-col overflow-hidden lg:max-h-full">
          <div className="shrink-0 border-b border-navy-700 p-2.5">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search notifications..."
                className="input-field w-full pl-9"
              />
            </label>
          </div>

          <QueryState
            isLoading={listQuery.isLoading}
            isError={listQuery.isError}
            error={listQuery.error as Error}
            onRetry={() => listQuery.refetch()}
            isEmpty={!listQuery.isLoading && filtered.length === 0}
            emptyTitle="No notifications"
            emptyHint="Alerts, announcements, and system messages will appear here."
            showLastUpdated={false}
            className="flex min-h-0 flex-1 flex-col"
          >
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 sidebar-scroll">
              {pageItems.map((n) => {
                const cat = categorize(n);
                const meta = categoryMeta(cat);
                const Icon = iconForNotification(n);
                const active = selected?._id === n._id;
                return (
                  <li key={n._id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(n._id)}
                      aria-pressed={active}
                      className={clsx(
                        'flex w-full gap-2.5 rounded-md border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
                        active
                          ? 'border-[#3b82f6]/50 bg-navy-800'
                          : 'border-navy-700 bg-navy-900/50 hover:border-navy-600 hover:bg-navy-800/70',
                        !n.readAt && 'ring-1 ring-inset ring-gold-500/20'
                      )}
                    >
                      <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-50', meta.bg)}>
                        <Icon className="h-4 w-4" strokeWidth={2.4} aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className={clsx('truncate text-sm text-ink-50', !n.readAt && 'font-semibold')}>{n.title}</p>
                          <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-ink-500">
                            {relativeStamp(n.sentAt)}
                            <span
                              className={clsx(
                                'inline-block h-1.5 w-1.5 rounded-full',
                                n.readAt ? 'bg-[#3b82f6]' : 'bg-alert-500'
                              )}
                              aria-label={n.readAt ? 'Read' : 'Unread'}
                            />
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-ink-400">{n.message}</p>
                        <div className="mt-1.5 flex items-center justify-end">
                          <span
                            className={clsx(
                              'rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide',
                              cat === 'Alert' && 'bg-alert-500/20 text-alert-400',
                              cat === 'Announcement' && 'bg-ok-500/20 text-ok-400',
                              cat === 'Scheduled' && 'bg-gold-500/20 text-gold-400',
                              cat === 'System' && 'bg-[#3b82f6]/20 text-[#60a5fa]'
                            )}
                          >
                            {cat}
                          </span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </QueryState>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-navy-700 px-3 py-2">
            <p className="font-mono text-[10px] text-ink-500">
              Showing {showingFrom} to {showingTo} of {filtered.length} notifications
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded border border-navy-600 p-1.5 text-ink-300 hover:bg-navy-800 disabled:opacity-40"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {Array.from({ length: Math.min(pageCount, 5) }, (_, i) => {
                const start = Math.max(0, Math.min(page - 2, pageCount - 5));
                const idx = start + i;
                if (idx >= pageCount) return null;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setPage(idx)}
                    className={clsx(
                      'min-w-8 rounded px-2 py-1 font-mono text-[11px]',
                      page === idx ? 'bg-[#3b82f6] text-ink-50' : 'text-ink-400 hover:bg-navy-800'
                    )}
                  >
                    {idx + 1}
                  </button>
                );
              })}
              <button
                type="button"
                className="rounded border border-navy-600 p-1.5 text-ink-300 hover:bg-navy-800 disabled:opacity-40"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>

        {/* Detail */}
        <section className="flex min-h-0 min-w-0 flex-col gap-3 lg:overflow-hidden">
          {!selected || !selectedMeta ? (
            <div className="card flex min-h-[240px] flex-1 flex-col items-center justify-center p-8 text-center text-sm text-ink-400">
              <Bell className="mb-3 h-8 w-8 text-ink-600" aria-hidden />
              <p className="font-medium text-ink-200">Select a notification</p>
              <p className="mt-1">Review message details, delivery, and related incident.</p>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto sidebar-scroll">
              <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
                <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                  Notification Details
                </h2>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    type="button"
                    className="min-h-[40px] gap-2 bg-[#3b82f6] hover:bg-[#60a5fa]"
                    disabled={busy || !!selected.readAt}
                    onClick={() => void markRead(selected._id)}
                  >
                    <Check className="h-4 w-4" aria-hidden />
                    {selected.readAt ? 'Read' : 'Mark as Read'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-[40px] gap-2 border-alert-500/40 text-alert-400 hover:bg-alert-500/10"
                    disabled={busy}
                    onClick={() => setDismissConfirmId(selected._id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    Dismiss
                  </Button>
                </div>
              </div>

              <div className="card p-3 sm:p-4">
                <div className="flex min-w-0 gap-3">
                  <span className={clsx('flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-ink-50', selectedMeta.bg)}>
                    <SelectedIcon className="h-6 w-6" strokeWidth={2.2} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold text-ink-50 sm:text-lg">{selected.title}</h3>
                      <span
                        className={clsx(
                          'rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase',
                          selectedCat === 'Alert' && 'bg-alert-500/20 text-alert-400',
                          selectedCat === 'Announcement' && 'bg-ok-500/20 text-ok-400',
                          selectedCat === 'Scheduled' && 'bg-gold-500/20 text-gold-400',
                          selectedCat === 'System' && 'bg-[#3b82f6]/20 text-[#60a5fa]'
                        )}
                      >
                        {selectedCat}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-400">
                      {selected.location?.addressText && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5 text-gold-500" aria-hidden />
                          {selected.location.addressText}
                        </span>
                      )}
                      <span>{formatManilaDate(selected.sentAt)}</span>
                      <span>{formatManilaTime(selected.sentAt)}</span>
                      <span>By: {selected.senderName || selected.type || 'System'}</span>
                      {selected.audience ? <span>To: {audienceText}</span> : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="card p-3 sm:p-4">
                <h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                  Message
                </h3>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-100">{selected.message}</p>
              </div>

              <div className="card p-3 sm:p-4">
                <h3 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                  Delivery Channels
                </h3>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span className="inline-flex items-center gap-2 text-ok-400">
                    <Star className="h-4 w-4" aria-hidden /> In-App (rows created)
                  </span>
                  <span className="inline-flex items-center gap-2 text-ink-500">
                    <MessageSquare className="h-4 w-4" aria-hidden /> SMS (not configured)
                  </span>
                  <span className="inline-flex items-center gap-2 text-gold-400">
                    <Check className="h-4 w-4" aria-hidden /> Push (subscription only — not device-confirmed)
                  </span>
                </div>
                {tracking?.channelNotes ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-500">{tracking.channelNotes}</p>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="card p-3 sm:p-4">
                  <h3 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                    Recipients Summary
                  </h3>
                  {trackingQuery.isLoading ? (
                    <p className="text-sm text-ink-500">Loading recipients…</p>
                  ) : (
                    <>
                      <p className="text-2xl font-bold text-ink-50">{tracking?.total ?? 1}</p>
                      <p className="text-xs text-ink-500">{audienceText}</p>
                      <dl className="mt-3 space-y-1.5 text-sm">
                        <div className="flex justify-between gap-2">
                          <dt className="text-ink-400">In-app created</dt>
                          <dd className="font-mono text-ok-400">
                            {tracking?.inAppCreated ?? tracking?.delivered ?? tracking?.total ?? 1}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-ink-400">Push subscribed</dt>
                          <dd className="font-mono text-gold-400">
                            {tracking?.pushSubscribed ?? '—'}
                            {tracking?.pushNotSubscribed != null ? (
                              <span className="text-ink-500"> · {tracking.pushNotSubscribed} without</span>
                            ) : null}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-ink-400">Acknowledged (read)</dt>
                          <dd className="font-mono text-ok-400">
                            {tracking?.acknowledgedCount ?? (selected.readAt ? 1 : 0)} ·{' '}
                            {tracking?.acknowledgedPct ?? (selected.readAt ? 100 : 0)}%
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-ink-400">Pending read</dt>
                          <dd className="font-mono text-gold-400">
                            {tracking?.pendingCount ?? (selected.readAt ? 0 : 1)} ·{' '}
                            {tracking?.pendingPct ?? (selected.readAt ? 0 : 100)}%
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-ink-400">Failed (tracked)</dt>
                          <dd className="font-mono text-ink-500">
                            {tracking?.failedCount ?? 0} · not instrumented for push
                          </dd>
                        </div>
                      </dl>
                    </>
                  )}
                </div>
                <div className="card p-3 sm:p-4">
                  <h3 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                    Priority & Scope
                  </h3>
                  <dl className="space-y-2 text-sm">
                    <div>
                      <dt className="text-[11px] text-ink-500">Priority Level</dt>
                      <dd className={clsx('font-semibold', /urgent|critical|important/i.test(selected.priority) ? 'text-alert-400' : 'text-ink-100')}>
                        {selected.priority || 'Normal'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-ink-500">Target Audience</dt>
                      <dd className="text-ink-100">{audienceText}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-ink-500">Scope</dt>
                      <dd className="text-ink-100">{selectedCat} · {selected.type || 'Notification'}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-ink-500">Sent At</dt>
                      <dd className="text-ink-100">{formatManilaDateTime(selected.sentAt)}</dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="card p-3 sm:p-4">
                  <h3 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                    Acknowledgements
                  </h3>
                  {!tracking ? (
                    <p className="text-sm text-ink-500">
                      {trackingQuery.isLoading ? 'Loading…' : 'No acknowledgement data yet.'}
                    </p>
                  ) : tracking.acknowledged.length === 0 && tracking.pending.length === 0 ? (
                    <p className="text-sm text-ink-500">No recipients on this notification.</p>
                  ) : (
                    <ul className="max-h-48 space-y-2 overflow-y-auto text-sm sidebar-scroll">
                      {tracking.acknowledged.map((p) => (
                        <li key={`ack-${p.userId}`} className="flex items-start justify-between gap-2 border-b border-navy-800 pb-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink-100">{p.fullName}</p>
                            <p className="text-[11px] text-ink-500">{formatRole(p.role)}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className="font-mono text-[10px] text-ok-400">ACK</span>
                            <p className="font-mono text-[10px] text-ink-500">
                              {p.readAt ? formatManilaTime(p.readAt) : '—'}
                            </p>
                          </div>
                        </li>
                      ))}
                      {tracking.pending.map((p) => (
                        <li key={`pend-${p.userId}`} className="flex items-start justify-between gap-2 border-b border-navy-800 pb-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink-100">{p.fullName}</p>
                            <p className="text-[11px] text-ink-500">{formatRole(p.role)}</p>
                          </div>
                          <span className="shrink-0 font-mono text-[10px] text-gold-400">PENDING</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="card p-3 sm:p-4">
                  <h3 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                    Replies
                  </h3>
                  {!tracking ? (
                    <p className="text-sm text-ink-500">
                      {trackingQuery.isLoading ? 'Loading…' : 'No replies yet.'}
                    </p>
                  ) : tracking.replies.length === 0 ? (
                    <p className="text-sm text-ink-500">No replies yet. Recipients can reply from their app.</p>
                  ) : (
                    <ul className="max-h-48 space-y-3 overflow-y-auto sidebar-scroll">
                      {tracking.replies.map((r) => (
                        <li key={r.id} className="rounded-md border border-navy-700 bg-navy-900/50 p-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-ink-100">{r.fullName}</p>
                            <span className="font-mono text-[10px] text-ink-500">{formatManilaDateTime(r.createdAt)}</span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-ink-500">{formatRole(r.role)}</p>
                          <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink-200">{r.message}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="card p-3 sm:p-4">
                <h3 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                  Activity Log
                </h3>
                <ol className="relative space-y-3 border-l border-navy-700 pl-4">
                  {activity.map((ev, i) => (
                    <li key={`${ev.label}-${i}`} className="relative">
                      <span
                        className={clsx(
                          'absolute -left-[1.3rem] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-navy-900',
                          ev.tone === 'ok' && 'bg-ok-500',
                          ev.tone === 'warn' && 'bg-gold-500',
                          ev.tone === 'info' && 'bg-[#3b82f6]'
                        )}
                      />
                      <p className="text-sm text-ink-100">{ev.label}</p>
                      <p className="font-mono text-[10px] text-ink-500">
                        {ev.at ? formatManilaDateTime(ev.at) : '—'}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </section>

        {/* Right rail */}
        <aside className="sidebar-scroll flex min-h-0 flex-col gap-3 lg:overflow-y-auto">
          {!selected ? (
            <div className="card p-4 text-sm text-ink-500">Select a notification to see location and related incident.</div>
          ) : (
            <>
              <div className="card overflow-hidden">
                <div className="border-b border-navy-700 px-3 py-2">
                  <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                    Location
                  </h3>
                </div>
                {selected.location ? (
                  <>
                    <div className="h-[180px]">
                      <MapView
                        height="180px"
                        className="rounded-none border-0"
                        zoom={15}
                        showBoundary
                        showRegionalContext={false}
                        showFacilities={false}
                        data={mapQuery.data?.data}
                        pin={{
                          lat: selected.location.latitude,
                          lng: selected.location.longitude,
                          label: selected.incidentDisplayId || selected.title,
                        }}
                      />
                    </div>
                    <div className="p-3">
                      <p className="mb-2 truncate text-xs text-ink-400">{selected.location.addressText || 'Pinned location'}</p>
                      <Button type="button" className="min-h-[40px] w-full gap-2 bg-[#3b82f6] hover:bg-[#60a5fa]" asChild>
                        <Link to="/admin/map">
                          Open in Map Monitoring
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </Link>
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="p-4 text-sm text-ink-500">No linked map location for this notification.</div>
                )}
              </div>

              <div className="card p-3 sm:p-4">
                <h3 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                  Related Incident
                </h3>
                {selected.incidentId ? (
                  <>
                    <p className="font-mono text-sm font-semibold text-ink-50">
                      #{selected.incidentDisplayId || selected.incidentId}
                    </p>
                    <div className="mt-2">
                      <StatusBadge status={selected.incidentStatus || 'Open'} />
                    </div>
                    <Button type="button" className="mt-3 min-h-[40px] w-full gap-2 bg-[#3b82f6] hover:bg-[#60a5fa]" asChild>
                      <Link to={`/admin/incidents/${selected.incidentId}`}>View Incident Details</Link>
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-ink-500">No related incident linked.</p>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New notification</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="notif-title">Title</Label>
              <Input
                id="notif-title"
                value={composeTitle}
                onChange={(e) => setComposeTitle(e.target.value)}
                placeholder="e.g. Immediate weather advisory"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notif-message">Message</Label>
              <textarea
                id="notif-message"
                className="input-field min-h-[100px] w-full"
                value={composeMessage}
                onChange={(e) => setComposeMessage(e.target.value)}
                placeholder="What should recipients see?"
                maxLength={2000}
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Type</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {BROADCAST_KINDS.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => selectKind(k.id)}
                    className={clsx(
                      'rounded-md border px-3 py-2 text-left transition-colors',
                      composeKind === k.id
                        ? 'border-[#3b82f6]/60 bg-[#3b82f6]/10 text-ink-50'
                        : 'border-navy-600 bg-navy-800/60 text-ink-300 hover:border-navy-500'
                    )}
                  >
                    <span className="block text-sm font-semibold">{k.label}</span>
                    <span className="mt-0.5 block text-[11px] text-ink-500">{k.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Send to</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {BROADCAST_AUDIENCES.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setComposeAudience(a.id)}
                    className={clsx(
                      'rounded-md border px-3 py-2 text-left transition-colors',
                      composeAudience === a.id
                        ? 'border-gold-500/50 bg-gold-500/10 text-ink-50'
                        : 'border-navy-600 bg-navy-800/60 text-ink-300 hover:border-navy-500'
                    )}
                  >
                    <span className="block text-sm font-semibold">{a.label}</span>
                    <span className="mt-0.5 block text-[11px] text-ink-500">{a.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Priority</p>
              <div className="flex flex-wrap gap-2">
                {(['Critical', 'Urgent', 'Important', 'Normal', 'Info'] as BroadcastPriority[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setComposePriority(p)}
                    className={clsx(
                      'rounded-md border px-3 py-1.5 text-sm',
                      composePriority === p
                        ? 'border-gold-500/50 bg-gold-500/10 text-gold-400'
                        : 'border-navy-600 bg-navy-800 text-ink-300'
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" disabled={composeBusy} onClick={() => setComposeOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-[#3b82f6] hover:bg-[#60a5fa]"
                disabled={composeBusy || !composeTitle.trim() || !composeMessage.trim()}
                onClick={() => void sendBroadcast()}
              >
                {composeBusy ? 'Sending…' : 'Send notification'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Filter notifications</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm text-ink-200">
              <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
              Unread only
            </label>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">Priority</p>
              <div className="flex flex-wrap gap-2">
                {['All', 'Normal', 'Important', 'Urgent', 'Critical'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriorityFilter(p)}
                    className={clsx(
                      'rounded-md border px-3 py-1.5 text-sm',
                      priorityFilter === p
                        ? 'border-gold-500/50 bg-gold-500/10 text-gold-400'
                        : 'border-navy-600 bg-navy-800 text-ink-300'
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <Button type="button" className="w-full" onClick={() => setFilterOpen(false)}>
              Apply filters
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={!!dismissConfirmId}
        request={{
          title: 'Dismiss notification',
          description: 'Remove this notification? This cannot be undone.',
          confirmLabel: 'Dismiss',
          tone: 'destructive',
        }}
        busy={busy}
        onCancel={() => setDismissConfirmId(null)}
        onConfirm={() => {
          const id = dismissConfirmId;
          if (id) {
            setDismissConfirmId(null);
            void removeOne(id);
          }
        }}
      />
    </div>
  );
}
