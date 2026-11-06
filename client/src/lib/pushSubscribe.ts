import { notificationsApi } from '@/services/api';
import { unlockAlertAudio, playNotificationTone, type AlertTone } from '@/lib/alertSound';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** Request permission, subscribe Web Push, unlock alert audio (all roles). */
export async function enableAppPush(token: string): Promise<{ ok: boolean; detail: string }> {
  unlockAlertAudio();

  if (typeof window === 'undefined') return { ok: false, detail: 'Not in browser' };
  if (!('Notification' in window)) return { ok: false, detail: 'Notifications not supported' };
  if (!('serviceWorker' in navigator)) return { ok: false, detail: 'Service worker not supported' };

  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && Boolean((navigator as unknown as { standalone?: boolean }).standalone));
  if (isIos && !standalone) {
    return {
      ok: false,
      detail: 'On iPhone/iPad: tap Share → Add to Home Screen, open the app, then enable alerts.',
    };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    return { ok: false, detail: 'Notification permission blocked. Enable it in browser settings.' };
  }

  try {
    const { publicKey } = await notificationsApi.pushPublicKey(token);
    if (!publicKey) return { ok: false, detail: 'Push is not configured on the server yet.' };

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, detail: 'Could not create push subscription.' };
    }

    await notificationsApi.pushSubscribe(token, {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });

    return { ok: true, detail: 'Alerts enabled — sound & lock-screen when the app is closed.' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'Push subscribe failed' };
  }
}

/** @deprecated Use enableAppPush */
export const enableResponderPush = enableAppPush;

export function bindAlertAudioUnlock() {
  const once = () => unlockAlertAudio();
  window.addEventListener('pointerdown', once, { once: true, passive: true });
  window.addEventListener('keydown', once, { once: true });
  window.addEventListener('touchstart', once, { once: true, passive: true });
}

/** Listen for SW push messages to play matching in-app tones while app is open. */
export function bindPushToneMessages() {
  if (!('serviceWorker' in navigator)) return () => undefined;
  const handler = (event: MessageEvent) => {
    const data = event.data as { type?: string; tone?: AlertTone } | undefined;
    if (data?.type === 'brigada:push-tone' && data.tone) {
      void playNotificationTone(data.tone);
    }
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}
