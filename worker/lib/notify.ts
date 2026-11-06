import { id, ROLES, sanitizeText } from './core';
import { sendWebPushToSubscriptions, type PushPayload } from './webpush';

export type NotifTone = 'sos' | 'urgent' | 'assignment' | 'alert' | 'chat' | 'status' | 'info';
export type NotifPriority = 'Critical' | 'Urgent' | 'Important' | 'Normal' | 'Info';

export type NotifySpec = {
  type: string;
  priority: NotifPriority;
  title: string;
  message: string;
  incidentId?: string | null;
  tone?: NotifTone;
  tag?: string;
  /** Role-specific deep links; falls back to role defaults. */
  urls?: Partial<Record<string, string>>;
  /** Skip inserting a DB row (push-only). */
  pushOnly?: boolean;
  /** Groups all recipient rows from one send. */
  batchId?: string;
  senderUserId?: string | null;
  audience?: string | null;
};

const DISPATCHER_ROLES = [
  ROLES.SYSTEM_ADMINISTRATOR,
  ROLES.CENTRAL_DISPATCHER,
  ROLES.DEPARTMENT_DISPATCHER,
] as const;

const DEFAULT_URL: Record<string, string> = {
  [ROLES.CITIZEN]: '/citizen/notifications',
  [ROLES.EMERGENCY_RESPONDER]: '/responder/notifications',
  [ROLES.CENTRAL_DISPATCHER]: '/admin/notifications',
  [ROLES.DEPARTMENT_DISPATCHER]: '/admin/notifications',
  [ROLES.SYSTEM_ADMINISTRATOR]: '/admin/notifications',
};

/** Map notification type/priority → tone used by SW + in-app audio. */
export function toneFor(type: string, priority: string, explicit?: NotifTone): NotifTone {
  if (explicit) return explicit;
  const t = type.toLowerCase();
  const p = priority.toLowerCase();
  if (t.includes('sos') || t.includes('emergency')) return 'sos';
  if (t.includes('chat') || t.includes('message')) return 'chat';
  if (t.includes('assignment') && !t.includes('declin')) return 'assignment';
  if (t.includes('status') || t.includes('update')) return 'status';
  if (t.includes('backup') || t.includes('declin') || p === 'critical') return 'urgent';
  if (p === 'urgent') return 'urgent';
  if (p === 'important' || t.includes('alert') || t.includes('reply')) return 'alert';
  return 'info';
}

function urlForRole(role: string, spec: NotifySpec): string {
  if (spec.urls?.[role]) return spec.urls[role]!;
  const t = spec.type.toLowerCase();
  if (role === ROLES.EMERGENCY_RESPONDER) {
    if (t.includes('chat')) return '/responder/chat';
    if (t.includes('assignment')) return '/responder';
  }
  if (DISPATCHER_ROLES.includes(role as (typeof DISPATCHER_ROLES)[number])) {
    if (t.includes('sos') || t.includes('emergency') || t.includes('backup') || t.includes('declin')) {
      return '/admin/dispatch';
    }
    if (t.includes('chat')) return '/admin/dispatch?focus=chat';
  }
  if (role === ROLES.CITIZEN && t.includes('status')) return '/citizen/sos';
  return DEFAULT_URL[role] || '/';
}

export async function listDispatcherUserIds(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.name IN ('SYSTEM_ADMINISTRATOR', 'CENTRAL_DISPATCHER', 'DEPARTMENT_DISPATCHER')
         AND u.status = 'active'`
    )
    .all<{ id: string }>();
  return (results ?? []).map((r) => r.id);
}

export async function listResponderUserIds(db: D1Database, excludeUserId?: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'EMERGENCY_RESPONDER' AND u.status = 'active'`
    )
    .all<{ id: string }>();
  return (results ?? []).map((r) => r.id).filter((uid) => uid !== excludeUserId);
}

