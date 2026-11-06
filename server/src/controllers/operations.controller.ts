import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/index.js';
import {
  TransportSchedule,
  ShiftSchedule,
  Attendance,
  Equipment,
  Notification,
} from '../models/extra.js';
import {
  Vehicle,
  Responder,
  User,
  Role,
  Department,
  Incident,
  AuditLog,
  Location,
} from '../models/index.js';
import { generateDisplayId, haversineKm, paramId } from '../utils/index.js';
import { ROLES } from '../constants/index.js';

// --- Transport ---
export async function listTransports(_req: AuthRequest, res: Response): Promise<void> {
  const schedules = await TransportSchedule.find()
    .populate('originLocationId destinationLocationId vehicleId incidentId')
    .sort({ scheduledDate: -1 })
    .lean();
  res.json({ success: true, data: schedules });
}

export async function createTransport(req: AuthRequest, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown>;
  const origin = await Location.create(body.origin as object);
  const destination = await Location.create(body.destination as object);

  if (body.vehicleId) {
    const conflict = await TransportSchedule.findOne({
      vehicleId: body.vehicleId,
      transportStatus: { $in: ['Scheduled', 'In Progress', 'En Route'] },
      scheduledDate: body.scheduledDate,
    });
    if (conflict) {
      res.status(409).json({
        success: false,
        message: 'Vehicle already has a conflicting transport schedule',
      });
      return;
    }
  }

  const displayId = await generateDisplayId('SCH');
  const schedule = await TransportSchedule.create({
    displayId,
    patientName: body.patientName,
    age: body.age,
    sex: body.sex,
    contactNumber: body.contactNumber,
    vehicleId: body.vehicleId,
    incidentId: body.incidentId,
    originLocationId: origin._id,
    destinationLocationId: destination._id,
    scheduledDate: body.scheduledDate,
    scheduledTime: body.scheduledTime,
    medicalNotes: body.medicalNotes,
    assignedTeam: body.assignedTeam,
    transportStatus: 'Scheduled',
  });

  const distanceKm = haversineKm(
    origin.latitude,
    origin.longitude,
    destination.latitude,
    destination.longitude
  );

  res.status(201).json({
    success: true,
    data: { schedule, route: { distanceKm, estimatedMinutes: Math.round(distanceKm * 3) } },
  });
}

export async function updateTransport(req: AuthRequest, res: Response): Promise<void> {
  const schedule = await TransportSchedule.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json({ success: true, data: schedule });
}

// --- Personnel ---
export async function listPersonnel(_req: AuthRequest, res: Response): Promise<void> {
  const users = await User.find()
    .populate('roleId', 'name')
    .select('-passwordHash -refreshToken')
    .lean();

  const responders = await Responder.find()
    .populate('departmentId', 'name code')
    .lean();

  res.json({ success: true, data: { users, responders } });
}

export async function updatePersonnelStatus(req: AuthRequest, res: Response): Promise<void> {
  const { status } = req.body as { status: string };
  const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true })
    .select('-passwordHash -refreshToken');
  res.json({ success: true, data: user });
}

// --- Attendance ---
export async function listAttendance(req: AuthRequest, res: Response): Promise<void> {
  const { date } = req.query as { date?: string };
  const filter: Record<string, unknown> = {};
  if (date) {
    const d = new Date(date);
    filter.date = { $gte: new Date(d.setHours(0, 0, 0, 0)), $lt: new Date(d.setHours(23, 59, 59, 999)) };
  }
  const records = await Attendance.find(filter)
    .populate({ path: 'responderId', populate: { path: 'userId', select: 'fullName' } })
    .lean();
  res.json({ success: true, data: records });
}

