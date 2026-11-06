import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { SignJWT, jwtVerify } from 'jose';
import { registerExtended } from './extended';
import {
  type Env,
  type Variables,
  ROLES,
  PERMISSIONS,
  TRANSITIONS,
  UNIT_READY_SQL,
  UNIT_ON_SCENE_SQL,
  PERSONNEL_ON_DUTY_SQL,
  num,
  id,
  jsonError,
  hasPerm,
  jwtSecret,
  hashPassword,
  verifyPassword,
  nextDisplayId,
  logActivity,
  audit,
  logStatusHistory,
  canTransition,
  sanitizeText,
  normalizePhPhone,
  passwordIssues,
  SUN_VALLEY_CENTER,
  STATIC_FACILITIES,
  syncSosForIncident,
  healStaleSosStatuses,
  PENDING_SOS_COUNT_SQL,
} from './lib/core';
import { buildOperationsPdf, manilaYmd } from './lib/pdf';
import {
  notifyUsers,
  notifyDispatchers,
  listResponderUserIds,
  listDispatcherUserIds,
  listAudienceUserIds,
  type BroadcastAudience,
  type NotifPriority,
  type NotifTone,
} from './lib/notify';
import {
  isTerminalIncidentStatus,
  releaseAssignmentsForIncident,
  syncVehicleForAssignmentStatus,
} from './lib/assignmentLifecycle';

export type { Env };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

async function signTokens(secret: string, payload: Variables['user']) {
  const key = new TextEncoder().encode(secret);
  const accessToken = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('8h')
    .sign(key);
  const refreshToken = await new SignJWT({ userId: payload.userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(key);
  return { accessToken, refreshToken };
}

app.use(
  '/api/*',
  cors({
    origin: ['https://emergency.brigadaonse.org', 'https://gis-based-emergency-dispatch-system.balidoyajayson.workers.dev', 'http://localhost:5173'],
    allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  })
);

async function auth(c: Context<{ Bindings: Env; Variables: Variables }>, next: () => Promise<void>) {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) return jsonError(c, 401, 'Authentication required');
  try {
    const { payload } = await jwtVerify(header.slice(7), new TextEncoder().encode(jwtSecret(c.env)));
    c.set('user', {
      userId: String(payload.userId),
      email: String(payload.email),
      role: String(payload.role),
      permissions: (payload.permissions as string[]) ?? [],
    });
    await next();
  } catch {
    return jsonError(c, 401, 'Invalid or expired token');
  }
}

function requirePerm(perm: string) {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: () => Promise<void>) => {
    const user = c.get('user');
    if (!hasPerm(user.role, perm)) return jsonError(c, 403, 'Insufficient permissions');
    await next();
  };
}

app.get('/api/health', async (c) => {
  const checks: Record<string, string> = {
    api: 'ok',
    database: 'unknown',
    map: c.env.MAPBOX_ACCESS_TOKEN ? 'ok' : 'degraded',
    realtime: 'polling',
    notifications: 'ok',
  };
  try {
    await c.env.DB.prepare('SELECT 1 as n').first();
    const tables = await c.env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='incidents'").first();
    checks.database = tables ? 'ok' : 'degraded';
  } catch {
    checks.database = 'down';
  }
  try {
    await c.env.DB.prepare('SELECT id FROM notifications LIMIT 1').first();
    checks.notifications = 'ok';
  } catch {
    checks.notifications = 'degraded';
  }
  const down = checks.database === 'down';
  const degraded = Object.values(checks).some((v) => v !== 'ok' && v !== 'polling');
  return c.json({
    success: !down,
    status: down ? 'down' : degraded ? 'degraded' : 'ok',
    version: '1.2.0',
    checks,
    center: SUN_VALLEY_CENTER,
    architecture: 'cloudflare-worker-d1',
    realtimeTransport: 'polling',
  });
});
app.get('/api/config', (c) =>
  c.json({
    success: true,
    data: {
      mapboxToken: c.env.MAPBOX_ACCESS_TOKEN ?? '',
      mapStyle: 'mapbox://styles/jayb21/cmutco0ed001201r76iq33qps',
      demoAccounts: false,
      center: SUN_VALLEY_CENTER,
    },
  })
);
app.get('/api/dashboard/health', async (c) => {
  const ping = await c.env.DB.prepare('SELECT 1 as n').first().catch(() => null);
  const map = c.env.MAPBOX_ACCESS_TOKEN ? 'ok' : 'missing-token';
  const database = ping ? 'ok' : 'down';
  const status = database === 'down' ? 'down' : map === 'ok' ? 'operational' : 'degraded';
  return c.json({
    success: true,
    data: { status, version: '1.1.0', database, map, realtime: 'polling' },
  });
});

app.get('/api/sos/types', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id as _id, type_name as typeName FROM incident_types WHERE is_active = 1').all();
  return c.json({ success: true, data: results });
});

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => ({}));
  if (!body.email || !body.password) return jsonError(c, 400, 'Invalid credentials');
  const email = body.email.toLowerCase();
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  try {
    const recent = await c.env.DB.prepare(
      "SELECT COUNT(*) as n FROM login_attempts WHERE email = ? AND success = 0 AND created_at > datetime('now', '-15 minutes')"
    )
      .bind(email)
      .first<{ n: unknown }>();
    if (num(recent?.n) >= 8) return jsonError(c, 429, 'Too many failed sign-in attempts. Try again in 15 minutes.');
  } catch {
    /* table may not exist until migrate */
  }
  const user = await c.env.DB.prepare(
    `SELECT u.*, r.name as role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ?`
  )
    .bind(email)
    .first<{
      id: string;
      full_name: string;
      email: string;
      contact_number: string;
      password_hash: string;
      status: string;
      role_name: string;
      locked_until?: string;
    }>();
  const recordAttempt = async (success: number) => {
    try {
      await c.env.DB.prepare('INSERT INTO login_attempts (id, email, ip, success) VALUES (?, ?, ?, ?)')
        .bind(id(), email, ip, success)
        .run();
    } catch {
      /* ignore */
    }
  };
  if (!user) {
    await recordAttempt(0);
    return jsonError(c, 401, 'Invalid email or password');
  }
  if (user.locked_until && Date.parse(user.locked_until) > Date.now()) {
    return jsonError(c, 423, 'Account temporarily locked. Try again later.');
  }
  if (user.status === 'inactive') return jsonError(c, 403, 'Account is deactivated');
  if (user.status === 'pending') return jsonError(c, 403, 'Account pending admin verification');
  const ok = await verifyPassword(body.password, user.password_hash);
  if (!ok) {
    await recordAttempt(0);
    return jsonError(c, 401, 'Invalid email or password');
  }
  await recordAttempt(1);
  try {
    await c.env.DB.prepare("UPDATE users SET last_login_at = datetime('now'), failed_logins = 0 WHERE id = ?").bind(user.id).run();
  } catch {
    /* columns may not exist yet */
  }

  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role_name,
    permissions: PERMISSIONS[user.role_name] ?? [],
  };
  const tokens = await signTokens(jwtSecret(c.env), payload);
  await c.env.DB.prepare('UPDATE users SET refresh_token = ? WHERE id = ?').bind(tokens.refreshToken, user.id).run();
  return c.json({
    success: true,
    data: {
      user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role_name, contactNumber: user.contact_number },
      ...tokens,
    },
  });
});

app.post('/api/auth/register', async (c) => {
  const body = await c.req.json<{
    fullName?: string;
    email?: string;
    contactNumber?: string;
    password?: string;
    confirmPassword?: string;
    address?: string;
    consent?: boolean;
    terms?: boolean;
  }>();
  if (!body.fullName || !body.email || !body.contactNumber || !body.password) {
    return jsonError(c, 400, 'Missing required fields');
  }
  if (body.confirmPassword != null && body.confirmPassword !== body.password) {
    return jsonError(c, 400, 'Passwords do not match');
  }
  if (!body.consent || !body.terms) {
    return jsonError(c, 400, 'Privacy consent and terms acceptance are required');
  }
  const phone = normalizePhPhone(body.contactNumber);
  if (!phone) return jsonError(c, 400, 'Enter a valid Philippine mobile number (09XXXXXXXXX)');
  const issues = passwordIssues(body.password);
  if (issues.length) return jsonError(c, 400, `Password must include ${issues.join(', ')}`);
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(body.email.toLowerCase()).first();
  if (existing) return jsonError(c, 409, 'Email already registered');
  const role = await c.env.DB.prepare('SELECT id FROM roles WHERE name = ?').bind(ROLES.CITIZEN).first<{ id: string }>();
  if (!role) return jsonError(c, 500, 'Citizen role not configured');
  const userId = id();
  await c.env.DB.prepare(
    'INSERT INTO users (id, role_id, full_name, contact_number, email, password_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(userId, role.id, sanitizeText(body.fullName, 120), phone, body.email.toLowerCase(), await hashPassword(body.password), 'active')
    .run();
  await c.env.DB.prepare('INSERT INTO citizens (id, user_id, address) VALUES (?, ?, ?)').bind(id(), userId, sanitizeText(body.address, 300) || null).run();
  try {
    await c.env.DB.prepare("UPDATE users SET consent_at = datetime('now'), email_verified = 0, phone_verified = 0 WHERE id = ?").bind(userId).run();
    await c.env.DB.prepare('UPDATE citizens SET privacy_consent = 1, terms_accepted = 1 WHERE user_id = ?').bind(userId).run();
  } catch {
    /* migrate optional */
  }
  await audit(c.env.DB, userId, ROLES.CITIZEN, 'CITIZEN_REGISTERED', 'User', userId);
  const payload = { userId, email: body.email.toLowerCase(), role: ROLES.CITIZEN, permissions: PERMISSIONS.CITIZEN };
  const tokens = await signTokens(jwtSecret(c.env), payload);
  return c.json({
    success: true,
    data: {
      user: { id: userId, fullName: sanitizeText(body.fullName, 120), email: payload.email, role: ROLES.CITIZEN, contactNumber: phone, status: 'active' },
      ...tokens,
    },
    message: 'Account created. Verify your contact number from Profile when prompted.',
  }, 201);
});

app.post('/api/auth/refresh', async (c) => {
  const { refreshToken } = await c.req.json<{ refreshToken?: string }>();
  if (!refreshToken) return jsonError(c, 400, 'Refresh token required');
  try {
    const { payload } = await jwtVerify(refreshToken, new TextEncoder().encode(jwtSecret(c.env)));
    const user = await c.env.DB.prepare(
      `SELECT u.*, r.name as role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`
    )
      .bind(String(payload.userId))
      .first<{ id: string; email: string; role_name: string; refresh_token: string; status: string }>();
    if (!user || user.refresh_token !== refreshToken || user.status !== 'active') {
      return jsonError(c, 401, 'Invalid refresh token');
    }
    const tokens = await signTokens(jwtSecret(c.env), {
      userId: user.id,
      email: user.email,
      role: user.role_name,
      permissions: PERMISSIONS[user.role_name] ?? [],
    });
    await c.env.DB.prepare('UPDATE users SET refresh_token = ? WHERE id = ?').bind(tokens.refreshToken, user.id).run();
    return c.json({ success: true, data: tokens });
  } catch {
    return jsonError(c, 401, 'Invalid refresh token');
  }
});

app.post('/api/auth/logout', auth, async (c) => {
  await c.env.DB.prepare('UPDATE users SET refresh_token = NULL WHERE id = ?').bind(c.get('user').userId).run();
  return c.json({ success: true, message: 'Logged out' });
});

app.get('/api/auth/me', auth, async (c) => {
  const user = await c.env.DB.prepare(
    `SELECT u.*, r.name as role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`
  )
    .bind(c.get('user').userId)
    .first<{ id: string; full_name: string; email: string; contact_number: string; status: string; role_name: string }>();
  if (!user) return jsonError(c, 404, 'User not found');
  return c.json({
    success: true,
    data: {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      contactNumber: user.contact_number,
      role: user.role_name,
      status: user.status,
    },
  });
});

app.get('/api/dashboard/stats', auth, requirePerm('incidents:read'), async (c) => {
  await healStaleSosStatuses(c.env.DB);
  const totalIncidents = num((await c.env.DB.prepare('SELECT COUNT(*) as n FROM incidents').first<{ n: unknown }>())?.n);
  const unitsAvailable = num(
    (await c.env.DB.prepare(`SELECT COUNT(*) as n FROM vehicles WHERE ${UNIT_READY_SQL}`).first<{ n: unknown }>())?.n
  );
  const unitsOnScene = num(
    (await c.env.DB.prepare(`SELECT COUNT(*) as n FROM vehicles WHERE ${UNIT_ON_SCENE_SQL}`).first<{ n: unknown }>())?.n
  );
  const totalPersonnel = num((await c.env.DB.prepare('SELECT COUNT(*) as n FROM responders').first<{ n: unknown }>())?.n);
  const personnelOnDuty = num(
    (await c.env.DB.prepare(`SELECT COUNT(*) as n FROM responders WHERE ${PERSONNEL_ON_DUTY_SQL}`).first<{ n: unknown }>())?.n
  );
  const pendingSos = num((await c.env.DB.prepare(PENDING_SOS_COUNT_SQL).first<{ n: unknown }>())?.n);
  return c.json({
    success: true,
    data: { totalIncidents, unitsAvailable, unitsOnScene, totalPersonnel, personnelOnDuty, pendingSos },
  });
});

function mapIncident(row: Record<string, unknown>) {
  return {
    _id: row.id,
    displayId: row.display_id,
    status: row.status,
    priorityLevel: row.priority_level,
    description: row.description,
    reportedAt: row.reported_at,
    callerName: row.caller_name,
    callerPhone: row.caller_phone,
    subcategory: row.subcategory,
    victimCount: row.victim_count,
    patientCondition: row.patient_condition,
    patientName: row.patient_name ?? null,
    vitalRr: row.vital_rr ?? null,
    vitalSpo2: row.vital_spo2 ?? null,
    vitalHr: row.vital_hr ?? null,
    vitalBp: row.vital_bp ?? null,
    oxygenRequired: Boolean(row.oxygen_required),
    oxygenFlow: row.oxygen_flow ?? null,
    knownHazards: row.known_hazards,
    accessibility: row.accessibility,
    reportSource: row.report_source,
    dispatcherNotes: row.dispatcher_notes,
    incidentTypeId: { typeName: row.type_name, _id: row.incident_type_id },
    locationId: {
      _id: row.location_id,
      latitude: num(row.latitude),
      longitude: num(row.longitude),
      addressText: row.address_text,
      landmark: row.landmark,
    },
    reportedByUserId: { fullName: row.reporter_name, contactNumber: row.reporter_phone, email: row.reporter_email },
  };
}

const INCIDENT_SELECT = `
  SELECT i.*, t.type_name, l.latitude, l.longitude, l.address_text, l.landmark,
         u.full_name as reporter_name, u.contact_number as reporter_phone, u.email as reporter_email
  FROM incidents i
  JOIN incident_types t ON t.id = i.incident_type_id
  JOIN locations l ON l.id = i.location_id
  JOIN users u ON u.id = i.reported_by_user_id
`;

app.get('/api/incidents/types', auth, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id as _id, type_name as typeName FROM incident_types
     WHERE is_active = 1 AND type_name NOT LIKE 'Patient Transport%'`
  ).all();
  return c.json({ success: true, data: results });
});

app.get('/api/incidents', auth, requirePerm('incidents:read'), async (c) => {
  const status = c.req.query('status') ?? 'All';
  let where = '';
  let bindValue: string | null = null;
  if (status === 'Open') where = "WHERE i.status IN ('Open', 'Assigned', 'Verified', 'Dispatching', 'Dispatched')";
  else if (status === 'Ongoing') where = "WHERE i.status IN ('En Route', 'On Scene', 'Transporting', 'In Progress', 'Assigned', 'Dispatched')";
  else if (status === 'Resolved') where = "WHERE i.status = 'Resolved'";
  else if (status === 'Closed') where = "WHERE i.status = 'Closed'";
  else if (status === 'Cancelled') where = "WHERE i.status = 'Cancelled'";
  else if (status === 'False Alarm') where = "WHERE i.status = 'False Alarm'";
  else if (status === 'Duplicate') where = "WHERE i.status = 'Duplicate'";
  else if (status === 'Reopened') where = "WHERE i.status = 'Reopened'";
  else if (status !== 'All') {
    where = 'WHERE i.status = ?';
    bindValue = status;
  }
  const sql = `${INCIDENT_SELECT} ${where} ORDER BY i.reported_at DESC LIMIT 100`;
  const { results } = bindValue
    ? await c.env.DB.prepare(sql).bind(bindValue).all()
    : await c.env.DB.prepare(sql).all();
  return c.json({ success: true, data: { incidents: results.map((r) => mapIncident(r as Record<string, unknown>)), total: results.length } });
});

app.get('/api/incidents/:incidentId', auth, requirePerm('incidents:read'), async (c) => {
  const row = await c.env.DB.prepare(`${INCIDENT_SELECT} WHERE i.id = ?`).bind(c.req.param('incidentId')).first();
  if (!row) return jsonError(c, 404, 'Incident not found');
  const timeline = await c.env.DB.prepare(
    'SELECT id as _id, action, details, created_at as createdAt, is_system as isSystemGenerated FROM activity_logs WHERE incident_id = ? ORDER BY created_at ASC'
  )
    .bind(c.req.param('incidentId'))
    .all();
  const assignments = await c.env.DB.prepare(
    `SELECT a.id as _id, a.assignment_status as assignmentStatus, r.callsign, u.full_name as fullName
     FROM assignments a JOIN responders r ON r.id = a.responder_id JOIN users u ON u.id = r.user_id
     WHERE a.incident_id = ?`
  )
    .bind(c.req.param('incidentId'))
    .all();
  return c.json({
    success: true,
    data: {
      ...mapIncident(row as Record<string, unknown>),
      timeline: timeline.results,
      assignments: assignments.results.map((a) => ({
        _id: a._id,
        assignmentStatus: a.assignmentStatus,
        responderId: { callsign: a.callsign, userId: { fullName: a.fullName } },
      })),
    },
  });
});

const CITIZEN_STATUS_NOTIFY = new Set([
  'Verified',
  'Open',
  'Assigned',
  'Dispatched',
  'En Route',
  'On Scene',
  'Transporting',
  'At Hospital/Destination',
  'Resolved',
  'Closed',
  'False Alarm',
  'Cancelled',
]);

async function notifyCitizenStatus(
  env: Env,
  db: D1Database,
  incidentId: string,
  next: string,
  actorId?: string
) {
  if (!CITIZEN_STATUS_NOTIFY.has(next)) return;
  const row = await db
    .prepare('SELECT display_id, reported_by_user_id FROM incidents WHERE id = ?')
    .bind(incidentId)
    .first<{ display_id: string; reported_by_user_id: string | null }>();
  if (!row?.reported_by_user_id || row.reported_by_user_id === actorId) return;
  const citizen = await db
    .prepare(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND r.name = 'CITIZEN'`
    )
    .bind(row.reported_by_user_id)
    .first<{ id: string }>();
  if (!citizen) return;

  const high = ['En Route', 'On Scene', 'Resolved', 'False Alarm', 'Cancelled'].includes(next);
  await notifyUsers(env, db, [citizen.id], {
    type: 'Incident Status',
    priority: high ? 'Important' : 'Info',
    title: `${row.display_id} — ${next}`,
    message: `Your emergency request is now: ${next}`,
    incidentId,
    tone: 'status',
    tag: `status-${incidentId}-${next}`,
  });
}

