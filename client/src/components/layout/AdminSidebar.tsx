import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Radio,
  Map,
  AlertTriangle,
  Calendar,
  Siren,
  Bell,
  FileText,
  Users,
  ClipboardCheck,
  Clock,
  Truck,
  Settings,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { useHealth } from '@/hooks/useHealth';

type NavItem = { label: string; path: string; icon: LucideIcon };

const NAV_GROUPS: { id: string; label: string; items: NavItem[] }[] = [
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { label: 'Dashboard', path: '/admin/dashboard', icon: LayoutDashboard },
      { label: 'Dispatch Center', path: '/admin/dispatch', icon: Radio },
      { label: 'Map Monitoring', path: '/admin/map', icon: Map },
      { label: 'Incidents', path: '/admin/incidents', icon: AlertTriangle },
      { label: 'SOS Reports', path: '/admin/sos', icon: Siren },
    ],
  },
  {
    id: 'coordination',
    label: 'Coordination',
    items: [
      { label: 'Conduction', path: '/admin/conduction', icon: Calendar },
      { label: 'Notifications', path: '/admin/notifications', icon: Bell },
      { label: 'Documents & Reports', path: '/admin/reports', icon: FileText },
      { label: 'Analytics', path: '/admin/analytics', icon: BarChart3 },
    ],
  },
  {
    id: 'workforce',
    label: 'Workforce',
    items: [
      { label: 'Personnel', path: '/admin/personnel', icon: Users },
      { label: 'Attendance', path: '/admin/attendance', icon: ClipboardCheck },
      { label: 'Shifts', path: '/admin/shifts', icon: Clock },
      { label: 'Resources', path: '/admin/resources', icon: Truck },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [{ label: 'Settings', path: '/admin/settings', icon: Settings }],
  },
];

interface AdminSidebarProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

