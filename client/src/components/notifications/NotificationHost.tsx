import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuthStore, isAdminRole } from '@/store/authStore';
import { notificationsApi } from '@/services/api';
import { asArray } from '@/lib/workforceMetrics';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { LIVE } from '@/lib/liveTiming';
import {
  playNotificationTone,
  showSystemNotification,
  unlockAlertAudio,
  toneFromNotification,
} from '@/lib/alertSound';
import { bindAlertAudioUnlock, bindPushToneMessages, enableAppPush } from '@/lib/pushSubscribe';
import { formatManilaTime } from '@/lib/timezone';
import type { NotificationItem } from '@/types';
import { X } from 'lucide-react';

const SEEN_KEY = 'sv-seen-alerts-v2';

function loadSeen(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveSeen(ids: Set<string>) {
  sessionStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-120)));
}

/** Counts up from a given ISO timestamp, rendering as "Xm Ys". */
function ElapsedTimer({ fromIso }: { fromIso: string }) {
  const [elapsed, setElapsed] = useState<number>(0);

  useEffect(() => {
    const base = Date.parse(fromIso);
    if (Number.isNaN(base)) return;

    function tick() {
      setElapsed(Math.floor((Date.now() - base) / 1000));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [fromIso]);

  if (elapsed <= 0) return <span>—</span>;
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return <span>{m > 0 ? `${m}m ${s}s` : `${s}s`}</span>;
}

function isModalPriority(n: NotificationItem) {
  const p = (n.priority || '').toLowerCase();
  const t = (n.type || '').toLowerCase();
  if (t.includes('chat') || t.includes('message') || t.includes('reply')) return false;
  if (['critical', 'urgent', 'important'].includes(p)) return true;
  if (
    t.includes('dispatch team') ||
    t.includes('sos') ||
    t.includes('backup') ||
    t.includes('immediate') ||
    t.includes('operational alert')
  ) {
    return true;
  }
  return false;
}

function defaultNotifPath(role?: string) {
  if (!role) return '/';
  if (role === 'CITIZEN') return '/citizen/notifications';
  if (role === 'EMERGENCY_RESPONDER') return '/responder/notifications';
  if (isAdminRole(role)) return '/admin/notifications';
  return '/';
}

type Props = {
  /** When true, Important/Urgent alerts open a reply modal (responders). */
  allowReply?: boolean;
};

/**
 * Cross-role notification host: push subscribe, urgency tones, toasts, and modal for high-priority alerts.
 */
export function NotificationHost({ allowReply = false }: Props) {
  const { accessToken, user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const seenRef = useRef(loadSeen());
  const [alert, setAlert] = useState<NotificationItem | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [pushHint, setPushHint] = useState<string | null>(null);
  const [pushHintDismissed, setPushHintDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('sv-push-hint-dismissed') === '1';
    } catch {
      return false;
    }
  });
  // For critical modals: show "Acknowledged by X at HH:MM:SS" for 2s before closing
  const [ackConfirmText, setAckConfirmText] = useState<string | null>(null);

  const hidePushBanner =
    pushHintDismissed ||
    location.pathname.startsWith('/citizen/sos') ||
    location.pathname.includes('/conduction');

  const listQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.hotMs,
  });

  useEffect(() => {
    bindAlertAudioUnlock();
    return bindPushToneMessages();
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    void enableAppPush(accessToken).then((r) => {
      if (!r.ok) setPushHint(r.detail);
      else setPushHint(null);
    });
  }, [accessToken]);

  useEffect(() => {
    const items = asArray<NotificationItem>(listQuery.data?.data);
    const fresh = items.filter((n) => !n.readAt && !seenRef.current.has(n._id));
    if (!fresh.length) return;

    if (!alert) {
      const modalCandidate = fresh.find(isModalPriority);
      if (modalCandidate) {
        seenRef.current.add(modalCandidate._id);
        saveSeen(seenRef.current);
        const tone = toneFromNotification(modalCandidate);
        unlockAlertAudio();
        void playNotificationTone(tone);
        showSystemNotification(modalCandidate.title, modalCandidate.message, {
          tag: modalCandidate._id,
          url: defaultNotifPath(user?.role),
          requireInteraction: true,
        });
        setAlert(modalCandidate);
        setReply('');
        return;
      }
    }

    const soft = fresh.filter((n) => !isModalPriority(n));
    if (!soft.length) return;
    for (const n of soft) seenRef.current.add(n._id);
    saveSeen(seenRef.current);
    unlockAlertAudio();
    void playNotificationTone(toneFromNotification(soft[0]));
    for (const n of soft.slice(0, 3)) {
      toast.message(n.title, { description: n.message.slice(0, 160) });
    }
  }, [listQuery.dataUpdatedAt, listQuery.data?.data, alert, user?.role]);

  async function enablePushNow() {
    if (!accessToken) return;
    unlockAlertAudio();
    void playNotificationTone('alert');
    const r = await enableAppPush(accessToken);
    if (r.ok) {
      toast.success(r.detail);
      setPushHint(null);
    } else {
      toast.message(r.detail);
      setPushHint(r.detail);
    }
  }

  async function dismiss(markRead = true) {
    if (!alert || !accessToken) {
      setAlert(null);
      return;
    }
    if (markRead) {
      try {
        await notificationsApi.markRead(accessToken, alert._id);
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      } catch {
        /* ignore */
      }
    }
    setAlert(null);
    setAckConfirmText(null);
  }

  async function handleCriticalAcknowledge() {
    if (!alert || !accessToken) return;
    setBusy(true);
    try {
      await notificationsApi.markRead(accessToken, alert._id);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      const timeStr = formatManilaTime(new Date().toISOString());
      const name = user?.fullName ?? 'Dispatcher';
      setAckConfirmText(`Acknowledged by ${name} at ${timeStr}`);
      setTimeout(() => {
        setAlert(null);
        setAckConfirmText(null);
      }, 2000);
    } catch {
      toast.error('Failed to acknowledge alert');
    } finally {
      setBusy(false);
    }
  }

  async function handleCriticalReviewDispatch() {
    if (!alert || !accessToken) return;
    try {
      await notificationsApi.markRead(accessToken, alert._id);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch {
      /* ignore */
    }
    const incId = alert.incidentId;
    setAlert(null);
    setAckConfirmText(null);
    if (incId) navigate(`/admin/dispatch?incident=${incId}`);
    else navigate('/admin/dispatch');
  }

  async function handleCriticalOpenIncident() {
    if (!alert || !accessToken) return;
    try {
      await notificationsApi.markRead(accessToken, alert._id);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch {
      /* ignore */
    }
    const incId = alert.incidentId;
    setAlert(null);
    setAckConfirmText(null);
    if (incId) navigate(`/admin/incidents/${incId}`);
    else navigate('/admin/incidents');
  }

  async function sendReply() {
    if (!accessToken || !alert || !reply.trim()) return;
    setBusy(true);
    try {
      await notificationsApi.reply(accessToken, alert._id, reply.trim());
      toast.success('Reply sent to Dispatch');
      setReply('');
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['responders-chat'] });
      setAlert(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reply failed');
    } finally {
      setBusy(false);
    }
  }

  const toneLabel = alert ? toneFromNotification(alert) : 'alert';

  return (
    <>
      {pushHint && !hidePushBanner && (
        <div
          className="pointer-events-auto fixed inset-x-0 bottom-0 z-40 border-t border-gold-600/40 bg-navy-900/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-xl lg:bottom-4 lg:left-auto lg:right-4 lg:w-[min(100%-2rem,22rem)] lg:rounded-lg lg:border lg:pb-3"
          role="status"
        >
          <div className="mx-auto flex max-w-lg items-start gap-2 lg:max-w-none">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-ink-200">{pushHint}</p>
              <p className="mt-1 text-[10px] text-ink-500">
                Optional — you can keep using the app without enabling browser alerts.
              </p>
              <Button type="button" size="sm" className="mt-2 min-h-[40px] w-full sm:w-auto" onClick={() => void enablePushNow()}>
                Enable alerts & sound
              </Button>
            </div>
            <button
              type="button"
              className="shrink-0 rounded p-1 text-ink-400 hover:bg-navy-800 hover:text-ink-100"
              aria-label="Dismiss notification tip"
              onClick={() => {
                setPushHintDismissed(true);
                try {
                  sessionStorage.setItem('sv-push-hint-dismissed', '1');
                } catch {
                  /* ignore */
                }
              }}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      )}

      {/* Critical alert modal — cannot be dismissed by overlay click or Escape */}
      <Dialog open={!!alert && alert.priority === 'Critical'} onOpenChange={() => { /* intentionally blocked — use action buttons */ }}>
        <DialogContent
          className="max-w-md overflow-hidden border-alert-500/60 p-0"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <div className="border-b border-alert-500/40 bg-alert-500/15 px-6 py-4 pr-12">
            <DialogHeader className="mb-0">
              <DialogTitle className="text-xl font-bold text-alert-300">
                🚨 CRITICAL INCIDENT
              </DialogTitle>
            </DialogHeader>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-ink-400">
              {alert?.type} · {toneLabel}
            </p>
          </div>
          <div className="space-y-3 p-5">
            <p className="font-semibold text-ink-50">{alert?.title}</p>
            <p className="whitespace-pre-wrap text-sm text-ink-200">{alert?.message}</p>

            {/* Incident context fields */}
            {(alert?.incidentDisplayId || alert?.location?.addressText || alert?.senderName) && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-navy-700 bg-navy-950/60 px-3 py-2.5 text-xs">
                {alert.incidentDisplayId && (
                  <>
                    <dt className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Incident ID</dt>
                    <dd className="font-mono text-ink-100">{alert.incidentDisplayId}</dd>
                  </>
                )}
                {(alert.incidentTypeName ?? alert.type) && (
                  <>
                    <dt className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Type</dt>
                    <dd className="text-ink-100">{alert.incidentTypeName ?? alert.type}</dd>
                  </>
                )}
                {alert.location?.addressText && (
                  <>
                    <dt className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Location</dt>
                    <dd className="text-ink-100">{alert.location.addressText}</dd>
                  </>
                )}
                {alert.senderName && (
                  <>
                    <dt className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Caller</dt>
                    <dd className="text-ink-100">{alert.senderName}</dd>
                  </>
                )}
                <dt className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Elapsed</dt>
                <dd className="font-mono font-semibold text-alert-300">
                  <ElapsedTimer fromIso={alert?.sentAt ?? ''} />
                </dd>
              </dl>
            )}

            {/* Acknowledgement confirmation text */}
            {ackConfirmText && (
              <p className="rounded-md border border-ok-500/30 bg-ok-500/10 px-3 py-2 text-sm font-medium text-ok-400">
                ✓ {ackConfirmText}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] border-alert-500/50 text-alert-300 hover:bg-alert-500/10"
                disabled={busy || !!ackConfirmText}
                onClick={() => void handleCriticalAcknowledge()}
              >
                {busy ? 'Processing…' : 'ACKNOWLEDGE'}
              </Button>
              {alert?.incidentId && (
                <>
                  <Button
                    type="button"
                    className="min-h-[44px]"
                    disabled={!!ackConfirmText}
                    onClick={() => void handleCriticalReviewDispatch()}
                  >
                    REVIEW &amp; DISPATCH
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-[44px]"
                    disabled={!!ackConfirmText}
                    onClick={() => void handleCriticalOpenIncident()}
                  >
                    OPEN INCIDENT
                  </Button>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Standard urgent/important alert modal */}
      <Dialog open={!!alert && alert.priority !== 'Critical'} onOpenChange={(o) => !o && void dismiss(true)}>
        <DialogContent className="max-w-sm overflow-hidden border-alert-500/40 p-0">
          <div className="border-b border-alert-500/30 bg-alert-500/10 px-6 py-4 pr-12">
            <DialogHeader className="mb-0">
              <DialogTitle className="text-alert-300">
                {alert?.priority === 'Urgent' ? 'Urgent alert' : 'Important alert'}
              </DialogTitle>
            </DialogHeader>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-ink-400">
              {alert?.type} · {toneLabel}
            </p>
          </div>
          <div className="space-y-3 p-5">
            <p className="font-semibold text-ink-50">{alert?.title}</p>
            <p className="whitespace-pre-wrap text-sm text-ink-200">{alert?.message}</p>
            {allowReply && (
              <label className="block space-y-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Reply to Dispatch</span>
                <textarea
                  className="input-field min-h-[88px] w-full resize-y py-2"
                  placeholder="Your reply…"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
              </label>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => void dismiss(true)}>
                Mark alert as read
              </Button>
              {allowReply && (
                <Button
                  type="button"
                  className="min-h-[44px]"
                  disabled={busy || !reply.trim()}
                  onClick={() => void sendReply()}
                >
                  {busy ? 'Sending…' : 'Send reply'}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Responder PWA host with reply-to-dispatch. */
export function ImportantAlertHost() {
  return <NotificationHost allowReply />;
}
