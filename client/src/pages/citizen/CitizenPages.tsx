import { Link } from 'react-router-dom';
import { Siren, Shield, Flame, HeartPulse, Car, ShieldAlert, Megaphone, Phone, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { sosApi, notificationsApi, profileApi } from '@/services/api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryState } from '@/components/ui/QueryState';
import { LIVE } from '@/lib/liveTiming';
import { useDevice } from '@/hooks/useDevice';

const QUICK = [
  { to: '/citizen/sos?type=fire', label: 'Fire incident', icon: Flame, hint: 'Fire / smoke' },
  { to: '/citizen/sos?type=medical', label: 'Medical emergency', icon: HeartPulse, hint: 'Injury / illness' },
  { to: '/citizen/sos?type=vehicular', label: 'Vehicular accident', icon: Car, hint: 'Road crash' },
  { to: '/citizen/sos?type=crime', label: 'Crime / incident', icon: ShieldAlert, hint: 'Security' },
] as const;

export function CitizenHomePage() {
  const { accessToken } = useAuthStore();
  const device = useDevice();
  const sosQuery = useQuery({
    queryKey: ['citizen-sos'],
    queryFn: () => sosApi.myStatus(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });

  const latest = sosQuery.data?.data;
  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-500">Barangay Sun Valley</p>
          <h2 className="text-lg font-bold text-ink-50">Citizen emergency</h2>
          <p className="text-sm text-ink-400">Request help or check your SOS status.</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-[11px] text-ink-400">{dateLabel}</p>
          <Link
            to="/citizen/notifications"
            className="inline-flex min-h-[44px] items-center text-xs text-gold-500 hover:underline"
            aria-label="Open alerts"
          >
            Alerts
          </Link>
        </div>
      </header>

      <Link
        to="/citizen/sos"
        className={`flex flex-col items-center justify-center gap-2 rounded-2xl bg-alert-500 text-white hover:bg-alert-400 focus:outline-none focus-visible:ring-4 focus-visible:ring-gold-500/40 ${
          device === 'web' ? 'min-h-[140px] p-8' : 'min-h-[120px] p-6'
        }`}
        aria-label="Send SOS emergency request"
      >
        <Siren className="h-12 w-12" aria-hidden="true" />
        <span className="text-xl font-bold tracking-wide">SOS EMERGENCY</span>
        <span className="text-sm text-white/85">Tap to send an emergency request</span>
      </Link>

      <div>
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">Quick services</p>
        <div className={`grid gap-2 ${
          device === 'web' ? 'grid-cols-4' : 'grid-cols-2'
        }`}>
          {QUICK.map((q) => {
            const Icon = q.icon;
            return (
              <Link
                key={q.label}
                to={q.to}
                className="card flex min-h-[88px] flex-col items-start justify-center gap-1 p-4 hover:border-gold-600/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
              >
                <Icon className="h-5 w-5 text-gold-500" aria-hidden="true" />
                <span className="text-sm font-semibold text-ink-50">{q.label}</span>
                <span className="text-[11px] text-ink-500">{q.hint}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <Link
          to="/citizen/notifications"
          className="card flex min-h-[48px] items-center gap-3 p-4 hover:bg-navy-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
        >
          <Megaphone className="h-5 w-5 shrink-0 text-gold-500" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">Recent announcements</p>
            <p className="text-xs text-ink-400">Barangay alerts and updates</p>
          </div>
        </Link>
        <a
          href="tel:117"
          className="card flex min-h-[48px] items-center gap-3 p-4 hover:bg-navy-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
        >
          <Phone className="h-5 w-5 shrink-0 text-gold-500" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">Emergency hotlines</p>
            <p className="text-xs text-ink-400">117 / Barangay Sun Valley BDRRMO</p>
          </div>
        </a>
      </div>

      <div className="card flex min-h-[48px] items-center gap-3 p-4">
        <Shield className="h-5 w-5 shrink-0 text-ok-400" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-ink-100">
            {latest && !['Cancelled', 'Closed', 'Resolved'].includes(String(latest.status))
              ? `Active SOS · ${latest.displayId}`
              : 'Ready for emergencies'}
          </p>
          <p className="text-xs text-ink-400">Use SOS for emergencies. False reports are prohibited.</p>
        </div>
      </div>

      <section className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">My SOS reports</p>
        <QueryState
          isLoading={sosQuery.isLoading}
          isError={sosQuery.isError}
          error={sosQuery.error as Error}
          onRetry={() => sosQuery.refetch()}
          isEmpty={!sosQuery.isLoading && !latest}
          emptyTitle="No SOS requests yet"
          emptyHint="When you send an SOS, live status will appear here."
          showLastUpdated={false}
        >
          <Link
            to="/citizen/sos?view=status"
            className="card flex min-h-[48px] items-center gap-3 p-4 hover:bg-navy-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
          >
            <FileText className="h-5 w-5 shrink-0 text-gold-500" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">My reports</p>
              <p className="truncate text-xs text-ink-400">
                {latest ? `${latest.displayId} · ${latest.incidentId?.status ?? latest.status}` : 'No SOS requests yet'}
              </p>
            </div>
            {latest ? <StatusBadge status={latest.incidentId?.status ?? latest.status} /> : null}
          </Link>
          {latest ? (
            <Button asChild variant="outline" className="min-h-[48px] w-full">
              <Link to="/citizen/sos?view=status">
                View SOS status · <StatusBadge status={latest.incidentId?.status ?? latest.status} />
              </Link>
            </Button>
          ) : null}
        </QueryState>
      </section>
    </div>
  );
}

export function CitizenNotificationsPage() {
  const { accessToken } = useAuthStore();
  const queryClient = useQueryClient();
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [busy, setBusy] = useState(false);
  const listQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.coolMs,
  });
  const items = listQuery.data?.data ?? [];

  async function sendReply(id: string) {
    if (!accessToken || !replyText.trim()) return;
    setBusy(true);
    try {
      await notificationsApi.reply(accessToken, id, replyText.trim());
      toast.success('Reply sent');
      setReplyFor(null);
      setReplyText('');
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reply failed');
    } finally {
      setBusy(false);
    }
  }

  async function acknowledge(id: string) {
    if (!accessToken) return;
    try {
      await notificationsApi.markRead(accessToken, id);
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('Acknowledged');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div className="space-y-3">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-500">Citizen</p>
        <h2 className="text-lg font-bold text-ink-50">Alerts</h2>
        <p className="text-sm text-ink-400">Readable updates about your SOS and barangay notices.</p>
      </header>

      <QueryState
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        error={listQuery.error as Error}
        onRetry={() => listQuery.refetch()}
        isEmpty={!listQuery.isLoading && items.length === 0}
        emptyTitle="No notifications yet"
        emptyHint="SOS updates and barangay notices will appear here."
        showLastUpdated={false}
      >
        <div className="space-y-2">
          {items.map((n) => (
            <div
              key={n._id}
              className={`card min-h-[48px] space-y-2 p-4 text-sm ${n.priority === 'Urgent' || n.priority === 'Critical' ? 'border-alert-500/50' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{n.title}</p>
                {!n.readAt && (
                  <span className="shrink-0 font-mono text-[10px] uppercase text-gold-400">New</span>
                )}
              </div>
              <p className="text-ink-400">{n.message}</p>
              <div className="flex flex-wrap gap-2 border-t border-navy-700 pt-2">
                {!n.readAt && (
                  <Button type="button" variant="outline" size="sm" className="min-h-[40px]" onClick={() => void acknowledge(n._id)}>
                    Acknowledge
                  </Button>
                )}
                {replyFor === n._id ? (
                  <div className="w-full space-y-2">
                    <textarea
                      className="input-field min-h-[72px] w-full"
                      placeholder="Your reply…"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" className="min-h-[40px] flex-1" onClick={() => setReplyFor(null)}>
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        className="min-h-[40px] flex-1"
                        disabled={busy || !replyText.trim()}
                        onClick={() => void sendReply(n._id)}
                      >
                        {busy ? 'Sending…' : 'Send reply'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" variant="outline" size="sm" className="min-h-[40px]" onClick={() => { setReplyFor(n._id); setReplyText(''); }}>
                    Reply
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </QueryState>

      <div className="card space-y-2 p-4">
        <p className="text-sm font-semibold">Safety tips & hotlines</p>
        <a
          className="inline-flex min-h-[44px] items-center text-sm text-gold-500 underline"
          href="tel:117"
        >
          Call 117 / Barangay Sun Valley BDRRMO
        </a>
      </div>
    </div>
  );
}

export function CitizenProfilePage() {
  const { accessToken, user } = useAuthStore();
  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: () => profileApi.get(accessToken!),
    enabled: !!accessToken,
  });
  const profile = profileQuery.data?.data ?? {};
  const [form, setForm] = useState({
    fullName: user?.fullName ?? '',
    contactNumber: user?.contactNumber ?? '',
    address: '',
    emergencyContact: '',
    medicalAlerts: '',
    language: 'en',
  });

  useEffect(() => {
    if (!profileQuery.data?.data) return;
    setForm((f) => ({
      ...f,
      fullName: String(profileQuery.data.data.fullName ?? f.fullName),
      contactNumber: String(profileQuery.data.data.contactNumber ?? f.contactNumber),
      address: String(profileQuery.data.data.address ?? ''),
      emergencyContact: String(profileQuery.data.data.emergencyContact ?? ''),
      medicalAlerts: String(profileQuery.data.data.medicalAlerts ?? ''),
      language: String(profileQuery.data.data.language ?? 'en'),
    }));
  }, [profileQuery.data]);

  async function save() {
    if (!accessToken) return;
    await profileApi.update(accessToken, form);
    toast.success('Profile saved');
    profileQuery.refetch();
  }

  return (
    <div className="space-y-3">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-500">Citizen</p>
        <h2 className="text-lg font-bold text-ink-50">Profile</h2>
        <p className="text-sm text-ink-400">Contact details shared with dispatch when you send SOS.</p>
      </header>

      <QueryState
        isLoading={profileQuery.isLoading}
        isError={profileQuery.isError}
        error={profileQuery.error as Error}
        onRetry={() => profileQuery.refetch()}
        isEmpty={false}
        showLastUpdated={false}
      >
        <div className="card space-y-4 p-4">
          <p className="text-sm text-ink-400">
            {user?.email} {profile.emailVerified ? '· verified' : '· email not verified'}
          </p>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-400">Full name</span>
            <Input
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              aria-label="Full name"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-400">Contact number</span>
            <Input
              type="tel"
              value={form.contactNumber}
              onChange={(e) => setForm({ ...form, contactNumber: e.target.value })}
              aria-label="Contact number"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-400">Address</span>
            <Input
              placeholder="Address"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              aria-label="Address"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-400">Emergency contact</span>
            <Input
              placeholder="Emergency contact"
              value={form.emergencyContact}
              onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })}
              aria-label="Emergency contact"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-400">Medical alerts</span>
            <textarea
              className="input-field"
              placeholder="Optional medical alerts (shared with dispatch only)"
              value={form.medicalAlerts}
              onChange={(e) => setForm({ ...form, medicalAlerts: e.target.value })}
              aria-label="Medical alerts"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-400">Preferred language</span>
            <select
              className="input-field min-h-[48px]"
              value={form.language}
              onChange={(e) => setForm({ ...form, language: e.target.value })}
              aria-label="Preferred language"
            >
              <option value="en">English</option>
              <option value="fil">Filipino</option>
            </select>
          </label>
          <p className="text-xs text-gold-400/90">
            Filipino covers SOS and profile notes only. Most screens remain in English.
          </p>
          <Button type="button" className="min-h-[48px]" onClick={() => void save()}>
            Save profile
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-[48px]"
            onClick={async () => {
              if (!accessToken) return;
              await profileApi.requestDelete(accessToken);
              toast.message('Deletion request recorded');
            }}
          >
            Request account deletion
          </Button>
        </div>
      </QueryState>
    </div>
  );
}
