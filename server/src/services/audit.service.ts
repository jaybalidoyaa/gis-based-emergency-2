import { Types } from 'mongoose';
import { AuditLog } from '../models/index.js';

export async function logAudit(params: {
  actorUserId: Types.ObjectId | string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  beforeValue?: Record<string, unknown>;
  afterValue?: Record<string, unknown>;
  ipAddress?: string;
}): Promise<void> {
  await AuditLog.create(params);
}
