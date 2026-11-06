import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity,
  Archive,
  Bell,
  Crosshair,
  FileText,
  HardDrive,
  HeartPulse,
  LayoutDashboard,
  Map,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  Settings2,
  Shield,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { settingsApi } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmActionDialog, type ConfirmActionRequest } from '@/components/ui/ConfirmActionDialog';
import { formatManilaDateTime } from '@/lib/timezone';
import { SUN_VALLEY_CENTER } from '@/lib/validation';
import { applyAppearancePrefs } from '@/lib/appearance';
import clsx from 'clsx';

type SettingsSection =
  | 'general'
  | 'users'
  | 'notifications'
  | 'incidents'
  | 'map'
  | 'preferences'
  | 'security'
  | 'backup'
  | 'audit';

const NAV: { id: SettingsSection; label: string; desc: string; icon: LucideIcon }[] = [
  { id: 'general', label: 'General Settings', desc: 'System preferences and configuration', icon: Settings2 },
  { id: 'users', label: 'User Management', desc: 'Manage users, roles and permissions', icon: Users },
  { id: 'notifications', label: 'Notifications', desc: 'Configure system notifications', icon: Bell },
  { id: 'incidents', label: 'Incident Settings', desc: 'Incident types and priorities', icon: HeartPulse },
  { id: 'map', label: 'Map Settings', desc: 'GIS, layers and location settings', icon: Map },
  { id: 'preferences', label: 'System Preferences', desc: 'Display, language and timezone', icon: LayoutDashboard },
  { id: 'security', label: 'Security Settings', desc: 'Authentication and security', icon: Shield },
  { id: 'backup', label: 'Backup & Restore', desc: 'Data backup and recovery', icon: HardDrive },
  { id: 'audit', label: 'Audit Logs', desc: 'System activity and logs', icon: ScrollText },
];

const STORAGE_KEY = 'sv-dispatch-settings-v1';

interface SettingsForm {
  barangayName: string;
  city: string;
  province: string;
  address: string;
  timeZone: string;
  dateFormat: string;
  language: string;
  timeFormat: '12' | '24';
  systemName: string;
  systemShortName: string;
  mapCenterLat: string;
  mapCenterLng: string;
  mapZoom: string;
  itemsPerPage: string;
  sessionTimeout: string;
  offlineMode: boolean;
  announcement: string;
  displayAnnouncement: boolean;
  announcementExpires: string;
  themeMode: 'dark' | 'light';
  primaryColor: string;
  sidebarStyle: string;
  layoutWidth: string;
  fontSize: string;
  twoFactor: boolean;
  strongPassword: boolean;
  loginAttemptLimit: boolean;
  sessionMonitoring: boolean;
  ipRestriction: boolean;
}

const DEFAULTS: SettingsForm = {
  barangayName: 'Sun Valley',
  city: 'Parañaque City',
  province: 'Metro Manila',
  address: 'Sun Valley, Parañaque City, Metro Manila',
  timeZone: 'Asia/Manila (GMT+8)',
  dateFormat: 'MM/DD/YYYY',
  language: 'English',
  timeFormat: '24',
  systemName: 'Barangay Sun Valley Dispatch System',
  systemShortName: 'SVFAR GDRRS',
  mapCenterLat: String(SUN_VALLEY_CENTER.lat),
  mapCenterLng: String(SUN_VALLEY_CENTER.lng),
  mapZoom: '14',
  itemsPerPage: '25',
  sessionTimeout: '30',
  offlineMode: true,
  announcement:
    'Welcome to Barangay Sun Valley Emergency Dispatch System. For emergencies, dial our hotline or use the citizen SOS portal.',
  displayAnnouncement: true,
  announcementExpires: '',
  themeMode: 'dark',
  primaryColor: '#1E88E5',
  sidebarStyle: 'Compact',
  layoutWidth: 'Full Width',
  fontSize: 'Medium',
  twoFactor: true,
  strongPassword: true,
  loginAttemptLimit: true,
  sessionMonitoring: true,
  ipRestriction: false,
};