export async function checkIn(req: AuthRequest, res: Response): Promise<void> {
  const responder = await Responder.findOne({ userId: req.user!.userId });
  if (!responder) {
    res.status(404).json({ success: false, message: 'Responder not found' });
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const record = await Attendance.findOneAndUpdate(
    { responderId: responder._id, date: today },
    { checkInTime: new Date(), status: 'On Duty' },
    { upsert: true, new: true }
  );
  res.json({ success: true, data: record });
}

export async function checkOut(req: AuthRequest, res: Response): Promise<void> {
  const responder = await Responder.findOne({ userId: req.user!.userId });
  if (!responder) {
    res.status(404).json({ success: false, message: 'Responder not found' });
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const record = await Attendance.findOneAndUpdate(
    { responderId: responder._id, date: today },
    { checkOutTime: new Date() },
    { new: true }
  );
  res.json({ success: true, data: record });
}

// --- Shifts ---
export async function listShifts(_req: AuthRequest, res: Response): Promise<void> {
  const shifts = await ShiftSchedule.find().sort({ scheduledDate: -1 }).lean();
  res.json({ success: true, data: shifts });
}

export async function createShift(req: AuthRequest, res: Response): Promise<void> {
  const shift = await ShiftSchedule.create(req.body);
  res.status(201).json({ success: true, data: shift });
}

// --- Resources ---
export async function listVehicles(_req: AuthRequest, res: Response): Promise<void> {
  const vehicles = await Vehicle.find().populate('departmentId', 'name code').lean();
  res.json({ success: true, data: vehicles });
}

export async function updateVehicleStatus(req: AuthRequest, res: Response): Promise<void> {
  const { status } = req.body as { status: string };
  const vehicle = await Vehicle.findByIdAndUpdate(req.params.id, { status }, { new: true });
  res.json({ success: true, data: vehicle });
}

export async function listEquipment(_req: AuthRequest, res: Response): Promise<void> {
  const equipment = await Equipment.find().populate('departmentId', 'name').lean();
  res.json({ success: true, data: equipment });
}

export async function updateEquipmentStatus(req: AuthRequest, res: Response): Promise<void> {
  const equipment = await Equipment.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json({ success: true, data: equipment });
}

// --- Notifications ---
export async function listNotifications(req: AuthRequest, res: Response): Promise<void> {
  const notifications = await Notification.find({ recipientUserId: req.user!.userId })
    .sort({ sentAt: -1 })
    .limit(50)
    .lean();
  res.json({ success: true, data: notifications });
}

export async function markNotificationRead(req: AuthRequest, res: Response): Promise<void> {
  await Notification.findByIdAndUpdate(req.params.id, { readAt: new Date() });
  res.json({ success: true });
}

export async function markAllNotificationsRead(req: AuthRequest, res: Response): Promise<void> {
  await Notification.updateMany(
    { recipientUserId: req.user!.userId, readAt: null },
    { readAt: new Date() }
  );
  res.json({ success: true });
}

// --- Reports ---
export async function listReports(req: AuthRequest, res: Response): Promise<void> {
  const { from, to } = req.query as { from?: string; to?: string };
  const filter: Record<string, unknown> = {};
  if (from || to) {
    filter.reportedAt = {};
    if (from) (filter.reportedAt as Record<string, Date>).$gte = new Date(from);
    if (to) (filter.reportedAt as Record<string, Date>).$lte = new Date(to);
  }

  const incidents = await Incident.find(filter)
    .populate('incidentTypeId', 'typeName')
    .populate('locationId')
    .populate('reportedByUserId', 'fullName')
    .sort({ reportedAt: -1 })
    .lean();

  res.json({ success: true, data: incidents });
}

export async function exportReports(req: AuthRequest, res: Response): Promise<void> {
  const { format = 'csv' } = req.query as { format?: string };
  const incidents = await Incident.find()
    .populate('incidentTypeId', 'typeName')
    .populate('reportedByUserId', 'fullName')
    .lean();

  if (format === 'csv') {
    const header = 'ID,Type,Priority,Status,Reported At,Resolved At\n';
    const rows = incidents
      .map((i) => {
        const type = (i.incidentTypeId as unknown as { typeName: string })?.typeName ?? '';
        const reporter = (i.reportedByUserId as unknown as { fullName: string })?.fullName ?? '';
        return `${i.displayId},"${type}",${i.priorityLevel},${i.status},${i.reportedAt},${i.resolvedAt ?? ''}`;
      })
      .join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=incident-report.csv');
    res.send(header + rows);
    return;
  }

  res.json({ success: true, data: incidents });
}

// --- Settings ---
export async function getSettings(_req: AuthRequest, res: Response): Promise<void> {
  const { SystemSetting } = await import('../models/extra.js');
  const settings = await SystemSetting.find().lean();
  const departments = await Department.find().lean();
  const roles = await Role.find().select('name permissions description').lean();
  res.json({ success: true, data: { settings, departments, roles } });
}

export async function getAuditLogs(_req: AuthRequest, res: Response): Promise<void> {
  const logs = await AuditLog.find()
    .populate('actorUserId', 'fullName email')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  res.json({ success: true, data: logs });
}

// --- Chat ---
export async function getChatMessages(req: AuthRequest, res: Response): Promise<void> {
  const { ChatMessage } = await import('../models/extra.js');
  const messages = await ChatMessage.find({ incidentId: req.params.incidentId })
    .populate('senderUserId', 'fullName')
    .sort({ createdAt: 1 })
    .lean();
  res.json({ success: true, data: messages });
}

export async function sendChatMessage(req: AuthRequest, res: Response): Promise<void> {
  const { message, department } = req.body as { message: string; department?: string };
  const { ChatMessage } = await import('../models/extra.js');
  const { emitToIncident } = await import('../sockets/index.js');

  const chatMsg = await ChatMessage.create({
    incidentId: paramId(req.params.incidentId),
    senderUserId: req.user!.userId,
    senderRole: req.user!.role,
    senderDepartment: department,
    message,
  });

  emitToIncident(paramId(req.params.incidentId), 'chat:message', chatMsg);
  res.status(201).json({ success: true, data: chatMsg });
}