async function setStatus(
  db: D1Database,
  incidentId: string,
  next: string,
  actorId?: string,
  reason?: string,
  env?: Env
) {
  const incident = await db.prepare('SELECT * FROM incidents WHERE id = ?').bind(incidentId).first<{ status: string; is_locked: number }>();
  if (!incident) throw new Error('Incident not found');
  if (incident.is_locked) throw new Error('Incident is locked and cannot be modified');
  if (!canTransition(incident.status, next) && !TRANSITIONS[incident.status]?.includes(next)) {
    throw new Error(`Invalid status transition from "${incident.status}" to "${next}"`);
  }
  const extra =
    next === 'Verified' || next === 'Acknowledged'
      ? ', verified_at = datetime("now")'
      : next === 'Dispatched' || next === 'Assigned'
        ? ', dispatched_at = datetime("now")'
        : next === 'En Route'
          ? ', enroute_at = datetime("now")'
          : next === 'On Scene'
            ? ', onscene_at = datetime("now")'
            : next === 'Transporting'
              ? ', transporting_at = datetime("now")'
              : next === 'At Hospital/Destination'
                ? ', destination_at = datetime("now")'
                : next === 'Resolved'
                  ? ', resolved_at = datetime("now")'
                  : next === 'Closed'
                    ? ', closed_at = datetime("now"), is_locked = 1'
                    : '';
  try {
    await db.prepare(`UPDATE incidents SET status = ? ${extra} WHERE id = ?`).bind(next, incidentId).run();
  } catch {
    await db.prepare('UPDATE incidents SET status = ? WHERE id = ?').bind(next, incidentId).run();
  }
  await logStatusHistory(db, incidentId, incident.status, next, actorId, reason);
  await logActivity(db, incidentId, `Status Changed to ${next}`, reason || `Status updated from ${incident.status} to ${next}`, actorId);
  await syncSosForIncident(db, incidentId, next);
  if (isTerminalIncidentStatus(next)) {
    try {
      await releaseAssignmentsForIncident(db, incidentId, { reason, actorUserId: actorId });
    } catch (err) {
      console.error('releaseAssignmentsForIncident failed', err);
    }
  }
  if (env) {
    try {
      await notifyCitizenStatus(env, db, incidentId, next, actorId);
    } catch (err) {
      console.error('citizen status notify failed', err);
    }
  }
}

