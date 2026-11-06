/**
 * Assignment / fleet lifecycle helpers for terminal incident transitions.
 * Keeps responders and vehicles consistent when an incident ends.
 */

export const TERMINAL_INCIDENT_STATUSES = [
  'Cancelled',
  'Closed',
  'False Alarm',
  'Duplicate',
  'Resolved',
] as const;

export type TerminalIncidentStatus = (typeof TERMINAL_INCIDENT_STATUSES)[number];

export function isTerminalIncidentStatus(status: string | null | undefined): boolean {
  return !!status && (TERMINAL_INCIDENT_STATUSES as readonly string[]).includes(status);
}

const OPEN_ASSIGNMENT_SQL = `assignment_status NOT IN ('Completed', 'Rejected', 'Declined', 'Cancelled')`;

/**
 * Cancel open assignments for an incident and free linked responders/vehicles
 * that have no other active assignment on a non-terminal incident.
 */
export async function releaseAssignmentsForIncident(
  db: D1Database,
  incidentId: string,
  opts?: { reason?: string; actorUserId?: string }
): Promise<{ cancelledAssignments: number; freedResponders: number; freedVehicles: number }> {
  const open = await db
    .prepare(
      `SELECT id, responder_id as responderId, vehicle_id as vehicleId
       FROM assignments
       WHERE incident_id = ? AND ${OPEN_ASSIGNMENT_SQL}`
    )
    .bind(incidentId)
    .all<{ id: string; responderId: string | null; vehicleId: string | null }>();

  const rows = open.results ?? [];
  if (!rows.length) {
    return { cancelledAssignments: 0, freedResponders: 0, freedVehicles: 0 };
  }

  await db
    .prepare(
      `UPDATE assignments SET assignment_status = 'Cancelled'
       WHERE incident_id = ? AND ${OPEN_ASSIGNMENT_SQL}`
    )
    .bind(incidentId)
    .run();

  const responderIds = [...new Set(rows.map((r) => r.responderId).filter(Boolean))] as string[];
  const vehicleIds = [...new Set(rows.map((r) => r.vehicleId).filter(Boolean))] as string[];

  let freedResponders = 0;
  for (const responderId of responderIds) {
    const stillBusy = await db
      .prepare(
        `SELECT a.id FROM assignments a
         JOIN incidents i ON i.id = a.incident_id
         WHERE a.responder_id = ?
           AND a.assignment_status NOT IN ('Completed', 'Rejected', 'Declined', 'Cancelled')
           AND i.status NOT IN ('Cancelled', 'Closed', 'False Alarm', 'Duplicate', 'Resolved')
         LIMIT 1`
      )
      .bind(responderId)
      .first();
    if (stillBusy) continue;
    await db
      .prepare(
        `UPDATE responders SET availability_status = 'Available', operational_status = 'Available' WHERE id = ?`
      )
      .bind(responderId)
      .run();
    freedResponders += 1;
  }

  let freedVehicles = 0;
  for (const vehicleId of vehicleIds) {
    const stillBusy = await db
      .prepare(
        `SELECT a.id FROM assignments a
         JOIN incidents i ON i.id = a.incident_id
         WHERE a.vehicle_id = ?
           AND a.assignment_status NOT IN ('Completed', 'Rejected', 'Declined', 'Cancelled')
           AND i.status NOT IN ('Cancelled', 'Closed', 'False Alarm', 'Duplicate', 'Resolved')
         LIMIT 1`
      )
      .bind(vehicleId)
      .first();
    if (stillBusy) continue;
    try {
      await db
        .prepare(`UPDATE vehicles SET status = 'Ready', out_of_service_reason = NULL WHERE id = ? AND status != 'Out of Service'`)
        .bind(vehicleId)
        .run();
    } catch {
      await db.prepare(`UPDATE vehicles SET status = 'Ready' WHERE id = ?`).bind(vehicleId).run();
    }
    freedVehicles += 1;
  }

  void opts;
  return { cancelledAssignments: rows.length, freedResponders, freedVehicles };
}

/** Sync vehicle row when a responder assignment advances (best-effort via callsign match). */
export async function syncVehicleForAssignmentStatus(
  db: D1Database,
  assignmentId: string,
  assignmentStatus: string
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT a.vehicle_id as vehicleId, r.callsign
       FROM assignments a
       LEFT JOIN responders r ON r.id = a.responder_id
       WHERE a.id = ?`
    )
    .bind(assignmentId)
    .first<{ vehicleId: string | null; callsign: string | null }>();
  if (!row) return;

  let vehicleId = row.vehicleId;
  if (!vehicleId && row.callsign) {
    const matched = await db
      .prepare(`SELECT id FROM vehicles WHERE upper(replace(unit_no, ' ', '')) = upper(replace(?, ' ', '')) LIMIT 1`)
      .bind(row.callsign)
      .first<{ id: string }>();
    vehicleId = matched?.id ?? null;
    if (vehicleId) {
      await db.prepare(`UPDATE assignments SET vehicle_id = ? WHERE id = ? AND vehicle_id IS NULL`).bind(vehicleId, assignmentId).run();
    }
  }
  if (!vehicleId) return;

  if (assignmentStatus === 'Completed' || assignmentStatus === 'Cancelled' || assignmentStatus === 'Rejected' || assignmentStatus === 'Declined') {
    const stillBusy = await db
      .prepare(
        `SELECT a.id FROM assignments a
         JOIN incidents i ON i.id = a.incident_id
         WHERE a.vehicle_id = ?
           AND a.assignment_status NOT IN ('Completed', 'Rejected', 'Declined', 'Cancelled')
           AND i.status NOT IN ('Cancelled', 'Closed', 'False Alarm', 'Duplicate', 'Resolved')
         LIMIT 1`
      )
      .bind(vehicleId)
      .first();
    if (!stillBusy) {
      try {
        await db
          .prepare(`UPDATE vehicles SET status = 'Ready', out_of_service_reason = NULL WHERE id = ? AND status != 'Out of Service'`)
          .bind(vehicleId)
          .run();
      } catch {
        await db.prepare(`UPDATE vehicles SET status = 'Ready' WHERE id = ?`).bind(vehicleId).run();
      }
    }
    return;
  }

  const vehicleStatus =
    assignmentStatus === 'Accepted' || assignmentStatus === 'En Route'
      ? 'En Route'
      : assignmentStatus === 'On Scene'
        ? 'On Scene'
        : 'Assigned';
  await db.prepare(`UPDATE vehicles SET status = ? WHERE id = ? AND status != 'Out of Service'`).bind(vehicleStatus, vehicleId).run();
}
