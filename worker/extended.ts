import { type Context, type Next, type Hono } from 'hono';
import {
  type Env,
  type Variables,
  UNIT_READY_SQL,
  canResponderTransition,
  num,
  id,
  jsonError,
  hasPerm,
  sanitizeText,
  normalizePhPhone,
  passwordIssues,
  haversineKm,
  hashPassword,
  nextDisplayId,
  logActivity,
  audit,
  logStatusHistory,
  SUN_VALLEY_CENTER,
  STATIC_FACILITIES,
  syncSosForIncident,
} from './lib/core';
import { kmeans } from './lib/kmeans';
import { planRoute } from './lib/routing';
import { manilaYmd } from './lib/pdf';
import { notifyUsers, notifyDispatchers } from './lib/notify';

type App = Hono<{ Bindings: Env; Variables: Variables }>;
type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

function requirePerm(perm: string) {
  return async (c: AppContext, next: Next) => {
    const user = c.get('user');
    if (!hasPerm(user.role, perm)) return jsonError(c, 403, 'Insufficient permissions');
    await next();
  };
}

async function consumeIdempotency(db: D1Database, userId: string, key: string | undefined) {
  if (!key) return null;
  const existing = await db.prepare('SELECT response_json FROM idempotency_keys WHERE key = ? AND user_id = ?')
    .bind(key, userId)
    .first<{ response_json: string }>();
  if (existing) return JSON.parse(existing.response_json);
  return null;
}

async function storeIdempotency(db: D1Database, userId: string, key: string | undefined, payload: unknown) {
  if (!key) return;
  try {
    await db
      .prepare('INSERT OR IGNORE INTO idempotency_keys (key, user_id, response_json) VALUES (?, ?, ?)')
      .bind(key, userId, JSON.stringify(payload))
      .run();
  } catch {
    /* migrate not applied */
  }
}