app.post('/api/incidents/:incidentId/verify', auth, requirePerm('incidents:verify'), async (c) => {
  const incidentId = c.req.param('incidentId');
  const userId = c.get('user').userId;
  const current = await c.env.DB.prepare('SELECT status FROM incidents WHERE id = ?').bind(incidentId).first<{ status: string }>();
  if (!current) return jsonError(c, 404, 'Incident not found');
  if (['Cancelled', 'Closed', 'False Alarm', 'Duplicate', 'Resolved'].includes(current.status)) {
    return jsonError(c, 400, `Incident is ${current.status} and cannot be verified. Reopen it first.`);
  }
  await c.env.DB.prepare('UPDATE incidents SET dispatcher_id = ? WHERE id = ?').bind(userId, incidentId).run();
  try {
    await setStatus(c.env.DB, incidentId, 'Verified', userId, undefined, c.env);
    await setStatus(c.env.DB, incidentId, 'Open', userId, undefined, c.env);
  } catch (err) {
    return jsonError(c, 400, err instanceof Error ? err.message : 'Verify failed');
  }
  await c.env.DB.prepare(
    'INSERT INTO audit_logs (id, actor_user_id, actor_role, action, resource_type, resource_id) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(id(), userId, c.get('user').role, 'INCIDENT_VERIFIED', 'Incident', incidentId)
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM incidents WHERE id = ?').bind(incidentId).first();
  return c.json({ success: true, data: row });
});

app.post('/api/incidents/:incidentId/false-alarm', auth, requirePerm('incidents:verify'), async (c) => {
  const incidentId = c.req.param('incidentId');
  try {
    await setStatus(c.env.DB, incidentId, 'False Alarm', c.get('user').userId, undefined, c.env);
    await setStatus(c.env.DB, incidentId, 'Closed', c.get('user').userId, undefined, c.env);
  } catch (err) {
    return jsonError(c, 400, err instanceof Error ? err.message : 'Update failed');
  }
  return c.json({ success: true });
});

app.post('/api/incidents/:incidentId/status', auth, requirePerm('incidents:write'), async (c) => {
  const { status } = await c.req.json<{ status?: string }>();
  if (!status) return jsonError(c, 400, 'Status required');
  try {
    await setStatus(c.env.DB, c.req.param('incidentId'), status, c.get('user').userId, undefined, c.env);
  } catch (err) {
    return jsonError(c, 400, err instanceof Error ? err.message : 'Update failed');
  }
  return c.json({ success: true });
});

app.post('/api/incidents/:incidentId/assign', auth, requirePerm('incidents:assign'), async (c) => {
  const { responderId, vehicleId } = await c.req.json<{ responderId?: string; vehicleId?: string }>();
  if (!responderId) return jsonError(c, 400, 'responderId required');
  const incidentId = c.req.param('incidentId');
  const incident = await c.env.DB.prepare('SELECT * FROM incidents WHERE id = ?').bind(incidentId).first<{ status: string; is_locked: number; display_id: string }>();
  if (!incident || incident.is_locked) return jsonError(c, 400, 'Incident not available for assignment');
  if (['Cancelled', 'Closed', 'False Alarm', 'Duplicate', 'Resolved'].includes(incident.status)) {
    return jsonError(c, 400, `Cannot assign units to a ${incident.status} incident`);
  }
  const assignmentId = id();
  await c.env.DB.prepare(
    'INSERT INTO assignments (id, incident_id, responder_id, vehicle_id, assigned_by_dispatcher_id, assignment_status) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(assignmentId, incidentId, responderId, vehicleId ?? null, c.get('user').userId, 'Assigned')
    .run();
  if (incident.status === 'Open' || incident.status === 'Verified') {
    await setStatus(c.env.DB, incidentId, 'Assigned', c.get('user').userId, undefined, c.env);
  }
  await c.env.DB.prepare("UPDATE responders SET availability_status = 'Dispatched', operational_status = 'Dispatched' WHERE id = ?")
    .bind(responderId)
    .run();
  if (vehicleId) {
    await c.env.DB.prepare("UPDATE vehicles SET status = 'Deployed' WHERE id = ?").bind(vehicleId).run();
  }
  const responder = await c.env.DB.prepare('SELECT user_id FROM responders WHERE id = ?').bind(responderId).first<{ user_id: string }>();
  if (responder) {
    await notifyUsers(c.env, c.env.DB, [responder.user_id], {
      type: 'Dispatch Assignment',
      priority: 'Important',
      title: 'New Dispatch Assignment',
      message: `You have been assigned to ${incident.display_id}`,
      incidentId,
      tone: 'assignment',
      tag: `assign-${assignmentId}`,
    });
  }
  await logActivity(c.env.DB, incidentId, 'Unit Assigned', 'Responder assigned to incident', c.get('user').userId);
  return c.json({ success: true, data: { id: assignmentId } });
});

app.get('/api/incidents/:incidentId/nearby-units', auth, requirePerm('incidents:assign'), async (c) => {
  const loc = await c.env.DB.prepare(
    'SELECT l.latitude, l.longitude FROM incidents i JOIN locations l ON l.id = i.location_id WHERE i.id = ?'
  )
    .bind(c.req.param('incidentId'))
    .first<{ latitude: number; longitude: number }>();
  if (!loc) return jsonError(c, 404, 'Incident not found');
  const { results } = await c.env.DB.prepare(
    `SELECT r.id as _id, r.callsign, r.lat, r.lng, u.full_name as fullName
     FROM responders r JOIN users u ON u.id = r.user_id
     WHERE r.availability_status = 'Available' AND r.lat IS NOT NULL`
  ).all();
  const withDistance = results
    .map((r) => {
      const dLat = ((Number(r.lat) - loc.latitude) * Math.PI) / 180;
      const dLon = ((Number(r.lng) - loc.longitude) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((loc.latitude * Math.PI) / 180) * Math.cos((Number(r.lat) * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
      const distanceKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return { _id: r._id, callsign: r.callsign, userId: { fullName: r.fullName }, distanceKm };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 10);
  return c.json({ success: true, data: withDistance });
});

app.get('/api/incidents/:incidentId/timeline', auth, requirePerm('incidents:read'), async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id as _id, action, details, created_at as createdAt FROM activity_logs WHERE incident_id = ? ORDER BY created_at'
  )
    .bind(c.req.param('incidentId'))
    .all();
  return c.json({ success: true, data: results });
});

app.post('/api/incidents/:incidentId/notes', auth, requirePerm('incidents:write'), async (c) => {
  const { note } = await c.req.json<{ note?: string }>();
  if (!note?.trim()) return jsonError(c, 400, 'Note required');
  await logActivity(c.env.DB, c.req.param('incidentId'), 'Note Added', note, c.get('user').userId);
  return c.json({ success: true, message: 'Note added' });
});

app.post('/api/sos', auth, requirePerm('sos:write'), async (c) => {
  const body = await c.req.json<{
    incidentTypeId: string;
    description?: string;
    latitude: number;
    longitude: number;
    addressText?: string;
    landmark?: string;
    autoLocationFlag?: boolean;
    priorityLevel?: string;
    victimCount?: number;
    hazards?: string;
    contactNumber?: string;
    clientRequestId?: string;
  }>();
  const citizen = await c.env.DB.prepare('SELECT id FROM citizens WHERE user_id = ?').bind(c.get('user').userId).first<{ id: string }>();
  if (!citizen) return jsonError(c, 403, 'Citizen profile required');
  const lat = num(body.latitude) || SUN_VALLEY_CENTER.lat;
  const lng = num(body.longitude) || SUN_VALLEY_CENTER.lng;
  const recent = await c.env.DB.prepare(
    `SELECT s.id FROM sos_requests s
     JOIN incidents i ON i.id = s.incident_id
     JOIN locations l ON l.id = i.location_id
     WHERE s.citizen_id = ? AND s.trigger_time > datetime('now', '-5 minutes') AND s.status = 'Pending'`
  )
    .bind(citizen.id)
    .first();
  if (recent) return jsonError(c, 409, 'An SOS was already submitted in the last 5 minutes. Wait for dispatch or update that request.');

  const locationId = id();
  const incidentId = id();
  const sosId = id();
  await c.env.DB.prepare('INSERT INTO locations (id, latitude, longitude, address_text, landmark) VALUES (?, ?, ?, ?, ?)')
    .bind(locationId, lat, lng, sanitizeText(body.addressText, 300) || null, sanitizeText(body.landmark, 200) || null)
    .run();
  const displayId = await nextDisplayId(c.env.DB, 'INC');
  const sosDisplayId = await nextDisplayId(c.env.DB, 'SOS');
  await c.env.DB.prepare(
    `INSERT INTO incidents (id, display_id, reported_by_user_id, incident_type_id, location_id, description, priority_level, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending Verification')`
  )
    .bind(incidentId, displayId, c.get('user').userId, body.incidentTypeId, locationId, sanitizeText(body.description, 2000), body.priorityLevel ?? 'High')
    .run();
  await c.env.DB.prepare(
    'INSERT INTO sos_requests (id, display_id, incident_id, citizen_id, auto_location_flag, status) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(sosId, sosDisplayId, incidentId, citizen.id, body.autoLocationFlag === false ? 0 : 1, 'Pending')
    .run();
  await logActivity(c.env.DB, incidentId, 'SOS Received', 'Citizen SOS emergency request submitted', c.get('user').userId);
  await notifyDispatchers(c.env, c.env.DB, {
    type: 'Emergency/SOS',
    priority: 'Urgent',
    title: 'New SOS Alert',
    message: `${sosDisplayId} — ${sanitizeText(body.description, 120) || 'Emergency reported'}`,
    incidentId,
    tone: 'sos',
    tag: `sos-${sosId}`,
  });
  return c.json({ success: true, data: { sos: { _id: sosId, displayId: sosDisplayId }, incident: { _id: incidentId, displayId } } }, 201);
});

app.get('/api/sos/my-status', auth, requirePerm('sos:read'), async (c) => {
  await healStaleSosStatuses(c.env.DB);
  const citizen = await c.env.DB.prepare('SELECT id FROM citizens WHERE user_id = ?').bind(c.get('user').userId).first<{ id: string }>();
  if (!citizen) return c.json({ success: true, data: null });
  const sos = await c.env.DB.prepare('SELECT * FROM sos_requests WHERE citizen_id = ? ORDER BY trigger_time DESC LIMIT 1')
    .bind(citizen.id)
    .first<Record<string, unknown>>();
  if (!sos) return c.json({ success: true, data: null });
  const incident = await c.env.DB.prepare(`${INCIDENT_SELECT} WHERE i.id = ?`).bind(sos.incident_id).first();
  return c.json({
    success: true,
    data: {
      _id: sos.id,
      displayId: sos.display_id,
      status: sos.status,
      triggerTime: sos.trigger_time,
      incidentId: incident ? mapIncident(incident as Record<string, unknown>) : undefined,
    },
  });
});

app.get('/api/sos', auth, requirePerm('sos:read'), async (c) => {
  await healStaleSosStatuses(c.env.DB);
  const status = c.req.query('status');
  let sql = `SELECT s.* FROM sos_requests s ORDER BY s.trigger_time DESC`;
  let bind: string | null = null;
  if (status && status !== 'All') {
    if (['Pending', 'In Progress', 'Resolved', 'Cancelled', 'Rejected'].includes(status)) {
      sql = `SELECT s.* FROM sos_requests s WHERE s.status = ? ORDER BY s.trigger_time DESC`;
      bind = status;
    } else if (status === 'Verified') {
      sql = `SELECT s.* FROM sos_requests s JOIN incidents i ON i.id = s.incident_id WHERE i.status IN ('Verified', 'Open') AND s.status != 'Cancelled' ORDER BY s.trigger_time DESC`;
    } else if (status === 'Converted to Incident') {
      sql = `SELECT s.* FROM sos_requests s JOIN incidents i ON i.id = s.incident_id WHERE i.status IN ('Open', 'Assigned', 'Dispatched', 'En Route', 'On Scene', 'Transporting', 'In Progress') AND s.status != 'Cancelled' ORDER BY s.trigger_time DESC`;
    } else if (status === 'False Alarm') {
      sql = `SELECT s.* FROM sos_requests s JOIN incidents i ON i.id = s.incident_id WHERE i.status = 'False Alarm' ORDER BY s.trigger_time DESC`;
    } else if (status === 'Duplicate') {
      sql = `SELECT s.* FROM sos_requests s JOIN incidents i ON i.id = s.incident_id WHERE i.status = 'Duplicate' ORDER BY s.trigger_time DESC`;
    }
  }
  const { results } = bind ? await c.env.DB.prepare(sql).bind(bind).all() : await c.env.DB.prepare(sql).all();
  const data = [];
  for (const s of results) {
    const incident = await c.env.DB.prepare(`${INCIDENT_SELECT} WHERE i.id = ?`).bind((s as { incident_id: string }).incident_id).first();
    data.push({
      _id: (s as { id: string }).id,
      displayId: (s as { display_id: string }).display_id,
      status: (s as { status: string }).status,
      triggerTime: (s as { trigger_time: string }).trigger_time,
      incidentId: incident ? mapIncident(incident as Record<string, unknown>) : undefined,
    });
  }
  return c.json({ success: true, data });
});

app.get('/api/responders/dispatch-queue', auth, requirePerm('dispatch:manage'), async (c) => {
  await healStaleSosStatuses(c.env.DB);
  const { results } = await c.env.DB.prepare(
    `${INCIDENT_SELECT} WHERE i.status NOT IN ('Closed', 'False Alarm', 'Resolved', 'Cancelled', 'Duplicate', 'Rejected') ORDER BY i.reported_at DESC`
  ).all();
  const pendingSos = num((await c.env.DB.prepare(PENDING_SOS_COUNT_SQL).first<{ n: unknown }>())?.n);
  const unitsReady = num((await c.env.DB.prepare(`SELECT COUNT(*) as n FROM vehicles WHERE ${UNIT_READY_SQL}`).first<{ n: unknown }>())?.n);
  const incidents = results.map((r) => mapIncident(r as Record<string, unknown>));
  const ids = incidents.map((i) => i._id as string).filter(Boolean);
  const assignmentByIncident = new Map<
    string,
    { _id: string; assignmentStatus: string; responderId: { callsign?: string; fullName?: string }; vehicleId?: { unitNo?: string } }[]
  >();
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const { results: assigns } = await c.env.DB.prepare(
      `SELECT a.id as _id, a.incident_id as incidentId, a.assignment_status as assignmentStatus,
              r.callsign, u.full_name as fullName, v.unit_no as unitNo
       FROM assignments a
       LEFT JOIN responders r ON r.id = a.responder_id
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN vehicles v ON v.id = a.vehicle_id
       WHERE a.incident_id IN (${placeholders})
         AND a.assignment_status NOT IN ('Completed', 'Rejected', 'Declined', 'Cancelled')
       ORDER BY a.assigned_at ASC`
    )
      .bind(...ids)
      .all<{
        _id: string;
        incidentId: string;
        assignmentStatus: string;
        callsign: string | null;
        fullName: string | null;
        unitNo: string | null;
      }>();
    for (const a of assigns ?? []) {
      const list = assignmentByIncident.get(a.incidentId) ?? [];
      list.push({
        _id: a._id,
        assignmentStatus: a.assignmentStatus,
        responderId: { callsign: a.callsign ?? undefined, fullName: a.fullName ?? undefined },
        vehicleId: a.unitNo ? { unitNo: a.unitNo } : undefined,
      });
      assignmentByIncident.set(a.incidentId, list);
    }
  }
  for (const inc of incidents) {
    (inc as { assignments?: unknown }).assignments = assignmentByIncident.get(inc._id as string) ?? [];
  }
  const order: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Moderate: 2, Low: 3 };
  incidents.sort((a, b) => (order[a.priorityLevel as string] ?? 9) - (order[b.priorityLevel as string] ?? 9));
  return c.json({ success: true, data: { incidents, pendingSos, unitsReady, liveQueue: incidents.length } });
});

app.get('/api/responders/assignments/mine', auth, requirePerm('responder:operations'), async (c) => {
  const responder = await c.env.DB.prepare('SELECT id FROM responders WHERE user_id = ?').bind(c.get('user').userId).first<{ id: string }>();
  if (!responder) return c.json({ success: true, data: [] });
  const { results } = await c.env.DB.prepare(
    `SELECT a.id as _id, a.assignment_status as assignmentStatus, a.incident_id
     FROM assignments a
     JOIN incidents i ON i.id = a.incident_id
     WHERE a.responder_id = ?
       AND a.assignment_status NOT IN ('Completed', 'Rejected', 'Declined', 'Cancelled')
       AND i.status NOT IN ('Cancelled', 'Closed', 'False Alarm', 'Duplicate', 'Resolved')
     ORDER BY a.assigned_at DESC`
  )
    .bind(responder.id)
    .all();
  const data = [];
  for (const a of results) {
    const incident = await c.env.DB.prepare(`${INCIDENT_SELECT} WHERE i.id = ?`).bind((a as { incident_id: string }).incident_id).first();
    data.push({
      _id: (a as { _id: string })._id,
      assignmentStatus: (a as { assignmentStatus: string }).assignmentStatus,
      incidentId: incident ? mapIncident(incident as Record<string, unknown>) : undefined,
    });
  }
  return c.json({ success: true, data });
});

app.post('/api/responders/assignments/:assignmentId/accept', auth, requirePerm('responder:operations'), async (c) => {
  const assignment = await c.env.DB.prepare('SELECT * FROM assignments WHERE id = ?')
    .bind(c.req.param('assignmentId'))
    .first<{ id: string; responder_id: string; incident_id: string }>();
  if (!assignment) return jsonError(c, 404, 'Assignment not found');
  const responder = await c.env.DB.prepare('SELECT id FROM responders WHERE user_id = ?').bind(c.get('user').userId).first<{ id: string }>();
  if (!responder || responder.id !== assignment.responder_id) return jsonError(c, 403, 'Not authorized');
  const linked = await c.env.DB.prepare('SELECT status FROM incidents WHERE id = ?').bind(assignment.incident_id).first<{ status: string }>();
  if (linked && isTerminalIncidentStatus(linked.status)) {
    return jsonError(c, 400, `Cannot acknowledge — incident is ${linked.status}`);
  }
  await c.env.DB.prepare("UPDATE assignments SET assignment_status = 'Accepted', accepted_at = datetime('now') WHERE id = ?")
    .bind(assignment.id)
    .run();
  await c.env.DB.prepare("UPDATE responders SET operational_status = 'Assigned', availability_status = 'Assigned' WHERE id = ?")
    .bind(responder.id)
    .run();
  try {
    await syncVehicleForAssignmentStatus(c.env.DB, assignment.id, 'Accepted');
  } catch {
    /* vehicle optional */
  }
  try {
    await setStatus(c.env.DB, assignment.incident_id, 'Dispatched', c.get('user').userId, 'Assignment accepted', c.env);
  } catch {
    /* already past Dispatched */
  }
  const sender = await c.env.DB.prepare('SELECT full_name FROM users WHERE id = ?')
    .bind(c.get('user').userId)
    .first<{ full_name: string }>();
  const incident = await c.env.DB.prepare('SELECT display_id FROM incidents WHERE id = ?')
    .bind(assignment.incident_id)
    .first<{ display_id: string }>();
  await notifyDispatchers(c.env, c.env.DB, {
    type: 'Assignment Update',
    priority: 'Important',
    title: 'Assignment accepted',
    message: `${sender?.full_name || 'Responder'} accepted ${incident?.display_id || 'assignment'} — ready to mobilize`,
    incidentId: assignment.incident_id,
    tone: 'status',
    tag: `accept-${assignment.id}`,
  });
  await logActivity(c.env.DB, assignment.incident_id, 'Assignment Accepted', 'Responder accepted dispatch assignment', c.get('user').userId);
  return c.json({ success: true, data: { assignmentStatus: 'Accepted' } });
});

app.post('/api/responders/assignments/:assignmentId/status', auth, requirePerm('responder:operations'), async (c) => {
  const { status } = await c.req.json<{ status?: string }>();
  const assignment = await c.env.DB.prepare('SELECT * FROM assignments WHERE id = ?')
    .bind(c.req.param('assignmentId'))
    .first<{ id: string; incident_id: string; responder_id: string }>();
  if (!assignment || !status) return jsonError(c, 404, 'Assignment not found');
  const linked = await c.env.DB.prepare('SELECT status FROM incidents WHERE id = ?')
    .bind(assignment.incident_id)
    .first<{ status: string }>();
  if (linked && isTerminalIncidentStatus(linked.status) && status !== 'Completed') {
    return jsonError(c, 400, `Incident is ${linked.status}; operational updates are closed`);
  }
  await c.env.DB.prepare('UPDATE assignments SET assignment_status = ? WHERE id = ?').bind(status, assignment.id).run();
  const responderStatus = status === 'Completed' ? 'Available' : status;
  await c.env.DB.prepare('UPDATE responders SET operational_status = ?, availability_status = ? WHERE id = ?')
    .bind(responderStatus, responderStatus, assignment.responder_id)
    .run();
  try {
    await syncVehicleForAssignmentStatus(c.env.DB, assignment.id, status);
  } catch {
    /* optional */
  }
  const map: Record<string, string> = { 'En Route': 'En Route', 'On Scene': 'On Scene', Completed: 'Resolved' };
  if (map[status]) {
    try {
      await setStatus(c.env.DB, assignment.incident_id, map[status], c.get('user').userId, undefined, c.env);
    } catch {
      /* ignore invalid if already there */
    }
  }
  await logActivity(c.env.DB, assignment.incident_id, `Unit ${status}`, `Assignment status updated to ${status}`, c.get('user').userId);
  return c.json({ success: true, data: { assignmentStatus: status } });
});

app.patch('/api/responders/me/status', auth, requirePerm('responder:operations'), async (c) => {
  const { status } = await c.req.json<{ status?: string }>();
  await c.env.DB.prepare('UPDATE responders SET operational_status = ?, availability_status = ? WHERE user_id = ?')
    .bind(status, status, c.get('user').userId)
    .run();
  return c.json({ success: true });
});

app.post('/api/responders/me/location', auth, requirePerm('responder:operations'), async (c) => {
  const { latitude, longitude, accuracy } = await c.req.json<{ latitude: number; longitude: number; accuracy?: number }>();
  const lat = num(latitude);
  const lng = num(longitude);
  const acc = accuracy == null ? null : num(accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    return jsonError(c, 400, 'Valid GPS coordinates required');
  }
  // Drop city/IP geolocation (~km); allow typical phone GPS (indoors often 50–200 m)
  const MAX_ACCURACY_M = 250;
  if (acc != null && (acc <= 0 || acc > MAX_ACCURACY_M)) {
    return c.json({ success: true, data: { skipped: true, reason: 'accuracy', accuracy: acc } });
  }
  // IP fixes are often snapped to 0.01° (e.g. 14.490000, 121.040000) — never apply those
  const gridLat = Math.round(lat * 100) / 100;
  const gridLng = Math.round(lng * 100) / 100;
  const onCoarseGrid = Math.abs(lat - gridLat) < 1e-8 && Math.abs(lng - gridLng) < 1e-8;
  if (onCoarseGrid && (acc == null || acc > 50)) {
    return c.json({ success: true, data: { skipped: true, reason: 'coarse_grid', accuracy: acc } });
  }

  const existing = await c.env.DB.prepare(
    'SELECT id, callsign, lat, lng, gps_updated_at FROM responders WHERE user_id = ?'
  )
    .bind(c.get('user').userId)
    .first<{ id: string; callsign: string | null; lat: number | null; lng: number | null; gps_updated_at?: string }>();

  const nowSql = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";
  await c.env.DB.prepare(
    `UPDATE responders SET lat = ?, lng = ?, gps_updated_at = ${nowSql} WHERE user_id = ?`
  )
    .bind(lat, lng, c.get('user').userId)
    .run();
  if (existing) {
    // Throttle track inserts so ~1s live updates don't flood D1
    let writeTrack = true;
    if (existing.gps_updated_at) {
      const prev = Date.parse(
        /Z$/i.test(existing.gps_updated_at) || /[+-]\d{2}:?\d{2}$/.test(existing.gps_updated_at)
          ? existing.gps_updated_at
          : `${existing.gps_updated_at.replace(' ', 'T')}Z`
      );
      if (Number.isFinite(prev) && Date.now() - prev < 8_000) writeTrack = false;
    }
    if (writeTrack) {
      try {
        await c.env.DB.prepare('INSERT INTO gps_tracks (id, responder_id, lat, lng, accuracy) VALUES (?, ?, ?, ?, ?)')
          .bind(id(), existing.id, lat, lng, acc)
          .run();
      } catch {
        /* migrate optional */
      }
    }
    // Only update the vehicle on an active assignment — do not mirror onto callsign-matched
    // fleet units (keeps station trucks separate from responder person pins).
    try {
      await c.env.DB.prepare(
        `UPDATE vehicles SET lat = ?, lng = ?, gps_updated_at = ${nowSql}
         WHERE id IN (
           SELECT vehicle_id FROM assignments
           WHERE responder_id = ? AND vehicle_id IS NOT NULL
             AND assignment_status NOT IN ('Completed', 'Rejected', 'Declined', 'Cancelled')
         )`
      )
        .bind(lat, lng, existing.id)
        .run();
    } catch {
      /* ignore */
    }
  }
  return c.json({ success: true, data: { latitude: lat, longitude: lng, accuracy: acc } });
});

app.get('/api/responders/available', auth, requirePerm('incidents:assign'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.id as _id, r.callsign, r.availability_status as availabilityStatus, u.full_name as fullName
     FROM responders r JOIN users u ON u.id = r.user_id
     WHERE r.availability_status = 'Available'`
  ).all();
  return c.json({
    success: true,
    data: results.map((r) => ({
      _id: r._id,
      callsign: r.callsign,
      availabilityStatus: r.availabilityStatus,
      userId: { fullName: r.fullName },
    })),
  });
});

app.get('/api/responders', auth, requirePerm('incidents:read'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, u.full_name, u.contact_number, u.email, d.name as dept_name, d.code as dept_code
     FROM responders r JOIN users u ON u.id = r.user_id JOIN departments d ON d.id = r.department_id`
  ).all();
  return c.json({ success: true, data: results });
});

app.get('/api/map/fleet', auth, requirePerm('map:monitor'), async (c) => {
  const staleMs = Number(c.env.GPS_STALE_MINUTES || 30) * 60 * 1000;
  function parseGpsAt(value?: string | null): number {
    if (!value) return 0;
    const raw = String(value).trim();
    const iso = /Z$/i.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
  }
  const [units, responders] = await Promise.all([
    c.env.DB.prepare('SELECT id, lat, lng, gps_updated_at FROM vehicles').all<{
      id: string;
      lat: number | null;
      lng: number | null;
      gps_updated_at: string | null;
    }>(),
    c.env.DB.prepare('SELECT id, lat, lng, gps_updated_at FROM responders').all<{
      id: string;
      lat: number | null;
      lng: number | null;
      gps_updated_at: string | null;
    }>(),
  ]);
  return c.json({
    success: true,
    data: {
      units: (units.results ?? []).map((row) => {
        const lat = row.lat != null ? num(row.lat) : NaN;
        const lng = row.lng != null ? num(row.lng) : NaN;
        const updated = parseGpsAt(row.gps_updated_at);
        return {
          _id: row.id,
          gpsStale: !Number.isFinite(lat) || (updated > 0 ? Date.now() - updated > staleMs : true),
          currentLocation:
            Number.isFinite(lat) && Number.isFinite(lng)
              ? { latitude: lat, longitude: lng, updatedAt: row.gps_updated_at || undefined }
              : undefined,
        };
      }),
      responders: (responders.results ?? []).map((row) => {
        const lat = row.lat != null ? num(row.lat) : NaN;
        const lng = row.lng != null ? num(row.lng) : NaN;
        const updated = parseGpsAt(row.gps_updated_at);
        return {
          _id: row.id,
          gpsStale: !Number.isFinite(lat) || (updated > 0 ? Date.now() - updated > staleMs : true),
          currentLocation:
            Number.isFinite(lat) && Number.isFinite(lng)
              ? { latitude: lat, longitude: lng, updatedAt: row.gps_updated_at || undefined }
              : undefined,
        };
      }),
      serverTime: new Date().toISOString(),
    },
  });
});

app.get('/api/map/data', auth, requirePerm('map:monitor'), async (c) => {
  const incidents = await c.env.DB.prepare(`${INCIDENT_SELECT} WHERE i.status NOT IN ('Closed', 'False Alarm', 'Cancelled', 'Duplicate', 'Resolved')`).all();
  const units = await c.env.DB.prepare('SELECT * FROM vehicles').all();
  const responders = await c.env.DB.prepare(
    `SELECT r.*, u.full_name FROM responders r JOIN users u ON u.id = r.user_id`
  ).all();
  let facilities: Array<Record<string, unknown>> = [...STATIC_FACILITIES];
  try {
    const q = await c.env.DB.prepare(
      `SELECT id, name, category, lat, lng, address, contact_number as contactNumber,
              operating_hours as operatingHours, verification_source as verificationSource,
              last_verified_at as lastVerifiedAt, verification_status as verificationStatus
       FROM facilities`
    ).all();
    if (q.results.length) facilities = q.results as Array<Record<string, unknown>>;
  } catch {
    try {
      const q = await c.env.DB.prepare('SELECT id, name, category, lat, lng FROM facilities').all<{
        id: string;
        name: string;
        category: string;
        lat: number;
        lng: number;
      }>();
      if (q.results.length) facilities = q.results;
    } catch {
      /* use static */
    }
  }
  const staleMs = Number(c.env.GPS_STALE_MINUTES || 30) * 60 * 1000;

  function parseGpsAt(value?: string | null): number {
    if (!value) return 0;
    const raw = String(value).trim();
    const iso = /Z$/i.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
  }

  // Active assignment labels for callouts
  const assignmentByResponder = new Map<string, { incidentId: string; displayId: string; status: string }>();
  const assignmentByVehicle = new Map<string, { incidentId: string; displayId: string; status: string }>();
  try {
    const { results: asg } = await c.env.DB.prepare(
      `SELECT a.responder_id as responderId, a.vehicle_id as vehicleId, a.assignment_status as status,
              a.incident_id as incidentId, i.display_id as displayId
       FROM assignments a JOIN incidents i ON i.id = a.incident_id
       WHERE a.assignment_status NOT IN ('Completed', 'Rejected', 'Declined', 'Cancelled')
         AND i.status NOT IN ('Closed', 'False Alarm', 'Cancelled', 'Duplicate', 'Resolved')`
    ).all<{
      responderId: string | null;
      vehicleId: string | null;
      status: string;
      incidentId: string;
      displayId: string;
    }>();
    for (const row of asg ?? []) {
      const meta = { incidentId: row.incidentId, displayId: row.displayId, status: row.status };
      if (row.responderId) assignmentByResponder.set(row.responderId, meta);
      if (row.vehicleId) assignmentByVehicle.set(row.vehicleId, meta);
    }
  } catch {
    /* optional */
  }

  const vehicleById = new Map(
    (units.results as Array<{ id: string; lat?: number; lng?: number; unit_no?: string; gps_updated_at?: string }>).map(
      (v) => [v.id, v]
    )
  );
  const responderById = new Map(
    (responders.results as Array<{ id: string; lat?: number; lng?: number; callsign?: string; gps_updated_at?: string }>).map(
      (r) => [r.id, r]
    )
  );

  // Active assignment pathways: unit/responder GPS → incident scene
  let routes: Array<{
    id: string;
    label: string;
    status: string;
    from: { lat: number; lng: number };
    to: { lat: number; lng: number };
    incidentId: string;
    incidentDisplayId?: string;
  }> = [];
  try {
    const assignQ = await c.env.DB.prepare(
      `SELECT a.id, a.assignment_status as status, a.incident_id as incidentId, a.vehicle_id as vehicleId,
              a.responder_id as responderId, i.display_id as incidentDisplayId,
              l.latitude as incLat, l.longitude as incLng,
              v.lat as vehLat, v.lng as vehLng, v.unit_no as unitNo,
              r.lat as respLat, r.lng as respLng, r.callsign as callsign
       FROM assignments a
       JOIN incidents i ON i.id = a.incident_id
       JOIN locations l ON l.id = i.location_id
       LEFT JOIN vehicles v ON v.id = a.vehicle_id
       LEFT JOIN responders r ON r.id = a.responder_id
       WHERE a.assignment_status NOT IN ('Completed', 'Rejected', 'Declined', 'Cancelled')
         AND i.status NOT IN ('Closed', 'False Alarm', 'Cancelled', 'Duplicate', 'Resolved')`
    ).all();
    routes = (assignQ.results as Array<Record<string, unknown>>)
      .map((row) => {
        const veh = row.vehicleId ? vehicleById.get(String(row.vehicleId)) : undefined;
        const resp = row.responderId ? responderById.get(String(row.responderId)) : undefined;
        const vehLat = row.vehLat != null ? num(row.vehLat) : veh?.lat != null ? num(veh.lat) : NaN;
        const vehLng = row.vehLng != null ? num(row.vehLng) : veh?.lng != null ? num(veh.lng) : NaN;
        const respLat = row.respLat != null ? num(row.respLat) : resp?.lat != null ? num(resp.lat) : NaN;
        const respLng = row.respLng != null ? num(row.respLng) : resp?.lng != null ? num(resp.lng) : NaN;
        const vehUpdated = parseGpsAt((veh as { gps_updated_at?: string } | undefined)?.gps_updated_at);
        const respUpdated = parseGpsAt((resp as { gps_updated_at?: string } | undefined)?.gps_updated_at);
        const preferResp =
          Number.isFinite(respLat) &&
          Number.isFinite(respLng) &&
          (!Number.isFinite(vehLat) || respUpdated >= vehUpdated);
        const fromLat = preferResp ? respLat : Number.isFinite(vehLat) ? vehLat : respLat;
        const fromLng = preferResp ? respLng : Number.isFinite(vehLng) ? vehLng : respLng;
        const toLat = num(row.incLat);
        const toLng = num(row.incLng);
        if (!Number.isFinite(fromLat) || !Number.isFinite(fromLng) || !Number.isFinite(toLat) || !Number.isFinite(toLng)) {
          return null;
        }
        return {
          id: String(row.id),
          label: String(row.unitNo || veh?.unit_no || row.callsign || resp?.callsign || 'Unit'),
          status: String(row.status || 'Assigned'),
          from: { lat: fromLat, lng: fromLng },
          to: { lat: toLat, lng: toLng },
          incidentId: String(row.incidentId),
          incidentDisplayId: row.incidentDisplayId ? String(row.incidentDisplayId) : undefined,
        };
      })
      .filter((r): r is NonNullable<typeof r> => !!r);
  } catch {
    routes = [];
  }

  return c.json({
    success: true,
    data: {
      incidents: incidents.results.map((r) => mapIncident(r as Record<string, unknown>)),
      sosPending: [],
      units: units.results.map((v) => {
        const row = v as {
          id: string;
          unit_no: string;
          vehicle_type?: string;
          status: string;
          lat?: number;
          lng?: number;
          gps_updated_at?: string;
        };
        // Vehicle pin uses its own coords (station / last unit GPS) — not responder GPS
        const lat = row.lat != null ? num(row.lat) : NaN;
        const lng = row.lng != null ? num(row.lng) : NaN;
        const updatedAt = row.gps_updated_at || undefined;
        const updated = parseGpsAt(updatedAt);
        const asg = assignmentByVehicle.get(row.id);
        return {
          _id: row.id,
          kind: 'vehicle',
          unitNo: row.unit_no,
          callsign: row.unit_no,
          vehicleType: row.vehicle_type,
          status: row.status,
          operationalStatus: row.status,
          gpsStale: !Number.isFinite(lat) || (updated > 0 ? Date.now() - updated > staleMs : true),
          currentLocation: Number.isFinite(lat) && Number.isFinite(lng)
            ? {
                latitude: lat,
                longitude: lng,
                updatedAt,
              }
            : undefined,
          assignedIncidentId: asg?.incidentId,
          assignedIncidentDisplayId: asg?.displayId,
          assignmentStatus: asg?.status,
        };
      }),
      responders: responders.results.map((r) => {
        const row = r as {
          id: string;
          callsign: string;
          operational_status: string;
          availability_status?: string;
          lat?: number;
          lng?: number;
          gps_updated_at?: string;
          full_name?: string;
          department_id?: string;
        };
        const updated = parseGpsAt(row.gps_updated_at);
        // Keep last-known responder GPS; only borrow vehicle coords when responder has none
        let lat = row.lat != null ? num(row.lat) : NaN;
        let lng = row.lng != null ? num(row.lng) : NaN;
        let updatedAt = row.gps_updated_at;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          const matchVeh = (units.results as Array<{
            unit_no?: string;
            lat?: number;
            lng?: number;
            gps_updated_at?: string;
          }>).find(
            (v) =>
              (v.unit_no || '').toUpperCase().replace(/[\s_\-./]+/g, '') ===
              (row.callsign || '').toUpperCase().replace(/[\s_\-./]+/g, '')
          );
          if (matchVeh?.lat != null && matchVeh?.lng != null) {
            lat = num(matchVeh.lat);
            lng = num(matchVeh.lng);
            updatedAt = matchVeh.gps_updated_at;
          }
        }
        const asg = assignmentByResponder.get(row.id);
        return {
          _id: row.id,
          kind: 'responder',
          callsign: row.callsign || 'Responder',
          fullName: row.full_name,
          operationalStatus: row.operational_status,
          availabilityStatus: row.availability_status || row.operational_status,
          gpsStale: !Number.isFinite(lat) || (updated > 0 ? Date.now() - updated > staleMs : true),
          currentLocation: Number.isFinite(lat) && Number.isFinite(lng)
            ? {
                latitude: lat,
                longitude: lng,
                updatedAt: updatedAt || undefined,
              }
            : undefined,
          assignedIncidentId: asg?.incidentId,
          assignedIncidentDisplayId: asg?.displayId,
          assignmentStatus: asg?.status,
        };
      }),
      facilities: facilities.map((f) => {
        const row = f as {
          id: string;
          name: string;
          category: string;
          lat: number;
          lng: number;
          address?: string;
          contactNumber?: string;
          operatingHours?: string;
          verificationSource?: string;
          lastVerifiedAt?: string;
          verificationStatus?: string;
        };
        return {
          _id: row.id,
          name: row.name,
          category: row.category,
          address: row.address,
          contactNumber: row.contactNumber,
          operatingHours: row.operatingHours,
          verificationSource: row.verificationSource,
          lastVerifiedAt: row.lastVerifiedAt,
          verificationStatus: row.verificationStatus,
          currentLocation: { latitude: num(row.lat), longitude: num(row.lng) },
        };
      }),
      routes,
      center: SUN_VALLEY_CENTER,
      barangay: { name: 'Barangay Sun Valley', city: 'Parañaque City' },
    },
  });
});

app.get('/api/notifications', auth, async (c) => {
  const user = c.get('user');
  const canTrack = hasPerm(user, 'dispatch:manage');
  const { results } = await c.env.DB.prepare(
    canTrack
      ? `SELECT n.id as _id, n.title, n.message, n.type, n.priority,
            n.read_at as readAt, n.sent_at as sentAt, n.incident_id as incidentId,
            n.batch_id as batchId, n.sender_user_id as senderUserId, n.audience as audience,
            i.display_id as incidentDisplayId, i.status as incidentStatus, i.priority_level as incidentPriority,
            l.latitude as latitude, l.longitude as longitude, l.address_text as addressText,
            t.type_name as incidentTypeName,
            su.full_name as senderName
     FROM notifications n
     LEFT JOIN incidents i ON i.id = n.incident_id
     LEFT JOIN locations l ON l.id = i.location_id
     LEFT JOIN incident_types t ON t.id = i.incident_type_id
     LEFT JOIN users su ON su.id = n.sender_user_id
     WHERE n.recipient_user_id = ?
        OR (
          n.sender_user_id = ?
          AND n.id = (
            SELECT n2.id FROM notifications n2
            WHERE COALESCE(n2.batch_id, n2.id) = COALESCE(n.batch_id, n.id)
              AND n2.sender_user_id = ?
            ORDER BY CASE WHEN n2.recipient_user_id = ? THEN 0 ELSE 1 END, n2.sent_at ASC
            LIMIT 1
          )
        )
     ORDER BY n.sent_at DESC
     LIMIT 150`
      : `SELECT n.id as _id, n.title, n.message, n.type, n.priority,
            n.read_at as readAt, n.sent_at as sentAt, n.incident_id as incidentId,
            n.batch_id as batchId, n.sender_user_id as senderUserId, n.audience as audience,
            i.display_id as incidentDisplayId, i.status as incidentStatus, i.priority_level as incidentPriority,
            l.latitude as latitude, l.longitude as longitude, l.address_text as addressText,
            t.type_name as incidentTypeName,
            su.full_name as senderName
     FROM notifications n
     LEFT JOIN incidents i ON i.id = n.incident_id
     LEFT JOIN locations l ON l.id = i.location_id
     LEFT JOIN incident_types t ON t.id = i.incident_type_id
     LEFT JOIN users su ON su.id = n.sender_user_id
     WHERE n.recipient_user_id = ?
     ORDER BY n.sent_at DESC
     LIMIT 100`
  )
    .bind(...(canTrack ? [user.userId, user.userId, user.userId, user.userId] : [user.userId]))
    .all();
  return c.json({
    success: true,
    data: (results ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      const lat = r.latitude != null ? num(r.latitude) : NaN;
      const lng = r.longitude != null ? num(r.longitude) : NaN;
      return {
        _id: r._id,
        title: r.title,
        message: r.message,
        type: r.type,
        priority: r.priority,
        readAt: r.readAt || undefined,
        sentAt: r.sentAt,
        incidentId: r.incidentId || undefined,
        incidentDisplayId: r.incidentDisplayId || undefined,
        incidentStatus: r.incidentStatus || undefined,
        incidentPriority: r.incidentPriority || undefined,
        incidentTypeName: r.incidentTypeName || undefined,
        batchId: r.batchId || undefined,
        senderUserId: r.senderUserId || undefined,
        senderName: r.senderName || undefined,
        audience: r.audience || undefined,
        location:
          Number.isFinite(lat) && Number.isFinite(lng)
            ? { latitude: lat, longitude: lng, addressText: (r.addressText as string) || undefined }
            : undefined,
      };
    }),
  });
});

