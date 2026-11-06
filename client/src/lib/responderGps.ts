import { respondersApi } from '@/services/api';
import { LIVE } from '@/lib/liveTiming';

const OFFLINE_GPS_KEY = 'sv-offline-status-queue';
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api';

/** Accept typical phone GPS; reject city/IP-level fixes. */
export const MAX_GPS_ACCURACY_M = 250;

/** Min time between server pushes (Life360-like cadence). */
const MIN_PUSH_MS = LIVE.gpsMs;
/** Push sooner if the phone moved at least this far. */
const MIN_MOVE_M = 2.5;

let watchId: number | undefined;
let intervalId: number | undefined;
let wakeLock: WakeLockSentinel | null = null;
let activeToken: string | null = null;
let lastGoodFix: { lat: number; lng: number; accuracy: number; at: number } | null = null;
let lastPushAt = 0;
let lastPushLat = 0;
let lastPushLng = 0;
let inflight = false;

function enqueueGpsOffline(lat: number, lng: number, accuracy?: number) {
  try {
    const raw = localStorage.getItem(OFFLINE_GPS_KEY);
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    list.push({ kind: 'gps', lat, lng, accuracy, queuedAt: Date.now() });
    localStorage.setItem(OFFLINE_GPS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function isUsableAccuracy(accuracy: number | undefined | null): boolean {
  if (accuracy == null || !Number.isFinite(accuracy)) return true;
  return accuracy > 0 && accuracy <= MAX_GPS_ACCURACY_M;
}

function isCoarseGridFix(lat: number, lng: number, accuracy: number | undefined | null): boolean {
  const gridLat = Math.round(lat * 100) / 100;
  const gridLng = Math.round(lng * 100) / 100;
  const onGrid = Math.abs(lat - gridLat) < 1e-8 && Math.abs(lng - gridLng) < 1e-8;
  const acc = accuracy ?? 999;
  return onGrid && acc > 50;
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number) {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLng - aLng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    }
  } catch {
    /* unsupported / denied */
  }
}

function shouldPush(lat: number, lng: number): boolean {
  const now = Date.now();
  if (!lastPushAt) return true;
  const moved = haversineM(lastPushLat, lastPushLng, lat, lng);
  if (moved >= MIN_MOVE_M) return true;
  return now - lastPushAt >= MIN_PUSH_MS;
}

function pushLocation(token: string, lat: number, lng: number, accuracy?: number, force = false) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return;
  if (!isUsableAccuracy(accuracy)) return;
  if (isCoarseGridFix(lat, lng, accuracy)) return;
  if (
    lastGoodFix &&
    accuracy != null &&
    accuracy > lastGoodFix.accuracy * 2.5 &&
    Date.now() - lastGoodFix.at < 45_000
  ) {
    return;
  }
  lastGoodFix = {
    lat,
    lng,
    accuracy: accuracy ?? lastGoodFix?.accuracy ?? 50,
    at: Date.now(),
  };
  if (!force && !shouldPush(lat, lng)) return;
  if (inflight && !force) return;

  lastPushAt = Date.now();
  lastPushLat = lat;
  lastPushLng = lng;

  if (!navigator.onLine) {
    enqueueGpsOffline(lat, lng, accuracy);
    return;
  }
  inflight = true;
  void respondersApi
    .updateLocation(token, lat, lng, accuracy)
    .catch(() => {
      enqueueGpsOffline(lat, lng, accuracy);
    })
    .finally(() => {
      inflight = false;
    });
}

function flushLastKnown() {
  if (!activeToken || !lastGoodFix) return;
  const { lat, lng, accuracy } = lastGoodFix;
  const body = JSON.stringify({ latitude: lat, longitude: lng, accuracy });
  const url = `${API_BASE}/responders/me/location`;
  try {
    void fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${activeToken}`,
      },
      body,
      keepalive: true,
      credentials: 'same-origin',
    });
  } catch {
    enqueueGpsOffline(lat, lng, accuracy);
  }
}

const GEO_OPTS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 15_000,
};

function sampleOnce(token: string, force = false) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => pushLocation(token, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, force),
    () => undefined,
    GEO_OPTS
  );
}

/**
 * Stream phone GPS while the responder PWA is open (~1s cadence).
 * Server keeps last-known when the app is closed.
 */
export function startResponderGpsTracking(token: string) {
  if (!navigator.geolocation || !token) return;
  if (activeToken === token && (watchId != null || intervalId != null)) return;
  stopResponderGpsTracking();
  activeToken = token;
  lastPushAt = 0;

  sampleOnce(token, true);
  void requestWakeLock();

  try {
    watchId = navigator.geolocation.watchPosition(
      (pos) => pushLocation(token, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
      () => undefined,
      GEO_OPTS
    );
  } catch {
    /* interval backup */
  }

  // Backup sample if watchPosition is quiet (some Android browsers)
  intervalId = window.setInterval(() => sampleOnce(token), LIVE.gpsMs * 2);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('beforeunload', onPageHide);
}

function onVisibility() {
  if (!activeToken) return;
  if (document.visibilityState === 'visible') {
    void requestWakeLock();
    sampleOnce(activeToken, true);
  } else {
    flushLastKnown();
  }
}

function onPageHide() {
  flushLastKnown();
}

export function stopResponderGpsTracking() {
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pagehide', onPageHide);
  window.removeEventListener('beforeunload', onPageHide);
  flushLastKnown();
  if (watchId != null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
    watchId = undefined;
  }
  if (intervalId != null) {
    window.clearInterval(intervalId);
    intervalId = undefined;
  }
  if (wakeLock) {
    void wakeLock.release().catch(() => undefined);
    wakeLock = null;
  }
  activeToken = null;
}