export function registerExtended(app: App, auth: (c: AppContext, next: Next) => Promise<void | Response>) {
  app.post('/api/auth/forgot-password', async (c) => {
    const { email } = await c.req.json<{ email?: string }>().catch(() => ({ email: '' }));
    const normalized = sanitizeText(email, 200).toLowerCase();
    const user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(normalized).first<{ id: string }>();
    if (user) {
      const token = id();
      const tokenHash = await hashPassword(token);
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      try {
        await c.env.DB.prepare(
          'INSERT INTO password_resets (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
        )
          .bind(id(), user.id, tokenHash, expires)
          .run();
      } catch {
        /* table may not exist */
      }
      await audit(c.env.DB, user.id, undefined, 'PASSWORD_RESET_REQUESTED', 'User', user.id);
    }
    return c.json({
      success: true,
      message: 'If an account exists for that email, a reset link will be sent.',
    });
  });

  app.post('/api/auth/reset-password', async (c) => {
    const body = await c.req.json<{ token?: string; email?: string; password?: string }>();
    if (!body.token || !body.email || !body.password) return jsonError(c, 400, 'Token, email, and password are required');
    const issues = passwordIssues(body.password);
    if (issues.length) return jsonError(c, 400, `Password must include ${issues.join(', ')}`);
    const user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(body.email.toLowerCase())
      .first<{ id: string }>();
    if (!user) return jsonError(c, 400, 'Invalid or expired reset token');
    const reset = await c.env.DB
      .prepare(
        "SELECT * FROM password_resets WHERE user_id = ? AND used_at IS NULL AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 5"
      )
      .bind(user.id)
      .all<{ id: string; token_hash: string }>();
    const { verifyPassword } = await import('./lib/core');
    let matched: { id: string } | null = null;
    for (const row of reset.results ?? []) {
      if (await verifyPassword(body.token, row.token_hash)) {
        matched = row;
        break;
      }
    }
    if (!matched) return jsonError(c, 400, 'Invalid or expired reset token');
    await c.env.DB.prepare('UPDATE users SET password_hash = ?, refresh_token = NULL WHERE id = ?')
      .bind(await hashPassword(body.password), user.id)
      .run();
    await c.env.DB.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?").bind(matched.id).run();
    await audit(c.env.DB, user.id, undefined, 'PASSWORD_RESET_COMPLETED', 'User', user.id);
    return c.json({ success: true, message: 'Password updated. You can sign in now.' });
  });

  app.get('/api/profile', auth, async (c) => {
    const userId = c.get('user').userId;
    const user = await c.env.DB.prepare(
      `SELECT u.*, r.name as role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`
    )
      .bind(userId)
      .first<Record<string, unknown>>();
    if (!user) return jsonError(c, 404, 'User not found');
    const citizen = await c.env.DB.prepare('SELECT * FROM citizens WHERE user_id = ?').bind(userId).first<Record<string, unknown>>();
    const responder = await c.env.DB.prepare(
      `SELECT r.*, d.name as dept_name FROM responders r JOIN departments d ON d.id = r.department_id WHERE r.user_id = ?`
    )
      .bind(userId)
      .first<Record<string, unknown>>();
    return c.json({
      success: true,
      data: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        contactNumber: user.contact_number,
        role: user.role_name,
        status: user.status,
        language: user.language ?? 'en',
        emailVerified: Boolean(user.email_verified),
        phoneVerified: Boolean(user.phone_verified),
        address: responder?.home_address ?? citizen?.address ?? null,
        emergencyContact: responder?.emergency_contact ?? citizen?.emergency_contact ?? null,
        medicalAlerts: responder?.medical_alerts ?? citizen?.medical_alerts ?? null,
        notificationPrefs: citizen?.notification_prefs ?? null,
        callsign: responder?.callsign ?? null,
        teamName: responder?.team_name ?? null,
        department: responder?.dept_name ?? null,
        availabilityStatus: responder?.availability_status ?? null,
      },
    });
  });

  app.patch('/api/profile', auth, async (c) => {
    const body = await c.req.json<{
      fullName?: string;
      contactNumber?: string;
      address?: string;
      emergencyContact?: string;
      medicalAlerts?: string;
      language?: string;
      notificationPrefs?: string;
    }>();
    const userId = c.get('user').userId;
    const phone = body.contactNumber ? normalizePhPhone(body.contactNumber) : null;
    if (body.contactNumber && !phone) return jsonError(c, 400, 'Enter a valid Philippine mobile number (09XXXXXXXXX)');
    if (body.fullName) {
      await c.env.DB.prepare('UPDATE users SET full_name = ? WHERE id = ?').bind(sanitizeText(body.fullName, 120), userId).run();
    }
    if (phone) {
      await c.env.DB.prepare('UPDATE users SET contact_number = ? WHERE id = ?').bind(phone, userId).run();
    }
    if (body.language) {
      await c.env.DB.prepare('UPDATE users SET language = ? WHERE id = ?').bind(body.language === 'fil' ? 'fil' : 'en', userId).run();
    }
    const citizen = await c.env.DB.prepare('SELECT id FROM citizens WHERE user_id = ?').bind(userId).first<{ id: string }>();
    if (citizen) {
      await c.env.DB.prepare(
        'UPDATE citizens SET address = COALESCE(?, address), emergency_contact = COALESCE(?, emergency_contact), medical_alerts = COALESCE(?, medical_alerts), notification_prefs = COALESCE(?, notification_prefs) WHERE id = ?'
      )
        .bind(
          body.address != null ? sanitizeText(body.address, 300) : null,
          body.emergencyContact != null ? sanitizeText(body.emergencyContact, 120) : null,
          body.medicalAlerts != null ? sanitizeText(body.medicalAlerts, 500) : null,
          body.notificationPrefs != null ? sanitizeText(body.notificationPrefs, 500) : null,
          citizen.id
        )
        .run();
    }
    const responder = await c.env.DB.prepare('SELECT id FROM responders WHERE user_id = ?').bind(userId).first<{ id: string }>();
    if (responder) {
      try {
        await c.env.DB.prepare(
          `UPDATE responders SET
             home_address = COALESCE(?, home_address),
             emergency_contact = COALESCE(?, emergency_contact),
             medical_alerts = COALESCE(?, medical_alerts)
           WHERE id = ?`
        )
          .bind(
            body.address != null ? sanitizeText(body.address, 300) : null,
            body.emergencyContact != null ? sanitizeText(body.emergencyContact, 120) : null,
            body.medicalAlerts != null ? sanitizeText(body.medicalAlerts, 500) : null,
            responder.id
          )
          .run();
      } catch {
        /* columns may be missing until migrate:v17 */
      }
    }
    await audit(c.env.DB, userId, c.get('user').role, 'PROFILE_UPDATED', 'User', userId);
    return c.json({ success: true });
  });

  app.post('/api/profile/delete-request', auth, async (c) => {
    const citizen = await c.env.DB.prepare('SELECT id FROM citizens WHERE user_id = ?').bind(c.get('user').userId).first<{ id: string }>();
    if (citizen) {
      try {
        await c.env.DB.prepare("UPDATE citizens SET deletion_requested_at = datetime('now') WHERE id = ?").bind(citizen.id).run();
      } catch {
        /* ignore */
      }
    }
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'ACCOUNT_DELETION_REQUESTED', 'User', c.get('user').userId);
    return c.json({ success: true, message: 'Deletion request recorded. An administrator will process it.' });
  });

  app.post('/api/incidents', auth, requirePerm('incidents:write'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json<Record<string, unknown>>();
    const idempotencyKey = c.req.header('Idempotency-Key') || String(body.clientRequestId ?? '');
    const cached = await consumeIdempotency(c.env.DB, user.userId, idempotencyKey || undefined);
    if (cached) return c.json(cached);

    const typeId = sanitizeText(body.incidentTypeId, 80);
    const lat = num(body.latitude);
    const lng = num(body.longitude);
    if (!typeId || !lat || !lng) return jsonError(c, 400, 'Incident type and map location are required');

    const type = await c.env.DB.prepare('SELECT id FROM incident_types WHERE id = ? OR type_name = ?')
      .bind(typeId, typeId)
      .first<{ id: string }>();
    if (!type) return jsonError(c, 400, 'Unknown incident category');

    const duplicates = await findDuplicates(c.env.DB, {
      lat,
      lng,
      typeId: type.id,
      reporterId: user.userId,
      description: sanitizeText(body.description, 2000),
    });

    const locationId = id();
    const incidentId = id();
    await c.env.DB.prepare('INSERT INTO locations (id, latitude, longitude, address_text, landmark) VALUES (?, ?, ?, ?, ?)')
      .bind(
        locationId,
        lat,
        lng,
        sanitizeText(body.addressText ?? body.address, 300) || null,
        sanitizeText(body.landmark, 200) || null
      )
      .run();
    const displayId = await nextDisplayId(c.env.DB, 'INC');
    const priority = ['Critical', 'High', 'Moderate', 'Medium', 'Low'].includes(String(body.priorityLevel))
      ? String(body.priorityLevel) === 'Medium'
        ? 'Moderate'
        : String(body.priorityLevel)
      : 'High';
    const baseBind = [
      incidentId,
      displayId,
      user.userId,
      type.id,
      locationId,
      sanitizeText(body.description, 2000),
      priority,
    ];
    try {
      await c.env.DB.prepare(
        `INSERT INTO incidents (
          id, display_id, reported_by_user_id, incident_type_id, location_id, description, priority_level, status,
          dispatcher_id, caller_name, caller_phone, subcategory, victim_count, patient_condition, known_hazards,
          accessibility, report_source, is_anonymous, callback_confirmed, dispatcher_notes, client_request_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending Verification', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          ...baseBind,
          user.userId,
          sanitizeText(body.callerName, 120) || null,
          body.callerPhone ? normalizePhPhone(String(body.callerPhone)) : null,
          sanitizeText(body.subcategory, 80) || null,
          body.victimCount != null ? num(body.victimCount) : null,
          sanitizeText(body.patientCondition, 400) || null,
          sanitizeText(body.knownHazards, 400) || null,
          sanitizeText(body.accessibility, 400) || null,
          sanitizeText(body.reportSource, 80) || 'Dispatcher intake',
          body.anonymous ? 1 : 0,
          body.callbackConfirmed ? 1 : 0,
          sanitizeText(body.dispatcherNotes, 2000) || null,
          idempotencyKey || null
        )
        .run();
    } catch {
      await c.env.DB.prepare(
        `INSERT INTO incidents (id, display_id, reported_by_user_id, incident_type_id, location_id, description, priority_level, status, dispatcher_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending Verification', ?)`
      )
        .bind(...baseBind, user.userId)
        .run();
    }
    await logActivity(c.env.DB, incidentId, 'Incident Created', 'Smart call intake submitted', user.userId);
    await logStatusHistory(c.env.DB, incidentId, '', 'Pending Verification', user.userId);
    await audit(c.env.DB, user.userId, user.role, 'INCIDENT_CREATED', 'Incident', incidentId);

    const payload = {
      success: true,
      data: { _id: incidentId, displayId, duplicates },
    };
    await storeIdempotency(c.env.DB, user.userId, idempotencyKey || undefined, payload);
    return c.json(payload, 201);
  });

  app.get('/api/incidents/:incidentId/duplicates', auth, requirePerm('incidents:read'), async (c) => {
    const row = await c.env.DB.prepare(
      `${INCIDENT_GEO} WHERE i.id = ?`
    )
      .bind(c.req.param('incidentId'))
      .first<{ latitude: number; longitude: number; incident_type_id: string; reported_by_user_id: string; description: string }>();
    if (!row) return jsonError(c, 404, 'Incident not found');
    const duplicates = await findDuplicates(c.env.DB, {
      lat: num(row.latitude),
      lng: num(row.longitude),
      typeId: row.incident_type_id,
      reporterId: row.reported_by_user_id,
      description: String(row.description ?? ''),
      excludeId: c.req.param('incidentId'),
    });
    return c.json({ success: true, data: duplicates });
  });

  app.post('/api/incidents/:incidentId/merge', auth, requirePerm('incidents:write'), async (c) => {
    const { sourceIncidentId, reason } = await c.req.json<{ sourceIncidentId?: string; reason?: string }>();
    const masterId = c.req.param('incidentId');
    if (!sourceIncidentId) return jsonError(c, 400, 'sourceIncidentId required');
    if (sourceIncidentId === masterId) return jsonError(c, 400, 'Cannot merge an incident into itself');
    await c.env.DB.prepare('UPDATE incidents SET master_incident_id = ?, status = ? WHERE id = ?')
      .bind(masterId, 'Duplicate', sourceIncidentId)
      .run();
    await syncSosForIncident(c.env.DB, sourceIncidentId, 'Duplicate');
    await c.env.DB.prepare('UPDATE assignments SET incident_id = ? WHERE incident_id = ?').bind(masterId, sourceIncidentId).run();
    await logActivity(
      c.env.DB,
      masterId,
      'Incidents Merged',
      `Merged ${sourceIncidentId}. ${sanitizeText(reason, 300)}`,
      c.get('user').userId
    );
    await logActivity(c.env.DB, sourceIncidentId, 'Marked Duplicate', `Merged into ${masterId}`, c.get('user').userId);
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'INCIDENT_MERGED', 'Incident', masterId);
    return c.json({ success: true });
  });

  app.post('/api/incidents/:incidentId/cancel', auth, requirePerm('incidents:write'), async (c) => {
    const { reason } = await c.req.json<{ reason?: string }>();
    if (!sanitizeText(reason, 400)) return jsonError(c, 400, 'A reason is required to cancel');
    const incidentId = c.req.param('incidentId');
    const current = await c.env.DB.prepare('SELECT status FROM incidents WHERE id = ?').bind(incidentId).first<{ status: string }>();
    if (!current) return jsonError(c, 404, 'Incident not found');
    if (['Cancelled', 'Closed', 'Duplicate', 'False Alarm', 'Resolved'].includes(current.status)) {
      return jsonError(c, 400, `Incident is already ${current.status}`);
    }
    try {
      await c.env.DB.prepare('UPDATE incidents SET status = ?, cancel_reason = ? WHERE id = ?')
        .bind('Cancelled', sanitizeText(reason, 400), incidentId)
        .run();
    } catch {
      await c.env.DB.prepare('UPDATE incidents SET status = ? WHERE id = ?').bind('Cancelled', incidentId).run();
    }
    await syncSosForIncident(c.env.DB, incidentId, 'Cancelled');
    try {
      const { releaseAssignmentsForIncident } = await import('./lib/assignmentLifecycle');
      await releaseAssignmentsForIncident(c.env.DB, incidentId, {
        reason: sanitizeText(reason, 400),
        actorUserId: c.get('user').userId,
      });
    } catch (err) {
      console.error('cancel releaseAssignments failed', err);
    }
    await logActivity(c.env.DB, incidentId, 'Cancelled', sanitizeText(reason, 400), c.get('user').userId);
    await logStatusHistory(c.env.DB, incidentId, current.status, 'Cancelled', c.get('user').userId, sanitizeText(reason, 400));
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'INCIDENT_CANCELLED', 'Incident', incidentId);
    return c.json({ success: true });
  });

  app.post('/api/incidents/:incidentId/reopen', auth, requirePerm('incidents:write'), async (c) => {
    const { reason } = await c.req.json<{ reason?: string }>();
    if (!sanitizeText(reason, 400)) return jsonError(c, 400, 'A reason is required to reopen');
    const incidentId = c.req.param('incidentId');
    const current = await c.env.DB.prepare('SELECT status, is_locked FROM incidents WHERE id = ?')
      .bind(incidentId)
      .first<{ status: string; is_locked: number }>();
    if (!current) return jsonError(c, 404, 'Incident not found');
    if (!['Cancelled', 'False Alarm', 'Closed', 'Resolved'].includes(current.status)) {
      return jsonError(c, 400, `Cannot reopen from status ${current.status}`);
    }
    await c.env.DB.prepare('UPDATE incidents SET status = ?, is_locked = 0 WHERE id = ?').bind('Reopened', incidentId).run();
    await syncSosForIncident(c.env.DB, incidentId, 'Reopened');
    await logActivity(c.env.DB, incidentId, 'Reopened', sanitizeText(reason, 400), c.get('user').userId);
    await logStatusHistory(c.env.DB, incidentId, current.status, 'Reopened', c.get('user').userId, sanitizeText(reason, 400));
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'INCIDENT_REOPENED', 'Incident', incidentId);
    return c.json({ success: true, data: { status: 'Reopened' } });
  });

  app.patch('/api/incidents/:incidentId', auth, requirePerm('incidents:write'), async (c) => {
    const incidentId = c.req.param('incidentId');
    const body = await c.req.json<Record<string, unknown>>();
    const row = await c.env.DB.prepare('SELECT * FROM incidents WHERE id = ?').bind(incidentId).first<{
      id: string;
      status: string;
      location_id: string;
      priority_level: string;
      description: string;
      incident_type_id: string;
    }>();
    if (!row) return jsonError(c, 404, 'Incident not found');
    if (['Closed', 'Duplicate'].includes(row.status)) {
      return jsonError(c, 400, `Cannot edit a ${row.status} incident. Reopen it first.`);
    }

    const sets: string[] = [];
    const binds: unknown[] = [];
    const changes: string[] = [];

    if (body.priorityLevel != null) {
      const raw = String(body.priorityLevel);
      const priority = ['Critical', 'High', 'Moderate', 'Medium', 'Low'].includes(raw)
        ? raw === 'Medium'
          ? 'Moderate'
          : raw
        : null;
      if (!priority) return jsonError(c, 400, 'Invalid priority');
      if (priority !== row.priority_level) {
        sets.push('priority_level = ?');
        binds.push(priority);
        changes.push(`priority → ${priority}`);
      }
    }

    if (body.incidentTypeId != null) {
      const typeId = sanitizeText(body.incidentTypeId, 80);
      const type = await c.env.DB.prepare('SELECT id, type_name FROM incident_types WHERE id = ? OR type_name = ?')
        .bind(typeId, typeId)
        .first<{ id: string; type_name: string }>();
      if (!type) return jsonError(c, 400, 'Unknown incident type');
      if (type.id !== row.incident_type_id) {
        sets.push('incident_type_id = ?');
        binds.push(type.id);
        changes.push(`type → ${type.type_name}`);
      }
    }

    if (body.description != null) {
      const description = sanitizeText(body.description, 2000);
      sets.push('description = ?');
      binds.push(description);
      changes.push('description updated');
    }

    const textFields: Array<[string, string, number]> = [
      ['caller_name', 'callerName', 120],
      ['caller_phone', 'callerPhone', 40],
      ['subcategory', 'subcategory', 80],
      ['patient_condition', 'patientCondition', 400],
      ['known_hazards', 'knownHazards', 400],
      ['accessibility', 'accessibility', 400],
      ['dispatcher_notes', 'dispatcherNotes', 1000],
    ];
    for (const [col, key, max] of textFields) {
      if (body[key] === undefined) continue;
      let val = sanitizeText(body[key], max) || null;
      if (key === 'callerPhone' && val) val = normalizePhPhone(val);
      sets.push(`${col} = ?`);
      binds.push(val);
      changes.push(key);
    }

    if (body.victimCount !== undefined) {
      const n = body.victimCount === null || body.victimCount === '' ? null : num(body.victimCount);
      sets.push('victim_count = ?');
      binds.push(n);
      changes.push('victimCount');
    }

    if (sets.length) {
      binds.push(incidentId);
      await c.env.DB.prepare(`UPDATE incidents SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    }

    if (body.addressText !== undefined || body.landmark !== undefined) {
      const locSets: string[] = [];
      const locBinds: unknown[] = [];
      if (body.addressText !== undefined) {
        locSets.push('address_text = ?');
        locBinds.push(sanitizeText(body.addressText, 300) || null);
      }
      if (body.landmark !== undefined) {
        locSets.push('landmark = ?');
        locBinds.push(sanitizeText(body.landmark, 200) || null);
      }
      if (locSets.length) {
        locBinds.push(row.location_id);
        await c.env.DB.prepare(`UPDATE locations SET ${locSets.join(', ')} WHERE id = ?`).bind(...locBinds).run();
        changes.push('location text');
      }
    }

    if (!changes.length) return c.json({ success: true, data: { updated: false } });

    await logActivity(
      c.env.DB,
      incidentId,
      'Incident Updated',
      changes.slice(0, 8).join(', '),
      c.get('user').userId
    );
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'INCIDENT_UPDATED', 'Incident', incidentId);
    return c.json({ success: true, data: { updated: true, changes } });
  });

  app.post('/api/incidents/:incidentId/assign-many', auth, requirePerm('incidents:assign'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json<{
      responderIds?: string[];
      vehicleIds?: string[];
      primaryResponderId?: string;
      reason?: string;
      clientRequestId?: string;
    }>();
    const idem = c.req.header('Idempotency-Key') || body.clientRequestId;
    const cached = await consumeIdempotency(c.env.DB, user.userId, idem);
    if (cached) return c.json(cached);

    const incidentId = c.req.param('incidentId');
    const incident = await c.env.DB.prepare('SELECT * FROM incidents WHERE id = ?').bind(incidentId).first<{
      status: string;
      is_locked: number;
      display_id: string;
    }>();
    if (!incident || incident.is_locked) return jsonError(c, 400, 'Incident not available for assignment');
    if (['Cancelled', 'Closed', 'False Alarm', 'Duplicate', 'Resolved'].includes(incident.status)) {
      return jsonError(c, 400, `Cannot assign units to a ${incident.status} incident`);
    }

    const responderIds = body.responderIds ?? [];
    const vehicleIds = body.vehicleIds ?? [];
    if (!responderIds.length && !vehicleIds.length) return jsonError(c, 400, 'Select at least one unit or responder');

    for (const vehicleId of vehicleIds) {
      const v = await c.env.DB.prepare('SELECT status FROM vehicles WHERE id = ?').bind(vehicleId).first<{ status: string }>();
      if (!v) return jsonError(c, 400, 'Vehicle not found');
      if (!['Ready', 'Available'].includes(v.status)) {
        return jsonError(c, 400, `Unit is ${v.status} and cannot be assigned`);
      }
    }
    for (const responderId of responderIds) {
      const r = await c.env.DB.prepare('SELECT availability_status FROM responders WHERE id = ?')
        .bind(responderId)
        .first<{ availability_status: string }>();
      if (!r) return jsonError(c, 400, 'Responder not found');
      if (!['Available'].includes(r.availability_status)) {
        return jsonError(c, 400, `Responder is ${r.availability_status} and cannot be assigned`);
      }
    }

    const created: string[] = [];
    const deadline = new Date(Date.now() + 90 * 1000).toISOString();
    const linkedVehicleIds = new Set(vehicleIds);
    for (const responderId of responderIds) {
      const responderMeta = await c.env.DB.prepare('SELECT callsign FROM responders WHERE id = ?')
        .bind(responderId)
        .first<{ callsign: string | null }>();
      let vehicleId = vehicleIds[0] ?? null;
      if (!vehicleId && responderMeta?.callsign) {
        const matched = await c.env.DB.prepare(
          `SELECT id FROM vehicles
           WHERE upper(replace(unit_no, ' ', '')) = upper(replace(?, ' ', ''))
             AND status IN ('Ready', 'Available')
           LIMIT 1`
        )
          .bind(responderMeta.callsign)
          .first<{ id: string }>();
        vehicleId = matched?.id ?? null;
      }
      if (vehicleId) linkedVehicleIds.add(vehicleId);
      const assignmentId = id();
      await c.env.DB.prepare(
        `INSERT INTO assignments (id, incident_id, responder_id, vehicle_id, assigned_by_dispatcher_id, assignment_status, is_primary, ack_deadline, client_request_id)
         VALUES (?, ?, ?, ?, ?, 'Assigned', ?, ?, ?)`
      )
        .bind(
          assignmentId,
          incidentId,
          responderId,
          vehicleId,
          user.userId,
          responderId === body.primaryResponderId ? 1 : 0,
          deadline,
          idem ?? null
        )
        .run();
      created.push(assignmentId);
      await c.env.DB.prepare("UPDATE responders SET availability_status = 'Dispatched', operational_status = 'Dispatched' WHERE id = ?")
        .bind(responderId)
        .run();
      const responder = await c.env.DB.prepare('SELECT user_id FROM responders WHERE id = ?').bind(responderId).first<{ user_id: string }>();
      if (responder) {
        await notifyUsers(c.env, c.env.DB, [responder.user_id], {
          type: 'Dispatch Assignment',
          priority: 'Urgent',
          title: 'New Dispatch Assignment',
          message: `Accept ${incident.display_id} within 90 seconds`,
          incidentId,
          tone: 'assignment',
          tag: `assign-${assignmentId}`,
        });
      }
    }
    for (const vehicleId of linkedVehicleIds) {
      await c.env.DB.prepare("UPDATE vehicles SET status = 'Assigned' WHERE id = ? AND status IN ('Ready', 'Available')")
        .bind(vehicleId)
        .run();
    }
    if (['Open', 'Verified', 'Pending Verification', 'Acknowledged', 'Dispatching'].includes(incident.status)) {
      await c.env.DB.prepare("UPDATE incidents SET status = 'Dispatched', dispatched_at = datetime('now') WHERE id = ?")
        .bind(incidentId)
        .run();
      await syncSosForIncident(c.env.DB, incidentId, 'Dispatched');
    }
    await logActivity(c.env.DB, incidentId, 'Units Assigned', `${created.length} responder(s) assigned. ${sanitizeText(body.reason, 200)}`, user.userId);
    await audit(c.env.DB, user.userId, user.role, 'UNITS_ASSIGNED', 'Incident', incidentId);
    const payload = { success: true, data: { assignmentIds: created } };
    await storeIdempotency(c.env.DB, user.userId, idem, payload);
    return c.json(payload);
  });

  app.get('/api/resources/units', auth, requirePerm('resources:manage'), async (c) => {
    const vehicles = await c.env.DB.prepare(
      `SELECT id, unit_no as unitNo, vehicle_type as vehicleType, status, lat, lng, gps_updated_at as gpsUpdatedAt, fuel_level as fuelLevel
       FROM vehicles`
    ).all();
    const ready = (await c.env.DB.prepare(`SELECT COUNT(*) as n FROM vehicles WHERE ${UNIT_READY_SQL}`).first<{ n: unknown }>())?.n;
    return c.json({
      success: true,
      data: { vehicles: vehicles.results, unitsReady: num(ready) },
    });
  });

  app.post('/api/resources/vehicles', auth, requirePerm('resources:manage'), async (c) => {
    const body = await c.req.json<{ unitNo?: string; vehicleType?: string; departmentId?: string; status?: string }>();
    if (!body.unitNo || !body.vehicleType) return jsonError(c, 400, 'Unit number and type are required');
    const dept = body.departmentId || 'dept-fire';
    const vid = id();
    await c.env.DB.prepare(
      'INSERT INTO vehicles (id, department_id, unit_no, vehicle_type, status, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(vid, dept, sanitizeText(body.unitNo, 40), sanitizeText(body.vehicleType, 80), body.status || 'Ready', SUN_VALLEY_CENTER.lat, SUN_VALLEY_CENTER.lng)
      .run();
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'VEHICLE_CREATED', 'Vehicle', vid);
    return c.json({ success: true, data: { id: vid } }, 201);
  });

  app.patch('/api/resources/vehicles/:id', auth, requirePerm('resources:manage'), async (c) => {
    const body = await c.req.json<{ status?: string; fuelLevel?: number; mileage?: number; reason?: string }>();
    const vehicleId = c.req.param('id');
    if (body.status === 'Out of Service' && !sanitizeText(body.reason, 200)) {
      return jsonError(c, 400, 'Reason required when placing a unit out of service');
    }
    await c.env.DB.prepare(
      'UPDATE vehicles SET status = COALESCE(?, status), fuel_level = COALESCE(?, fuel_level), mileage = COALESCE(?, mileage), out_of_service_reason = COALESCE(?, out_of_service_reason) WHERE id = ?'
    )
      .bind(body.status ?? null, body.fuelLevel ?? null, body.mileage ?? null, body.reason ?? null, vehicleId)
      .run();
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'VEHICLE_UPDATED', 'Vehicle', vehicleId);
    return c.json({ success: true });
  });

  app.post('/api/resources/equipment', auth, requirePerm('resources:manage'), async (c) => {
    const body = await c.req.json<{ name?: string; category?: string; quantity?: number; departmentId?: string; serviceability?: string }>();
    if (!body.name || !body.category) return jsonError(c, 400, 'Name and category required');
    const eid = id();
    await c.env.DB.prepare(
      'INSERT INTO equipment (id, name, category, quantity, serviceability, department_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(eid, sanitizeText(body.name, 120), sanitizeText(body.category, 80), num(body.quantity) || 1, body.serviceability || 'Serviceable', body.departmentId ?? 'dept-fire')
      .run();
    return c.json({ success: true, data: { id: eid } }, 201);
  });

  app.patch('/api/resources/equipment/:id', auth, requirePerm('resources:manage'), async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const eid = c.req.param('id');
    await c.env.DB.prepare(
      `UPDATE equipment SET
        name = COALESCE(?, name),
        category = COALESCE(?, category),
        quantity = COALESCE(?, quantity),
        serviceability = COALESCE(?, serviceability),
        assigned_unit = COALESCE(?, assigned_unit),
        expiration_date = COALESCE(?, expiration_date),
        calibration_date = COALESCE(?, calibration_date),
        missing = COALESCE(?, missing)
       WHERE id = ?`
    )
      .bind(
        body.name ? sanitizeText(String(body.name), 120) : null,
        body.category ? sanitizeText(String(body.category), 80) : null,
        body.quantity != null ? num(body.quantity) : null,
        body.serviceability ? sanitizeText(String(body.serviceability), 40) : null,
        body.assignedUnit != null ? sanitizeText(String(body.assignedUnit), 80) : null,
        body.expirationDate != null ? String(body.expirationDate) : null,
        body.calibrationDate != null ? String(body.calibrationDate) : null,
        body.missing != null ? (body.missing ? 1 : 0) : null,
        eid
      )
      .run();
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'EQUIPMENT_UPDATED', 'Equipment', eid);
    return c.json({ success: true });
  });

  app.post('/api/resources/checklists', auth, requirePerm('resources:manage'), async (c) => {
    const body = await c.req.json<{
      vehicleId?: string;
      kind?: string;
      items?: { label: string; critical?: boolean; passed: boolean }[];
      notes?: string;
    }>();
    if (!body.vehicleId || !body.items?.length) return jsonError(c, 400, 'Vehicle and checklist items required');
    const failedCritical = body.items.some((i) => i.critical && !i.passed);
    const cid = id();
    try {
      await c.env.DB.prepare(
        'INSERT INTO checklists (id, vehicle_id, kind, passed, failed_critical, notes, completed_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
        .bind(
          cid,
          body.vehicleId,
          body.kind === 'post' ? 'post' : 'pre',
          failedCritical ? 0 : 1,
          failedCritical ? 1 : 0,
          sanitizeText(body.notes, 400) || null,
          c.get('user').userId
        )
        .run();
      for (const item of body.items) {
        await c.env.DB.prepare(
          'INSERT INTO checklist_items (id, checklist_id, label, critical, passed) VALUES (?, ?, ?, ?, ?)'
        )
          .bind(id(), cid, sanitizeText(item.label, 200), item.critical ? 1 : 0, item.passed ? 1 : 0)
          .run();
      }
    } catch {
      return jsonError(c, 400, 'Checklist tables are not migrated yet');
    }
    if (failedCritical) {
      await c.env.DB.prepare("UPDATE vehicles SET status = 'Out of Service', out_of_service_reason = ? WHERE id = ?")
        .bind('Failed critical checklist item', body.vehicleId)
        .run();
      await notifyDispatchers(c.env, c.env.DB, {
        type: 'Resource Alert',
        priority: 'Urgent',
        title: 'Unit out of service',
        message: 'A critical checklist item failed. Unit placed Out of Service.',
        tone: 'urgent',
        tag: `oos-${body.vehicleId}`,
      });
    }
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'CHECKLIST_COMPLETED', 'Vehicle', body.vehicleId);
    return c.json({ success: true, data: { id: cid, outOfService: failedCritical } });
  });

  app.post('/api/personnel', auth, requirePerm('personnel:manage'), async (c) => {
    const body = await c.req.json<{
      fullName?: string;
      email?: string;
      contactNumber?: string;
      password?: string;
      role?: string;
      departmentId?: string;
      department?: string;
      callsign?: string;
      team?: string;
      teamName?: string;
    }>();
    if (!body.fullName || !body.email || !body.contactNumber || !body.password || !body.role) {
      return jsonError(c, 400, 'Name, email, contact, password, and role are required');
    }
    const phone = normalizePhPhone(body.contactNumber);
    if (!phone) return jsonError(c, 400, 'Invalid Philippine mobile number');
    const issues = passwordIssues(body.password);
    if (issues.length) return jsonError(c, 400, `Password must include ${issues.join(', ')}`);
    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(body.email.toLowerCase()).first();
    if (existing) return jsonError(c, 409, 'Email already registered');
    const role = await c.env.DB.prepare('SELECT id FROM roles WHERE name = ?').bind(body.role).first<{ id: string }>();
    if (!role) return jsonError(c, 400, 'Unknown role');

    let departmentId = body.departmentId || '';
    if (!departmentId && body.department) {
      const dept = await c.env.DB.prepare(
        'SELECT id FROM departments WHERE lower(code) = lower(?) OR lower(name) = lower(?) OR id = ? LIMIT 1'
      )
        .bind(body.department, body.department, body.department)
        .first<{ id: string }>();
      departmentId = dept?.id || '';
    }
    if (!departmentId) departmentId = 'dept-fire';
    const teamName = sanitizeText(body.teamName || body.team || '', 80) || null;

    const userId = id();
    await c.env.DB.prepare(
      'INSERT INTO users (id, role_id, full_name, contact_number, email, password_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(userId, role.id, sanitizeText(body.fullName, 120), phone, body.email.toLowerCase(), await hashPassword(body.password), 'active')
      .run();
    if (body.role === 'EMERGENCY_RESPONDER') {
      try {
        await c.env.DB.prepare(
          'INSERT INTO responders (id, user_id, department_id, callsign, team_name, availability_status, operational_status, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
          .bind(
            id(),
            userId,
            departmentId,
            sanitizeText(body.callsign, 40) || null,
            teamName,
            'Available',
            'Available',
            SUN_VALLEY_CENTER.lat,
            SUN_VALLEY_CENTER.lng
          )
          .run();
      } catch {
        await c.env.DB.prepare(
          'INSERT INTO responders (id, user_id, department_id, callsign, availability_status, operational_status, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
          .bind(
            id(),
            userId,
            departmentId,
            sanitizeText(body.callsign, 40) || null,
            'Available',
            'Available',
            SUN_VALLEY_CENTER.lat,
            SUN_VALLEY_CENTER.lng
          )
          .run();
      }
    }
    if (body.role === 'CITIZEN') {
      await c.env.DB.prepare('INSERT INTO citizens (id, user_id) VALUES (?, ?)').bind(id(), userId).run();
    }
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'PERSONNEL_CREATED', 'User', userId);
    return c.json({ success: true, data: { id: userId } }, 201);
  });

  app.patch('/api/personnel/:id', auth, requirePerm('personnel:manage'), async (c) => {
    const body = await c.req.json<{
      status?: string;
      fullName?: string;
      contactNumber?: string;
      callsign?: string;
      teamName?: string;
      team?: string;
      departmentId?: string;
      reason?: string;
    }>();
    const targetId = c.req.param('id');
    const phone = body.contactNumber ? normalizePhPhone(body.contactNumber) : null;
    if (body.contactNumber && !phone) return jsonError(c, 400, 'Invalid Philippine mobile number');
    await c.env.DB.prepare(
      'UPDATE users SET status = COALESCE(?, status), full_name = COALESCE(?, full_name), contact_number = COALESCE(?, contact_number) WHERE id = ?'
    )
      .bind(body.status ?? null, body.fullName ? sanitizeText(body.fullName, 120) : null, phone, targetId)
      .run();

    const teamName = body.teamName ?? body.team;
    if (body.callsign !== undefined || teamName !== undefined || body.departmentId) {
      const responder = await c.env.DB.prepare('SELECT id FROM responders WHERE user_id = ?')
        .bind(targetId)
        .first<{ id: string }>();
      if (responder) {
        try {
          await c.env.DB.prepare(
            `UPDATE responders SET
               callsign = COALESCE(?, callsign),
               team_name = COALESCE(?, team_name),
               department_id = COALESCE(?, department_id)
             WHERE user_id = ?`
          )
            .bind(
              body.callsign !== undefined ? sanitizeText(body.callsign, 40) || null : null,
              teamName !== undefined ? sanitizeText(teamName, 80) || null : null,
              body.departmentId || null,
              targetId
            )
            .run();
        } catch {
          await c.env.DB.prepare(
            `UPDATE responders SET
               callsign = COALESCE(?, callsign),
               department_id = COALESCE(?, department_id)
             WHERE user_id = ?`
          )
            .bind(
              body.callsign !== undefined ? sanitizeText(body.callsign, 40) || null : null,
              body.departmentId || null,
              targetId
            )
            .run();
        }
      }
    }

    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'PERSONNEL_UPDATED', 'User', targetId);
    return c.json({ success: true });
  });

  app.post('/api/departments', auth, requirePerm('settings:manage'), async (c) => {
    const { name, code } = await c.req.json<{ name?: string; code?: string }>();
    if (!name || !code) return jsonError(c, 400, 'Name and code required');
    const did = id();
    await c.env.DB.prepare('INSERT INTO departments (id, name, code) VALUES (?, ?, ?)').bind(did, sanitizeText(name, 120), sanitizeText(code, 20).toUpperCase()).run();
    return c.json({ success: true, data: { id: did } }, 201);
  });

  app.post('/api/shifts', auth, requirePerm('shifts:manage'), async (c) => {
    const body = await c.req.json<{
      teamName?: string;
      startTime?: string;
      endTime?: string;
      scheduledDate?: string;
      shiftStatus?: string;
    }>();
    if (!body.teamName || !body.startTime || !body.endTime || !body.scheduledDate) {
      return jsonError(c, 400, 'Team, times, and date are required');
    }
    const sid = id();
    await c.env.DB.prepare(
      'INSERT INTO shifts (id, team_name, start_time, end_time, shift_status, scheduled_date) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(
        sid,
        sanitizeText(body.teamName, 80),
        sanitizeText(body.startTime, 20),
        sanitizeText(body.endTime, 20),
        sanitizeText(body.shiftStatus || 'Scheduled', 40),
        body.scheduledDate
      )
      .run();
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'SHIFT_CREATED', 'Shift', sid);
    return c.json({ success: true, data: { id: sid } }, 201);
  });

  app.patch('/api/shifts/:id', auth, requirePerm('shifts:manage'), async (c) => {
    const body = await c.req.json<{
      shiftStatus?: string;
      handoverNotes?: string;
      teamName?: string;
      startTime?: string;
      endTime?: string;
      scheduledDate?: string;
      assignResponderIds?: string[];
    }>();
    const sid = c.req.param('id');
    await c.env.DB.prepare(
      `UPDATE shifts SET
         shift_status = COALESCE(?, shift_status),
         team_name = COALESCE(?, team_name),
         start_time = COALESCE(?, start_time),
         end_time = COALESCE(?, end_time),
         scheduled_date = COALESCE(?, scheduled_date)
       WHERE id = ?`
    )
      .bind(
        body.shiftStatus ? sanitizeText(body.shiftStatus, 40) : null,
        body.teamName ? sanitizeText(body.teamName, 80) : null,
        body.startTime ? sanitizeText(body.startTime, 20) : null,
        body.endTime ? sanitizeText(body.endTime, 20) : null,
        body.scheduledDate || null,
        sid
      )
      .run();

    if (body.assignResponderIds?.length && body.teamName) {
      const team = sanitizeText(body.teamName, 80);
      for (const rid of body.assignResponderIds) {
        try {
          await c.env.DB.prepare('UPDATE responders SET team_name = ? WHERE id = ?').bind(team, rid).run();
        } catch {
          /* team_name column may be missing on older DBs */
        }
      }
    }

    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'SHIFT_UPDATED', 'Shift', sid);
    return c.json({ success: true });
  });

  app.delete('/api/shifts/:id', auth, requirePerm('shifts:manage'), async (c) => {
    const sid = c.req.param('id');
    await c.env.DB.prepare('DELETE FROM shifts WHERE id = ?').bind(sid).run();
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'SHIFT_DELETED', 'Shift', sid);
    return c.json({ success: true });
  });

  app.get('/api/analytics', auth, requirePerm('analytics:read'), async (c) => {
    const from = c.req.query('from') || '1970-01-01';
    const to = c.req.query('to') || '2999-12-31';
    const includeTraining = c.req.query('includeTraining') === '1' || c.req.query('includeTraining') === 'true';
    let rows: Record<string, unknown>[] = [];
    try {
      const incidents = await c.env.DB.prepare(
        `SELECT i.status, i.priority_level, t.type_name, l.latitude, l.longitude,
                i.reported_at, i.verified_at, i.dispatched_at, i.enroute_at, i.onscene_at, i.resolved_at, i.closed_at
         FROM incidents i
         JOIN incident_types t ON t.id = i.incident_type_id
         JOIN locations l ON l.id = i.location_id
         WHERE date(i.reported_at) BETWEEN date(?) AND date(?)
           ${includeTraining ? '' : 'AND COALESCE(i.is_training, 0) = 0'}`
      )
        .bind(from, to)
        .all<Record<string, unknown>>();
      rows = incidents.results ?? [];
    } catch {
      // Column may not exist until migrate-v15
      const incidents = await c.env.DB.prepare(
        `SELECT i.status, i.priority_level, t.type_name, l.latitude, l.longitude,
                i.reported_at, i.verified_at, i.dispatched_at, i.enroute_at, i.onscene_at, i.resolved_at, i.closed_at
         FROM incidents i
         JOIN incident_types t ON t.id = i.incident_type_id
         JOIN locations l ON l.id = i.location_id
         WHERE date(i.reported_at) BETWEEN date(?) AND date(?)`
      )
        .bind(from, to)
        .all<Record<string, unknown>>();
      rows = (incidents.results ?? []).filter((r) => {
        if (includeTraining) return true;
        const desc = String((r as { description?: string }).description ?? '');
        return !/AUTHORIZED AUDIT TEST|NO REAL EMERGENCY/i.test(desc);
      });
    }

    const byCategory: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const hours = Array.from({ length: 24 }, () => 0);
    const byDay: Record<string, { count: number; responseSum: number; responseN: number }> = {};
    let ackMs = 0;
    let ackN = 0;
    let dispatchMs = 0;
    let dispatchN = 0;
    let travelMs = 0;
    let travelN = 0;
    let sceneMs = 0;
    let sceneN = 0;
    const manilaHourFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      hour: 'numeric',
      hour12: false,
    });
    const manilaDayFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    for (const r of rows) {
      const cat = String(r.type_name);
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      const st = String(r.status);
      byStatus[st] = (byStatus[st] ?? 0) + 1;
      const pri = String(r.priority_level || 'Unknown');
      byPriority[pri] = (byPriority[pri] ?? 0) + 1;
      const reported = Date.parse(String(r.reported_at));
      if (Number.isFinite(reported)) {
        const hourRaw = Number(manilaHourFmt.format(new Date(reported)));
        const hour = hourRaw === 24 ? 0 : hourRaw;
        if (hour >= 0 && hour < 24) hours[hour] += 1;
        const day = manilaDayFmt.format(new Date(reported));
        if (!byDay[day]) byDay[day] = { count: 0, responseSum: 0, responseN: 0 };
        byDay[day].count += 1;
        if (r.onscene_at) {
          const travel = Date.parse(String(r.onscene_at)) - reported;
          if (Number.isFinite(travel) && travel >= 0) {
            byDay[day].responseSum += travel;
            byDay[day].responseN += 1;
          }
        }
      }
      if (r.verified_at && Number.isFinite(reported)) {
        ackMs += Date.parse(String(r.verified_at)) - reported;
        ackN += 1;
      }
      if (r.dispatched_at && r.verified_at) {
        dispatchMs += Date.parse(String(r.dispatched_at)) - Date.parse(String(r.verified_at));
        dispatchN += 1;
      }
      if (r.onscene_at && r.enroute_at) {
        travelMs += Date.parse(String(r.onscene_at)) - Date.parse(String(r.enroute_at));
        travelN += 1;
      }
      if (r.resolved_at && r.onscene_at) {
        sceneMs += Date.parse(String(r.resolved_at)) - Date.parse(String(r.onscene_at));
        sceneN += 1;
      }
    }
    const avg = (ms: number, n: number) => (n ? Math.round(ms / n / 1000) : 0);
    const ready = num((await c.env.DB.prepare(`SELECT COUNT(*) as n FROM vehicles WHERE ${UNIT_READY_SQL}`).first<{ n: unknown }>())?.n);
    const totalUnits = num((await c.env.DB.prepare('SELECT COUNT(*) as n FROM vehicles').first<{ n: unknown }>())?.n);
    const resolved =
      (byStatus.Resolved ?? 0) + (byStatus.Closed ?? 0) + (byStatus.Completed ?? 0);
    const active =
      rows.length -
      resolved -
      (byStatus.Cancelled ?? 0) -
      (byStatus['False Alarm'] ?? 0) -
      (byStatus.Duplicate ?? 0);

    const responseTrend = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        count: v.count,
        avgResponse: v.responseN ? Math.round(v.responseSum / v.responseN / 1000) : null,
      }));

    return c.json({
      success: true,
      data: {
        totalIncidents: rows.length,
        byCategory,
        byStatus,
        byPriority,
        peakHours: hours,
        avgAckSeconds: avg(ackMs, ackN),
        avgDispatchSeconds: avg(dispatchMs, dispatchN),
        avgTravelSeconds: avg(travelMs, travelN),
        avgOnSceneSeconds: avg(sceneMs, sceneN),
        cancelled: byStatus.Cancelled ?? 0,
        falseAlarm: byStatus['False Alarm'] ?? 0,
        reopened: byStatus.Reopened ?? 0,
        resolved,
        active: Math.max(0, active),
        unitUtilization: totalUnits ? Math.round(((totalUnits - ready) / totalUnits) * 100) : 0,
        unitsReady: ready,
        unitsTotal: totalUnits,
        responseTrend,
        heatmap: rows.map((r) => ({ lat: num(r.latitude), lng: num(r.longitude), status: r.status, weight: 1 })),
        kmeansGroups: kmeans(
          rows.map((r) => ({ lat: num(r.latitude), lng: num(r.longitude), id: String(r.display_id ?? '') })),
          Math.min(5, Math.max(1, Math.floor(rows.length / 3) || 1))
        ).map((g, i) => ({
          group: i + 1,
          size: g.members.length,
          centroid: g.centroid,
          note: 'Descriptive spatial grouping only — not predictive forecasting',
        })),
        dataNotes: [
          includeTraining ? 'Includes training / audit-flagged incidents' : 'Training / audit-flagged incidents excluded by default (pass includeTraining=1 to include)',
          rows.length < 5 ? 'Insufficient data for stable clustering' : null,
        ]
          .filter(Boolean)
          .join('. ') || undefined,
        trainingExcluded: !includeTraining,
      },
    });
  });

  app.get('/api/responders/me', auth, requirePerm('responder:operations'), async (c) => {
    const row = await c.env.DB.prepare(
      `SELECT r.*, u.full_name, u.contact_number, d.name as dept_name
       FROM responders r
       JOIN users u ON u.id = r.user_id
       JOIN departments d ON d.id = r.department_id
       WHERE r.user_id = ?`
    )
      .bind(c.get('user').userId)
      .first<Record<string, unknown>>();
    if (!row) return jsonError(c, 404, 'Responder profile not found');

    let unitId: string | null = row.assigned_vehicle_id ? String(row.assigned_vehicle_id) : null;
    let unitNo: string | null = null;
    let unitType: string | null = null;
    let unitStatus: string | null = null;
    try {
      if (unitId) {
        const v = await c.env.DB.prepare(
          `SELECT id, unit_no, vehicle_type, status FROM vehicles WHERE id = ?`
        )
          .bind(unitId)
          .first<{ id: string; unit_no: string; vehicle_type: string; status: string }>();
        if (v) {
          unitNo = v.unit_no;
          unitType = v.vehicle_type;
          unitStatus = v.status;
        }
      } else if (row.callsign) {
        const matched = await c.env.DB.prepare(
          `SELECT id, unit_no, vehicle_type, status FROM vehicles
           WHERE upper(replace(unit_no, ' ', '')) = upper(replace(?, ' ', ''))
           LIMIT 1`
        )
          .bind(String(row.callsign))
          .first<{ id: string; unit_no: string; vehicle_type: string; status: string }>();
        if (matched) {
          unitId = matched.id;
          unitNo = matched.unit_no;
          unitType = matched.vehicle_type;
          unitStatus = matched.status;
        }
      }
    } catch {
      /* assigned_vehicle_id may be missing until migrate:v18 */
    }

    const attendance = await c.env.DB.prepare(
      'SELECT * FROM attendance WHERE responder_id = ? AND date = ?'
    )
      .bind(row.id, manilaYmd())
      .first();

    let pendingTeamChange: Record<string, unknown> | null = null;
    let pendingUnitChange: Record<string, unknown> | null = null;
    try {
      pendingTeamChange =
        (await c.env.DB.prepare(
          `SELECT id, COALESCE(request_type, 'team') as requestType, from_team as fromTeam, to_team as toTeam,
                  from_unit_label as fromUnitLabel, to_unit_label as toUnitLabel,
                  reason, status, created_at as createdAt
           FROM unit_change_requests
           WHERE responder_id = ? AND status = 'Pending' AND COALESCE(request_type, 'team') = 'team'
           ORDER BY created_at DESC LIMIT 1`
        )
          .bind(row.id)
          .first<Record<string, unknown>>()) ?? null;
      pendingUnitChange =
        (await c.env.DB.prepare(
          `SELECT id, request_type as requestType, from_team as fromTeam, to_team as toTeam,
                  from_vehicle_id as fromVehicleId, to_vehicle_id as toVehicleId,
                  from_unit_label as fromUnitLabel, to_unit_label as toUnitLabel,
                  reason, status, created_at as createdAt
           FROM unit_change_requests
           WHERE responder_id = ? AND status = 'Pending' AND request_type = 'unit'
           ORDER BY created_at DESC LIMIT 1`
        )
          .bind(row.id)
          .first<Record<string, unknown>>()) ?? null;
    } catch {
      try {
        pendingTeamChange =
          (await c.env.DB.prepare(
            `SELECT id, from_team as fromTeam, to_team as toTeam, reason, status, created_at as createdAt
             FROM unit_change_requests WHERE responder_id = ? AND status = 'Pending'
             ORDER BY created_at DESC LIMIT 1`
          )
            .bind(row.id)
            .first<Record<string, unknown>>()) ?? null;
      } catch {
        pendingTeamChange = null;
      }
      pendingUnitChange = null;
    }

    return c.json({
      success: true,
      data: {
        id: row.id,
        callsign: row.callsign,
        teamName: row.team_name,
        department: row.dept_name,
        availabilityStatus: row.availability_status,
        operationalStatus: row.operational_status,
        gpsUpdatedAt: row.gps_updated_at,
        lat: row.lat,
        lng: row.lng,
        homeAddress: row.home_address ?? null,
        emergencyContact: row.emergency_contact ?? null,
        medicalAlerts: row.medical_alerts ?? null,
        assignedVehicleId: unitId,
        unitNo,
        unitType,
        unitStatus,
        attendance,
        pendingTeamChange,
        pendingUnitChange,
      },
    });
  });

  const TEAM_CHOICES = ['Team Alpha', 'Team Bravo', 'Team Charlie', 'Team Delta', 'Unassigned'];

  app.get('/api/responders/me/units', auth, requirePerm('responder:operations'), async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT id, unit_no as unitNo, vehicle_type as vehicleType, status
       FROM vehicles
       WHERE status IN ('Ready', 'Available', 'Assigned', 'En Route', 'On Scene', 'Transporting', 'Returning')
       ORDER BY unit_no ASC
       LIMIT 80`
    ).all();
    return c.json({ success: true, data: results ?? [] });
  });

  async function assertNoPendingOfType(db: D1Database, responderId: string, requestType: 'team' | 'unit') {
    const existing = await db
      .prepare(
        `SELECT id FROM unit_change_requests
         WHERE responder_id = ? AND status = 'Pending' AND COALESCE(request_type, 'team') = ?
         LIMIT 1`
      )
      .bind(responderId, requestType)
      .first();
    if (existing) {
      return requestType === 'team'
        ? 'You already have a pending team change waiting for Dispatch'
        : 'You already have a pending unit change waiting for Dispatch';
    }
    return null;
  }

  app.post('/api/responders/me/team-change', auth, requirePerm('responder:operations'), async (c) => {
    const body = await c.req.json<{ teamName?: string; reason?: string }>();
    const toTeam = sanitizeText(body.teamName, 80);
    if (!toTeam || !TEAM_CHOICES.includes(toTeam)) {
      return jsonError(c, 400, `Choose a team: ${TEAM_CHOICES.join(', ')}`);
    }
    const reason = sanitizeText(body.reason, 400);
    if (reason.length < 3) return jsonError(c, 400, 'Explain why you need this team change (min 3 characters)');

    const responder = await c.env.DB.prepare(
      `SELECT r.id, r.team_name, r.callsign, u.full_name
       FROM responders r JOIN users u ON u.id = r.user_id WHERE r.user_id = ?`
    )
      .bind(c.get('user').userId)
      .first<{ id: string; team_name: string | null; callsign: string; full_name: string }>();
    if (!responder) return jsonError(c, 404, 'Responder profile not found');
    if ((responder.team_name || 'Unassigned') === toTeam) {
      return jsonError(c, 400, 'You are already on that team');
    }

    try {
      const conflict = await assertNoPendingOfType(c.env.DB, responder.id, 'team');
      if (conflict) return jsonError(c, 409, conflict);
    } catch {
      return jsonError(c, 503, 'Change-request table missing — run db:migrate:v18');
    }

    const rid = id();
    await c.env.DB.prepare(
      `INSERT INTO unit_change_requests (id, responder_id, request_type, from_team, to_team, reason, status)
       VALUES (?, ?, 'team', ?, ?, ?, 'Pending')`
    )
      .bind(rid, responder.id, responder.team_name || 'Unassigned', toTeam, reason)
      .run();

    await notifyDispatchers(c.env, c.env.DB, {
      type: 'Team Change Request',
      priority: 'Important',
      title: `Team change · ${responder.callsign}`,
      message: `${responder.full_name} (${responder.callsign}) requests team ${responder.team_name || 'Unassigned'} → ${toTeam}. Reason: ${reason}`,
      tone: 'alert',
      tag: `team-change-${rid}`,
      urls: {
        CENTRAL_DISPATCHER: '/admin/personnel',
        DEPARTMENT_DISPATCHER: '/admin/personnel',
        SYSTEM_ADMINISTRATOR: '/admin/personnel',
      },
    });
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'TEAM_CHANGE_REQUESTED', 'Responder', responder.id);
    return c.json({ success: true, data: { id: rid, status: 'Pending', requestType: 'team', toTeam } }, 201);
  });

  app.post('/api/responders/me/unit-change', auth, requirePerm('responder:operations'), async (c) => {
    const body = await c.req.json<{ vehicleId?: string; teamName?: string; reason?: string }>();
    // Backward-compat: old clients sent teamName on this endpoint
    if (body.teamName && !body.vehicleId) {
      return jsonError(c, 400, 'Use /responders/me/team-change for team requests');
    }
    const vehicleId = sanitizeText(body.vehicleId, 80);
    if (!vehicleId) return jsonError(c, 400, 'Select a unit (vehicle)');
    const reason = sanitizeText(body.reason, 400);
    if (reason.length < 3) return jsonError(c, 400, 'Explain why you need this unit change (min 3 characters)');

    const responder = await c.env.DB.prepare(
      `SELECT r.id, r.team_name, r.callsign, r.assigned_vehicle_id, u.full_name
       FROM responders r JOIN users u ON u.id = r.user_id WHERE r.user_id = ?`
    )
      .bind(c.get('user').userId)
      .first<{
        id: string;
        team_name: string | null;
        callsign: string;
        assigned_vehicle_id: string | null;
        full_name: string;
      }>();
    if (!responder) return jsonError(c, 404, 'Responder profile not found');

    const vehicle = await c.env.DB.prepare(
      `SELECT id, unit_no, vehicle_type, status FROM vehicles WHERE id = ?`
    )
      .bind(vehicleId)
      .first<{ id: string; unit_no: string; vehicle_type: string; status: string }>();
    if (!vehicle) return jsonError(c, 404, 'Unit not found');

    let fromVehicleId = responder.assigned_vehicle_id;
    let fromLabel = 'Unassigned';
    if (fromVehicleId) {
      const cur = await c.env.DB.prepare(`SELECT unit_no, vehicle_type FROM vehicles WHERE id = ?`)
        .bind(fromVehicleId)
        .first<{ unit_no: string; vehicle_type: string }>();
      if (cur) fromLabel = `${cur.unit_no}${cur.vehicle_type ? ` (${cur.vehicle_type})` : ''}`;
    } else if (responder.callsign) {
      const matched = await c.env.DB.prepare(
        `SELECT id, unit_no, vehicle_type FROM vehicles
         WHERE upper(replace(unit_no, ' ', '')) = upper(replace(?, ' ', ''))
         LIMIT 1`
      )
        .bind(responder.callsign)
        .first<{ id: string; unit_no: string; vehicle_type: string }>();
      if (matched) {
        fromVehicleId = matched.id;
        fromLabel = `${matched.unit_no}${matched.vehicle_type ? ` (${matched.vehicle_type})` : ''}`;
      }
    }

    if (fromVehicleId === vehicle.id) {
      return jsonError(c, 400, 'You are already assigned to that unit');
    }

    try {
      const conflict = await assertNoPendingOfType(c.env.DB, responder.id, 'unit');
      if (conflict) return jsonError(c, 409, conflict);
    } catch {
      return jsonError(c, 503, 'Change-request table missing — run db:migrate:v18');
    }

    const toLabel = `${vehicle.unit_no}${vehicle.vehicle_type ? ` (${vehicle.vehicle_type})` : ''}`;
    const rid = id();
    await c.env.DB.prepare(
      `INSERT INTO unit_change_requests (
         id, responder_id, request_type, from_team, to_team,
         from_vehicle_id, to_vehicle_id, from_unit_label, to_unit_label, reason, status
       ) VALUES (?, ?, 'unit', ?, ?, ?, ?, ?, ?, ?, 'Pending')`
    )
      .bind(
        rid,
        responder.id,
        responder.team_name || null,
        responder.team_name || null,
        fromVehicleId,
        vehicle.id,
        fromLabel,
        toLabel,
        reason
      )
      .run();

    await notifyDispatchers(c.env, c.env.DB, {
      type: 'Unit Change Request',
      priority: 'Important',
      title: `Unit change · ${responder.callsign}`,
      message: `${responder.full_name} (${responder.callsign}) requests unit ${fromLabel} → ${toLabel}. Reason: ${reason}`,
      tone: 'alert',
      tag: `unit-change-${rid}`,
      urls: {
        CENTRAL_DISPATCHER: '/admin/personnel',
        DEPARTMENT_DISPATCHER: '/admin/personnel',
        SYSTEM_ADMINISTRATOR: '/admin/personnel',
      },
    });
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'UNIT_CHANGE_REQUESTED', 'Responder', responder.id);
    return c.json({ success: true, data: { id: rid, status: 'Pending', requestType: 'unit', toUnitLabel: toLabel } }, 201);
  });

  app.get('/api/unit-change-requests', auth, async (c) => {
    const role = c.get('user').role;
    if (!hasPerm(role, 'personnel:manage') && !hasPerm(role, 'dispatch:manage')) {
      return jsonError(c, 403, 'Insufficient permissions');
    }
    const status = sanitizeText(c.req.query('status') || 'Pending', 40) || 'Pending';
    try {
      const { results } = await c.env.DB.prepare(
        `SELECT uc.id, COALESCE(uc.request_type, 'team') as requestType,
                uc.from_team as fromTeam, uc.to_team as toTeam,
                uc.from_vehicle_id as fromVehicleId, uc.to_vehicle_id as toVehicleId,
                uc.from_unit_label as fromUnitLabel, uc.to_unit_label as toUnitLabel,
                uc.reason, uc.status, uc.created_at as createdAt, uc.reviewed_at as reviewedAt,
                uc.review_note as reviewNote, r.callsign, u.full_name as fullName, r.id as responderId
         FROM unit_change_requests uc
         JOIN responders r ON r.id = uc.responder_id
         JOIN users u ON u.id = r.user_id
         WHERE uc.status = ?
         ORDER BY uc.created_at DESC
         LIMIT 50`
      )
        .bind(status)
        .all();
      return c.json({ success: true, data: results ?? [] });
    } catch {
      return c.json({ success: true, data: [] });
    }
  });

  app.post('/api/unit-change-requests/:id/decide', auth, async (c) => {
    const role = c.get('user').role;
    if (!hasPerm(role, 'personnel:manage') && !hasPerm(role, 'dispatch:manage')) {
      return jsonError(c, 403, 'Insufficient permissions');
    }
    const requestId = c.req.param('id');
    const body = await c.req.json<{ decision?: string; note?: string }>();
    const decision = String(body.decision || '').toLowerCase();
    if (decision !== 'approve' && decision !== 'deny') {
      return jsonError(c, 400, 'decision must be approve or deny');
    }
    const note = sanitizeText(body.note, 400) || null;
    const row = await c.env.DB.prepare(
      `SELECT uc.*, r.user_id as responder_user_id, r.callsign, u.full_name
       FROM unit_change_requests uc
       JOIN responders r ON r.id = uc.responder_id
       JOIN users u ON u.id = r.user_id
       WHERE uc.id = ?`
    )
      .bind(requestId)
      .first<Record<string, unknown>>();
    if (!row) return jsonError(c, 404, 'Request not found');
    if (row.status !== 'Pending') return jsonError(c, 400, `Request already ${row.status}`);

    const requestType = String(row.request_type || 'team');
    const nextStatus = decision === 'approve' ? 'Approved' : 'Denied';
    await c.env.DB.prepare(
      `UPDATE unit_change_requests SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = datetime('now')
       WHERE id = ?`
    )
      .bind(nextStatus, c.get('user').userId, note, requestId)
      .run();

    if (decision === 'approve') {
      if (requestType === 'unit' && row.to_vehicle_id) {
        try {
          await c.env.DB.prepare('UPDATE responders SET assigned_vehicle_id = ? WHERE id = ?')
            .bind(String(row.to_vehicle_id), String(row.responder_id))
            .run();
        } catch {
          return jsonError(c, 503, 'assigned_vehicle_id missing — run db:migrate:v18');
        }
      } else if (row.to_team) {
        await c.env.DB.prepare('UPDATE responders SET team_name = ? WHERE id = ?')
          .bind(String(row.to_team), String(row.responder_id))
          .run();
      }
    }

    const summary =
      requestType === 'unit'
        ? `${row.from_unit_label || 'Unassigned'} → ${row.to_unit_label || '—'}`
        : `${row.from_team || 'Unassigned'} → ${row.to_team || '—'}`;
    const kindLabel = requestType === 'unit' ? 'Unit' : 'Team';

    await notifyUsers(c.env, c.env.DB, [String(row.responder_user_id)], {
      type: `${kindLabel} Change Decision`,
      priority: 'Important',
      title: decision === 'approve' ? `${kindLabel} change approved` : `${kindLabel} change denied`,
      message:
        decision === 'approve'
          ? `Dispatch approved your ${kindLabel.toLowerCase()} change (${summary}).${note ? ` Note: ${note}` : ''}`
          : `Dispatch denied your ${kindLabel.toLowerCase()} change (${summary}).${note ? ` Note: ${note}` : ''}`,
      tone: 'alert',
      urls: { EMERGENCY_RESPONDER: '/responder/profile' },
    });
    await audit(
      c.env.DB,
      c.get('user').userId,
      c.get('user').role,
      decision === 'approve'
        ? requestType === 'unit'
          ? 'UNIT_CHANGE_APPROVED'
          : 'TEAM_CHANGE_APPROVED'
        : requestType === 'unit'
          ? 'UNIT_CHANGE_DENIED'
          : 'TEAM_CHANGE_DENIED',
      'UnitChangeRequest',
      requestId
    );
    return c.json({ success: true, data: { status: nextStatus, requestType } });
  });

  app.post(
    '/api/responders/assignments/:assignmentId/patient-report',
    auth,
    requirePerm('responder:operations'),
    async (c) => {
      const assignmentId = c.req.param('assignmentId');
      const body = await c.req.json<Record<string, unknown>>();
      const assignment = await c.env.DB.prepare(
        `SELECT a.id, a.incident_id, a.assignment_status, r.user_id
         FROM assignments a
         JOIN responders r ON r.id = a.responder_id
         WHERE a.id = ?`
      )
        .bind(assignmentId)
        .first<{ id: string; incident_id: string; assignment_status: string; user_id: string }>();
      if (!assignment) return jsonError(c, 404, 'Assignment not found');
      if (assignment.user_id !== c.get('user').userId) return jsonError(c, 403, 'Not your assignment');

      const patientName = body.patientName != null ? sanitizeText(body.patientName, 120) || null : null;
      const vitalRr = body.vitalRr != null ? sanitizeText(body.vitalRr, 40) || null : null;
      const vitalSpo2 = body.vitalSpo2 != null ? sanitizeText(body.vitalSpo2, 40) || null : null;
      const vitalHr = body.vitalHr != null ? sanitizeText(body.vitalHr, 40) || null : null;
      const vitalBp = body.vitalBp != null ? sanitizeText(body.vitalBp, 40) || null : null;
      const oxygenFlow = body.oxygenFlow != null ? sanitizeText(body.oxygenFlow, 40) || null : null;
      const oxygenRequired = body.oxygenRequired ? 1 : 0;
      const notes = body.notes != null ? sanitizeText(body.notes, 800) || null : null;
      const conditionParts = [
        patientName ? `Patient: ${patientName}` : null,
        vitalRr ? `RR ${vitalRr}` : null,
        vitalSpo2 ? `SpO2 ${vitalSpo2}%` : null,
        vitalHr ? `HR ${vitalHr}` : null,
        vitalBp ? `BP ${vitalBp}` : null,
        oxygenRequired ? `O2 ${oxygenFlow || 'required'}` : null,
        notes,
      ].filter(Boolean);
      const patientCondition = conditionParts.join(' · ') || null;

      try {
        await c.env.DB.prepare(
          `UPDATE incidents SET
             patient_name = COALESCE(?, patient_name),
             vital_rr = COALESCE(?, vital_rr),
             vital_spo2 = COALESCE(?, vital_spo2),
             vital_hr = COALESCE(?, vital_hr),
             vital_bp = COALESCE(?, vital_bp),
             oxygen_required = ?,
             oxygen_flow = COALESCE(?, oxygen_flow),
             patient_condition = COALESCE(?, patient_condition)
           WHERE id = ?`
        )
          .bind(
            patientName,
            vitalRr,
            vitalSpo2,
            vitalHr,
            vitalBp,
            oxygenRequired,
            oxygenFlow,
            patientCondition,
            assignment.incident_id
          )
          .run();
      } catch {
        await c.env.DB.prepare('UPDATE incidents SET patient_condition = COALESCE(?, patient_condition) WHERE id = ?')
          .bind(patientCondition, assignment.incident_id)
          .run();
      }

      await logActivity(
        c.env.DB,
        assignment.incident_id,
        'Patient / vitals update',
        patientCondition || 'Updated',
        c.get('user').userId
      );
      await notifyDispatchers(c.env, c.env.DB, {
        type: 'Field Update',
        priority: 'Important',
        title: 'Patient / vitals update from field',
        message: patientCondition || 'Responder submitted patient details',
        incidentId: assignment.incident_id,
        tone: 'status',
      });
      return c.json({ success: true });
    }
  );

  app.post('/api/responders/assignments/:assignmentId/decline', auth, requirePerm('responder:operations'), async (c) => {
    const { reason } = await c.req.json<{ reason?: string }>();
    if (!sanitizeText(reason, 300)) return jsonError(c, 400, 'A decline reason is required');
    const assignment = await c.env.DB.prepare('SELECT * FROM assignments WHERE id = ?')
      .bind(c.req.param('assignmentId'))
      .first<{ id: string; responder_id: string; incident_id: string }>();
    if (!assignment) return jsonError(c, 404, 'Assignment not found');
    const responder = await c.env.DB.prepare('SELECT id FROM responders WHERE user_id = ?').bind(c.get('user').userId).first<{ id: string }>();
    if (!responder || responder.id !== assignment.responder_id) return jsonError(c, 403, 'Not authorized');
    await c.env.DB.prepare("UPDATE assignments SET assignment_status = 'Declined', decline_reason = ? WHERE id = ?")
      .bind(sanitizeText(reason, 300), assignment.id)
      .run();
    await c.env.DB.prepare("UPDATE responders SET availability_status = 'Available', operational_status = 'Available' WHERE id = ?")
      .bind(responder.id)
      .run();
    await logActivity(c.env.DB, assignment.incident_id, 'Assignment Declined', sanitizeText(reason, 300), c.get('user').userId);
    await notifyDispatchers(c.env, c.env.DB, {
      type: 'Dispatch Alert',
      priority: 'Urgent',
      title: 'Assignment declined',
      message: sanitizeText(reason, 300),
      incidentId: assignment.incident_id,
      tone: 'urgent',
      tag: `decline-${assignment.id}`,
    });
    return c.json({ success: true });
  });

  app.post('/api/responders/assignments/:assignmentId/backup', auth, requirePerm('responder:operations'), async (c) => {
    const { note } = await c.req.json<{ note?: string }>();
    const assignment = await c.env.DB.prepare('SELECT * FROM assignments WHERE id = ?')
      .bind(c.req.param('assignmentId'))
      .first<{ incident_id: string; responder_id: string }>();
    if (!assignment) return jsonError(c, 404, 'Assignment not found');
    await logActivity(c.env.DB, assignment.incident_id, 'Backup Requested', sanitizeText(note, 400) || 'Backup requested', c.get('user').userId);
    await notifyDispatchers(c.env, c.env.DB, {
      type: 'Backup Request',
      priority: 'Urgent',
      title: 'Backup requested',
      message: sanitizeText(note, 400) || 'On-scene unit requested backup',
      incidentId: assignment.incident_id,
      tone: 'urgent',
      tag: `backup-${assignment.incident_id}`,
    });
    return c.json({ success: true });
  });

  app.post('/api/responders/me/status', auth, requirePerm('responder:operations'), async (c) => {
    const { status, reason, assignmentId } = await c.req.json<{ status?: string; reason?: string; assignmentId?: string }>();
    if (!status) return jsonError(c, 400, 'Status required');
    const responder = await c.env.DB.prepare('SELECT * FROM responders WHERE user_id = ?')
      .bind(c.get('user').userId)
      .first<{ id: string; availability_status: string }>();
    if (!responder) return jsonError(c, 404, 'Responder profile required');
    if (!canResponderTransition(responder.availability_status, status)) {
      if (!sanitizeText(reason, 200)) {
        return jsonError(c, 400, `Invalid status change from ${responder.availability_status} to ${status}. Provide an override reason.`);
      }
    }
    await c.env.DB.prepare('UPDATE responders SET operational_status = ?, availability_status = ? WHERE id = ?')
      .bind(status, status, responder.id)
      .run();
    if (assignmentId) {
      const assignment = await c.env.DB.prepare('SELECT incident_id FROM assignments WHERE id = ? AND responder_id = ?')
        .bind(assignmentId, responder.id)
        .first<{ incident_id: string }>();
      if (assignment) {
        await logActivity(c.env.DB, assignment.incident_id, `Responder ${status}`, sanitizeText(reason, 200) || `Status ${status}`, c.get('user').userId);
      }
    }
    return c.json({ success: true });
  });

  app.post('/api/sos/:id/cancel', auth, requirePerm('sos:write'), async (c) => {
    const { reason } = await c.req.json<{ reason?: string }>();
    if (!sanitizeText(reason, 300)) return jsonError(c, 400, 'Cancellation reason required');
    const citizen = await c.env.DB.prepare('SELECT id FROM citizens WHERE user_id = ?').bind(c.get('user').userId).first<{ id: string }>();
    if (!citizen) return jsonError(c, 403, 'Citizen profile required');
    const sos = await c.env.DB.prepare('SELECT * FROM sos_requests WHERE id = ? AND citizen_id = ?')
      .bind(c.req.param('id'), citizen.id)
      .first<{ id: string; incident_id: string; status: string }>();
    if (!sos) return jsonError(c, 404, 'SOS request not found');
    if (!['Pending', 'In Progress'].includes(String(sos.status))) {
      return jsonError(c, 400, 'This request can no longer be cancelled from the citizen portal');
    }
    await c.env.DB.prepare("UPDATE sos_requests SET status = 'Cancelled', cancel_reason = ? WHERE id = ?")
      .bind(sanitizeText(reason, 300), sos.id)
      .run();
    await c.env.DB.prepare('UPDATE incidents SET status = ?, cancel_reason = ? WHERE id = ?')
      .bind('Cancelled', sanitizeText(reason, 300), sos.incident_id)
      .run();
    await logActivity(c.env.DB, sos.incident_id, 'SOS Cancelled by citizen', sanitizeText(reason, 300), c.get('user').userId);
    return c.json({ success: true });
  });

  app.post('/api/sos/:id/reopen', auth, requirePerm('incidents:write'), async (c) => {
    const { reason } = await c.req.json<{ reason?: string }>();
    if (!sanitizeText(reason, 400)) return jsonError(c, 400, 'A reason is required to reopen');
    const sos = await c.env.DB.prepare('SELECT * FROM sos_requests WHERE id = ?')
      .bind(c.req.param('id'))
      .first<{ id: string; incident_id: string; status: string }>();
    if (!sos) return jsonError(c, 404, 'SOS request not found');
    if (!['Cancelled', 'Rejected'].includes(String(sos.status))) {
      const incident = await c.env.DB.prepare('SELECT status FROM incidents WHERE id = ?')
        .bind(sos.incident_id)
        .first<{ status: string }>();
      if (!incident || !['Cancelled', 'False Alarm', 'Closed', 'Resolved'].includes(incident.status)) {
        return jsonError(c, 400, 'SOS is not in a reopenable state');
      }
    }
    await c.env.DB.prepare("UPDATE sos_requests SET status = 'Pending', cancel_reason = NULL WHERE id = ?").bind(sos.id).run();
    await c.env.DB.prepare('UPDATE incidents SET status = ?, is_locked = 0 WHERE id = ?').bind('Reopened', sos.incident_id).run();
    await logActivity(c.env.DB, sos.incident_id, 'SOS Reopened', sanitizeText(reason, 400), c.get('user').userId);
    await logStatusHistory(c.env.DB, sos.incident_id, 'Cancelled', 'Reopened', c.get('user').userId, sanitizeText(reason, 400));
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'SOS_REOPENED', 'SOS', sos.id);
    return c.json({ success: true, data: { status: 'Pending' } });
  });

  app.post('/api/sos/:id/update', auth, requirePerm('sos:write'), async (c) => {
    const { description } = await c.req.json<{ description?: string }>();
    const citizen = await c.env.DB.prepare('SELECT id FROM citizens WHERE user_id = ?').bind(c.get('user').userId).first<{ id: string }>();
    if (!citizen) return jsonError(c, 403, 'Citizen profile required');
    const sos = await c.env.DB.prepare('SELECT * FROM sos_requests WHERE id = ? AND citizen_id = ?')
      .bind(c.req.param('id'), citizen.id)
      .first<{ incident_id: string }>();
    if (!sos) return jsonError(c, 404, 'SOS request not found');
    await logActivity(c.env.DB, sos.incident_id, 'Citizen update', sanitizeText(description, 1000), c.get('user').userId);
    return c.json({ success: true });
  });

  app.patch('/api/transports/:id', auth, requirePerm('transport:manage'), async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const tid = c.req.param('id');
    if (body.transportStatus === 'Cancelled' && !sanitizeText(body.cancelReason, 200)) {
      return jsonError(c, 400, 'Cancellation reason required');
    }
    const toCoord = (v: unknown): number | null => {
      if (v == null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const originLat = body.originLat !== undefined ? toCoord(body.originLat) : null;
    const originLng = body.originLng !== undefined ? toCoord(body.originLng) : null;
    const destinationLat =
      body.destLat !== undefined || body.destinationLat !== undefined
        ? toCoord(body.destLat ?? body.destinationLat)
        : null;
    const destinationLng =
      body.destLng !== undefined || body.destinationLng !== undefined
        ? toCoord(body.destLng ?? body.destinationLng)
        : null;
    await c.env.DB.prepare(
      `UPDATE transports SET
         transport_status = COALESCE(?, transport_status),
         patient_name = COALESCE(?, patient_name),
         scheduled_date = COALESCE(?, scheduled_date),
         scheduled_time = COALESCE(?, scheduled_time),
         origin_address = COALESCE(?, origin_address),
         destination_address = COALESCE(?, destination_address),
         origin_lat = COALESCE(?, origin_lat),
         origin_lng = COALESCE(?, origin_lng),
         destination_lat = COALESCE(?, destination_lat),
         destination_lng = COALESCE(?, destination_lng),
         patient_contact = COALESCE(?, patient_contact),
         requesting_person = COALESCE(?, requesting_person),
         return_trip = COALESCE(?, return_trip),
         priority = COALESCE(?, priority),
         oxygen_required = COALESCE(?, oxygen_required),
         assigned_vehicle_id = COALESCE(?, assigned_vehicle_id),
         assigned_crew = COALESCE(?, assigned_crew),
         notes = COALESCE(?, notes),
         cancel_reason = COALESCE(?, cancel_reason)
       WHERE id = ? OR display_id = ?`
    )
      .bind(
        body.transportStatus ? String(body.transportStatus) : null,
        body.patientName ? sanitizeText(body.patientName, 120) : null,
        body.scheduledDate ? String(body.scheduledDate) : null,
        body.scheduledTime ? String(body.scheduledTime) : null,
        body.originAddress ? sanitizeText(body.originAddress, 300) : null,
        body.destinationAddress ? sanitizeText(body.destinationAddress, 300) : null,
        originLat,
        originLng,
        destinationLat,
        destinationLng,
        body.contactNumber !== undefined
          ? sanitizeText(String(body.contactNumber ?? ''), 40) || null
          : null,
        body.requestingPerson !== undefined
          ? sanitizeText(String(body.requestingPerson ?? ''), 120) || null
          : null,
        body.tripType !== undefined || body.returnTrip !== undefined
          ? body.tripType === 'Round trip' || body.returnTrip
            ? 1
            : 0
          : null,
        body.priority ? sanitizeText(body.priority, 40) : null,
        body.oxygen !== undefined || body.oxygenRequired !== undefined
          ? body.oxygen || body.oxygenRequired
            ? 1
            : 0
          : null,
        body.assignedVehicleId !== undefined
          ? body.assignedVehicleId
            ? String(body.assignedVehicleId)
            : null
          : null,
        body.assignedCrew !== undefined || body.companion !== undefined
          ? sanitizeText(String(body.assignedCrew ?? body.companion ?? ''), 200) || null
          : null,
        body.specialInstructions !== undefined || body.notes !== undefined
          ? sanitizeText(String(body.specialInstructions ?? body.notes ?? ''), 1000) || null
          : null,
        body.cancelReason ? sanitizeText(body.cancelReason, 300) : null,
        tid,
        tid
      )
      .run();
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'TRANSPORT_UPDATED', 'Transport', tid);
    return c.json({ success: true });
  });

  app.get('/api/events', auth, async (c) => {
    const role = c.get('user').role;
    const since = c.req.query('since') || new Date(Date.now() - 60_000).toISOString();
    const incidents = hasPerm(role, 'incidents:read')
      ? await c.env.DB.prepare(
          `SELECT display_id, status, reported_at FROM incidents WHERE reported_at > ? OR verified_at > ? OR resolved_at > ? ORDER BY reported_at DESC LIMIT 20`
        )
          .bind(since, since, since)
          .all()
      : { results: [] };
    const notifications = await c.env.DB.prepare(
      'SELECT id, title, type, priority, sent_at FROM notifications WHERE recipient_user_id = ? AND sent_at > ? ORDER BY sent_at DESC LIMIT 20'
    )
      .bind(c.get('user').userId, since)
      .all();
    let systemEvents: unknown[] = [];
    try {
      const ev = await c.env.DB.prepare(
        'SELECT id, event_type as eventType, entity_type as entityType, entity_id as entityId, payload, created_at as createdAt FROM system_events WHERE created_at > ? ORDER BY created_at DESC LIMIT 50'
      )
        .bind(since)
        .all();
      systemEvents = ev.results;
    } catch {
      systemEvents = [];
    }
    return c.json({
      success: true,
      data: {
        serverTime: new Date().toISOString(),
        transport: 'polling',
        incidents: incidents.results,
        notifications: notifications.results,
        events: systemEvents,
      },
    });
  });

  app.get('/api/routing/plan', auth, requirePerm('map:monitor'), async (c) => {
    const fromLat = Number(c.req.query('fromLat'));
    const fromLng = Number(c.req.query('fromLng'));
    const toLat = Number(c.req.query('toLat'));
    const toLng = Number(c.req.query('toLng'));
    if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) return jsonError(c, 400, 'fromLat, fromLng, toLat, toLng required');
    const result = await planRoute(c.env.MAPBOX_ACCESS_TOKEN, { lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng });
    return c.json({ success: true, data: result });
  });

  app.get('/api/training', auth, requirePerm('personnel:manage'), async (c) => {
    try {
      const { results } = await c.env.DB.prepare(
        `SELECT tr.id, tr.responder_id as responderId, tr.training_name as trainingName, tr.completed_at as completedAt, tr.expires_at as expiresAt,
                tr.certification_status as certificationStatus, r.callsign, u.full_name as fullName
         FROM training_records tr
         JOIN responders r ON r.id = tr.responder_id
         JOIN users u ON u.id = r.user_id
         ORDER BY tr.created_at DESC LIMIT 100`
      ).all();
      return c.json({ success: true, data: results });
    } catch {
      return c.json({ success: true, data: [], meta: { note: 'Run db:migrate:v4' } });
    }
  });

  app.post('/api/training', auth, requirePerm('personnel:manage'), async (c) => {
    const body = await c.req.json<{ responderId?: string; trainingName?: string; expiresAt?: string; certificationStatus?: string }>();
    if (!body.responderId || !body.trainingName) return jsonError(c, 400, 'responderId and trainingName required');
    const tid = id();
    await c.env.DB.prepare(
      `INSERT INTO training_records (id, responder_id, training_name, completed_at, expires_at, certification_status)
       VALUES (?, ?, ?, datetime('now'), ?, ?)`
    )
      .bind(tid, body.responderId, sanitizeText(body.trainingName, 200), body.expiresAt ?? null, body.certificationStatus ?? 'passed')
      .run();
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'TRAINING_RECORDED', 'Training', tid);
    return c.json({ success: true, data: { id: tid } }, 201);
  });

  app.get('/api/announcements', auth, async (c) => {
    try {
      const { results } = await c.env.DB.prepare(
        `SELECT id, title, body, priority, audience, published_at as publishedAt, is_active as isActive
         FROM announcements WHERE is_active = 1 ORDER BY published_at DESC LIMIT 50`
      ).all();
      return c.json({ success: true, data: results });
    } catch {
      return c.json({ success: true, data: [] });
    }
  });

  app.post('/api/announcements', auth, requirePerm('settings:manage'), async (c) => {
    const body = await c.req.json<{ title?: string; body?: string; priority?: string; audience?: string }>();
    if (!sanitizeText(body.title, 200) || !sanitizeText(body.body, 2000)) return jsonError(c, 400, 'Title and body required');
    const aid = id();
    await c.env.DB.prepare(
      `INSERT INTO announcements (id, title, body, priority, audience, published_by) VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(aid, sanitizeText(body.title, 200), sanitizeText(body.body, 2000), body.priority ?? 'Normal', body.audience ?? 'ALL', c.get('user').userId)
      .run();
    try {
      await c.env.DB.prepare(
        `INSERT INTO system_events (id, event_type, entity_type, entity_id, payload) VALUES (?, ?, ?, ?, ?)`
      )
        .bind(id(), 'announcement.published', 'Announcement', aid, JSON.stringify({ title: body.title }))
        .run();
    } catch {
      /* optional */
    }
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'ANNOUNCEMENT_PUBLISHED', 'Announcement', aid);
    return c.json({ success: true, data: { id: aid } }, 201);
  });

  app.get('/api/escalation-rules', auth, requirePerm('settings:manage'), async (c) => {
    try {
      const { results } = await c.env.DB.prepare('SELECT * FROM escalation_rules ORDER BY created_at DESC').all();
      return c.json({ success: true, data: results });
    } catch {
      return c.json({ success: true, data: [] });
    }
  });

  app.post('/api/escalation-rules', auth, requirePerm('settings:manage'), async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.name || !body.triggerType) return jsonError(c, 400, 'name and triggerType required');
    const rid = id();
    await c.env.DB.prepare(
      `INSERT INTO escalation_rules (id, name, trigger_type, threshold_seconds, incident_category, priority_level, notify_roles, message_template)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        rid,
        sanitizeText(String(body.name), 120),
        sanitizeText(String(body.triggerType), 80),
        num(body.thresholdSeconds) || 300,
        body.incidentCategory ? sanitizeText(String(body.incidentCategory), 80) : null,
        body.priorityLevel ? sanitizeText(String(body.priorityLevel), 40) : null,
        body.notifyRoles ? sanitizeText(String(body.notifyRoles), 200) : 'CENTRAL_DISPATCHER',
        body.messageTemplate ? sanitizeText(String(body.messageTemplate), 500) : null
      )
      .run();
    return c.json({ success: true, data: { id: rid } }, 201);
  });

  app.post('/api/escalation-rules/evaluate', auth, requirePerm('dispatch:manage'), async (c) => {
    const { incidentId } = await c.req.json<{ incidentId?: string }>();
    if (!incidentId) return jsonError(c, 400, 'incidentId required');
    const incident = await c.env.DB.prepare(
      `SELECT i.*, t.type_name FROM incidents i JOIN incident_types t ON t.id = i.incident_type_id WHERE i.id = ?`
    )
      .bind(incidentId)
      .first<Record<string, unknown>>();
    if (!incident) return jsonError(c, 404, 'Incident not found');
    let rules: Record<string, unknown>[] = [];
    try {
      const q = await c.env.DB.prepare('SELECT * FROM escalation_rules WHERE is_active = 1').all<Record<string, unknown>>();
      rules = q.results;
    } catch {
      rules = [];
    }
    const matched = rules.filter((r) => {
      if (r.priority_level && r.priority_level !== incident.priority_level) return false;
      if (r.incident_category && String(incident.type_name).toLowerCase().indexOf(String(r.incident_category).toLowerCase()) < 0) return false;
      return true;
    });
    for (const rule of matched) {
      const nid = id();
      await c.env.DB.prepare(
        `INSERT INTO notification_deliveries (id, channel, recipient, message, priority, state, incident_id, sent_at)
         VALUES (?, 'in-app', ?, ?, ?, 'sent', ?, datetime('now'))`
      )
        .bind(
          nid,
          String(rule.notify_roles ?? 'CENTRAL_DISPATCHER'),
          sanitizeText(String(rule.message_template || `Escalation: ${rule.name} for ${incident.display_id}`), 500),
          String(incident.priority_level ?? 'High'),
          incidentId
        )
        .run();
    }
    return c.json({ success: true, data: { matched: matched.length } });
  });

  app.post('/api/media', auth, async (c) => {
    const body = await c.req.json<{
      incidentId?: string;
      sosId?: string;
      fileName?: string;
      contentType?: string;
      sizeBytes?: number;
      caption?: string;
      storageKey?: string;
    }>();
    if (!body.fileName || !body.contentType) return jsonError(c, 400, 'fileName and contentType required');
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];
    if (!allowed.includes(body.contentType)) return jsonError(c, 400, 'File type not permitted');
    if (num(body.sizeBytes) > 10 * 1024 * 1024) return jsonError(c, 400, 'Max 10MB');
    const mid = id();
    const key = body.storageKey || `media/${mid}/${sanitizeText(body.fileName, 120)}`;
    try {
      await c.env.DB.prepare(
        `INSERT INTO media_attachments (id, incident_id, sos_id, uploaded_by, file_name, content_type, size_bytes, storage_key, caption)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          mid,
          body.incidentId ?? null,
          body.sosId ?? null,
          c.get('user').userId,
          sanitizeText(body.fileName, 120),
          body.contentType,
          num(body.sizeBytes) || 0,
          key,
          sanitizeText(body.caption, 300) || null
        )
        .run();
    } catch (err) {
      return jsonError(c, 500, err instanceof Error ? err.message : 'media table missing — run migrate:v4');
    }
    if (body.incidentId) {
      await logActivity(c.env.DB, body.incidentId, 'Media attached', sanitizeText(body.fileName, 120), c.get('user').userId);
    }
    return c.json({ success: true, data: { id: mid, storageKey: key, uploadHint: 'PUT binary to R2 via authorized upload when configured' } }, 201);
  });

  /** Multipart photo/video upload → R2 + media_attachments */
  app.post('/api/media/upload', auth, async (c) => {
    const form = await c.req.parseBody();
    const file = form['file'];
    const incidentId = sanitizeText(form['incidentId'], 80) || null;
    const sosId = sanitizeText(form['sosId'], 80) || null;
    const caption = sanitizeText(form['caption'], 300) || null;

    if (!file || typeof file === 'string') return jsonError(c, 400, 'file required');
    const contentType = file.type || 'application/octet-stream';
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4'];
    if (!allowed.includes(contentType)) return jsonError(c, 400, 'Only JPEG, PNG, WebP, GIF, or MP4 allowed');
    if (file.size > 10 * 1024 * 1024) return jsonError(c, 400, 'Max 10MB per file');
    if (!incidentId && !sosId) return jsonError(c, 400, 'incidentId or sosId required');

    const mid = id();
    const safeName = sanitizeText(file.name || 'upload.jpg', 120) || 'upload.jpg';
    const key = `media/${incidentId || sosId}/${mid}/${safeName}`;

    if (!c.env.MEDIA) return jsonError(c, 503, 'Media storage is not configured');
    await c.env.MEDIA.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType },
      customMetadata: { incidentId: incidentId || '', uploadedBy: c.get('user').userId },
    });

    try {
      await c.env.DB.prepare(
        `INSERT INTO media_attachments (id, incident_id, sos_id, uploaded_by, file_name, content_type, size_bytes, storage_key, caption)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(mid, incidentId, sosId, c.get('user').userId, safeName, contentType, file.size, key, caption)
        .run();
    } catch (err) {
      return jsonError(c, 500, err instanceof Error ? err.message : 'media table missing — run migrate:v4');
    }

    if (incidentId) {
      try {
        await c.env.DB.prepare('UPDATE incidents SET photo_url = ? WHERE id = ? AND (photo_url IS NULL OR photo_url = ?)')
          .bind(`/api/media/${mid}`, incidentId, '')
          .run();
      } catch {
        /* photo_url column may be missing on older DBs */
      }
      await logActivity(c.env.DB, incidentId, 'Photo uploaded', safeName, c.get('user').userId);
    }

    return c.json(
      {
        success: true,
        data: {
          id: mid,
          fileName: safeName,
          contentType,
          sizeBytes: file.size,
          url: `/api/media/${mid}`,
        },
      },
      201
    );
  });

  app.get('/api/incidents/:incidentId/media', auth, requirePerm('incidents:read'), async (c) => {
    const incidentId = c.req.param('incidentId');
    try {
      const { results } = await c.env.DB.prepare(
        `SELECT id, file_name as fileName, content_type as contentType, size_bytes as sizeBytes,
                caption, created_at as createdAt, storage_key as storageKey
         FROM media_attachments WHERE incident_id = ? ORDER BY created_at DESC`
      )
        .bind(incidentId)
        .all();
      return c.json({
        success: true,
        data: (results ?? []).map((r) => ({
          ...r,
          url: `/api/media/${r.id}`,
        })),
      });
    } catch {
      return c.json({ success: true, data: [] });
    }
  });

  app.get('/api/media/:id', auth, async (c) => {
    const mid = c.req.param('id');
    const row = await c.env.DB.prepare(
      'SELECT storage_key, content_type, file_name FROM media_attachments WHERE id = ?'
    )
      .bind(mid)
      .first<{ storage_key: string; content_type: string; file_name: string }>();
    if (!row) return jsonError(c, 404, 'Media not found');
    if (!c.env.MEDIA) return jsonError(c, 503, 'Media storage is not configured');
    const obj = await c.env.MEDIA.get(row.storage_key);
    if (!obj) return jsonError(c, 404, 'File missing from storage');
    const headers = new Headers();
    headers.set('Content-Type', row.content_type || obj.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Cache-Control', 'private, max-age=3600');
    if (row.file_name) headers.set('Content-Disposition', `inline; filename="${row.file_name.replace(/"/g, '')}"`);
    return new Response(obj.body, { headers });
  });

  app.delete('/api/media/:id', auth, requirePerm('incidents:write'), async (c) => {
    const mid = c.req.param('id');
    const row = await c.env.DB.prepare('SELECT storage_key, incident_id FROM media_attachments WHERE id = ?')
      .bind(mid)
      .first<{ storage_key: string; incident_id: string | null }>();
    if (!row) return jsonError(c, 404, 'Media not found');
    if (c.env.MEDIA) {
      try {
        await c.env.MEDIA.delete(row.storage_key);
      } catch {
        /* ignore */
      }
    }
    await c.env.DB.prepare('DELETE FROM media_attachments WHERE id = ?').bind(mid).run();
    if (row.incident_id) {
      await logActivity(c.env.DB, row.incident_id, 'Media removed', mid, c.get('user').userId);
    }
    return c.json({ success: true });
  });

  app.post('/api/facilities', auth, requirePerm('settings:manage'), async (c) => {
    const body = await c.req.json<{ name?: string; category?: string; lat?: number; lng?: number }>();
    if (!body.name || !body.category || body.lat == null || body.lng == null) return jsonError(c, 400, 'name, category, lat, lng required');
    const fid = id();
    await c.env.DB.prepare('INSERT INTO facilities (id, name, category, lat, lng) VALUES (?, ?, ?, ?, ?)')
      .bind(fid, sanitizeText(body.name, 120), sanitizeText(body.category, 80), body.lat, body.lng)
      .run();
    await audit(c.env.DB, c.get('user').userId, c.get('user').role, 'FACILITY_CREATED', 'Facility', fid);
    return c.json({ success: true, data: { id: fid } }, 201);
  });

  app.post('/api/sos/guest', async (c) => {
    const body = await c.req.json<{
      callerName?: string;
      callerPhone?: string;
      incidentTypeId?: string;
      description?: string;
      latitude?: number;
      longitude?: number;
      addressText?: string;
      landmark?: string;
    }>();
    const phone = normalizePhPhone(body.callerPhone ?? '');
    if (!phone) return jsonError(c, 400, 'Valid callback number required for guest SOS');
    if (!body.incidentTypeId || body.latitude == null || body.longitude == null) {
      return jsonError(c, 400, 'incidentTypeId and location required');
    }
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const ipHash = Array.from(new TextEncoder().encode(ip))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32);
    try {
      const rate = await c.env.DB.prepare('SELECT count, window_start as windowStart FROM guest_sos_rate WHERE ip_hash = ?')
        .bind(ipHash)
        .first<{ count: number; windowStart: string }>();
      const windowStart = rate?.windowStart ? Date.parse(rate.windowStart) : 0;
      if (rate && Date.now() - windowStart < 15 * 60_000 && rate.count >= 5) {
        return jsonError(c, 429, 'Too many guest SOS attempts — please call the barangay hotline');
      }
      if (!rate || Date.now() - windowStart >= 15 * 60_000) {
        await c.env.DB.prepare(
          `INSERT INTO guest_sos_rate (ip_hash, window_start, count) VALUES (?, datetime('now'), 1)
           ON CONFLICT(ip_hash) DO UPDATE SET window_start = datetime('now'), count = 1`
        )
          .bind(ipHash)
          .run();
      } else {
        await c.env.DB.prepare('UPDATE guest_sos_rate SET count = count + 1 WHERE ip_hash = ?').bind(ipHash).run();
      }
    } catch {
      /* rate table may be missing until migrate */
    }

    const locationId = id();
    const incidentId = id();
    const sosId = id();
    const displayId = await nextDisplayId(c.env.DB, 'INC');
    const sosDisplayId = await nextDisplayId(c.env.DB, 'SOS');
    await c.env.DB.prepare(
      'INSERT INTO locations (id, latitude, longitude, address_text, landmark) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(locationId, body.latitude, body.longitude, sanitizeText(body.addressText, 300) || null, sanitizeText(body.landmark, 200) || null)
      .run();
    const systemUser =
      (await c.env.DB.prepare("SELECT id FROM users WHERE email LIKE '%admin%' LIMIT 1").first<{ id: string }>())?.id ||
      (await c.env.DB.prepare('SELECT id FROM users LIMIT 1').first<{ id: string }>())?.id;
    if (!systemUser) return jsonError(c, 503, 'System not ready for guest SOS');
    await c.env.DB.prepare(
      `INSERT INTO incidents (id, display_id, reported_by_user_id, incident_type_id, location_id, description, priority_level, status, caller_name, caller_phone)
       VALUES (?, ?, ?, ?, ?, ?, 'High', 'Pending Verification', ?, ?)`
    )
      .bind(
        incidentId,
        displayId,
        systemUser,
        body.incidentTypeId,
        locationId,
        `[GUEST/UNVERIFIED] ${sanitizeText(body.description, 1000) || 'Emergency'}`,
        sanitizeText(body.callerName, 120) || 'Guest',
        phone
      )
      .run();
    const citizenId = (await c.env.DB.prepare('SELECT id FROM citizens LIMIT 1').first<{ id: string }>())?.id;
    if (citizenId) {
      await c.env.DB.prepare(
        `INSERT INTO sos_requests (id, display_id, incident_id, citizen_id, status, trigger_time, auto_location_flag)
         VALUES (?, ?, ?, ?, 'Pending', datetime('now'), 1)`
      )
        .bind(sosId, sosDisplayId, incidentId, citizenId)
        .run();
    }
    await logActivity(c.env.DB, incidentId, 'Guest SOS received', 'Unverified queue — callback validation required', 'system');
    await audit(c.env.DB, 'system', 'GUEST', 'GUEST_SOS', 'Incident', incidentId);
    return c.json({
      success: true,
      data: {
        displayId: sosDisplayId || displayId,
        incidentDisplayId: displayId,
        status: 'Unverified',
        message: 'Report queued for dispatcher verification. Keep your phone available for callback.',
      },
    }, 201);
  });

  app.get('/api/map/facilities', auth, requirePerm('map:monitor'), async (c) => {
    let rows: { id: string; name: string; category: string; lat: number; lng: number }[] = [];
    try {
      const q = await c.env.DB.prepare('SELECT id, name, category, lat, lng FROM facilities').all<{
        id: string;
        name: string;
        category: string;
        lat: number;
        lng: number;
      }>();
      rows = q.results;
    } catch {
      rows = [];
    }
    return c.json({ success: true, data: rows.length ? rows : STATIC_FACILITIES });
  });
}