app.patch('/api/notifications/:id/read', auth, async (c) => {
  await c.env.DB.prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND recipient_user_id = ?")
    .bind(c.req.param('id'), c.get('user').userId)
    .run();
  return c.json({ success: true });
});

app.delete('/api/notifications/:id', auth, async (c) => {
  await c.env.DB.prepare('DELETE FROM notifications WHERE id = ? AND recipient_user_id = ?')
    .bind(c.req.param('id'), c.get('user').userId)
    .run();
  return c.json({ success: true });
});

app.post('/api/notifications/read-all', auth, async (c) => {
  await c.env.DB.prepare("UPDATE notifications SET read_at = datetime('now') WHERE recipient_user_id = ? AND read_at IS NULL")
    .bind(c.get('user').userId)
    .run();
  return c.json({ success: true });
});

/** Dispatch → assigned responders (Important). Pops on responder PWA. */
app.post('/api/notifications/dispatch-team', auth, requirePerm('dispatch:manage'), async (c) => {
  const body = await c.req.json<{ incidentId?: string; message?: string; title?: string }>();
  const incidentId = body.incidentId?.trim();
  const message = body.message?.trim();
  if (!incidentId) return jsonError(c, 400, 'incidentId required');
  if (!message) return jsonError(c, 400, 'Message required');
  const incident = await c.env.DB.prepare('SELECT id, display_id FROM incidents WHERE id = ?')
    .bind(incidentId)
    .first<{ id: string; display_id: string }>();
  if (!incident) return jsonError(c, 404, 'Incident not found');

  const { results: assignees } = await c.env.DB.prepare(
    `SELECT DISTINCT r.user_id as userId, r.callsign, u.full_name as fullName
     FROM assignments a
     JOIN responders r ON r.id = a.responder_id
     JOIN users u ON u.id = r.user_id
     WHERE a.incident_id = ?
       AND a.assignment_status NOT IN ('Completed', 'Rejected', 'Declined', 'Cancelled')`
  )
    .bind(incidentId)
    .all<{ userId: string; callsign: string | null; fullName: string }>();

  if (!assignees?.length) {
    return jsonError(c, 400, 'No assigned units on this incident. Assign a unit first.');
  }

  const title = sanitizeText(body.title?.trim() || `Dispatch — ${incident.display_id}`, 120);
  const text = sanitizeText(message, 2000);
  const userIds = assignees.map((a) => a.userId);
  const senderId = c.get('user').userId;
  if (!userIds.includes(senderId)) userIds.push(senderId);
  const batchId = id();
  const result = await notifyUsers(c.env, c.env.DB, userIds, {
    type: 'Dispatch Team Alert',
    priority: 'Important',
    title,
    message: text,
    incidentId,
    tone: 'alert',
    tag: `dispatch-${incidentId}`,
    batchId,
    senderUserId: senderId,
    audience: 'RESPONDERS',
  });

  await c.env.DB.prepare(
    "UPDATE notifications SET read_at = datetime('now') WHERE batch_id = ? AND recipient_user_id = ?"
  )
    .bind(batchId, senderId)
    .run();

  await audit(c.env.DB, senderId, c.get('user').role, 'NOTIFY_TEAM', 'Incident', incidentId);
  await logActivity(c.env.DB, incidentId, 'Team Notified', text, senderId);
  return c.json({
    success: true,
    data: {
      sent: result.notified,
      batchId: result.batchId,
      recipients: assignees.map((a) => a.callsign || a.fullName),
    },
  });
});

