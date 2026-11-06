/** Terminal / read-only incident statuses — no cancel, assign, or verify. */
export const READONLY_INCIDENT_STATUSES = new Set([
  'Cancelled',
  'Closed',
  'False Alarm',
  'Duplicate',
  'Resolved',
  'Rejected',
]);

export const DISPATCHABLE_STATUSES = new Set([
  'Pending Verification',
  'Validating',
  'Verified',
  'Acknowledged',
  'Open',
  'Dispatching',
  'Assigned',
  'Dispatched',
  'Reopened',
  'Escalated',
]);

export function isIncidentReadonly(status?: string | null): boolean {
  return !!status && READONLY_INCIDENT_STATUSES.has(status);
}

export function canAssignIncident(status?: string | null): boolean {
  return !!status && DISPATCHABLE_STATUSES.has(status) && status !== 'Pending Verification';
}

export function canVerifyIncident(status?: string | null): boolean {
  return status === 'Pending Verification' || status === 'Validating' || status === 'Reported';
}

export function canCancelIncident(status?: string | null): boolean {
  return !!status && !READONLY_INCIDENT_STATUSES.has(status);
}

export function canReopenIncident(status?: string | null): boolean {
  return status === 'Cancelled' || status === 'False Alarm' || status === 'Closed' || status === 'Resolved';
}

/** Valid next statuses for dispatcher status changes (mirrors worker TRANSITIONS). */
export const INCIDENT_STATUS_TRANSITIONS: Record<string, string[]> = {
  'Pending Verification': ['Validating', 'Verified', 'False Alarm', 'Duplicate', 'Cancelled', 'Unable to Locate'],
  Reported: ['Pending Verification', 'Validating', 'Verified', 'False Alarm', 'Cancelled'],
  Validating: ['Acknowledged', 'Verified', 'False Alarm', 'Duplicate', 'Unable to Locate', 'Cancelled'],
  Acknowledged: ['Dispatching', 'Open', 'Verified', 'Cancelled'],
  Verified: ['Open', 'Dispatching', 'False Alarm', 'Cancelled'],
  Open: ['Assigned', 'Dispatching', 'Dispatched', 'Closed', 'Cancelled', 'Escalated'],
  Dispatching: ['Dispatched', 'Assigned', 'Cancelled', 'Escalated'],
  Assigned: ['Dispatched', 'En Route', 'Open', 'Cancelled', 'Escalated'],
  Dispatched: ['En Route', 'Assigned', 'Cancelled', 'Escalated'],
  'En Route': ['On Scene', 'Assigned', 'Unable to Locate', 'Cancelled'],
  'On Scene': ['Transporting', 'At Hospital/Destination', 'In Progress', 'Resolved', 'Cancelled'],
  Transporting: ['At Hospital/Destination', 'On Scene', 'Resolved'],
  'At Hospital/Destination': ['Resolved', 'Transporting'],
  'In Progress': ['Resolved', 'Transporting', 'On Scene'],
  Resolved: ['Closed', 'Reopened'],
  Closed: ['Reopened'],
  Cancelled: ['Reopened'],
  'False Alarm': ['Closed', 'Reopened'],
  Duplicate: ['Closed'],
  'Unable to Locate': ['En Route', 'Closed', 'Cancelled', 'Reopened'],
  Reopened: ['Open', 'Dispatching', 'Verified'],
  Escalated: ['Dispatching', 'Assigned', 'Dispatched'],
};

export function allowedNextStatuses(status?: string | null): string[] {
  if (!status) return [];
  return INCIDENT_STATUS_TRANSITIONS[status] ?? [];
}

export const ROLE_LABELS: Record<string, string> = {
  SYSTEM_ADMINISTRATOR: 'System Administrator',
  CENTRAL_DISPATCHER: 'Central Dispatcher',
  DEPARTMENT_DISPATCHER: 'Department Dispatcher',
  EMERGENCY_RESPONDER: 'Emergency Responder',
  CITIZEN: 'Citizen',
};

export function formatRole(role?: string | null): string {
  if (!role) return '—';
  return ROLE_LABELS[role] ?? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format HH:MM (24h) as operational 0800H */
export function toOperationalTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm;
  return `${m[1].padStart(2, '0')}${m[2]}H`;
}

export function fromOperationalTime(value: string): string {
  const m = /^(\d{2})(\d{2})H?$/i.exec(value.replace(':', '').trim());
  if (m) return `${m[1]}:${m[2]}`;
  if (/^\d{1,2}:\d{2}$/.test(value)) return value;
  return '08:00';
}
