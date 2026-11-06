/**
 * GPS freshness configuration and helpers.
 *
 * Thresholds are intentionally kept as a configurable object so they can be
 * adjusted from a settings page in the future without touching component code.
 */

export const GPS_THRESHOLDS = {
  /** 0–30 s → LIVE */
  LIVE_MAX_SECONDS: 30,
  /** 31–120 s → DELAYED */
  DELAYED_MAX_SECONDS: 120,
  // > 120 s → OFFLINE
} as const;

export type GpsFreshness = 'LIVE' | 'DELAYED' | 'OFFLINE';

/**
 * Compute GPS freshness category from a UTC ISO timestamp.
 *
 * @param lastUpdateIso - ISO 8601 timestamp string, or null/undefined
 * @returns 'LIVE' | 'DELAYED' | 'OFFLINE'
 *
 * Comparison is epoch-based (timezone-agnostic).
 */
export function getGpsFreshness(lastUpdateIso: string | null | undefined): GpsFreshness {
  if (!lastUpdateIso) return 'OFFLINE';

  const parsedMs = Date.parse(lastUpdateIso);
  if (Number.isNaN(parsedMs)) return 'OFFLINE';

  const elapsedSeconds = (Date.now() - parsedMs) / 1000;

  if (elapsedSeconds <= GPS_THRESHOLDS.LIVE_MAX_SECONDS) return 'LIVE';
  if (elapsedSeconds <= GPS_THRESHOLDS.DELAYED_MAX_SECONDS) return 'DELAYED';
  return 'OFFLINE';
}

/**
 * Format a human-readable GPS status string.
 *
 * Examples:
 *   'Live · 5 sec ago'
 *   'Delayed · 1m 32s ago'
 *   'GPS Offline · 12m ago'
 *   'GPS Offline' (when no timestamp)
 *
 * @param lastUpdateIso - ISO 8601 timestamp string, or null/undefined
 */
export function formatGpsStatus(lastUpdateIso: string | null | undefined): string {
  if (!lastUpdateIso) return 'GPS Offline';

  const parsedMs = Date.parse(lastUpdateIso);
  if (Number.isNaN(parsedMs)) return 'GPS Offline';

  const elapsedSeconds = Math.floor((Date.now() - parsedMs) / 1000);

  const freshness = getGpsFreshness(lastUpdateIso);

  if (freshness === 'LIVE') {
    return `Live · ${elapsedSeconds} sec ago`;
  }

  if (freshness === 'DELAYED') {
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = elapsedSeconds % 60;
    const elapsed = mins > 0 ? `${mins}m ${secs}s ago` : `${secs}s ago`;
    return `Delayed · Last update ${elapsed}`;
  }

  // OFFLINE
  const totalMins = Math.floor(elapsedSeconds / 60);
  if (totalMins < 60) {
    return `GPS Offline · Last update ${totalMins}m ago`;
  }
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `GPS Offline · Last update ${hours}h ${mins}m ago`;
}
