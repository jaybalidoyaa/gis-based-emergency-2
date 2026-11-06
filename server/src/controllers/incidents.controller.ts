import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/index.js';
import {
  Incident,
  Location,
  IncidentType,
  ActivityLog,
  Assignment,
  Responder,
  Vehicle,
  User,
} from '../models/index.js';
import { generateDisplayId, haversineKm, paramId } from '../utils/index.js';
import { updateIncidentStatus } from '../services/incident.service.js';
import { logActivity } from '../services/timeline.service.js';
import { createNotification } from '../services/notification.service.js';
import { logAudit } from '../services/audit.service.js';
import { emitToDispatch, emitToIncident, emitToUser } from '../sockets/index.js';

const listQuerySchema = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
  type: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(20),
});

export async function listIncidents(req: AuthRequest, res: Response): Promise<void> {
  const query = listQuerySchema.parse(req.query);
  const filter: Record<string, unknown> = {};

  if (query.status && query.status !== 'All') {
    if (query.status === 'Open') filter.status = { $in: ['Open', 'Assigned', 'Verified'] };
    else if (query.status === 'Ongoing') filter.status = { $in: ['En Route', 'On Scene', 'Transporting', 'In Progress', 'Assigned'] };
    else if (query.status === 'Resolved') filter.status = 'Resolved';
    else if (query.status === 'Closed') filter.status = { $in: ['Closed', 'False Alarm'] };
    else filter.status = query.status;
  }
  if (query.priority) filter.priorityLevel = query.priority;
  if (query.search) {
    filter.$or = [
      { displayId: { $regex: query.search, $options: 'i' } },
      { description: { $regex: query.search, $options: 'i' } },
    ];
  }

  const skip = (query.page - 1) * query.limit;
  const [incidents, total] = await Promise.all([
    Incident.find(filter)
      .populate('incidentTypeId', 'typeName')
      .populate('locationId')
      .populate('reportedByUserId', 'fullName contactNumber email')
      .sort({ reportedAt: -1 })
      .skip(skip)
      .limit(query.limit)
      .lean(),
    Incident.countDocuments(filter),
  ]);

  res.json({ success: true, data: { incidents, total, page: query.page, limit: query.limit } });
}

export async function getIncident(req: AuthRequest, res: Response): Promise<void> {
  const incident = await Incident.findById(req.params.id)
    .populate('incidentTypeId')
    .populate('locationId')
    .populate('reportedByUserId', 'fullName contactNumber email')
    .populate('dispatcherId', 'fullName')
    .populate('departmentId', 'name code')
    .lean();

  if (!incident) {
    res.status(404).json({ success: false, message: 'Incident not found' });
    return;
  }

  const [assignments, timeline] = await Promise.all([
    Assignment.find({ incidentId: incident._id })
      .populate({ path: 'responderId', populate: { path: 'userId', select: 'fullName contactNumber' } })
      .populate('vehicleId', 'unitNo vehicleType')
      .lean(),
    ActivityLog.find({ incidentId: incident._id }).sort({ createdAt: 1 }).lean(),
  ]);

  res.json({ success: true, data: { ...incident, assignments, timeline } });
}

export async function verifyIncident(req: AuthRequest, res: Response): Promise<void> {
  const { priority, departmentId, incidentTypeId } = req.body as {
    priority?: string;
    departmentId?: string;
    incidentTypeId?: string;
  };

  const incident = await Incident.findById(req.params.id);
  if (!incident) {
    res.status(404).json({ success: false, message: 'Incident not found' });
    return;
  }

  if (priority) incident.priorityLevel = priority;
  if (departmentId) incident.departmentId = departmentId as never;
  if (incidentTypeId) incident.incidentTypeId = incidentTypeId as never;
  incident.dispatcherId = req.user!.userId as never;
  await incident.save();

  const updated = await updateIncidentStatus(String(incident._id), 'Verified', req.user!.userId);
  await updateIncidentStatus(String(incident._id), 'Open', req.user!.userId);

  await logAudit({
    actorUserId: req.user!.userId,
    actorRole: req.user!.role,
    action: 'INCIDENT_VERIFIED',
    resourceType: 'Incident',
    resourceId: incident.displayId,
    afterValue: { status: 'Open', priority: incident.priorityLevel },
  });

  emitToDispatch('incident:verified', updated);
  emitToIncident(String(incident._id), 'incident:updated', updated);

  res.json({ success: true, data: updated });
}

export async function falseAlarm(req: AuthRequest, res: Response): Promise<void> {
  const { reason } = req.body as { reason?: string };
  const id = paramId(req.params.id);
  const incident = await updateIncidentStatus(id, 'False Alarm', req.user!.userId);
  await updateIncidentStatus(id, 'Closed', req.user!.userId);

  await logActivity({
    incidentId: incident._id,
    actorUserId: req.user!.userId,
    action: 'Marked False Alarm',
    details: reason ?? 'Dispatcher marked as false alarm',
  });

  res.json({ success: true, data: incident });
}

export async function updateStatus(req: AuthRequest, res: Response): Promise<void> {
  const { status } = req.body as { status: string };
  if (!status) {
    res.status(400).json({ success: false, message: 'Status required' });
    return;
  }

  try {
    const incident = await updateIncidentStatus(paramId(req.params.id), status, req.user!.userId);
    emitToDispatch('incident:status', incident);
    emitToIncident(String(incident._id), 'incident:status', incident);
    res.json({ success: true, data: incident });
  } catch (err) {
    res.status(400).json({ success: false, message: err instanceof Error ? err.message : 'Update failed' });
  }
}

