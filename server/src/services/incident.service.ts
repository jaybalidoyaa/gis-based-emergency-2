import { INCIDENT_TRANSITIONS, IncidentStatus } from '../constants/index.js';
import { Incident } from '../models/index.js';
import { logActivity } from './timeline.service.js';

export function canTransition(from: string, to: string): boolean {
  const allowed = INCIDENT_TRANSITIONS[from as IncidentStatus];
  return allowed?.includes(to as IncidentStatus) ?? false;
}

export async function updateIncidentStatus(
  incidentId: string,
  newStatus: string,
  actorUserId?: string
): Promise<typeof Incident.prototype> {
  const incident = await Incident.findById(incidentId);
  if (!incident) throw new Error('Incident not found');
  if (incident.isLocked) throw new Error('Incident is locked and cannot be modified');

  if (!canTransition(incident.status, newStatus)) {
    throw new Error(`Invalid status transition from "${incident.status}" to "${newStatus}"`);
  }

  const before = incident.status;
  incident.status = newStatus;

  if (newStatus === 'Verified') incident.verifiedAt = new Date();
  if (newStatus === 'Resolved') incident.resolvedAt = new Date();
  if (newStatus === 'Closed') {
    incident.closedAt = new Date();
    incident.isLocked = true;
  }

  await incident.save();

  await logActivity({
    incidentId: incident._id,
    actorUserId,
    action: `Status Changed to ${newStatus}`,
    details: `Status updated from ${before} to ${newStatus}`,
    metadata: { from: before, to: newStatus },
  });

  return incident;
}