const BROADCAST_KINDS = {
  Immediate: {
    type: 'Immediate Alert',
    priority: 'Critical' as NotifPriority,
    tone: 'urgent' as NotifTone,
  },
  Alert: {
    type: 'Operational Alert',
    priority: 'Urgent' as NotifPriority,
    tone: 'alert' as NotifTone,
  },
  Announcement: {
    type: 'Announcement',
    priority: 'Important' as NotifPriority,
    tone: 'info' as NotifTone,
  },
  System: {
    type: 'System Notice',
    priority: 'Info' as NotifPriority,
    tone: 'info' as NotifTone,
  },
  Scheduled: {
    type: 'Scheduled Reminder',
    priority: 'Normal' as NotifPriority,
    tone: 'status' as NotifTone,
  },
} as const;

type BroadcastKind = keyof typeof BROADCAST_KINDS;

/** Dispatcher compose → broadcast to All / Responders / Citizens / Dispatchers. */
app.post('/api/notifications/broadcast', auth, requirePerm('dispatch:manage'), async (c) => {
  const body = await c.req.json<{
    title?: string;
    message?: string;
    audience?: string;
    kind?: string;
    priority?: string;
    incidentId?: string;
  }>();

  const title = sanitizeText(body.title?.trim(), 120);
  const message = sanitizeText(body.message?.trim(), 2000);
  if (!title || !message) return jsonError(c, 400, 'Title and message required');

  const audienceRaw = (body.audience || 'ALL').toUpperCase();
  const audience = (
    ['ALL', 'RESPONDERS', 'CITIZENS', 'DISPATCHERS'].includes(audienceRaw) ? audienceRaw : null
  ) as BroadcastAudience | null;
  if (!audience) return jsonError(c, 400, 'Invalid audience');

  const kindRaw = (body.kind || 'Alert') as string;
  const kind = (kindRaw in BROADCAST_KINDS ? kindRaw : null) as BroadcastKind | null;
  if (!kind) return jsonError(c, 400, 'Invalid notification kind');

  const defaults = BROADCAST_KINDS[kind];
  const priorityAllow = ['Critical', 'Urgent', 'Important', 'Normal', 'Info'] as const;
  const priority = (
    body.priority && priorityAllow.includes(body.priority as (typeof priorityAllow)[number])
      ? body.priority
      : defaults.priority
  ) as NotifPriority;

  let incidentId: string | null = body.incidentId?.trim() || null;
  if (incidentId) {
    const incident = await c.env.DB.prepare('SELECT id FROM incidents WHERE id = ?')
      .bind(incidentId)
      .first<{ id: string }>();
    if (!incident) return jsonError(c, 404, 'Incident not found');
  }

  const userIds = await listAudienceUserIds(c.env.DB, audience);
  const senderId = c.get('user').userId;
  // Ensure sender always has a copy so it appears under All Notifications
  if (!userIds.includes(senderId)) userIds.push(senderId);
  if (!userIds.length) return jsonError(c, 400, 'No active recipients for that audience');

  const batchId = id();
  const result = await notifyUsers(c.env, c.env.DB, userIds, {
    type: defaults.type,
    priority,
    title,
    message,
    incidentId,
    tone: defaults.tone,
    tag: `broadcast-${kind.toLowerCase()}-${audience.toLowerCase()}`,
    batchId,
    senderUserId: senderId,
    audience,
  });

  // Sender copy is for tracking/outbox — don't leave it unread in their inbox
  await c.env.DB.prepare(
    "UPDATE notifications SET read_at = datetime('now') WHERE batch_id = ? AND recipient_user_id = ?"
  )
    .bind(batchId, senderId)
    .run();

  if (kind === 'Announcement') {
    try {
      await c.env.DB.prepare(
        `INSERT INTO announcements (id, title, body, priority, audience, published_by) VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(id(), title, message, priority, audience, senderId)
        .run();
    } catch {
      /* announcements table optional */
    }
  }

  await audit(
    c.env.DB,
    senderId,
    c.get('user').role,
    'NOTIFY_BROADCAST',
    'Notification',
    `${kind}:${audience}`
  );

  return c.json({
    success: true,
    data: {
      sent: result.notified,
      pushed: result.pushed,
      batchId: result.batchId,
      audience,
      kind,
      type: defaults.type,
      priority,
    },
  });
});

/** Acknowledgement + reply tracking for a notification (batch-aware). */
app.get('/api/notifications/:id/tracking', auth, async (c) => {
  const user = c.get('user');
  const notif = await c.env.DB.prepare(
    `SELECT id, recipient_user_id as recipientUserId, sender_user_id as senderUserId,
            batch_id as batchId, title, message, type, priority, sent_at as sentAt, audience
     FROM notifications WHERE id = ?`
  )
    .bind(c.req.param('id'))
    .first<{
      id: string;
      recipientUserId: string;
      senderUserId: string | null;
      batchId: string | null;
      title: string;
      message: string;
      type: string;
      priority: string;
      sentAt: string;
      audience: string | null;
    }>();
  if (!notif) return jsonError(c, 404, 'Notification not found');

  const batchKey = notif.batchId || notif.id;
  const canManage = hasPerm(user, 'dispatch:manage');
  const isParty =
    notif.recipientUserId === user.userId ||
    notif.senderUserId === user.userId ||
    (
      await c.env.DB.prepare(
        `SELECT 1 as ok FROM notifications
         WHERE COALESCE(batch_id, id) = ? AND (recipient_user_id = ? OR sender_user_id = ?)
         LIMIT 1`
      )
        .bind(batchKey, user.userId, user.userId)
        .first<{ ok: number }>()
    )?.ok === 1;

  if (!canManage && !isParty) return jsonError(c, 403, 'Forbidden');

  const { results: recipients } = await c.env.DB.prepare(
    `SELECT n.id as notificationId, n.recipient_user_id as userId, n.read_at as readAt,
            u.full_name as fullName, r.name as role
     FROM notifications n
     JOIN users u ON u.id = n.recipient_user_id
     JOIN roles r ON r.id = u.role_id
     WHERE COALESCE(n.batch_id, n.id) = ?
     ORDER BY u.full_name COLLATE NOCASE ASC`
  )
    .bind(batchKey)
    .all<{
      notificationId: string;
      userId: string;
      readAt: string | null;
      fullName: string;
      role: string;
    }>();

  const people = recipients ?? [];
  const acknowledged = people
    .filter((p) => !!p.readAt)
    .map((p) => ({
      userId: p.userId,
      fullName: p.fullName,
      role: p.role,
      readAt: p.readAt as string,
      notificationId: p.notificationId,
    }));
  const pending = people
    .filter((p) => !p.readAt)
    .map((p) => ({
      userId: p.userId,
      fullName: p.fullName,
      role: p.role,
      notificationId: p.notificationId,
    }));

  let replies: {
    id: string;
    fromUserId: string;
    fullName: string;
    role: string;
    message: string;
    createdAt: string;
    notificationId?: string | null;
  }[] = [];
  try {
    const { results: replyRows } = await c.env.DB.prepare(
      `SELECT nr.id, nr.from_user_id as fromUserId, nr.message, nr.created_at as createdAt,
              nr.notification_id as notificationId, u.full_name as fullName, r.name as role
       FROM notification_replies nr
       JOIN users u ON u.id = nr.from_user_id
       JOIN roles r ON r.id = u.role_id
       WHERE nr.batch_id = ?
       ORDER BY nr.created_at ASC
       LIMIT 200`
    )
      .bind(batchKey)
      .all<{
        id: string;
        fromUserId: string;
        message: string;
        createdAt: string;
        notificationId: string | null;
        fullName: string;
        role: string;
      }>();
    replies = (replyRows ?? []).map((row) => ({
      id: row.id,
      fromUserId: row.fromUserId,
      fullName: row.fullName,
      role: row.role,
      message: row.message,
      createdAt: row.createdAt,
      notificationId: row.notificationId,
    }));
  } catch {
    replies = [];
  }

  const total = people.length;
  const ackCount = acknowledged.length;
  const pendingCount = pending.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);

  let pushSubscribed = 0;
  try {
    if (people.length) {
      const placeholders = people.map(() => '?').join(',');
      const { results: subRows } = await c.env.DB.prepare(
        `SELECT DISTINCT user_id as userId FROM push_subscriptions WHERE user_id IN (${placeholders})`
      )
        .bind(...people.map((p) => p.userId))
        .all<{ userId: string }>();
      pushSubscribed = (subRows ?? []).length;
    }
  } catch {
    pushSubscribed = 0;
  }
  const pushNotSubscribed = Math.max(0, total - pushSubscribed);

  return c.json({
    success: true,
    data: {
      batchId: batchKey,
      title: notif.title,
      type: notif.type,
      priority: notif.priority,
      audience: notif.audience || undefined,
      sentAt: notif.sentAt,
      total,
      // Legacy field kept for older clients — means in-app rows created, NOT push delivered
      delivered: total,
      inAppCreated: total,
      pushSubscribed,
      pushNotSubscribed,
      acknowledgedCount: ackCount,
      pendingCount,
      failedCount: 0,
      deliveredPct: pct(total),
      acknowledgedPct: pct(ackCount),
      pendingPct: pct(pendingCount),
      failedPct: 0,
      channelNotes:
        'In-app = notification rows created. Push subscribed = recipients with a registered endpoint (not proof of device delivery; permission may be denied). SMS is not configured. Acknowledged = marked read in-app.',
      acknowledged,
      pending,
      replies,
    },
  });
});

/** Any recipient can reply; replies are stored on the batch for dispatcher tracking. */
app.post('/api/notifications/:id/reply', auth, async (c) => {
  const body = await c.req.json<{ message?: string }>();
  const reply = body.message?.trim();
  if (!reply) return jsonError(c, 400, 'Reply required');
  const notif = await c.env.DB.prepare(
    `SELECT id, recipient_user_id, incident_id, title, message, batch_id, sender_user_id
     FROM notifications WHERE id = ?`
  )
    .bind(c.req.param('id'))
    .first<{
      id: string;
      recipient_user_id: string;
      incident_id: string | null;
      title: string;
      message: string;
      batch_id: string | null;
      sender_user_id: string | null;
    }>();
  if (!notif) return jsonError(c, 404, 'Notification not found');
  if (notif.recipient_user_id !== c.get('user').userId) return jsonError(c, 403, 'Not your notification');

  const sender = await c.env.DB.prepare('SELECT full_name FROM users WHERE id = ?')
    .bind(c.get('user').userId)
    .first<{ full_name: string }>();
  const senderName = sender?.full_name ?? 'User';
  const text = sanitizeText(reply, 2000);
  const title = `Reply: ${sanitizeText(notif.title, 80)}`;
  const batchId = notif.batch_id || notif.id;

  try {
    await c.env.DB.prepare(
      `INSERT INTO notification_replies (id, batch_id, notification_id, from_user_id, message)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(id(), batchId, notif.id, c.get('user').userId, text)
      .run();
  } catch (err) {
    console.error('notification reply insert failed', err);
    return jsonError(c, 500, 'Could not save reply — run db migration v9');
  }

  await notifyDispatchers(c.env, c.env.DB, {
    type: 'Notification Reply',
    priority: 'Important',
    title,
    message: `${senderName}: ${text}`,
    incidentId: notif.incident_id,
    tone: 'alert',
    tag: `reply-${notif.id}`,
    batchId: id(),
    senderUserId: c.get('user').userId,
    audience: 'DISPATCHERS',
  });

  try {
    await c.env.DB.prepare('INSERT INTO chat_messages (id, incident_id, sender_user_id, message) VALUES (?, ?, ?, ?)')
      .bind(id(), 'channel:responders', c.get('user').userId, `[Reply to alert] ${text}`)
      .run();
  } catch {
    /* optional */
  }

  await c.env.DB.prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ?").bind(notif.id).run();
  return c.json({ success: true, data: { batchId } });
});

app.get('/api/push/vapid-public-key', auth, async (c) => {
  return c.json({ success: true, publicKey: c.env.VAPID_PUBLIC_KEY ?? null });
});

app.post('/api/push/subscribe', auth, async (c) => {
  const body = await c.req.json<{
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  }>();
  const endpoint = body.endpoint?.trim();
  const p256dh = body.keys?.p256dh?.trim();
  const authKey = body.keys?.auth?.trim();
  if (!endpoint || !p256dh || !authKey) return jsonError(c, 400, 'Invalid push subscription');

  const existing = await c.env.DB.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?')
    .bind(endpoint)
    .first<{ id: string }>();
  if (existing) {
    await c.env.DB.prepare(
      'UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, user_agent = ? WHERE id = ?'
    )
      .bind(c.get('user').userId, p256dh, authKey, c.req.header('user-agent')?.slice(0, 240) ?? null, existing.id)
      .run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(id(), c.get('user').userId, endpoint, p256dh, authKey, c.req.header('user-agent')?.slice(0, 240) ?? null)
      .run();
  }
  return c.json({ success: true }, 201);
});

app.post('/api/push/unsubscribe', auth, async (c) => {
  const body = await c.req.json<{ endpoint?: string }>();
  if (!body.endpoint) return jsonError(c, 400, 'endpoint required');
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
    .bind(body.endpoint, c.get('user').userId)
    .run();
  return c.json({ success: true });
});

app.get('/api/personnel', auth, requirePerm('personnel:manage'), async (c) => {
  let roster: Record<string, unknown>[] = [];
  try {
    const q = await c.env.DB.prepare(
      `SELECT u.id, u.full_name as fullName, u.email, u.contact_number as contactNumber,
              u.status as accountStatus, u.created_at as createdAt, rl.name as roleName,
              r.id as responderId, r.callsign, r.availability_status as availabilityStatus,
              r.operational_status as operationalStatus, r.lat, r.lng, r.gps_updated_at as gpsUpdatedAt,
              r.team_name as teamName,
              d.name as departmentName, d.code as departmentCode
       FROM users u
       JOIN roles rl ON rl.id = u.role_id
       LEFT JOIN responders r ON r.user_id = u.id
       LEFT JOIN departments d ON d.id = r.department_id
       WHERE rl.name IN ('EMERGENCY_RESPONDER', 'CENTRAL_DISPATCHER', 'DEPARTMENT_DISPATCHER', 'SYSTEM_ADMINISTRATOR')
       ORDER BY u.full_name COLLATE NOCASE ASC`
    ).all();
    roster = (q.results ?? []) as Record<string, unknown>[];
  } catch {
    const users = await c.env.DB.prepare(
      `SELECT u.id, u.full_name as fullName, u.email, u.contact_number as contactNumber,
              u.status as accountStatus, u.created_at as createdAt, r.name as roleName
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.name != 'CITIZEN'
       ORDER BY u.full_name COLLATE NOCASE ASC`
    ).all();
    const responders = await c.env.DB.prepare(
      `SELECT r.id as responderId, r.user_id as userId, r.callsign, r.availability_status as availabilityStatus,
              r.operational_status as operationalStatus, r.lat, r.lng, r.gps_updated_at as gpsUpdatedAt,
              d.name as departmentName, d.code as departmentCode
       FROM responders r
       LEFT JOIN departments d ON d.id = r.department_id`
    ).all();
    const byUser = new Map(
      ((responders.results ?? []) as Record<string, unknown>[]).map((row) => [String(row.userId), row])
    );
    roster = ((users.results ?? []) as Record<string, unknown>[]).map((u) => ({
      ...u,
      ...(byUser.get(String(u.id)) || {}),
    }));
  }

  let assignments: Record<string, unknown>[] = [];
  try {
    const a = await c.env.DB.prepare(
      `SELECT a.responder_id as responderId, a.assignment_status as assignmentStatus,
              a.assigned_at as assignedAt, i.id as incidentId, i.display_id as incidentDisplayId,
              t.type_name as incidentType, l.address_text as addressText,
              v.unit_no as unitNo, assigner.full_name as assignedBy
       FROM assignments a
       JOIN incidents i ON i.id = a.incident_id
       LEFT JOIN incident_types t ON t.id = i.incident_type_id
       LEFT JOIN locations l ON l.id = i.location_id
       LEFT JOIN vehicles v ON v.id = a.vehicle_id
       LEFT JOIN users assigner ON assigner.id = a.assigned_by_dispatcher_id
       WHERE a.assignment_status NOT IN ('Completed', 'Rejected', 'Declined', 'Cancelled')
         AND i.status NOT IN ('Cancelled', 'Closed', 'False Alarm', 'Duplicate', 'Resolved')`
    ).all();
    assignments = (a.results ?? []) as Record<string, unknown>[];
  } catch {
    assignments = [];
  }

  const assignByResponder = new Map<string, Record<string, unknown>>();
  for (const row of assignments) {
    const rid = String(row.responderId || '');
    if (rid && !assignByResponder.has(rid)) assignByResponder.set(rid, row);
  }

  const people = roster.map((row) => {
    const responderId = row.responderId ? String(row.responderId) : undefined;
    const assignment = responderId ? assignByResponder.get(responderId) : undefined;
    const rawAvail = row.availabilityStatus != null && String(row.availabilityStatus).trim()
      ? String(row.availabilityStatus)
      : row.operationalStatus != null && String(row.operationalStatus).trim()
        ? String(row.operationalStatus)
        : responderId
          ? 'Available'
          : String(row.accountStatus || '') === 'active'
            ? 'On Duty'
            : 'Off Duty';
    return {
      id: String(row.id),
      fullName: String(row.fullName || ''),
      email: String(row.email || ''),
      contactNumber: row.contactNumber ? String(row.contactNumber) : undefined,
      accountStatus: String(row.accountStatus || 'active'),
      createdAt: row.createdAt ? String(row.createdAt) : undefined,
      roleName: String(row.roleName || ''),
      roleId: { name: String(row.roleName || '') },
      status: String(row.accountStatus || 'active'),
      responderId,
      callsign: row.callsign ? String(row.callsign) : undefined,
      availabilityStatus: rawAvail,
      operationalStatus: row.operationalStatus ? String(row.operationalStatus) : undefined,
      teamName: row.teamName ? String(row.teamName) : undefined,
      departmentName: row.departmentName ? String(row.departmentName) : undefined,
      departmentCode: row.departmentCode ? String(row.departmentCode) : undefined,
      lat: row.lat != null ? Number(row.lat) : undefined,
      lng: row.lng != null ? Number(row.lng) : undefined,
      gpsUpdatedAt: row.gpsUpdatedAt ? String(row.gpsUpdatedAt) : undefined,
      assignment: assignment
        ? {
            assignmentStatus: String(assignment.assignmentStatus || ''),
            assignedAt: assignment.assignedAt ? String(assignment.assignedAt) : undefined,
            incidentId: assignment.incidentId ? String(assignment.incidentId) : undefined,
            incidentDisplayId: assignment.incidentDisplayId ? String(assignment.incidentDisplayId) : undefined,
            incidentType: assignment.incidentType ? String(assignment.incidentType) : undefined,
            addressText: assignment.addressText ? String(assignment.addressText) : undefined,
            unitNo: assignment.unitNo ? String(assignment.unitNo) : undefined,
            assignedBy: assignment.assignedBy ? String(assignment.assignedBy) : undefined,
          }
        : undefined,
    };
  });

  return c.json({
    success: true,
    data: {
      users: people,
      responders: people.filter((p) => p.responderId),
    },
  });
});

app.get('/api/attendance', auth, requirePerm('attendance:manage'), async (c) => {
  const date = c.req.query('date');
  try {
    let sql = `SELECT a.id as _id, a.responder_id as responderId, a.date,
                      a.check_in_time as checkInTime, a.check_out_time as checkOutTime,
                      a.status, a.remarks, a.leave_type as leaveType,
                      r.callsign, r.team_name as teamName, u.id as userId, u.full_name as fullName,
                      d.name as departmentName, d.code as departmentCode
               FROM attendance a
               JOIN responders r ON r.id = a.responder_id
               JOIN users u ON u.id = r.user_id
               LEFT JOIN departments d ON d.id = r.department_id`;
    if (date) sql += ' WHERE a.date = ?';
    sql += ' ORDER BY COALESCE(a.check_in_time, a.date) DESC LIMIT 200';
    const q = date ? c.env.DB.prepare(sql).bind(date) : c.env.DB.prepare(sql);
    const { results } = await q.all();
    return c.json({ success: true, data: results });
  } catch {
    let sql = `SELECT a.id as _id, a.responder_id as responderId, a.date,
                      a.check_in_time as checkInTime, a.check_out_time as checkOutTime, a.status,
                      r.callsign, r.team_name as teamName, u.id as userId, u.full_name as fullName,
                      d.name as departmentName, d.code as departmentCode
               FROM attendance a
               JOIN responders r ON r.id = a.responder_id
               JOIN users u ON u.id = r.user_id
               LEFT JOIN departments d ON d.id = r.department_id`;
    if (date) sql += ' WHERE a.date = ?';
    sql += ' ORDER BY a.date DESC LIMIT 200';
    const q = date ? c.env.DB.prepare(sql).bind(date) : c.env.DB.prepare(sql);
    const { results } = await q.all();
    return c.json({ success: true, data: results, meta: { note: 'Run db:migrate:v10 for remarks/leave' } });
  }
});

app.post('/api/attendance', auth, requirePerm('attendance:manage'), async (c) => {
  const body = await c.req.json<{
    responderId?: string;
    date?: string;
    checkInTime?: string;
    checkOutTime?: string;
    status?: string;
    remarks?: string;
    leaveType?: string;
  }>();
  if (!body.responderId || !body.date) return jsonError(c, 400, 'responderId and date required');
  const aid = id();
  const status = body.status || 'Present';
  try {
    await c.env.DB.prepare(
      `INSERT INTO attendance (id, responder_id, date, check_in_time, check_out_time, status, remarks, leave_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(responder_id, date) DO UPDATE SET
         check_in_time = excluded.check_in_time,
         check_out_time = excluded.check_out_time,
         status = excluded.status,
         remarks = excluded.remarks,
         leave_type = excluded.leave_type`
    )
      .bind(
        aid,
        body.responderId,
        body.date,
        body.checkInTime || null,
        body.checkOutTime || null,
        status,
        body.remarks || null,
        body.leaveType || null
      )
      .run();
  } catch {
    await c.env.DB.prepare(
      `INSERT INTO attendance (id, responder_id, date, check_in_time, check_out_time, status)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(responder_id, date) DO UPDATE SET
         check_in_time = excluded.check_in_time,
         check_out_time = excluded.check_out_time,
         status = excluded.status`
    )
      .bind(aid, body.responderId, body.date, body.checkInTime || null, body.checkOutTime || null, status)
      .run();
  }
  await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'ATTENDANCE_RECORDED', 'Attendance', aid);
  return c.json({ success: true, data: { id: aid } }, 201);
});

app.patch('/api/attendance/:id', auth, requirePerm('attendance:manage'), async (c) => {
  const body = await c.req.json<{
    checkInTime?: string;
    checkOutTime?: string;
    status?: string;
    remarks?: string;
    leaveType?: string;
  }>();
  const aid = c.req.param('id');
  try {
    await c.env.DB.prepare(
      `UPDATE attendance SET
         check_in_time = COALESCE(?, check_in_time),
         check_out_time = COALESCE(?, check_out_time),
         status = COALESCE(?, status),
         remarks = COALESCE(?, remarks),
         leave_type = COALESCE(?, leave_type)
       WHERE id = ?`
    )
      .bind(
        body.checkInTime ?? null,
        body.checkOutTime ?? null,
        body.status ?? null,
        body.remarks ?? null,
        body.leaveType ?? null,
        aid
      )
      .run();
  } catch {
    await c.env.DB.prepare(
      `UPDATE attendance SET
         check_in_time = COALESCE(?, check_in_time),
         check_out_time = COALESCE(?, check_out_time),
         status = COALESCE(?, status)
       WHERE id = ?`
    )
      .bind(body.checkInTime ?? null, body.checkOutTime ?? null, body.status ?? null, aid)
      .run();
  }
  await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'ATTENDANCE_UPDATED', 'Attendance', aid);
  return c.json({ success: true });
});

