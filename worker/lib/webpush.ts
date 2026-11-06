import webpush from 'web-push';

export type PushSubRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  important?: boolean;
  tone?: string;
  priority?: string;
};

const VIBRATE: Record<string, number[]> = {
  sos: [300, 80, 300, 80, 300, 80, 500],
  urgent: [220, 70, 220, 70, 400],
  assignment: [200, 80, 200, 80, 320],
  alert: [180, 60, 180, 60, 180],
  chat: [70, 40, 90],
  status: [100],
  info: [50],
};

function pushUrgency(priority?: string, tone?: string): 'very-low' | 'low' | 'normal' | 'high' {
  const p = (priority || '').toLowerCase();
  const t = (tone || '').toLowerCase();
  if (p === 'critical' || t === 'sos') return 'high';
  if (p === 'urgent' || t === 'urgent' || t === 'assignment') return 'high';
  if (p === 'important' || t === 'alert') return 'high';
  if (t === 'chat' || t === 'status') return 'normal';
  return 'normal';
}

export async function sendWebPushToSubscriptions(
  env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string },
  subs: PushSubRow[],
  payload: PushPayload
) {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey || subs.length === 0) return { sent: 0, failed: 0 };

  webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:admin@sunvalley.gov.ph', publicKey, privateKey);

  const tone = payload.tone || 'alert';
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/responder/notifications',
    tag: payload.tag || 'brigada-alert',
    important: payload.important !== false,
    tone,
    priority: payload.priority || 'Important',
    vibrate: VIBRATE[tone] || VIBRATE.alert,
  });

  const urgency = pushUrgency(payload.priority, tone);
  let sent = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: 60 * 60 * 12, urgency }
        );
        sent += 1;
      } catch {
        failed += 1;
      }
    })
  );
  return { sent, failed };
}
