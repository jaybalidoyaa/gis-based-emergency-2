/** Shared live-ops timing — keep PWA + dashboard refresh snappy with minimal delay. */

export const LIVE = {
  /** React Query default stale time */
  staleMs: 800,
  /** Event poll / live-sync base interval */
  syncMs: 1500,
  /** Cap for exponential backoff when reconnecting */
  syncMaxMs: 12000,
  /** Hot operational data (queue, SOS, assignments) — map GPS uses mapLiveMs */
  hotMs: 4000,
  /** Map fleet GPS / pins — Life360-like cadence */
  mapLiveMs: 1000,
  /** Dashboard KPIs / secondary panels */
  warmMs: 8000,
  /** Notifications / health / header badge */
  coolMs: 10000,
  /** Responder GPS push cadence to server */
  gpsMs: 1000,
  /** Citizen SOS hold-to-send (anti-mis-tap, still minimal) */
  sosHoldMs: 600,
  /** Map camera moves */
  mapFlyMs: 350,
  mapEaseMs: 400,
} as const;