app.get('/api/leave-requests', auth, requirePerm('attendance:manage'), async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT lr.id, lr.responder_id as responderId, lr.leave_type as leaveType,
              lr.start_date as startDate, lr.end_date as endDate, lr.status, lr.reason,
              lr.created_at as createdAt, r.callsign, u.full_name as fullName,
              d.name as departmentName
       FROM leave_requests lr
       JOIN responders r ON r.id = lr.responder_id
       JOIN users u ON u.id = r.user_id
       LEFT JOIN departments d ON d.id = r.department_id
       ORDER BY lr.created_at DESC LIMIT 100`
    ).all();
    return c.json({ success: true, data: results });
  } catch {
    return c.json({ success: true, data: [], meta: { note: 'Run db:migrate:v10' } });
  }
});

app.post('/api/leave-requests', auth, requirePerm('attendance:manage'), async (c) => {
  const body = await c.req.json<{
    responderId?: string;
    leaveType?: string;
    startDate?: string;
    endDate?: string;
    reason?: string;
    status?: string;
  }>();
  if (!body.responderId || !body.leaveType || !body.startDate || !body.endDate) {
    return jsonError(c, 400, 'responderId, leaveType, startDate, endDate required');
  }
  const lid = id();
  try {
    await c.env.DB.prepare(
      `INSERT INTO leave_requests (id, responder_id, leave_type, start_date, end_date, status, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        lid,
        body.responderId,
        sanitizeText(body.leaveType, 40),
        body.startDate,
        body.endDate,
        body.status || 'Approved',
        body.reason ? sanitizeText(body.reason, 200) : null
      )
      .run();
  } catch {
    return jsonError(c, 500, 'Leave requests unavailable — run db:migrate:v10');
  }
  await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'LEAVE_REQUESTED', 'Leave', lid);
  return c.json({ success: true, data: { id: lid } }, 201);
});

app.patch('/api/leave-requests/:id', auth, requirePerm('attendance:manage'), async (c) => {
  const body = await c.req.json<{ status?: string }>();
  try {
    await c.env.DB.prepare('UPDATE leave_requests SET status = COALESCE(?, status) WHERE id = ?')
      .bind(body.status ?? null, c.req.param('id'))
      .run();
  } catch {
    return jsonError(c, 500, 'Leave requests unavailable — run db:migrate:v10');
  }
  return c.json({ success: true });
});

app.post('/api/attendance/check-in', auth, requirePerm('responder:operations'), async (c) => {
  const responder = await c.env.DB.prepare('SELECT id FROM responders WHERE user_id = ?')
    .bind(c.get('user').userId)
    .first<{ id: string }>();
  if (!responder) return jsonError(c, 403, 'Responder profile required');
  const today = manilaYmd();
  const existing = await c.env.DB.prepare('SELECT id FROM attendance WHERE responder_id = ? AND date = ?')
    .bind(responder.id, today)
    .first();
  if (existing) return jsonError(c, 400, 'Already checked in today');
  await c.env.DB.prepare(
    'INSERT INTO attendance (id, responder_id, date, check_in_time, status) VALUES (?, ?, ?, datetime(\'now\'), ?)'
  )
    .bind(id(), responder.id, today, 'On Duty')
    .run();
  return c.json({ success: true });
});

app.post('/api/attendance/check-out', auth, requirePerm('responder:operations'), async (c) => {
  const responder = await c.env.DB.prepare('SELECT id FROM responders WHERE user_id = ?')
    .bind(c.get('user').userId)
    .first<{ id: string }>();
  if (!responder) return jsonError(c, 403, 'Responder profile required');
  const today = manilaYmd();
  await c.env.DB.prepare(
    "UPDATE attendance SET check_out_time = datetime('now'), status = 'Off Duty' WHERE responder_id = ? AND date = ?"
  )
    .bind(responder.id, today)
    .run();
  return c.json({ success: true });
});

app.get('/api/shifts', auth, requirePerm('shifts:manage'), async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, team_name as teamName, start_time as startTime, end_time as endTime, shift_status as shiftStatus, scheduled_date as scheduledDate FROM shifts ORDER BY scheduled_date DESC, start_time ASC'
  ).all();

  // Derive live status from Manila clock so dashboard + shifts page stay in sync
  const manilaParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const nowMins =
    Number(manilaParts.find((p) => p.type === 'hour')?.value ?? 0) * 60 +
    Number(manilaParts.find((p) => p.type === 'minute')?.value ?? 0);
  const todayYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  function parseMins(value: string): number | null {
    const digits = String(value).replace(/[^0-9]/g, '');
    if (digits.length >= 3 && digits.length <= 4) {
      const padded = digits.padStart(4, '0');
      const h = Number(padded.slice(0, 2));
      const m = Number(padded.slice(2, 4));
      if (h <= 23 && m <= 59) return h * 60 + m;
    }
    return null;
  }

  function inWindow(startTime: string, endTime: string): boolean {
    const start = parseMins(startTime);
    const end = parseMins(endTime);
    if (start == null || end == null) return false;
    if (start <= end) return nowMins >= start && nowMins < end;
    return nowMins >= start || nowMins < end;
  }

  let roster: Array<{
    responderId: string;
    fullName: string;
    callsign?: string;
    teamName?: string;
    departmentName?: string;
    departmentCode?: string;
    availabilityStatus?: string;
    lat?: number;
    lng?: number;
  }> = [];
  try {
    const q = await c.env.DB.prepare(
      `SELECT r.id as responderId, u.full_name as fullName, r.callsign, r.team_name as teamName,
              r.availability_status as availabilityStatus, r.lat, r.lng,
              d.name as departmentName, d.code as departmentCode
       FROM responders r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN departments d ON d.id = r.department_id
       WHERE u.status = 'active'`
    ).all();
    roster = (q.results ?? []) as typeof roster;
  } catch {
    roster = [];
  }

  const data = (
    results as Array<{
      id: string;
      teamName: string;
      startTime: string;
      endTime: string;
      shiftStatus: string;
      scheduledDate?: string;
    }>
  ).map((s) => {
    const isToday = !s.scheduledDate || String(s.scheduledDate).startsWith(todayYmd);
    const active = isToday && inWindow(s.startTime, s.endTime);
    const start = parseMins(s.startTime);
    const beginsSoon = isToday && start != null && start >= nowMins && start - nowMins <= 120;
    const past =
      s.scheduledDate && String(s.scheduledDate) < todayYmd
        ? true
        : isToday && start != null && !active && !beginsSoon && (() => {
            const end = parseMins(s.endTime);
            if (end == null) return false;
            if (start <= end) return nowMins >= end;
            return nowMins >= end && nowMins < start;
          })();

    let liveStatus = s.shiftStatus;
    if (active) liveStatus = 'Ongoing';
    else if (beginsSoon) liveStatus = 'Upcoming';
    else if (past || /complete|done/i.test(s.shiftStatus)) liveStatus = 'Completed';
    else if (/break/i.test(s.shiftStatus)) liveStatus = 'On Break';
    else if (/overtime|ot/i.test(s.shiftStatus)) liveStatus = 'Overtime';
    else if (s.shiftStatus === 'Ongoing') liveStatus = 'Scheduled';
    else liveStatus = s.shiftStatus || 'Scheduled';

    const teamKey = String(s.teamName || '').toLowerCase();
    const assigned = roster.filter((p) => String(p.teamName || '').toLowerCase() === teamKey);
    const departmentName = assigned[0]?.departmentName || (teamKey.includes('bravo') || teamKey.includes('medical') ? 'Medical / Ambulance' : 'Fire & Rescue');
    const lead = assigned[0]?.fullName;

    return {
      ...s,
      shiftStatus: liveStatus,
      storedStatus: s.shiftStatus,
      personnelCount: assigned.length,
      departmentName,
      shiftLead: lead,
      location: 'Sun Valley Operations Base',
      assignedPersonnel: assigned.map((p, i) => ({
        responderId: p.responderId,
        fullName: p.fullName,
        callsign: p.callsign,
        role: i === 0 ? 'Shift Lead' : p.callsign?.toLowerCase().includes('rescue') ? 'EMT' : 'Responder',
        status: active ? 'On Shift' : liveStatus === 'Upcoming' ? 'Standby' : p.availabilityStatus || 'Scheduled',
        lat: p.lat,
        lng: p.lng,
      })),
    };
  });

  return c.json({ success: true, data });
});

