import type { Context } from 'hono';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  JWT_SECRET: string;
  MEDIA?: R2Bucket;
  MAPBOX_ACCESS_TOKEN?: string;
  GPS_STALE_MINUTES?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export type AppUser = {
  userId: string;
  email: string;
  role: string;
  permissions: string[];
};

export type Variables = { user: AppUser };

export const ROLES = {
  SYSTEM_ADMINISTRATOR: 'SYSTEM_ADMINISTRATOR',
  CENTRAL_DISPATCHER: 'CENTRAL_DISPATCHER',
  DEPARTMENT_DISPATCHER: 'DEPARTMENT_DISPATCHER',
  EMERGENCY_RESPONDER: 'EMERGENCY_RESPONDER',
  CITIZEN: 'CITIZEN',
} as const;

const DISPATCHER_PERMS = [
  'incidents:read',
  'incidents:write',
  'incidents:verify',
  'incidents:assign',
  'incidents:close',
  'sos:read',
  'dispatch:manage',
  'map:monitor',
  'transport:manage',
  'notifications:manage',
  'reports:read',
  'reports:export',
  'personnel:manage',
  'attendance:manage',
  'shifts:manage',
  'resources:manage',
  'settings:manage',
  'analytics:read',
];

export const PERMISSIONS: Record<string, string[]> = {
  SYSTEM_ADMINISTRATOR: ['*'],
  CENTRAL_DISPATCHER: DISPATCHER_PERMS,
  DEPARTMENT_DISPATCHER: DISPATCHER_PERMS.filter((p) => p !== 'personnel:manage'),
  EMERGENCY_RESPONDER: [
    'incidents:read',
    'sos:read',
    'responder:operations',
    'notifications:manage',
    'map:monitor',
    'attendance:self',
  ],
  CITIZEN: ['sos:write', 'sos:read', 'notifications:manage', 'profile:self'],
};

/** Unified ready-unit statuses so Dashboard, Dispatch, Resources, and Map agree. */
export const UNIT_READY_SQL = "status IN ('Ready', 'Available')";
export const UNIT_ON_SCENE_SQL = "status IN ('On Scene', 'Deployed', 'Assigned', 'En Route', 'Transporting')";
export const PERSONNEL_ON_DUTY_SQL =
  "availability_status IN ('Available', 'Assigned', 'Dispatched', 'En Route', 'On Scene', 'Transporting')";