export async function listCitizenUserIds(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'CITIZEN' AND u.status = 'active'`
    )
    .all<{ id: string }>();
  return (results ?? []).map((r) => r.id);
}

export type BroadcastAudience = 'ALL' | 'RESPONDERS' | 'CITIZENS' | 'DISPATCHERS';

/** Resolve active user IDs for a dispatcher broadcast audience. */
export async function listAudienceUserIds(
  db: D1Database,
  audience: BroadcastAudience
): Promise<string[]> {
  switch (audience) {
    case 'RESPONDERS':
      return listResponderUserIds(db);
    case 'CITIZENS':
      return listCitizenUserIds(db);
    case 'DISPATCHERS':
      return listDispatcherUserIds(db);
    case 'ALL': {
      const [dispatchers, responders, citizens] = await Promise.all([
        listDispatcherUserIds(db),
        listResponderUserIds(db),
        listCitizenUserIds(db),
      ]);
      return [...new Set([...dispatchers, ...responders, ...citizens])];
    }
    default:
      return [];
  }
}

async function rolesForUsers(db: D1Database, userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!userIds.length) return map;
  const placeholders = userIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT u.id, r.name as role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id IN (${placeholders})`
    )
    .bind(...userIds)
    .all<{ id: string; role: string }>();
  for (const row of results ?? []) map.set(row.id, row.role);
  return map;
}

export async function notifyUsers(
  env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string },
  db: D1Database,
  userIds: string[],
  spec: NotifySpec
): Promise<{ notified: number; pushed: number; batchId: string }> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const batchId = spec.batchId || id();
  if (!unique.length) return { notified: 0, pushed: 0, batchId };

  const title = sanitizeText(spec.title, 120);
  const message = sanitizeText(spec.message, 2000);
  const tone = toneFor(spec.type, spec.priority, spec.tone);
  const roles = await rolesForUsers(db, unique);
  const senderUserId = spec.senderUserId ?? null;
  const audience = spec.audience ?? null;

  if (!spec.pushOnly) {
    for (const userId of unique) {
      await db
        .prepare(
          `INSERT INTO notifications
            (id, recipient_user_id, incident_id, type, priority, title, message, batch_id, sender_user_id, audience)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id(),
          userId,
          spec.incidentId ?? null,
          spec.type,
          spec.priority,
          title,
          message,
          batchId,
          senderUserId,
          audience
        )
        .run();
    }
  }

  let pushed = 0;
  try {
    const placeholders = unique.map(() => '?').join(',');
    const { results: subs } = await db
      .prepare(
        `SELECT user_id as userId, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (${placeholders})`
      )
      .bind(...unique)
      .all<{ userId: string; endpoint: string; p256dh: string; auth: string }>();

    // Group by URL so each role gets the right deep link
    const byUrl = new Map<string, { endpoint: string; p256dh: string; auth: string }[]>();
    for (const sub of subs ?? []) {
      const role = roles.get(sub.userId) || ROLES.EMERGENCY_RESPONDER;
      const url = urlForRole(role, spec);
      const list = byUrl.get(url) || [];
      list.push({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth });
      byUrl.set(url, list);
    }

    for (const [url, group] of byUrl) {
      const payload: PushPayload = {
        title,
        body: message,
        url,
        tag: spec.tag || `${spec.type}-${spec.incidentId || 'ops'}`,
        tone,
        priority: spec.priority,
        important: ['Critical', 'Urgent', 'Important'].includes(spec.priority),
      };
      const result = await sendWebPushToSubscriptions(env, group, payload);
      pushed += result.sent;
    }
  } catch (err) {
    console.error('notify push failed', err);
  }

  return { notified: unique.length, pushed, batchId };
}

export async function notifyDispatchers(
  env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string },
  db: D1Database,
  spec: NotifySpec
) {
  const ids = await listDispatcherUserIds(db);
  return notifyUsers(env, db, ids, spec);
}