app.get('/api/resources/vehicles', auth, requirePerm('resources:manage'), async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, unit_no as unitNo, vehicle_type as vehicleType, status, lat, lng FROM vehicles'
  ).all();
  const unitsReady = num((await c.env.DB.prepare(`SELECT COUNT(*) as n FROM vehicles WHERE ${UNIT_READY_SQL}`).first<{ n: unknown }>())?.n);
  return c.json({ success: true, data: results, meta: { unitsReady } });
});

app.get('/api/resources/equipment', auth, requirePerm('resources:manage'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, category, serviceability, quantity, assigned_unit as assignedUnit,
            expiration_date as expirationDate, calibration_date as calibrationDate, missing
     FROM equipment`
  ).all();
  return c.json({ success: true, data: results });
});

app.get('/api/transports', auth, requirePerm('transport:manage'), async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  let sql = `SELECT t.id, t.display_id as displayId, t.patient_name as patientName, t.transport_status as transportStatus,
    t.scheduled_date as scheduledDate, t.scheduled_time as scheduledTime, t.origin_address as originAddress,
    t.destination_address as destinationAddress, t.origin_lat as originLat, t.origin_lng as originLng,
    t.destination_lat as destinationLat, t.destination_lng as destinationLng,
    t.patient_contact as contactNumber, t.requesting_person as requestingPerson,
    t.priority, t.return_trip as returnTrip, t.oxygen_required as oxygenRequired, t.assigned_vehicle_id as assignedVehicleId,
    t.assigned_crew as assignedCrew, t.recurring_rule as recurringRule, t.notes, t.cancel_reason as cancelReason,
    v.unit_no as unitNo, v.vehicle_type as vehicleType, v.status as vehicleStatus
    FROM transports t
    LEFT JOIN vehicles v ON v.id = t.assigned_vehicle_id`;
  const binds: string[] = [];
  if (from && to) {
    sql += ' WHERE t.scheduled_date BETWEEN ? AND ?';
    binds.push(from, to);
  }
  sql += ' ORDER BY t.scheduled_date ASC, t.scheduled_time ASC';
  const { results } = binds.length
    ? await c.env.DB.prepare(sql).bind(...binds).all()
    : await c.env.DB.prepare(sql).all();
  return c.json({ success: true, data: results });
});

app.post('/api/transports', auth, requirePerm('transport:manage'), async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  if (!body.patientName || !body.scheduledDate || !body.scheduledTime) {
    return jsonError(c, 400, 'Patient name, date, and time are required');
  }
  const conflicts = await c.env.DB.prepare(
    `SELECT display_id as displayId FROM transports
     WHERE scheduled_date = ? AND scheduled_time = ? AND transport_status NOT IN ('Cancelled', 'Completed')
     LIMIT 5`
  )
    .bind(String(body.scheduledDate), String(body.scheduledTime))
    .all();
  if (body.assignedVehicleId) {
    const vehicleBusy = await c.env.DB.prepare(
      `SELECT display_id FROM transports WHERE assigned_vehicle_id = ? AND scheduled_date = ? AND scheduled_time = ?
       AND transport_status NOT IN ('Cancelled', 'Completed') LIMIT 1`
    )
      .bind(String(body.assignedVehicleId), String(body.scheduledDate), String(body.scheduledTime))
      .first();
    if (vehicleBusy) return jsonError(c, 409, 'Assigned vehicle has a schedule conflict');
  }
  const displayId = await nextDisplayId(c.env.DB, 'TRN');
  const tid = id();
  const toCoord = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const originLat = toCoord(body.originLat);
  const originLng = toCoord(body.originLng);
  const destinationLat = toCoord(body.destLat ?? body.destinationLat);
  const destinationLng = toCoord(body.destLng ?? body.destinationLng);
  try {
    await c.env.DB.prepare(
      `INSERT INTO transports (
        id, display_id, patient_name, scheduled_date, scheduled_time, origin_address, destination_address,
        origin_lat, origin_lng, destination_lat, destination_lng,
        patient_contact, requesting_person, return_trip, priority, oxygen_required, assigned_vehicle_id,
        assigned_crew, recurring_rule, notes, transport_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Scheduled')`
    )
      .bind(
        tid,
        displayId,
        sanitizeText(String(body.patientName), 120),
        String(body.scheduledDate),
        String(body.scheduledTime),
        sanitizeText(String(body.originAddress ?? ''), 300) || null,
        sanitizeText(String(body.destinationAddress ?? ''), 300) || null,
        originLat,
        originLng,
        destinationLat,
        destinationLng,
        sanitizeText(String(body.contactNumber ?? ''), 40) || null,
        sanitizeText(String(body.requestingPerson ?? ''), 120) || null,
        body.tripType === 'Round trip' || body.returnTrip ? 1 : 0,
        sanitizeText(String(body.priority ?? 'Routine'), 40),
        body.oxygen ? 1 : 0,
        body.assignedVehicleId ? String(body.assignedVehicleId) : null,
        sanitizeText(String(body.assignedCrew ?? body.companion ?? ''), 200) || null,
        sanitizeText(String(body.recurringRule ?? ''), 120) || null,
        sanitizeText(String(body.specialInstructions ?? body.notes ?? ''), 1000) || null
      )
      .run();
  } catch {
    await c.env.DB.prepare(
      `INSERT INTO transports (id, display_id, patient_name, scheduled_date, scheduled_time, origin_address, destination_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        tid,
        displayId,
        String(body.patientName),
        String(body.scheduledDate),
        String(body.scheduledTime),
        body.originAddress ?? null,
        body.destinationAddress ?? null
      )
      .run();
  }
  await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'TRANSPORT_CREATED', 'Transport', tid);
  return c.json({
    success: true,
    data: {
      displayId,
      id: tid,
      conflicts: (conflicts.results ?? []).map((r) => (r as { displayId: string }).displayId),
    },
  }, 201);
});

app.get('/api/reports', auth, requirePerm('reports:read'), async (c) => {
  const status = c.req.query('status');
  const priority = c.req.query('priority');
  const from = c.req.query('from');
  const to = c.req.query('to');
  let sql = `${INCIDENT_SELECT} WHERE 1=1`;
  const binds: string[] = [];
  if (status) {
    sql += ' AND i.status = ?';
    binds.push(status);
  }
  if (priority) {
    sql += ' AND i.priority_level = ?';
    binds.push(priority);
  }
  if (from) {
    sql += ' AND date(i.reported_at) >= ?';
    binds.push(from);
  }
  if (to) {
    sql += ' AND date(i.reported_at) <= ?';
    binds.push(to);
  }
  sql += ' ORDER BY i.reported_at DESC LIMIT 200';
  const { results } = binds.length
    ? await c.env.DB.prepare(sql).bind(...binds).all()
    : await c.env.DB.prepare(sql).all();
  return c.json({ success: true, data: results.map((r) => mapIncident(r as Record<string, unknown>)) });
});

/** Documentation library: incident report entries + uploaded media attachments. */
app.get('/api/reports/library', auth, requirePerm('reports:read'), async (c) => {
  const { results: incidents } = await c.env.DB.prepare(
    `SELECT i.id, i.display_id as displayId, i.status, i.priority_level as priority,
            i.reported_at as reportedAt, t.type_name as typeName,
            u.full_name as reporterName, r.name as reporterRole
     FROM incidents i
     LEFT JOIN incident_types t ON t.id = i.incident_type_id
     LEFT JOIN users u ON u.id = i.reported_by_user_id
     LEFT JOIN roles r ON r.id = u.role_id
     ORDER BY i.reported_at DESC
     LIMIT 120`
  ).all();

  let mediaRows: Record<string, unknown>[] = [];
  let storageBytes = 0;
  try {
    const media = await c.env.DB.prepare(
      `SELECT m.id, m.file_name as fileName, m.content_type as contentType, m.size_bytes as sizeBytes,
              m.created_at as createdAt, m.incident_id as incidentId,
              u.full_name as uploadedBy, r.name as uploaderRole,
              i.display_id as incidentDisplayId, t.type_name as typeName
       FROM media_attachments m
       LEFT JOIN users u ON u.id = m.uploaded_by
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN incidents i ON i.id = m.incident_id
       LEFT JOIN incident_types t ON t.id = i.incident_type_id
       ORDER BY m.created_at DESC
       LIMIT 100`
    ).all();
    mediaRows = (media.results ?? []) as Record<string, unknown>[];
    storageBytes = mediaRows.reduce((sum, row) => sum + (Number(row.sizeBytes) || 0), 0);
  } catch {
    mediaRows = [];
  }

  const docs = [
    ...(incidents ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      const typeName = String(r.typeName || 'Incident');
      return {
        id: `inc-${r.id}`,
        kind: 'report' as const,
        name: `${r.displayId} — ${typeName} Report`,
        category: folderForType(typeName),
        fileType: 'PDF',
        uploadedBy: String(r.reporterName || 'System'),
        uploaderRole: String(r.reporterRole || 'DISPATCHER'),
        dateUploaded: String(r.reportedAt || ''),
        sizeBytes: 0,
        sizeNote: 'Generated on download',
        status: String(r.status || ''),
        incidentId: String(r.id),
        incidentDisplayId: String(r.displayId || ''),
        downloadable: true,
        reportType: reportTypeForFolder(folderForType(typeName)),
      };
    }),
    ...mediaRows.map((r) => {
      const ct = String(r.contentType || '');
      const name = String(r.fileName || 'Attachment');
      return {
        id: `media-${r.id}`,
        kind: 'media' as const,
        name,
        category: folderForType(String(r.typeName || 'Operational Checklists')),
        fileType: fileTypeFromContent(ct, name),
        uploadedBy: String(r.uploadedBy || 'Unknown'),
        uploaderRole: String(r.uploaderRole || 'USER'),
        dateUploaded: String(r.createdAt || ''),
        sizeBytes: Number(r.sizeBytes) || 0,
        status: 'Uploaded',
        incidentId: r.incidentId ? String(r.incidentId) : undefined,
        incidentDisplayId: r.incidentDisplayId ? String(r.incidentDisplayId) : undefined,
        mediaId: String(r.id),
        downloadable: true,
      };
    }),
  ].sort((a, b) => String(b.dateUploaded).localeCompare(String(a.dateUploaded)));

  const byCategory: Record<string, number> = {};
  const byFileType: Record<string, number> = {};
  for (const d of docs) {
    byCategory[d.category] = (byCategory[d.category] || 0) + 1;
    byFileType[d.fileType] = (byFileType[d.fileType] || 0) + 1;
  }

  const incidentReports = docs.filter((d) => d.kind === 'report').length;
  const uploadedMedia = docs.filter((d) => d.kind === 'media').length;

  return c.json({
    success: true,
    data: {
      documents: docs,
      stats: {
        libraryItems: docs.length,
        reportsGenerated: incidentReports,
        uploadedMedia,
        pendingApproval: 0,
        storageBytes,
        storageQuotaBytes: 20 * 1024 ** 3,
        // Downloads are not tracked yet — do not invent a count
        totalDownloads: null,
        byCategory,
        byFileType,
      },
    },
  });
});

function folderForType(typeName: string): string {
  const t = typeName.toLowerCase();
  if (/fire|damage|struct/.test(t)) return 'Damage Assessment';
  if (/medical|ems|patient|transport|conduction/.test(t)) return 'Situation Reports';
  if (/resource|equipment|vehicle|inventory/.test(t)) return 'Resource Inventory';
  if (/train|drill/.test(t)) return 'Training & Drills';
  if (/memo|bulletin|announce/.test(t)) return 'Memorandums';
  if (/dispatch|log/.test(t)) return 'Daily Dispatch Logs';
  if (/check/.test(t)) return 'Operational Checklists';
  return 'Incident Reports';
}

function reportTypeForFolder(folder: string): string {
  switch (folder) {
    case 'Daily Dispatch Logs':
      return 'dispatch';
    case 'Situation Reports':
      return 'daily-ops';
    case 'Resource Inventory':
      return 'checklist';
    case 'Damage Assessment':
      return 'fire';
    default:
      return 'incident';
  }
}

function fileTypeFromContent(contentType: string, fileName: string): string {
  const c = contentType.toLowerCase();
  const n = fileName.toLowerCase();
  if (c.includes('pdf') || n.endsWith('.pdf')) return 'PDF';
  if (c.includes('sheet') || c.includes('excel') || /\.(xlsx?|csv)$/.test(n)) return 'Excel';
  if (c.includes('word') || /\.(docx?)$/.test(n)) return 'Word';
  if (c.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/.test(n)) return 'Image';
  return 'Other';
}

app.get('/api/reports/export', auth, requirePerm('reports:export'), async (c) => {
  const format = c.req.query('format') ?? 'csv';
  const reportType = (c.req.query('reportType') ?? 'incident').toLowerCase();
  const from = c.req.query('from');
  const to = c.req.query('to');

  const REPORT_TITLES: Record<string, string> = {
    incident: 'Incident Report',
    dispatch: 'Dispatch Report',
    'patient-care': 'Patient Care Report',
    transport: 'Transport / Conduction Report',
    fire: 'Fire Incident Report',
    'daily-ops': 'Daily Operations Report',
    'unit-activity': 'Unit Activity Report',
    attendance: 'Personnel Attendance Report',
    personnel: 'Personnel Roster Report',
    shift: 'Shift Report',
    'response-time': 'Response-Time Report',
    checklist: 'Equipment / Vehicle Checklist',
    'incident-summary': 'Incident Summary',
    'monthly-ops': 'Monthly Operations Summary',
    audit: 'Audit Log Report',
  };
  const title = REPORT_TITLES[reportType] ?? 'Operations Report';

  let linesBody: string[] = [];
  let columns = ['Record'];
  let tableRows: string[][] = [];

  if (reportType === 'attendance') {
    const { results } = await c.env.DB.prepare(
      `SELECT a.date, a.status, a.check_in_time, a.check_out_time, r.callsign, u.full_name
       FROM attendance a JOIN responders r ON r.id = a.responder_id JOIN users u ON u.id = r.user_id
       ORDER BY a.date DESC LIMIT 80`
    ).all();
    if (!results.length) return jsonError(c, 404, 'No attendance records available to export');
    columns = ['Date', 'Name', 'Callsign', 'Status', 'Check-in', 'Check-out'];
    tableRows = results.map((r) => {
      const row = r as Record<string, string>;
      return [row.date, row.full_name, row.callsign ?? '-', row.status, row.check_in_time ?? '-', row.check_out_time ?? '-'];
    });
    linesBody = tableRows.map((r) => r.join(' | '));
  } else if (reportType === 'personnel') {
    const { results } = await c.env.DB.prepare(
      `SELECT u.full_name, u.email, u.contact_number, u.status, rl.name as role_name,
              r.callsign, r.team_name, r.availability_status, d.name as department_name
       FROM users u
       JOIN roles rl ON rl.id = u.role_id
       LEFT JOIN responders r ON r.user_id = u.id
       LEFT JOIN departments d ON d.id = r.department_id
       WHERE rl.name IN ('EMERGENCY_RESPONDER', 'CENTRAL_DISPATCHER', 'DEPARTMENT_DISPATCHER', 'SYSTEM_ADMINISTRATOR')
       ORDER BY u.full_name COLLATE NOCASE ASC
       LIMIT 200`
    ).all();
    if (!results.length) return jsonError(c, 404, 'No personnel records available to export');
    columns = ['Name', 'Email', 'Contact', 'Role', 'Department', 'Team', 'Callsign', 'Availability', 'Status'];
    tableRows = results.map((r) => {
      const row = r as Record<string, string>;
      return [
        row.full_name,
        row.email,
        row.contact_number ?? '-',
        row.role_name,
        row.department_name ?? '-',
        row.team_name ?? '-',
        row.callsign ?? '-',
        row.availability_status ?? '-',
        row.status,
      ];
    });
    linesBody = tableRows.map((r) => r.join(' | '));
  } else if (reportType === 'shift') {
    const { results } = await c.env.DB.prepare(
      'SELECT team_name, start_time, end_time, shift_status FROM shifts ORDER BY start_time LIMIT 80'
    ).all();
    if (!results.length) return jsonError(c, 404, 'No shift records available to export');
    columns = ['Team', 'Start', 'End', 'Status'];
    tableRows = results.map((r) => {
      const row = r as Record<string, string>;
      return [row.team_name, row.start_time, row.end_time, row.shift_status];
    });
    linesBody = tableRows.map((r) => r.join(' | '));
  } else if (reportType === 'unit-activity' || reportType === 'checklist') {
    const { results } = await c.env.DB.prepare(
      'SELECT unit_no, vehicle_type, status FROM vehicles ORDER BY unit_no LIMIT 80'
    ).all();
    if (!results.length) return jsonError(c, 404, 'No unit records available to export');
    columns = ['Unit', 'Type', 'Status'];
    tableRows = results.map((r) => {
      const row = r as Record<string, string>;
      return [row.unit_no, row.vehicle_type ?? '-', row.status];
    });
    linesBody = tableRows.map((r) => r.join(' | '));
  } else if (reportType === 'audit') {
    try {
      const { results } = await c.env.DB.prepare(
        'SELECT action, resource_type, resource_id, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 80'
      ).all();
      if (!results.length) return jsonError(c, 404, 'No audit records available to export');
      columns = ['When', 'Action', 'Resource', 'Id'];
      tableRows = results.map((r) => {
        const row = r as Record<string, string>;
        return [row.created_at, row.action, row.resource_type ?? '-', (row.resource_id ?? '-').slice(0, 40)];
      });
      linesBody = tableRows.map((r) => r.join(' | '));
    } catch {
      return jsonError(c, 404, 'No audit records available to export');
    }
  } else {
    let sql = `${INCIDENT_SELECT} WHERE 1=1`;
    const binds: string[] = [];
    if (from) {
      sql += ' AND date(i.reported_at) >= date(?)';
      binds.push(from);
    }
    if (to) {
      sql += ' AND date(i.reported_at) <= date(?)';
      binds.push(to);
    }
    if (reportType === 'fire') sql += " AND lower(t.type_name) LIKE '%fire%'";
    if (reportType === 'transport' || reportType === 'patient-care') {
      sql += " AND (lower(t.type_name) LIKE '%transport%' OR lower(t.type_name) LIKE '%conduction%' OR lower(t.type_name) LIKE '%medical%' OR lower(t.type_name) LIKE '%ambulance%')";
    }
    if (reportType === 'dispatch') sql += " AND i.status NOT IN ('Closed', 'Cancelled', 'False Alarm', 'Duplicate')";
    sql += ' ORDER BY i.reported_at DESC LIMIT 80';
    const { results } = binds.length
      ? await c.env.DB.prepare(sql).bind(...binds).all()
      : await c.env.DB.prepare(sql).all();
    if (!results.length) return jsonError(c, 404, 'No records available to export');
    columns = ['ID', 'Type', 'Priority', 'Status', 'Reported'];
    tableRows = results.map((r) => {
      const i = r as Record<string, string>;
      return [i.display_id, i.type_name, i.priority_level, i.status, i.reported_at];
    });
    linesBody = tableRows.map((r) => r.join(' | '));
  }

  if (format === 'xlsx' || format === 'excel') {
    const reportNo = `RPT-${manilaYmd().replace(/-/g, '')}`;
    const rowsXml = linesBody
      .map((line) => `<Row><Cell><Data ss:Type="String">${line.replace(/[<>&]/g, '')}</Data></Cell></Row>`)
      .join('');
    const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Report"><Table>
<Row><Cell><Data ss:Type="String">${title}</Data></Cell></Row>
${rowsXml}
</Table></Worksheet>
<Worksheet ss:Name="Signatories"><Table>
<Row><Cell><Data ss:Type="String">Report ${reportNo}</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">Dispatcher</Data></Cell><Cell><Data ss:Type="String">________________</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">Chief</Data></Cell><Cell><Data ss:Type="String">________________</Data></Cell></Row>
</Table></Worksheet>
</Workbook>`;
    return new Response(xml, {
      headers: {
        'Content-Type': 'application/vnd.ms-excel',
        'Content-Disposition': `attachment; filename=${reportNo}.xls`,
      },
    });
  }
  if (format === 'pdf') {
    const reportNo = `RPT-${manilaYmd().replace(/-/g, '')}-${tableRows.length}`;
    const generated = new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' });
    const pdfBytes = buildOperationsPdf({
      orgName: 'Brigada Onse SVFAR / Barangay Sun Valley BDRRMO',
      title,
      reportNo,
      generatedLabel: `${generated} (Asia/Manila)`,
      filtersLine: `type=${reportType}${from ? ` from=${from}` : ''}${to ? ` to=${to}` : ''}`,
      columns,
      rows: tableRows,
      footerNote: 'Authorized signatures — official operations report',
    });
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=${reportType}-${reportNo}.pdf`,
      },
    });
  }
  const header = 'Line\n';
  const reportNo = `RPT-${manilaYmd().replace(/-/g, '')}`;
  return new Response(header + linesBody.join('\n') + `\nReport,${reportNo}\n`, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename=${reportType}-${reportNo}.csv`,
    },
  });
});