function loadSettings(): SettingsForm {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SettingsForm>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function boolFromSetting(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

function mergeServerSettings(server: Record<string, string> | undefined): SettingsForm {
  const local = loadSettings();
  if (!server || !Object.keys(server).length) return local;
  return {
    ...local,
    barangayName: server.barangayName ?? local.barangayName,
    city: server.city ?? local.city,
    province: server.province ?? local.province,
    address: server.address ?? local.address,
    timeZone: server.timeZone ?? local.timeZone,
    dateFormat: server.dateFormat ?? local.dateFormat,
    language: (server.language && server.language.trim() !== '') ? server.language : (local.language || 'English'),
    timeFormat: (server.timeFormat === '12' || server.timeFormat === '24' ? server.timeFormat : local.timeFormat) as '12' | '24',
    systemName: server.systemName ?? local.systemName,
    systemShortName: server.systemShortName ?? local.systemShortName,
    mapCenterLat: server.mapCenterLat ?? local.mapCenterLat,
    mapCenterLng: server.mapCenterLng ?? local.mapCenterLng,
    mapZoom: server.mapZoom ?? local.mapZoom,
    itemsPerPage: server.itemsPerPage ?? local.itemsPerPage,
    sessionTimeout: server.sessionTimeout ?? local.sessionTimeout,
    offlineMode: boolFromSetting(server.offlineMode, local.offlineMode),
    announcement: server.announcement ?? local.announcement,
    displayAnnouncement: boolFromSetting(server.displayAnnouncement, local.displayAnnouncement),
    announcementExpires: server.announcementExpires ?? local.announcementExpires,
    themeMode: (server.themeMode === 'light' || server.themeMode === 'dark' ? server.themeMode : local.themeMode) as 'dark' | 'light',
    primaryColor: server.primaryColor ?? local.primaryColor,
    sidebarStyle: server.sidebarStyle ?? local.sidebarStyle,
    layoutWidth: server.layoutWidth ?? local.layoutWidth,
    fontSize: server.fontSize ?? local.fontSize,
    twoFactor: boolFromSetting(server.twoFactor, local.twoFactor),
    strongPassword: boolFromSetting(server.strongPassword, local.strongPassword),
    loginAttemptLimit: boolFromSetting(server.loginAttemptLimit, local.loginAttemptLimit),
    sessionMonitoring: boolFromSetting(server.sessionMonitoring, local.sessionMonitoring),
    ipRestriction: boolFromSetting(server.ipRestriction, local.ipRestriction),
  };
}

function applyAppearance(form: SettingsForm) {
  applyAppearancePrefs(form);
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={clsx('settings-toggle', on ? 'settings-toggle--on' : 'settings-toggle--off')}
      onClick={() => onChange(!on)}
    >
      <span className="settings-toggle-knob" />
    </button>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('space-y-1.5', className)}>
      <Label className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</Label>
      {children}
    </div>
  );
}