export async function assignUnit(req: AuthRequest, res: Response): Promise<void> {
  const { responderId, vehicleId } = req.body as { responderId: string; vehicleId?: string };
  if (!responderId) {
    res.status(400).json({ success: false, message: 'responderId required' });
    return;
  }

  const incident = await Incident.findById(req.params.id);
  if (!incident || incident.isLocked) {
    res.status(400).json({ success: false, message: 'Incident not available for assignment' });
    return;
  }

  const responder = await Responder.findById(responderId).populate('userId');
  if (!responder) {
    res.status(404).json({ success: false, message: 'Responder not found' });
    return;
  }

  const assignment = await Assignment.create({
    incidentId: incident._id,
    responderId,
    vehicleId,
    assignedByDispatcherId: req.user!.userId,
    assignmentStatus: 'Assigned',
  });

  if (incident.status === 'Open' || incident.status === 'Verified') {
    await updateIncidentStatus(String(incident._id), 'Assigned', req.user!.userId);
  }

  responder.availabilityStatus = 'Dispatched';
  responder.operationalStatus = 'Dispatched';
  await responder.save();

  if (vehicleId) {
    await Vehicle.findByIdAndUpdate(vehicleId, { status: 'Deployed' });
  }

  const user = responder.userId as unknown as { _id: string; fullName: string };
  await logActivity({
    incidentId: incident._id,
    actorUserId: req.user!.userId,
    action: 'Unit Assigned',
    details: `${user?.fullName ?? 'Responder'} assigned to incident`,
    metadata: { assignmentId: assignment._id, responderId },
  });

  const responderUserId = (responder.userId as unknown as { _id: string })._id;
  await createNotification({
    recipientUserId: responderUserId,
    incidentId: incident._id,
    type: 'Dispatch Assignment',
    priority: incident.priorityLevel === 'Critical' ? 'Urgent' : 'Important',
    title: 'New Dispatch Assignment',
    message: `You have been assigned to ${incident.displayId}`,
  });

  emitToDispatch('incident:assigned', { incident, assignment });
  emitToUser(String(responderUserId), 'assignment:new', { incident, assignment });

  res.json({ success: true, data: assignment });
}

export async function getNearestUnits(req: AuthRequest, res: Response): Promise<void> {
  const incident = await Incident.findById(req.params.id).populate('locationId');
  if (!incident) {
    res.status(404).json({ success: false, message: 'Incident not found' });
    return;
  }

  const loc = incident.locationId as unknown as { latitude: number; longitude: number };
  const responders = await Responder.find({ availabilityStatus: 'Available' })
    .populate('userId', 'fullName')
    .populate('departmentId', 'name code')
    .lean();

  const withDistance = responders
    .filter((r) => r.currentLocation?.latitude)
    .map((r) => ({
      ...r,
      distanceKm: haversineKm(
        loc.latitude,
        loc.longitude,
        r.currentLocation!.latitude,
        r.currentLocation!.longitude
      ),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 10);

  res.json({ success: true, data: withDistance });
}

export async function getTimeline(req: AuthRequest, res: Response): Promise<void> {
  const timeline = await ActivityLog.find({ incidentId: req.params.id })
    .populate('actorUserId', 'fullName')
    .sort({ createdAt: 1 })
    .lean();
  res.json({ success: true, data: timeline });
}

export async function addNote(req: AuthRequest, res: Response): Promise<void> {
  const { note } = req.body as { note: string };
  if (!note?.trim()) {
    res.status(400).json({ success: false, message: 'Note required' });
    return;
  }

  const incident = await Incident.findById(req.params.id);
  if (!incident || incident.isLocked) {
    res.status(400).json({ success: false, message: 'Cannot add note to locked incident' });
    return;
  }

  await logActivity({
    incidentId: incident._id,
    actorUserId: req.user!.userId,
    action: 'Note Added',
    details: note,
  });

  res.json({ success: true, message: 'Note added' });
}

export async function getIncidentTypes(_req: AuthRequest, res: Response): Promise<void> {
  const types = await IncidentType.find({ isActive: true }).lean();
  res.json({ success: true, data: types });
}

export async function createIncident(req: AuthRequest, res: Response): Promise<void> {
  const schema = z.object({
    incidentTypeId: z.string(),
    description: z.string().default(''),
    priorityLevel: z.string().default('Medium'),
    latitude: z.number(),
    longitude: z.number(),
    addressText: z.string().optional(),
    landmark: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.errors[0]?.message });
    return;
  }

  const location = await Location.create({
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    addressText: parsed.data.addressText,
    landmark: parsed.data.landmark,
  });

  const displayId = await generateDisplayId('INC');
  const incident = await Incident.create({
    displayId,
    reportedByUserId: req.user!.userId,
    incidentTypeId: parsed.data.incidentTypeId,
    locationId: location._id,
    description: parsed.data.description,
    priorityLevel: parsed.data.priorityLevel,
    status: 'Pending Verification',
  });

  await logActivity({
    incidentId: incident._id,
    action: 'Incident Reported',
    details: 'Incident created',
    isSystemGenerated: true,
  });

  emitToDispatch('incident:created', incident);
  res.status(201).json({ success: true, data: incident });
}