app.get('/api/settings', auth, requirePerm('settings:manage'), async (c) => {
  const departments = await c.env.DB.prepare('SELECT id, name, code FROM departments').all();
  const roles = await c.env.DB.prepare('SELECT name FROM roles').all();
  let settingsMap: Record<string, string> = {};
  try {
    const { results } = await c.env.DB.prepare('SELECT key, value FROM system_settings').all<{ key: string; value: string }>();
    for (const row of results ?? []) settingsMap[row.key] = row.value;
  } catch {
    /* table may not exist until migrate-v11 */
  }
  return c.json({
    success: true,
    data: { settings: settingsMap, departments: departments.results, roles: roles.results },
  });
});

app.patch('/api/settings', auth, requirePerm('settings:manage'), async (c) => {
  const body = await c.req.json<{ settings?: Record<string, unknown> }>().catch(() => ({} as { settings?: Record<string, unknown> }));
  const incoming = body.settings;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return jsonError(c, 400, 'settings object required');
  }
  const entries = Object.entries(incoming).filter(([k]) => typeof k === 'string' && k.length > 0 && k.length <= 64);
  if (!entries.length) return jsonError(c, 400, 'No settings to update');

  const stmts = entries.map(([key, raw]) => {
    const value =
      typeof raw === 'boolean' || typeof raw === 'number'
        ? String(raw)
        : String(raw ?? '').slice(0, 4000);
    return c.env.DB.prepare(
      `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).bind(key, value);
  });
  try {
    await c.env.DB.batch(stmts);
  } catch {
    return jsonError(c, 503, 'Settings storage unavailable — run db:migrate:v11');
  }
  const user = c.get('user');
  await audit(c.env.DB, user.userId, user.role, 'settings.update', 'system_settings', String(entries.length));
  const { results } = await c.env.DB.prepare('SELECT key, value FROM system_settings').all<{ key: string; value: string }>();
  const settingsMap: Record<string, string> = {};
  for (const row of results ?? []) settingsMap[row.key] = row.value;
  return c.json({ success: true, data: { settings: settingsMap } });
});

app.get('/api/settings/audit-logs', auth, requirePerm('settings:manage'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.action,
            a.resource_type as resourceType,
            a.resource_id as resourceId,
            a.created_at as createdAt,
            a.actor_role as actorRole,
            u.full_name as actorName,
            CASE WHEN a.resource_type IN ('Incident', 'incident') THEN i.display_id ELSE NULL END as incidentDisplayId
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id
     LEFT JOIN incidents i ON i.id = a.resource_id
     ORDER BY a.created_at DESC
     LIMIT 100`
  ).all();
  return c.json({ success: true, data: results });
});

app.post('/api/settings/reset-status', auth, requirePerm('settings:manage'), async (c) => {
  const body = await c.req.json<{ confirm?: string }>().catch(() => ({} as { confirm?: string }));
  if ((body.confirm ?? '').trim().toUpperCase() !== 'RESET STATUS') {
    return jsonError(c, 400, 'Type RESET STATUS to confirm');
  }
  const user = c.get('user');
  const { resetUnitResponderStatus } = await import('./lib/opsReset');
  const data = await resetUnitResponderStatus(c.env.DB, user.userId, user.role);
  return c.json({ success: true, data });
});

app.post('/api/settings/reset-data', auth, async (c) => {
  const user = c.get('user');
  if (user.role !== ROLES.SYSTEM_ADMINISTRATOR) {
    return jsonError(c, 403, 'Only system administrators can reset all data');
  }
  const body = await c.req.json<{ confirm?: string }>().catch(() => ({} as { confirm?: string }));
  if ((body.confirm ?? '').trim().toUpperCase() !== 'RESET ALL DATA') {
    return jsonError(c, 400, 'Type RESET ALL DATA to confirm');
  }
  const { resetAllOpsData } = await import('./lib/opsReset');
  try {
    const data = await resetAllOpsData(c.env.DB, user.userId, user.role);
    return c.json({ success: true, data });
  } catch (err) {
    return jsonError(c, 500, err instanceof Error ? err.message : 'Reset failed');
  }
});

app.post('/api/settings/ensure-ops-accounts', auth, async (c) => {
  const user = c.get('user');
  if (user.role !== ROLES.SYSTEM_ADMINISTRATOR) {
    return jsonError(c, 403, 'Only system administrators can create protected console accounts');
  }
  const { ensureProtectedOpsAccounts, DEFAULT_OPS_PASSWORD, PROTECTED_OPS_ACCOUNTS } = await import('./lib/opsReset');
  const result = await ensureProtectedOpsAccounts(c.env.DB);
  await audit(c.env.DB, user.userId, user.role, 'ops.ensure_accounts', 'users', String(PROTECTED_OPS_ACCOUNTS.length));
  return c.json({
    success: true,
    data: {
      ...result,
      accounts: PROTECTED_OPS_ACCOUNTS.map((a) => ({ email: a.email, role: a.roleName, fullName: a.fullName })),
      defaultPasswordHint: result.created.length ? DEFAULT_OPS_PASSWORD : null,
    },
  });
});

app.get('/api/chat/incident/:incidentId', auth, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT m.id as _id, m.message, m.created_at as createdAt, u.full_name as senderName
     FROM chat_messages m JOIN users u ON u.id = m.sender_user_id
     WHERE m.incident_id = ? ORDER BY m.created_at ASC`
  )
    .bind(c.req.param('incidentId'))
    .all();
  return c.json({ success: true, data: results });
});

app.post('/api/chat/incident/:incidentId', auth, async (c) => {
  const { message } = await c.req.json<{ message?: string }>();
  if (!message?.trim()) return jsonError(c, 400, 'Message required');
  const incidentId = c.req.param('incidentId');
  const text = message.trim().slice(0, 2000);
  const userId = c.get('user').userId;
  await c.env.DB.prepare('INSERT INTO chat_messages (id, incident_id, sender_user_id, message) VALUES (?, ?, ?, ?)')
    .bind(id(), incidentId, userId, text)
    .run();

  const sender = await c.env.DB.prepare('SELECT full_name FROM users WHERE id = ?').bind(userId).first<{ full_name: string }>();
  const { results: assignees } = await c.env.DB.prepare(
    `SELECT DISTINCT r.user_id as userId FROM assignments a
     JOIN responders r ON r.id = a.responder_id
     WHERE a.incident_id = ? AND a.assignment_status NOT IN ('Completed', 'Rejected', 'Declined', 'Cancelled')`
  )
    .bind(incidentId)
    .all<{ userId: string }>();
  const dispatcherIds = await listDispatcherUserIds(c.env.DB);
  const recipients = [...new Set([...(assignees ?? []).map((a) => a.userId), ...dispatcherIds])].filter(
    (uid) => uid !== userId
  );
  if (recipients.length) {
    await notifyUsers(c.env, c.env.DB, recipients, {
      type: 'Incident Chat',
      priority: 'Normal',
      title: `Chat — ${sender?.full_name || 'User'}`,
      message: text.slice(0, 160),
      incidentId,
      tone: 'chat',
      tag: `chat-${incidentId}-${Date.now()}`,
    });
  }
  return c.json({ success: true }, 201);
});

/** Shared dispatch ↔ responder team channel (not tied to an incident). */
const RESPONDER_CHAT_CHANNEL = 'channel:responders';

function canUseResponderChat(role: string) {
  return (
    role === ROLES.EMERGENCY_RESPONDER ||
    role === ROLES.CENTRAL_DISPATCHER ||
    role === ROLES.DEPARTMENT_DISPATCHER ||
    role === ROLES.SYSTEM_ADMINISTRATOR ||
    hasPerm(role, 'dispatch:manage') ||
    hasPerm(role, 'responder:operations')
  );
}

app.get('/api/chat/responders', auth, async (c) => {
  if (!canUseResponderChat(c.get('user').role)) return jsonError(c, 403, 'Responders chat is for dispatch and field units only');
  const { results } = await c.env.DB.prepare(
    `SELECT m.id as _id, m.message, m.created_at as createdAt, u.full_name as senderName, r.name as senderRole
     FROM chat_messages m
     JOIN users u ON u.id = m.sender_user_id
     JOIN roles r ON r.id = u.role_id
     WHERE m.incident_id = ?
     ORDER BY m.created_at DESC
     LIMIT 100`
  )
    .bind(RESPONDER_CHAT_CHANNEL)
    .all();
  return c.json({ success: true, data: (results ?? []).reverse() });
});

app.post('/api/chat/responders', auth, async (c) => {
  if (!canUseResponderChat(c.get('user').role)) return jsonError(c, 403, 'Responders chat is for dispatch and field units only');
  const { message } = await c.req.json<{ message?: string }>();
  if (!message?.trim()) return jsonError(c, 400, 'Message required');
  const text = message.trim().slice(0, 2000);
  const msgId = id();
  const userId = c.get('user').userId;
  await c.env.DB.prepare('INSERT INTO chat_messages (id, incident_id, sender_user_id, message) VALUES (?, ?, ?, ?)')
    .bind(msgId, RESPONDER_CHAT_CHANNEL, userId, text)
    .run();
  const sender = await c.env.DB.prepare('SELECT full_name FROM users WHERE id = ?').bind(userId).first<{ full_name: string }>();

  const [dispatchers, responders] = await Promise.all([
    listDispatcherUserIds(c.env.DB),
    listResponderUserIds(c.env.DB, userId),
  ]);
  const recipients = [...new Set([...dispatchers, ...responders])].filter((uid) => uid !== userId);
  if (recipients.length) {
    await notifyUsers(c.env, c.env.DB, recipients, {
      type: 'Team Chat',
      priority: 'Normal',
      title: `Responders chat — ${sender?.full_name || 'User'}`,
      message: text.slice(0, 160),
      tone: 'chat',
      tag: `team-chat-${msgId}`,
    });
  }

  return c.json(
    {
      success: true,
      data: {
        _id: msgId,
        message: text,
        createdAt: new Date().toISOString(),
        senderName: sender?.full_name ?? 'User',
      },
    },
    201
  );
});

registerExtended(app, auth as Parameters<typeof registerExtended>[1]);

app.notFound((c) => jsonError(c, 404, 'Not found'));
app.onError((err, c) => {
  console.error(err);
  return jsonError(c, 500, err instanceof Error ? err.message : 'Server error');
});

export default {
  fetch: app.fetch,
};
