import { Types } from 'mongoose';
import { Notification } from '../models/extra.js';
import { emitToUser, emitToDispatch } from '../sockets/index.js';

export async function createNotification(params: {
  recipientUserId: Types.ObjectId | string;
  incidentId?: Types.ObjectId | string;
  type: string;
  priority: string;
  title: string;
  message: string;
  channel?: string;
}): Promise<void> {
  const notification = await Notification.create({
    recipientUserId: params.recipientUserId,
    incidentId: params.incidentId,
    type: params.type,
    priority: params.priority,
    title: params.title,
    message: params.message,
    channel: params.channel ?? 'in-app',
    deliveryStatus: 'delivered',
    sentAt: new Date(),
  });

  emitToUser(String(params.recipientUserId), 'notification:new', notification);
  emitToDispatch('notification:new', notification);
}