function SelectField({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      className="input-field"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function SettingsPage() {
  const { accessToken, user } = useAuthStore();
  const queryClient = useQueryClient();
  const [section, setSection] = useState<SettingsSection>('general');
  const [form, setForm] = useState<SettingsForm>(() => loadSettings());
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [hydratedFromServer, setHydratedFromServer] = useState(false);
  const [confirmReq, setConfirmReq] = useState<ConfirmActionRequest | null>(null);
  const [confirmKind, setConfirmKind] = useState<'status' | 'data' | 'accounts' | null>(null);
  const [busyReset, setBusyReset] = useState(false);
  const isSystemAdmin = user?.role === 'SYSTEM_ADMINISTRATOR';

  useEffect(() => {
    applyAppearance(form);
  }, [form]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(accessToken!),
    enabled: !!accessToken,
  });
  const auditQuery = useQuery({
    queryKey: ['audit'],
    queryFn: () => settingsApi.auditLogs(accessToken!),
    enabled: !!accessToken && (section === 'audit' || section === 'users'),
  });

  useEffect(() => {
    if (!settingsQuery.data?.data || hydratedFromServer) return;
    const merged = mergeServerSettings(settingsQuery.data.data.settings);
    setForm(merged);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    setHydratedFromServer(true);
  }, [settingsQuery.data, hydratedFromServer]);

  const depts = useMemo(() => settingsQuery.data?.data?.departments ?? [], [settingsQuery.data]);
  const roles = useMemo(() => settingsQuery.data?.data?.roles ?? [], [settingsQuery.data]);
  const logs = useMemo(
    () => ((auditQuery.data?.data ?? []) as { action: string; resourceType: string; createdAt: string }[]),
    [auditQuery.data]
  );

  function patch<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setHasUnsavedChanges(true);
  }

  function openResetStatus() {
    setConfirmKind('status');
    setConfirmReq({
      title: 'Reset unit & responder status?',
      description:
        'Sets every vehicle to Ready and every responder to Available, and cancels open assignments. Incidents and accounts are not deleted.',
      confirmLabel: 'Reset status',
      tone: 'gold',
      requireReason: true,
      reasonLabel: 'Type RESET STATUS to confirm',
      reasonPlaceholder: 'RESET STATUS',
    });
  }

  function openResetData() {
    setConfirmKind('data');
    setConfirmReq({
      title: 'Reset all operational data?',
      description:
        'Deletes incidents, SOS, assignments, GPS tracks, chats, notifications, attendance, shifts, and non-console users. Keeps admin@emergency.brigadaonse.org and balidoya@emergency.brigadaonse.org, plus catalog data (roles, departments, facilities, vehicles inventory).',
      confirmLabel: 'Wipe operational data',
      tone: 'destructive',
      requireReason: true,
      reasonLabel: 'Type RESET ALL DATA to confirm',
      reasonPlaceholder: 'RESET ALL DATA',
    });
  }

  function openEnsureAccounts() {
    setConfirmKind('accounts');
    setConfirmReq({
      title: 'Ensure console accounts?',
      description:
        'Creates or repairs admin@emergency.brigadaonse.org (admin) and balidoya@emergency.brigadaonse.org (dispatcher). New accounts get password Password123! — existing passwords are kept.',
      confirmLabel: 'Ensure accounts',
      tone: 'default',
    });
  }

  async function runConfirmedReset(typed?: string) {
    if (!accessToken || !confirmKind) return;
    if (confirmKind === 'status' && (typed ?? '').trim().toUpperCase() !== 'RESET STATUS') {
      toast.error('Type RESET STATUS exactly to confirm');
      return;
    }
    if (confirmKind === 'data' && (typed ?? '').trim().toUpperCase() !== 'RESET ALL DATA') {
      toast.error('Type RESET ALL DATA exactly to confirm');
      return;
    }
    setBusyReset(true);
    try {
      if (confirmKind === 'status') {
        await settingsApi.resetStatus(accessToken);
        toast.success('Units and responders set to available');
      } else if (confirmKind === 'data') {
        const res = await settingsApi.resetData(accessToken);
        const preserved = (res.data as { preservedUsers?: string[] })?.preservedUsers?.join(', ');
        toast.success(preserved ? `Data reset. Kept: ${preserved}` : 'Operational data reset');
        queryClient.clear();
        const email = user?.email?.toLowerCase() ?? '';
        const kept = ((res.data as { preservedUsers?: string[] })?.preservedUsers ?? []).map((e) => e.toLowerCase());
        if (email && !kept.includes(email)) {
          toast.message('Your account was removed in the wipe — sign in with a protected console account.');
          useAuthStore.getState().clearAuth();
        }
      } else {
        const res = await settingsApi.ensureOpsAccounts(accessToken);
        const created = res.data.created ?? [];
        if (created.length && res.data.defaultPasswordHint) {
          toast.success(`Created ${created.join(', ')}. Temporary password: ${res.data.defaultPasswordHint}`);
        } else {
          toast.success(`Accounts ready (${(res.data.updated ?? []).join(', ') || 'updated'})`);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['map-data'] });
      queryClient.invalidateQueries({ queryKey: ['personnel'] });
      queryClient.invalidateQueries({ queryKey: ['audit'] });
      setConfirmReq(null);
      setConfirmKind(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyReset(false);
    }
  }

  async function saveAll() {
    setSaving(true);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
      applyAppearance(form);
      if (accessToken) {
        await settingsApi.update(accessToken, { ...form });
        queryClient.invalidateQueries({ queryKey: ['settings'] });
      }
      if (accessToken && form.displayAnnouncement && form.announcement.trim()) {
        await fetch('/api/announcements', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'System Announcement',
            body: form.announcement.trim(),
            priority: 'Info',
          }),
        });
        queryClient.invalidateQueries({ queryKey: ['announcements'] });
      }
      toast.success('✓ Settings saved successfully.');
      setHasUnsavedChanges(false);
      setHydratedFromServer(false);
    } catch (err) {
      toast.error('Unable to save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function quickAction(action: string) {
    if (action === 'logs') {
      setSection('audit');
      return;
    }
    if (action === 'users') {
      setSection('users');
      return;
    }
    if (action === 'health') {
      void (async () => {
        if (!accessToken) return;
        try {
          const { healthApi } = await import('@/services/api');
          const res = await healthApi.dashboard(accessToken);
          const d = res.data;
          toast.success(`System ${d.status}`, {
            description: `DB: ${d.database ?? '—'} · Map: ${d.map ?? '—'} · Realtime: ${d.realtime ?? '—'}`,
          });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Health check failed');
        }
      })();
      return;
    }
    if (action === 'cache') {
      queryClient.clear();
      toast.success('Client cache cleared', { description: 'Live data will reload on the next page view.' });
      return;
    }
    if (action === 'backup') {
      setSection('backup');
      toast.message('D1 backups are managed in Cloudflare', {
        description: 'Use Cloudflare dashboard → D1 → barangay-dispatch-db for export/restore.',
      });
      return;
    }
  }

  return (
    <div className="settings-page mx-auto flex w-full min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-ink-50 sm:text-2xl">System Settings</h1>
          <p className="mt-0.5 text-sm text-ink-400">Manage system configuration, preferences, and security settings</p>
        </div>
        <Button type="button" className="min-h-[44px] bg-blue-600 hover:bg-blue-500" disabled={saving} onClick={() => void saveAll()}>
          <Save className="mr-2 h-4 w-4" aria-hidden />
          {saving ? 'Saving…' : 'Save All Changes'}
        </Button>
      </div>

      <div className="settings-grid">
        {/* Nav */}
        <aside className="settings-area-nav card overflow-hidden p-2 sm:p-3">
          <nav className="settings-nav" aria-label="Settings sections">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={clsx('settings-nav-btn', active && 'settings-nav-btn--active')}
                  onClick={() => setSection(item.id)}
                >
                  <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', active ? 'text-blue-300' : 'text-ink-400')} aria-hidden />
                  <span className="min-w-0">
                    <span className={clsx('block text-sm font-medium', active ? 'text-ink-50' : 'text-ink-200')}>{item.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-500">{item.desc}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main */}
        <section className="settings-area-main flex min-w-0 flex-col gap-4">
          {(section === 'general' || section === 'preferences' || section === 'map') && (
            <div className="card overflow-hidden p-3 sm:p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-300">General Settings</h2>
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Barangay Information</h3>
                  <Field label="Barangay Name">
                    <Input value={form.barangayName} onChange={(e) => patch('barangayName', e.target.value)} />
                  </Field>
                  <Field label="City / Municipality">
                    <Input value={form.city} onChange={(e) => patch('city', e.target.value)} />
                  </Field>
                  <Field label="Province">
                    <Input value={form.province} onChange={(e) => patch('province', e.target.value)} />
                  </Field>
                  <Field label="Address">
                    <Input value={form.address} onChange={(e) => patch('address', e.target.value)} />
                  </Field>
                  <Field label="Time Zone">
                    <SelectField
                      value={form.timeZone}
                      onChange={(v) => patch('timeZone', v)}
                      options={['Asia/Manila (GMT+8)', 'UTC']}
                    />
                  </Field>
                  <Field label="Date Format">
                    <SelectField
                      value={form.dateFormat}
                      onChange={(v) => patch('dateFormat', v)}
                      options={['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']}
                    />
                  </Field>
                  <Field label="System Language">
                    <SelectField value={form.language || 'English'} onChange={(v) => patch('language', v)} options={['English', 'Filipino']} />
                    {/* Language selector is display-only — localization not yet implemented */}
                    <p className="mt-1 text-[11px] text-gold-400/90">
                      Preference only — Filipino is not fully wired across admin screens. Citizen SOS uses a limited Filipino string set when the citizen profile language is Filipino.
                    </p>
                  </Field>
                  <Field label="Time Format">
                    <div className="flex flex-wrap gap-4 pt-1 text-sm text-ink-200">
                      {(['12', '24'] as const).map((fmt) => (
                        <label key={fmt} className="inline-flex cursor-pointer items-center gap-2">
                          <input
                            type="radio"
                            name="timeFormat"
                            className="accent-blue-500"
                            checked={form.timeFormat === fmt}
                            onChange={() => patch('timeFormat', fmt)}
                          />
                          {fmt} Hour
                        </label>
                      ))}
                    </div>
                  </Field>
                </div>

                <div className="space-y-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">System Configuration</h3>
                  <Field label="System Name">
                    <Input value={form.systemName} onChange={(e) => patch('systemName', e.target.value)} />
                  </Field>
                  <Field label="System Short Name">
                    <Input value={form.systemShortName} onChange={(e) => patch('systemShortName', e.target.value)} />
                  </Field>
                  <Field label="Default Map Center">
                    <div className="flex gap-2">
                      <Input
                        value={`${form.mapCenterLat}, ${form.mapCenterLng}`}
                        onChange={(e) => {
                          const [lat, lng] = e.target.value.split(',').map((s) => s.trim());
                          if (lat) patch('mapCenterLat', lat);
                          if (lng) patch('mapCenterLng', lng);
                        }}
                      />
                      <button
                        type="button"
                        className="btn-secondary shrink-0 px-3"
                        title="Reset to Sun Valley center"
                        onClick={() => {
                          patch('mapCenterLat', String(SUN_VALLEY_CENTER.lat));
                          patch('mapCenterLng', String(SUN_VALLEY_CENTER.lng));
                        }}
                      >
                        <Crosshair className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </Field>
                  <Field label="Default Map Zoom Level">
                    <SelectField
                      value={form.mapZoom}
                      onChange={(v) => patch('mapZoom', v)}
                      options={['12', '13', '14', '15', '16']}
                    />
                  </Field>
                  <Field label="Items Per Page">
                    <SelectField
                      value={form.itemsPerPage}
                      onChange={(v) => patch('itemsPerPage', v)}
                      options={['10', '25', '50', '100']}
                    />
                  </Field>
                  <Field label="Session Timeout (minutes)">
                    <Input
                      type="number"
                      min={5}
                      max={480}
                      value={form.sessionTimeout}
                      onChange={(e) => patch('sessionTimeout', e.target.value)}
                    />
                  </Field>
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-navy-700 bg-navy-950/40 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-ink-100">Enable Offline Mode</p>
                      <p className="text-[11px] text-ink-500">Queue SOS and status updates when offline</p>
                    </div>
                    <Toggle on={form.offlineMode} onChange={(v) => patch('offlineMode', v)} label="Enable Offline Mode" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {(section === 'general' || section === 'notifications') && (
            <div className="card overflow-hidden p-3 sm:p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-300">System Announcement</h2>
              <Field label="Announcement Message">
                <textarea
                  className="input-field min-h-[110px]"
                  value={form.announcement}
                  onChange={(e) => patch('announcement', e.target.value)}
                />
              </Field>
              <div className="mt-3 flex flex-wrap items-end gap-4">
                <div className="flex items-center gap-3">
                  <Toggle
                    on={form.displayAnnouncement}
                    onChange={(v) => patch('displayAnnouncement', v)}
                    label="Display Announcement"
                  />
                  <span className="text-sm text-ink-200">Display Announcement</span>
                </div>
                <Field label="Announcement Expires On" className="min-w-[200px] flex-1">
                  <Input
                    type="date"
                    value={form.announcementExpires}
                    onChange={(e) => patch('announcementExpires', e.target.value)}
                  />
                </Field>
              </div>
            </div>
          )}

          {section === 'users' && (
            <div className="card overflow-hidden p-3 sm:p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-300">User Management</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Departments</h3>
                  <ul className="max-h-[min(50vh,420px)] space-y-1 overflow-y-auto text-sm ops-scroll">
                    {depts.map((d, i) => (
                      <li key={i} className="rounded-md border border-navy-800 bg-navy-950/40 px-3 py-2">
                        {d.name} <span className="text-ink-500">({d.code})</span>
                      </li>
                    ))}
                    {depts.length === 0 && <li className="text-ink-500">No departments loaded</li>}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Roles</h3>
                  <ul className="max-h-[min(50vh,420px)] space-y-1 overflow-y-auto text-sm ops-scroll">
                    {roles.map((r, i) => (
                      <li key={i} className="rounded-md border border-navy-800 bg-navy-950/40 px-3 py-2">
                        {r.name}
                      </li>
                    ))}
                    {roles.length === 0 && <li className="text-ink-500">No roles loaded</li>}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {section === 'incidents' && (
            <div className="card overflow-hidden p-3 sm:p-4">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-300">Incident Settings</h2>
              <p className="text-sm text-ink-400">
                Incident types, priorities, and SLA rules are managed in Dispatch and Incidents workflows. Use Save All Changes to persist preferences to the server.
              </p>
            </div>
          )}

          {section === 'backup' && (
            <div className="flex flex-col gap-4">
              <div className="card overflow-hidden p-3 sm:p-4">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-300">Backup & Restore</h2>
                <p className="mb-3 text-sm text-ink-400">
                  Production data lives in Cloudflare D1 (`barangay-dispatch-db`). Point-in-time restore still goes through Cloudflare — use the actions below only for ops reset.
                </p>
                <ol className="mb-4 list-decimal space-y-2 pl-5 text-sm text-ink-300">
                  <li>Open the Cloudflare dashboard → Workers & Pages → D1 → <span className="font-mono text-ink-100">barangay-dispatch-db</span>.</li>
                  <li>Use Export / backups there for point-in-time copies.</li>
                  <li>Restore only via Cloudflare (or Wrangler) during a planned maintenance window.</li>
                </ol>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => quickAction('backup')}>
                    <Archive className="mr-2 h-4 w-4" aria-hidden />
                    Remind me how
                  </Button>
                  <Button type="button" variant="outline" onClick={() => quickAction('logs')}>
                    <FileText className="mr-2 h-4 w-4" aria-hidden />
                    View audit logs
                  </Button>
                </div>
              </div>

              <div className="card overflow-hidden border-alert-500/30 p-3 sm:p-4">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-alert-400">Data reset</h2>
                <p className="mb-3 text-sm text-ink-400">
                  Protected console logins (kept on full wipe):{' '}
                  <span className="font-mono text-ink-200">admin@emergency.brigadaonse.org</span> (admin),{' '}
                  <span className="font-mono text-ink-200">balidoya@emergency.brigadaonse.org</span> (dispatcher).
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button type="button" variant="outline" onClick={openResetStatus} disabled={!accessToken || busyReset}>
                    <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                    Reset unit & responder status
                  </Button>
                  {isSystemAdmin && (
                    <>
                      <Button type="button" variant="outline" onClick={openEnsureAccounts} disabled={!accessToken || busyReset}>
                        <UserPlus className="mr-2 h-4 w-4" aria-hidden />
                        Ensure admin / dispatcher accounts
                      </Button>
                      <Button type="button" variant="destructive" onClick={openResetData} disabled={!accessToken || busyReset}>
                        <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                        Reset all data
                      </Button>
                    </>
                  )}
                </div>
                {!isSystemAdmin && (
                  <p className="mt-2 text-xs text-ink-500">Full data wipe and account ensure require a System Administrator login.</p>
                )}
              </div>
            </div>
          )}

          <ConfirmActionDialog
            open={!!confirmReq}
            request={confirmReq}
            busy={busyReset}
            onCancel={() => {
              if (busyReset) return;
              setConfirmReq(null);
              setConfirmKind(null);
            }}
            onConfirm={(reason) => void runConfirmedReset(reason)}
          />

          {section === 'audit' && (
            <div className="card overflow-hidden p-3 sm:p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-300">Audit Logs</h2>
              <ul className="max-h-[min(60vh,560px)] space-y-1 overflow-y-auto text-sm ops-scroll">
                {logs.map((l, i) => (
                  <li key={i} className="border-b border-navy-800 py-2 text-ink-300">
                    <span className="text-ink-500">{formatManilaDateTime(l.createdAt)}</span>
                    {' — '}
                    {l.action} <span className="text-ink-500">({l.resourceType})</span>
                  </li>
                ))}
                {logs.length === 0 && <li className="py-6 text-center text-ink-500">No audit entries</li>}
              </ul>
            </div>
          )}

          {section === 'security' && (
            <div className="card overflow-hidden p-3 sm:p-4 lg:hidden">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-300">Security Settings</h2>
              <SecurityToggles form={form} patch={patch} />
            </div>
          )}
        </section>

        {/* Rail */}
        <aside className="settings-area-rail flex min-w-0 flex-col gap-4">
          <div className="card overflow-hidden p-3 sm:p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-300">System Appearance</h2>
            <Field label="Theme Mode">
              <div className="flex flex-wrap gap-4 pt-1 text-sm text-ink-200">
                {(['dark', 'light'] as const).map((mode) => (
                  <label key={mode} className="inline-flex cursor-pointer items-center gap-2 capitalize">
                    <input
                      type="radio"
                      name="themeMode"
                      className="accent-blue-500"
                      checked={form.themeMode === mode}
                      onChange={() => patch('themeMode', mode)}
                    />
                    {mode} Mode
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Primary Color" className="mt-3">
              <div className="flex items-center gap-2">
                <Input value={form.primaryColor} onChange={(e) => patch('primaryColor', e.target.value)} />
                <span
                  className="h-10 w-10 shrink-0 rounded-md border border-navy-600"
                  style={{ background: form.primaryColor }}
                  aria-hidden
                />
              </div>
            </Field>
            <div className="mt-3 grid gap-3">
              <Field label="Sidebar Style">
                <SelectField
                  value={form.sidebarStyle}
                  onChange={(v) => patch('sidebarStyle', v)}
                  options={['Compact', 'Expanded']}
                />
              </Field>
              <Field label="Layout Width">
                <SelectField
                  value={form.layoutWidth}
                  onChange={(v) => patch('layoutWidth', v)}
                  options={['Full Width', 'Contained']}
                />
              </Field>
              <Field label="Font Size">
                <SelectField
                  value={form.fontSize}
                  onChange={(v) => patch('fontSize', v)}
                  options={['Small', 'Medium', 'Large']}
                />
              </Field>
            </div>
          </div>

          <div className="card hidden overflow-hidden p-3 sm:p-4 lg:block">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-300">Security Settings</h2>
            <SecurityToggles form={form} patch={patch} />
          </div>

          <div className="card overflow-hidden p-3 sm:p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-300">Quick Actions</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Clear Client Cache', icon: RefreshCw, action: 'cache' },
                { label: 'System Health Check', icon: Activity, action: 'health' },
                { label: 'View Audit Logs', icon: FileText, action: 'logs' },
                { label: 'Departments & Roles', icon: Users, action: 'users' },
                { label: 'Backup Guidance', icon: Archive, action: 'backup' },
                { label: 'Security Settings', icon: Shield, action: 'security' },
              ].map((qa) => {
                const Icon = qa.icon;
                return (
                  <button
                    key={qa.label}
                    type="button"
                    className="flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-lg border border-blue-500/35 bg-navy-950/40 px-2 py-2 text-center text-[11px] text-blue-200 transition-colors hover:bg-blue-500/10"
                    onClick={() => {
                      if (qa.action === 'security') setSection('security');
                      else quickAction(qa.action);
                    }}
                  >
                    <Icon className="h-4 w-4 text-blue-400" aria-hidden />
                    {qa.label}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SecurityToggles({
  form,
  patch,
}: {
  form: SettingsForm;
  patch: <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => void;
}) {
  const items: { key: keyof SettingsForm; label: string; note: string; enforced: boolean }[] = [
    {
      key: 'twoFactor',
      label: 'Two-Factor Authentication (2FA)',
      note: 'Preference only — MFA enrollment is not implemented yet.',
      enforced: false,
    },
    {
      key: 'strongPassword',
      label: 'Strong Password Policy',
      note: 'Server already enforces password rules on register/reset.',
      enforced: true,
    },
    {
      key: 'loginAttemptLimit',
      label: 'Login Attempt Limit',
      note: 'Server rate-limits failed logins (fixed threshold).',
      enforced: true,
    },
    {
      key: 'sessionMonitoring',
      label: 'Session Monitoring',
      note: 'Preference only — no separate monitoring service yet.',
      enforced: false,
    },
    {
      key: 'ipRestriction',
      label: 'IP Restriction',
      note: 'Preference only — not enforced on the Worker.',
      enforced: false,
    },
  ];
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li
          key={item.key}
          className="flex flex-col gap-2 rounded-lg border border-navy-800 bg-navy-950/40 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="min-w-0">
            <span className="inline-flex items-center gap-2 text-sm text-ink-200">
              <ShieldCheck className="h-3.5 w-3.5 text-ink-500" aria-hidden />
              {item.label}
            </span>
            <span className={clsx('mt-0.5 block text-[11px]', item.enforced ? 'text-ok-400/90' : 'text-gold-400/90')}>
              {item.enforced ? 'Enforced on server' : 'UI preference — not active protection'} · {item.note}
            </span>
          </span>
          <Toggle
            on={Boolean(form[item.key])}
            onChange={(v) => patch(item.key, v as SettingsForm[typeof item.key])}
            label={item.label}
          />
        </li>
      ))}
    </ul>
  );
}
