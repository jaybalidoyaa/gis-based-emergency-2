/**
 * Canonical unit operational status constants.
 * Use these consistently across Dispatch Center, Dashboard, Map,
 * Resources, Incident Detail, Personnel, and Analytics.
 */

export const UNIT_STATUS = {
  AVAILABLE: 'Available',
  ASSIGNED: 'Assigned',
  DISPATCHED: 'Dispatched',
  EN_ROUTE: 'En Route',
  ON_SCENE: 'On Scene',
  TRANSPORTING: 'Transporting',
  AT_HOSPITAL: 'At Hospital/Destination',
  RETURNING_TO_BASE: 'Returning',
  OUT_OF_SERVICE: 'Out of Service',
} as const;

export type UnitStatus = (typeof UNIT_STATUS)[keyof typeof UNIT_STATUS];

/** Human-readable display labels for each status key. */
export const UNIT_STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'Available',
  ASSIGNED: 'Assigned',
  DISPATCHED: 'Dispatched',
  EN_ROUTE: 'En Route',
  ON_SCENE: 'On Scene',
  TRANSPORTING: 'Transporting',
  AT_HOSPITAL: 'At Hospital / Destination',
  RETURNING_TO_BASE: 'Returning to Base',
  OUT_OF_SERVICE: 'Out of Service',
};

/**
 * Tailwind class strings matching the existing StatusBadge variants.
 * Keys are the runtime status strings (UNIT_STATUS values).
 */
export const UNIT_STATUS_BADGE: Record<string, string> = {
  [UNIT_STATUS.AVAILABLE]: 'bg-ok-500/15 text-ok-400 border-ok-500/30',
  [UNIT_STATUS.ASSIGNED]: 'bg-navy-700 text-gold-400 border-navy-600',
  [UNIT_STATUS.DISPATCHED]: 'bg-navy-700 text-ink-100 border-navy-600',
  [UNIT_STATUS.EN_ROUTE]: 'bg-gold-500/15 text-gold-400 border-gold-600/40',
  [UNIT_STATUS.ON_SCENE]: 'bg-alert-500/15 text-alert-400 border-alert-500/40',
  [UNIT_STATUS.TRANSPORTING]: 'bg-gold-500/10 text-gold-400 border-gold-600/30',
  [UNIT_STATUS.AT_HOSPITAL]: 'bg-ok-500/10 text-ok-400 border-ok-500/30',
  [UNIT_STATUS.RETURNING_TO_BASE]: 'bg-navy-700 text-ink-200 border-navy-600',
  [UNIT_STATUS.OUT_OF_SERVICE]: 'bg-navy-800 text-ink-400 border-navy-600',
};