const INCIDENT_GEO = `
  SELECT i.*, l.latitude, l.longitude
  FROM incidents i JOIN locations l ON l.id = i.location_id
`;

async function findDuplicates(
  db: D1Database,
  opts: { lat: number; lng: number; typeId: string; reporterId: string; description: string; excludeId?: string }
) {
  const { results } = await db
    .prepare(
      `${INCIDENT_GEO}
       WHERE i.status NOT IN ('Closed', 'Cancelled', 'False Alarm', 'Duplicate')
         AND i.reported_at > datetime('now', '-2 hours')
         AND (? IS NULL OR i.id != ?)`
    )
    .bind(opts.excludeId ?? null, opts.excludeId ?? 'none')
    .all<Record<string, unknown>>();
  return results
    .map((r) => {
      const distanceKm = haversineKm(opts.lat, opts.lng, num(r.latitude), num(r.longitude));
      const sameType = r.incident_type_id === opts.typeId;
      const sameReporter = r.reported_by_user_id === opts.reporterId;
      const desc = String(r.description ?? '').toLowerCase();
      const other = opts.description.toLowerCase();
      const similarText = other.length > 8 && desc.length > 8 && (desc.includes(other.slice(0, 12)) || other.includes(desc.slice(0, 12)));
      const score = (distanceKm < 0.25 ? 3 : distanceKm < 0.6 ? 1 : 0) + (sameType ? 2 : 0) + (sameReporter ? 1 : 0) + (similarText ? 1 : 0);
      return {
        _id: r.id,
        displayId: r.display_id,
        status: r.status,
        distanceKm: Math.round(distanceKm * 1000) / 1000,
        score,
      };
    })
    .filter((r) => r.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

