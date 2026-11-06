import { Types } from 'mongoose';
import { ActivityLog } from '../models/index.js';
import { emitToIncident, emitToDispatch } from '../sockets/index.js';

export async function logActivity(params: {
  incidentId: Types.ObjectId | string;
  actorUserId?: Types.ObjectId | string;
  action: string;
  details?: string;
  metadata?: Record<string, unknown>;
  isSystemGenerated?: boolean;
}): Promise<void> {
  const entry = await ActivityLog.create({
    incidentId: params.incidentId,
    actorUserId: params.actorUserId,
    action: params.action,
    details: params.details,
    metadata: params.metadata,
    isSystemGenerated: params.isSystemGenerated ?? !params.actorUserId,
  });

  const payload = { incidentId: String(params.incidentId), entry };
  emitToIncident(String(params.incidentId), 'timeline:update', payload);
  emitToDispatch('timeline:update', payload);
}
