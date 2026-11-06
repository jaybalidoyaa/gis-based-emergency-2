import { audit, hashPassword, id, ROLES } from './core.js';

/** Production console accounts that must survive data wipe. */
export const PROTECTED_OPS_ACCOUNTS = [
  {
    id: 'user-ops-admin',
    email: 'admin@emergency.brigadaonse.org',
    roleName: ROLES.SYSTEM_ADMINISTRATOR,
    fullName: 'System Administrator',
    contactNumber: '09170000001',
  },
  {
    id: 'user-ops-dispatcher',
    email: 'balidoya@emergency.brigadaonse.org',
    roleName: ROLES.CENTRAL_DISPATCHER,
    fullName: 'Balidoya Dispatcher',
    contactNumber: '09170000002',
  },
] as const;

export const DEFAULT_OPS_PASSWORD = 'Password123!';

const ROLE_ID_BY_NAME: Record<string, string> = {
  [ROLES.SYSTEM_ADMINISTRATOR]: 'role-admin',
  [ROLES.CENTRAL_DISPATCHER]: 'role-dispatch',
  [ROLES.DEPARTMENT_DISPATCHER]: 'role-dept',
  [ROLES.EMERGENCY_RESPONDER]: 'role-responder',
  [ROLES.CITIZEN]: 'role-citizen',
};

async function runIgnore(db: D1Database, sql: string, ...binds: unknown[]) {
  try {
    if (binds.length) await db.prepare(sql).bind(...binds).run();
    else await db.prepare(sql).run();
  } catch {
    /* table/column may not exist on older DBs */
  }
}

async function resolveRoleId(db: D1Database, roleName: string): Promise<string> {
  const row = await db.prepare('SELECT id FROM roles WHERE name = ?').bind(roleName).first<{ id: string }>();
  if (row?.id) return row.id;
  const fallback = ROLE_ID_BY_NAME[roleName];
  if (fallback) return fallback;
  throw new Error(`Role missing: ${roleName}`);
}

/**
 * Ensure admin + dispatcher console accounts exist.
 * Existing password hashes are preserved; new accounts get DEFAULT_OPS_PASSWORD.
 */
export async function ensureProtectedOpsAccounts(db: D1Database): Promise<{
  created: string[];
  updated: string[];
}> {
  const created: string[] = [];
  const updated: string[] = [];
  const defaultHash = await hashPassword(DEFAULT_OPS_PASSWORD);

  for (const acct of PROTECTED_OPS_ACCOUNTS) {
    const roleId = await resolveRoleId(db, acct.roleName);
    const existing = await db
      .prepare('SELECT id, email FROM users WHERE lower(email) = lower(?)')
      .bind(acct.email)
      .first<{ id: string; email: string }>();

    if (existing) {
      await db
        .prepare(
          `UPDATE users SET role_id = ?, full_name = COALESCE(NULLIF(full_name, ''), ?), status = 'active', refresh_token = NULL
           WHERE id = ?`
        )
        .bind(roleId, acct.fullName, existing.id)
        .run();
      updated.push(acct.email);
      continue;
    }

    // Prefer stable id; if id collision (different email), mint a new id
    const idTaken = await db.prepare('SELECT id FROM users WHERE id = ?').bind(acct.id).first();
    const userId = idTaken ? id() : acct.id;
    await db
      .prepare(
        `INSERT INTO users (id, role_id, full_name, contact_number, email, password_hash, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`
      )
      .bind(userId, roleId, acct.fullName, acct.contactNumber, acct.email.toLowerCase(), defaultHash)
      .run();
    created.push(acct.email);
  }

  return { created, updated };
}

