/**
 * Canonical incident priority constants.
 *
 * Note: some legacy code uses 'Medium' (incidentState.ts, IncidentActionDialogs)
 * as an alias for MODERATE. Do NOT rename those occurrences — this file provides
 * the canonical values going forward.
 */

export const INCIDENT_PRIORITY = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MODERATE: 'Moderate',
  LOW: 'Low',
} as const;

export type IncidentPriority = (typeof INCIDENT_PRIORITY)[keyof typeof INCIDENT_PRIORITY];

/**
 * Hex accent colors for map pins, charts, and inline priority indicators.
 * Keep in sync with the Figma palette used in opsVisuals.ts.
 */
export const PRIORITY_COLORS: Record<string, string> = {
  [INCIDENT_PRIORITY.CRITICAL]: '#d4453a',
  [INCIDENT_PRIORITY.HIGH]: '#fb923c',
  [INCIDENT_PRIORITY.MODERATE]: '#e8b84a',
  [INCIDENT_PRIORITY.LOW]: '#38bdf8',
};

/**
 * Tailwind class strings matching the existing StatusBadge variants.
 * Keys are the runtime priority strings (INCIDENT_PRIORITY values).
 */
export const PRIORITY_BADGE: Record<string, string> = {
  [INCIDENT_PRIORITY.CRITICAL]: 'bg-alert-500/20 text-alert-400 border-alert-500/40',
  [INCIDENT_PRIORITY.HIGH]: 'bg-alert-500/15 text-alert-400 border-alert-500/30',
  [INCIDENT_PRIORITY.MODERATE]: 'bg-gold-500/15 text-gold-400 border-gold-600/30',
  [INCIDENT_PRIORITY.LOW]: 'bg-navy-800 text-ink-400 border-navy-600',
};