export function AdminSidebar({ collapsed, onNavigate }: AdminSidebarProps) {
  const [now, setNow] = useState(() => new Date());
  const health = useHealth();

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const time12 = now.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
  });
  const time24 = now.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const dateStr = now.toLocaleDateString('en-US', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <aside
      className={clsx(
        'fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-navy-700 bg-navy-950 text-ink-50 transition-all',
        collapsed ? 'w-16' : 'w-sidebar'
      )}
    >
      <div className="flex h-header items-center gap-3 border-b border-navy-700 px-3">
        <img src="/logo.png" alt="" className="h-10 w-10 shrink-0 object-contain" />
        {!collapsed && (
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold-500">Brigada Onse</p>
            <p className="text-sm font-semibold leading-tight">SVFAR Dispatch</p>
          </div>
        )}
      </div>

      <nav
        className="sidebar-scroll flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-2 py-4"
        aria-label="Main navigation"
      >
        {NAV_GROUPS.map((group) => (
          <div key={group.id} role="group" aria-label={group.label}>
            {!collapsed && (
              <p className="mb-1 px-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-500">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map(({ label, path, icon: Icon }) => (
                <NavLink
                  key={path}
                  to={path}
                  onClick={() => onNavigate?.()}
                  className={({ isActive }) =>
                    clsx(
                      'flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-navy-800 text-gold-400'
                        : 'text-ink-300 hover:bg-navy-800 hover:text-ink-50',
                      collapsed && 'justify-center px-2'
                    )
                  }
                  title={label}
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  {!collapsed && <span>{label}</span>}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {!collapsed && (
        <div className="shrink-0 border-t border-navy-700 p-3">
          <HealthPanel
            status={health.data?.status}
            checks={health.data?.checks}
            loading={health.isLoading}
            error={health.isError}
            time12={time12}
            time24={time24}
            dateStr={dateStr}
          />
        </div>
      )}
      {collapsed && (
        <div className="flex shrink-0 justify-center border-t border-navy-700 p-2" title={healthSummaryTitle(health)}>
          <span
            className={clsx(
              'h-2.5 w-2.5 rounded-full',
              health.isError || health.data?.status === 'down'
                ? 'bg-alert-400'
                : health.data?.status === 'degraded'
                  ? 'bg-gold-400'
                  : 'bg-ok-400'
            )}
            aria-hidden
          />
          <span className="sr-only">{healthSummaryTitle(health)}</span>
        </div>
      )}
    </aside>
  );
}

function healthSummaryTitle(health: ReturnType<typeof useHealth>) {
  if (health.isLoading) return 'Checking systems';
  if (health.isError || health.data?.status === 'down') return 'Systems unavailable';
  if (health.data?.status === 'degraded') return 'Systems degraded';
  return 'Systems operational';
}

function HealthPanel({
  status,
  checks,
  loading,
  error,
  time12,
  time24,
  dateStr,
}: {
  status?: string;
  checks?: Record<string, string>;
  loading: boolean;
  error: boolean;
  time12: string;
  time24: string;
  dateStr: string;
}) {
  const tone =
    loading ? 'ink' : error || status === 'down' ? 'alert' : status === 'degraded' ? 'gold' : 'ok';
  const headline = loading
    ? 'Checking Systems'
    : error || status === 'down'
      ? 'Systems Unavailable'
      : status === 'degraded'
        ? 'Systems Degraded'
        : 'Systems Operational';

  const toneClass =
    tone === 'ok'
      ? 'border-ok-500/30 bg-ok-500/10 text-ok-300'
      : tone === 'gold'
        ? 'border-gold-500/30 bg-gold-500/10 text-gold-300'
        : tone === 'alert'
          ? 'border-alert-500/30 bg-alert-500/10 text-alert-300'
          : 'border-navy-700 bg-navy-900/80 text-ink-300';

  const dotClass =
    tone === 'ok'
      ? 'bg-ok-400'
      : tone === 'gold'
        ? 'bg-gold-400'
        : tone === 'alert'
          ? 'bg-alert-400'
          : 'bg-ink-500';

  return (
    <div className="space-y-2.5" role="status" aria-live="polite">
      <div className={clsx('rounded-md border px-2.5 py-2', toneClass)}>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2 shrink-0">
            {(tone === 'ok' || tone === 'gold') && (
              <span className={clsx('absolute inline-flex h-full w-full animate-ping rounded-full opacity-40', dotClass)} />
            )}
            <span className={clsx('relative inline-flex h-2 w-2 rounded-full', dotClass)} />
          </span>
          <p className="text-xs font-semibold leading-tight">{headline}</p>
        </div>
        {!loading && checks && <HealthChecks checks={checks} />}
      </div>

      <div className="px-0.5 font-mono text-[11px] leading-relaxed text-ink-400">
        <p className="text-ink-200">
          <span className="text-ink-50">{time12}</span>
          <span className="mx-1.5 text-ink-600">·</span>
          <span>{time24}H</span>
          <span className="mx-1.5 text-ink-600">·</span>
          <span className="text-ink-500">Manila</span>
        </p>
        <p className="mt-0.5 text-[10px] text-ink-500">{dateStr}</p>
      </div>
    </div>
  );
}

function checkTone(value: string) {
  const v = value.toLowerCase();
  if (v === 'ok' || v === 'polling' || v === 'live') return 'ok' as const;
  if (v === 'degraded' || v === 'warn') return 'gold' as const;
  if (v === 'down' || v === 'error' || v === 'fail') return 'alert' as const;
  return 'ink' as const;
}

function formatCheckValue(key: string, value: string) {
  const v = value.toLowerCase();
  if (key === 'realtime' && (v === 'polling' || v === 'live')) return 'Live Sync';
  if (v === 'ok') return 'Ready';
  if (v === 'degraded') return 'Degraded';
  if (v === 'down') return 'Down';
  return value;
}

function HealthChecks({ checks }: { checks: Record<string, string> }) {
  const order = ['api', 'database', 'map', 'realtime', 'notifications'] as const;
  const labels: Record<string, string> = {
    api: 'API',
    database: 'DB',
    map: 'Map',
    realtime: 'Sync',
    notifications: 'Alerts',
  };
  const entries = [
    ...order.filter((k) => k in checks).map((k) => [k, checks[k]] as const),
    ...Object.entries(checks).filter(([k]) => !(order as readonly string[]).includes(k)),
  ];

  return (
    <ul className="mt-2 grid grid-cols-1 gap-1" aria-label="Service Health Checks">
      {entries.map(([key, value]) => {
        const tone = checkTone(value);
        return (
          <li
            key={key}
            className="flex items-center gap-1.5 rounded border border-navy-700/60 bg-navy-950/40 px-1.5 py-1 text-[10px] text-ink-300"
            title={`${labels[key] ?? key}: ${value}`}
          >
            <span
              className={clsx(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                tone === 'ok' ? 'bg-ok-400' : tone === 'gold' ? 'bg-gold-400' : tone === 'alert' ? 'bg-alert-400' : 'bg-ink-500'
              )}
              aria-hidden
            />
            <span className="truncate text-ink-400">{labels[key] ?? key}</span>
            <span
              className={clsx(
                'ml-auto truncate font-medium',
                tone === 'ok' ? 'text-ok-300' : tone === 'gold' ? 'text-gold-300' : tone === 'alert' ? 'text-alert-300' : 'text-ink-300'
              )}
            >
              {formatCheckValue(key, value)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