export const TRANSITIONS: Record<string, string[]> = {
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

export const RESPONDER_STATUS_TRANSITIONS: Record<string, string[]> = {
  Available: ['Assigned', 'Dispatched', 'Out of Service', 'Off Duty'],
  Assigned: ['Accepted', 'Declined', 'En Route', 'Available', 'Out of Service'],
  Dispatched: ['Accepted', 'Declined', 'En Route', 'Available'],
  Accepted: ['En Route', 'Declined', 'Available'],
  Declined: ['Available', 'Assigned'],
  'En Route': ['On Scene', 'Available', 'Out of Service'],
  'On Scene': ['Transporting', 'Completed', 'Available'],
  Transporting: ['At Hospital/Destination', 'Completed', 'On Scene'],
  'At Hospital/Destination': ['Completed', 'Returning', 'Available'],
  Returning: ['Available', 'Out of Service'],
  Completed: ['Available', 'Returning'],
  'Out of Service': ['Available'],
  'Off Duty': ['Available'],
};

export function canTransition(from: string, to: string): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function canResponderTransition(from: string, to: string): boolean {
  if (from === to) return true;
  return RESPONDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function id(): string {
  return crypto.randomUUID();
}

export function jsonError(c: Context, status: number, message: string) {
  return c.json({ success: false, message }, status);
}

export function hasPerm(role: string, perm: string) {
  const list = PERMISSIONS[role] ?? [];
  return list.includes('*') || list.includes(perm);
}

export function jwtSecret(env: Env) {
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return env.JWT_SECRET;
}

export function sanitizeText(value: unknown, max = 4000): string {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, max);
}

const PH_MOBILE = /^(09|\+639|639)\d{9}$/;

export function normalizePhPhone(raw: string): string | null {
  const digits = raw.replace(/[\s()-]/g, '');
  if (PH_MOBILE.test(digits)) {
    if (digits.startsWith('+63')) return '0' + digits.slice(3);
    if (digits.startsWith('63')) return '0' + digits.slice(2);
    return digits;
  }
  return null;
}

export function passwordIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < 10) issues.push('at least 10 characters');
  if (!/[A-Z]/.test(password)) issues.push('one uppercase letter');
  if (!/[a-z]/.test(password)) issues.push('one lowercase letter');
  if (!/\d/.test(password)) issues.push('one number');
  if (!/[^A-Za-z0-9]/.test(password)) issues.push('one special character');
  return issues;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return `pbkdf2:100000:${saltB64}:${hashB64}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith('pbkdf2:')) return false;
  const [, iterS, saltB64, hashB64] = stored.split(':');
  const iterations = Number(iterS);
  const salt = Uint8Array.from(atob(saltB64), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  );
  const computed = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return computed === hashB64;
}

export async function nextDisplayId(db: D1Database, prefix: string) {
  const year = new Date().getUTCFullYear();
  await db
    .prepare('INSERT INTO counters (key, year, seq) VALUES (?, ?, 1) ON CONFLICT(key, year) DO UPDATE SET seq = seq + 1')
    .bind(prefix, year)
    .run();
  const row = await db.prepare('SELECT seq FROM counters WHERE key = ? AND year = ?').bind(prefix, year).first<{ seq: number }>();
  return `${prefix}-${year}-${String(row?.seq ?? 1).padStart(4, '0')}`;
}

export async function logActivity(
  db: D1Database,
  incidentId: string,
  action: string,
  details?: string,
  actorUserId?: string
) {
  await db
    .prepare(
      'INSERT INTO activity_logs (id, incident_id, actor_user_id, action, details, is_system) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(id(), incidentId, actorUserId ?? null, action, details ?? null, actorUserId ? 0 : 1)
    .run();
}

export async function audit(
  db: D1Database,
  actorUserId: string | undefined,
  actorRole: string | undefined,
  action: string,
  resourceType: string,
  resourceId?: string
) {
  await db
    .prepare(
      'INSERT INTO audit_logs (id, actor_user_id, actor_role, action, resource_type, resource_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(id(), actorUserId ?? null, actorRole ?? null, action, resourceType, resourceId ?? null)
    .run();
}

export async function logStatusHistory(
  db: D1Database,
  incidentId: string,
  fromStatus: string,
  toStatus: string,
  actorUserId?: string,
  reason?: string
) {
  try {
    await db
      .prepare(
        'INSERT INTO incident_status_history (id, incident_id, from_status, to_status, actor_user_id, reason) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(id(), incidentId, fromStatus, toStatus, actorUserId ?? null, reason ?? null)
      .run();
  } catch {
    /* table may not exist until migrate */
  }
}

/** Map linked incident status → SOS request status used by dashboard / SOS tabs. */
export function sosStatusFromIncident(incidentStatus: string): string | null {
  switch (incidentStatus) {
    case 'Pending Verification':
    case 'Validating':
    case 'Reported':
    case 'Reopened':
      return 'Pending';
    case 'Verified':
    case 'Open':
    case 'Acknowledged':
    case 'Dispatching':
    case 'Assigned':
    case 'Dispatched':
    case 'En Route':
    case 'On Scene':
    case 'Transporting':
    case 'At Hospital/Destination':
    case 'In Progress':
    case 'Escalated':
    case 'Unable to Locate':
      return 'In Progress';
    case 'Resolved':
    case 'Closed':
      return 'Resolved';
    case 'Cancelled':
    case 'False Alarm':
      return 'Cancelled';
    case 'Duplicate':
    case 'Rejected':
      return 'Rejected';
    default:
      return null;
  }
}

/** Keep sos_requests.status aligned with its linked incident. */
export async function syncSosForIncident(db: D1Database, incidentId: string, incidentStatus: string) {
  const next = sosStatusFromIncident(incidentStatus);
  if (!next) return;
  await db.prepare('UPDATE sos_requests SET status = ? WHERE incident_id = ?').bind(next, incidentId).run();
}

/**
 * Repair SOS rows stuck as Pending/In Progress after the linked incident already finished
 * (historical bug: incident status advanced without updating sos_requests).
 */
export async function healStaleSosStatuses(db: D1Database) {
  await db
    .prepare(
      `UPDATE sos_requests SET status = 'Resolved'
       WHERE status IN ('Pending', 'In Progress')
         AND incident_id IN (SELECT id FROM incidents WHERE status IN ('Resolved', 'Closed'))`
    )
    .run();
  await db
    .prepare(
      `UPDATE sos_requests SET status = 'Cancelled'
       WHERE status IN ('Pending', 'In Progress')
         AND incident_id IN (SELECT id FROM incidents WHERE status IN ('Cancelled', 'False Alarm'))`
    )
    .run();
  await db
    .prepare(
      `UPDATE sos_requests SET status = 'Rejected'
       WHERE status IN ('Pending', 'In Progress')
         AND incident_id IN (SELECT id FROM incidents WHERE status IN ('Duplicate', 'Rejected'))`
    )
    .run();
  await db
    .prepare(
      `UPDATE sos_requests SET status = 'In Progress'
       WHERE status = 'Pending'
         AND incident_id IN (
           SELECT id FROM incidents WHERE status IN (
             'Verified', 'Open', 'Acknowledged', 'Dispatching', 'Assigned', 'Dispatched',
             'En Route', 'On Scene', 'Transporting', 'At Hospital/Destination', 'In Progress',
             'Escalated', 'Unable to Locate'
           )
         )`
    )
    .run();
}

/** True pending-for-triage SOS count (not stale rows whose incidents already finished). */
export const PENDING_SOS_COUNT_SQL = `
  SELECT COUNT(*) as n FROM sos_requests s
  JOIN incidents i ON i.id = s.incident_id
  WHERE s.status = 'Pending'
    AND i.status IN ('Pending Verification', 'Validating', 'Reported', 'Reopened')
`;


export { SUN_VALLEY_CENTER, STATIC_FACILITIES } from './facilities.js';