export async function resetUnitResponderStatus(db: D1Database, actorUserId: string, actorRole: string) {
  await runIgnore(
    db,
    `UPDATE assignments SET assignment_status = 'Cancelled'
     WHERE assignment_status NOT IN ('Completed', 'Rejected', 'Declined', 'Cancelled')`
  );
  await runIgnore(db, `UPDATE vehicles SET status = 'Ready', out_of_service_reason = NULL`);
  await runIgnore(
    db,
    `UPDATE responders SET availability_status = 'Available', operational_status = 'Available'`
  );
  await audit(db, actorUserId, actorRole, 'ops.reset_status', 'fleet', 'units+responders');
  return {
    vehicles: 'Ready',
    responders: 'Available',
    openAssignments: 'Cancelled',
  };
}

const OPS_CLEAR_STATEMENTS = [
  'DELETE FROM notification_replies',
  'DELETE FROM notification_deliveries',
  'DELETE FROM notifications',
  'DELETE FROM chat_messages',
  'DELETE FROM assignments',
  'DELETE FROM incident_status_history',
  'DELETE FROM activity_logs',
  'DELETE FROM media_attachments',
  'DELETE FROM gps_tracks',
  'DELETE FROM transports',
  'DELETE FROM checklist_items',
  'DELETE FROM checklists',
  'DELETE FROM sos_requests',
  'DELETE FROM incidents',
  'DELETE FROM locations',
  'DELETE FROM attendance',
  'DELETE FROM leave_requests',
  'DELETE FROM shifts',
  'DELETE FROM announcements',
  'DELETE FROM push_subscriptions',
  'DELETE FROM login_attempts',
  'DELETE FROM password_resets',
  'DELETE FROM idempotency_keys',
  'DELETE FROM guest_sos_rate',
  'DELETE FROM system_events',
  'DELETE FROM training_records',
  'DELETE FROM certifications',
  'DELETE FROM audit_logs',
  'DELETE FROM counters',
];

/**
 * Wipe operational data. Keeps roles, departments, incident types, facilities,
 * equipment, vehicles (status reset), system_settings, and protected console users.
 */
export async function resetAllOpsData(db: D1Database, actorUserId: string, actorRole: string) {
  const ensured = await ensureProtectedOpsAccounts(db);

  const protectedEmails = PROTECTED_OPS_ACCOUNTS.map((a) => a.email.toLowerCase());
  const placeholders = protectedEmails.map(() => '?').join(', ');

  const keptUsers = await db
    .prepare(`SELECT id, email FROM users WHERE lower(email) IN (${placeholders})`)
    .bind(...protectedEmails)
    .all<{ id: string; email: string }>();
  const keepIds = (keptUsers.results ?? []).map((u) => u.id);
  if (!keepIds.length) {
    throw new Error('Protected admin/dispatcher accounts could not be ensured');
  }
  const keepPlaceholders = keepIds.map(() => '?').join(', ');

  for (const sql of OPS_CLEAR_STATEMENTS) {
    await runIgnore(db, sql);
  }

  await runIgnore(db, 'DELETE FROM citizens');
  await runIgnore(db, `DELETE FROM responders WHERE user_id NOT IN (${keepPlaceholders})`, ...keepIds);
  await runIgnore(db, `DELETE FROM users WHERE id NOT IN (${keepPlaceholders})`, ...keepIds);

  await runIgnore(db, `UPDATE vehicles SET status = 'Ready', out_of_service_reason = NULL`);
  await runIgnore(
    db,
    `UPDATE responders SET availability_status = 'Available', operational_status = 'Available'`
  );

  // Invalidate sessions on preserved accounts so stale tokens after wipe are cleared
  await runIgnore(db, `UPDATE users SET refresh_token = NULL WHERE id IN (${keepPlaceholders})`, ...keepIds);

  await audit(db, actorUserId, actorRole, 'ops.reset_all_data', 'system', 'except_protected_credentials');

  return {
    preservedUsers: (keptUsers.results ?? []).map((u) => u.email),
    accountsEnsured: ensured,
    note: 'Catalog data (roles, departments, incident types, facilities, equipment, vehicles) retained. Vehicle/responder status set to available.',
  };
}
