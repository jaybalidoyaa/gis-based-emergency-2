/**
 * Canonical incident status constants.
 * These are additive display-metadata only.
 * Do NOT modify incidentState.ts — the transitions and guard functions there
 * remain the source of truth for status flow.
 */

export const INCIDENT_STATUS = {
  REPORTED: 'Reported',
  PENDING_VERIFICATION: 'Pending Verification',
  VERIFIED: 'Verified',
  UNIT_ASSIGNED: 'Assigned',
  DISPATCHED: 'Dispatched',
  EN_ROUTE: 'En Route',
  ON_SCENE: 'On Scene',
  TRANSPORTING: 'Transporting',
  AT_DESTINATION: 'At Hospital/Destination',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
  FALSE_ALARM: 'False Alarm',
} as const;

export type IncidentStatus = (typeof INCIDENT_STATUS)[keyof typeof INCIDENT_STATUS];

/**
 * Human-readable display labels for each status key.
 * PENDING_VERIFICATION maps to the fuller dispatcher-facing label per Issue 14.
 */
export const INCIDENT_STATUS_LABELS: Record<string, string> = {
  REPORTED: 'Reported',
  PENDING_VERIFICATION: 'PENDING DISPATCHER VERIFICATION',
  VERIFIED: 'Verified',
  UNIT_ASSIGNED: 'Unit Assigned',
  DISPATCHED: 'Dispatched',
  EN_ROUTE: 'En Route',
  ON_SCENE: 'On Scene',
  TRANSPORTING: 'Transporting',
  AT_DESTINATION: 'At Hospital / Destination',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
  FALSE_ALARM: 'False Alarm',
};

/**
 * Tailwind class strings that match the existing StatusBadge variants.
 * Keys are the runtime status strings (INCIDENT_STATUS values).
 */
export const INCIDENT_STATUS_BADGE: Record<string, string> = {
  // Active / warning states
  [INCIDENT_STATUS.REPORTED]: 'bg-gold-500/15 text-gold-400 border-gold-600/40',
  [INCIDENT_STATUS.PENDING_VERIFICATION]: 'bg-gold-500/15 text-gold-400 border-gold-600/40',
  [INCIDENT_STATUS.VERIFIED]: 'bg-navy-700 text-ink-100 border-navy-600',
  [INCIDENT_STATUS.UNIT_ASSIGNED]: 'bg-navy-700 text-gold-400 border-navy-600',
  [INCIDENT_STATUS.DISPATCHED]: 'bg-navy-700 text-ink-100 border-navy-600',
  [INCIDENT_STATUS.EN_ROUTE]: 'bg-gold-500/15 text-gold-400 border-gold-600/40',
  [INCIDENT_STATUS.ON_SCENE]: 'bg-alert-500/15 text-alert-400 border-alert-500/40',
  [INCIDENT_STATUS.TRANSPORTING]: 'bg-gold-500/10 text-gold-400 border-gold-600/30',
  [INCIDENT_STATUS.AT_DESTINATION]: 'bg-ok-500/10 text-ok-400 border-ok-500/30',
  // Terminal states
  [INCIDENT_STATUS.RESOLVED]: 'bg-ok-500/15 text-ok-400 border-ok-500/30',
  [INCIDENT_STATUS.CLOSED]: 'bg-navy-800 text-ink-400 border-navy-600',
  [INCIDENT_STATUS.CANCELLED]: 'bg-navy-800 text-ink-400 border-navy-600',
  [INCIDENT_STATUS.FALSE_ALARM]: 'bg-navy-800 text-ink-400 border-navy-600',
};

/**
 * Ordered incident lifecycle — from first contact through closure.
 * Terminal statuses (CANCELLED, FALSE_ALARM) appear after CLOSED.
 */
export const INCIDENT_STATUS_ORDER: string[] = [
  INCIDENT_STATUS.REPORTED,
  INCIDENT_STATUS.PENDING_VERIFICATION,
  INCIDENT_STATUS.VERIFIED,
  INCIDENT_STATUS.UNIT_ASSIGNED,
  INCIDENT_STATUS.DISPATCHED,
  INCIDENT_STATUS.EN_ROUTE,
  INCIDENT_STATUS.ON_SCENE,
  INCIDENT_STATUS.TRANSPORTING,
  INCIDENT_STATUS.AT_DESTINATION,
  INCIDENT_STATUS.RESOLVED,
  INCIDENT_STATUS.CLOSED,
  // Terminal / special statuses
  INCIDENT_STATUS.CANCELLED,
  INCIDENT_STATUS.FALSE_ALARM,
];
