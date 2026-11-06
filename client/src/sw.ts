/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> };

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

try {
  registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));
} catch {
  /* build-time precache may omit index in some envs */
}

type PushData = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  tone?: string;
  priority?: string;
  important?: boolean;
  vibrate?: number[];
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

self.addEventListener('push', (event) => {
  let title = 'Brigada Onse';
  let body = 'New notification';
  let url = '/';
  let tag = 'brigada-alert';
  let tone = 'alert';
  let priority = 'Important';
  let vibrate = VIBRATE.alert;
  let important = true;

  try {
    const data = (event.data?.json() || {}) as PushData;
    if (data.title) title = data.title;
    if (data.body) body = data.body;
    if (data.url) url = data.url;
    if (data.tag) tag = data.tag;
    if (data.tone) tone = data.tone;
    if (data.priority) priority = data.priority;
    if (typeof data.important === 'boolean') important = data.important;
    vibrate = data.vibrate || VIBRATE[tone] || VIBRATE.alert;
  } catch {
    const text = event.data?.text();
    if (text) body = text;
  }

  const requireInteraction = important || ['Critical', 'Urgent', 'Important'].includes(priority);

  // Ask open clients to play the matching in-app tone
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        client.postMessage({ type: 'brigada:push-tone', tone, title, body, url, priority });
      }
      await self.registration.showNotification(title, {
        body,
        icon: '/logo.png',
        badge: '/logo.png',
        tag,
        requireInteraction,
        silent: false,
        vibrate,
        data: { url, tone, priority },
      } as NotificationOptions);
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | undefined)?.url || '/';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            try {
              await (client as WindowClient).navigate(target);
            } catch {
              /* ignore */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});
