import { Response } from 'express';
import { AuthRequest } from '../middleware/index.js';
import {
  Assignment,
  Incident,
  Responder,
  Vehicle,
  User,
} from '../models/index.js';
import { updateIncidentStatus } from '../services/incident.service.js';
import { logActivity } from '../services/timeline.service.js';
import { createNotification } from '../services/notification.service.js';
import { emitToDispatch, emitToIncident } from '../sockets/index.js';
import { config } from '../config/index.js';
import { isGpsStale } from '../utils/index.js';

export async function acceptAssignment(req: AuthRequest, res: Response): Promise<void> {
  const assignment = await Assignment.findById(req.params.id).populate('incidentId');
  if (!assignment) {
    res.status(404).json({ success: false, message: 'Assignment not found' });
    return;
  }

  const responder = await Responder.findOne({ userId: req.user!.userId });
  if (!responder || String(assignment.responderId) !== String(responder._id)) {
    res.status(403).json({ success: false, message: 'Not authorized' });
    return;
  }

  assignment.assignmentStatus = 'Accepted';
  assignment.acceptedAt = new Date();
  await assignment.save();

  responder.operationalStatus = 'En Route';
  responder.availabilityStatus = 'En Route';
  await responder.save();

  const incident = assignment.incidentId as unknown as { _id: string; displayId: string; dispatcherId?: string };
  await updateIncidentStatus(String(incident._id), 'En Route', req.user!.userId);

  await logActivity({
    incidentId: incident._id,
    actorUserId: req.user!.userId,
    action: 'Assignment Accepted',
    details: 'Responder accepted dispatch assignment',
  });

  emitToDispatch('assignment:accepted', { assignment, incident });
  res.json({ success: true, data: assignment });
}

export async function rejectAssignment(req: AuthRequest, res: Response): Promise<void> {
  const assignment = await Assignment.findById(req.params.id);
  if (!assignment) {
    res.status(404).json({ success: false, message: 'Assignment not found' });
    return;
  }

  const responder = await Responder.findOne({ userId: req.user!.userId });
  if (!responder || String(assignment.responderId) !== String(responder._id)) {
    res.status(403).json({ success: false, message: 'Not authorized' });
    return;
  }

  assignment.assignmentStatus = 'Rejected';
  await assignment.save();

  responder.availabilityStatus = 'Available';
  responder.operationalStatus = 'Available';
  await responder.save();

  res.json({ success: true, data: assignment });
}

export async function updateAssignmentStatus(req: AuthRequest, res: Response): Promise<void> {
  const { status } = req.body as { status: string };
  const assignment = await Assignment.findById(req.params.id);
  if (!assignment) {
    res.status(404).json({ success: false, message: 'Assignment not found' });
    return;
  }

  assignment.assignmentStatus = status;
  await assignment.save();

  const responder = await Responder.findById(assignment.responderId);
  if (responder) {
    responder.operationalStatus = status;
    if (status === 'On Scene') responder.availabilityStatus = 'On Scene';
    if (status === 'Completed') {
      responder.availabilityStatus = 'Available';
      responder.operationalStatus = 'Available';
    }
    await responder.save();
  }

  const statusMap: Record<string, string> = {
    'En Route': 'En Route',
    'On Scene': 'On Scene',
    Completed: 'Resolved',
  };

  if (statusMap[status]) {
    try {
      await updateIncidentStatus(String(assignment.incidentId), statusMap[status], req.user!.userId);
    } catch {
      // incident may already be in target state
    }
  }

  await logActivity({
    incidentId: assignment.incidentId,
    actorUserId: req.user!.userId,
    action: `Unit ${status}`,
    details: `Assignment status updated to ${status}`,
  });

  emitToDispatch('assignment:status', assignment);
  res.json({ success: true, data: assignment });
}

export async function getMyAssignments(req: AuthRequest, res: Response): Promise<void> {
  const responder = await Responder.findOne({ userId: req.user!.userId });
  if (!responder) {
    res.json({ success: true, data: [] });
    return;
  }

  const assignments = await Assignment.find({
    responderId: responder._id,
    assignmentStatus: { $nin: ['Completed', 'Rejected'] },
  })
    .populate({
      path: 'incidentId',
      populate: ['incidentTypeId', 'locationId'],
    })
    .sort({ assignedAt: -1 })
    .lean();

  res.json({ success: true, data: assignments });
}

export async function updateResponderStatus(req: AuthRequest, res: Response): Promise<void> {
  const { status } = req.body as { status: string };
  const responder = await Responder.findOne({ userId: req.user!.userId });
  if (!responder) {
    res.status(404).json({ success: false, message: 'Responder profile not found' });
    return;
  }

  responder.operationalStatus = status;
  responder.availabilityStatus = status;
  await responder.save();

  emitToDispatch('responder:status', responder);
  res.json({ success: true, data: responder });
}

export async function updateResponderLocation(req: AuthRequest, res: Response): Promise<void> {
  const { latitude, longitude, accuracy } = req.body as {
    latitude: number;
    longitude: number;
    accuracy?: number;
  };

  const responder = await Responder.findOne({ userId: req.user!.userId });
  if (!responder) {
    res.status(404).json({ success: false, message: 'Responder profile not found' });
    return;
  }

  const updatedAt = new Date();
  responder.currentLocation = { latitude, longitude, accuracy, updatedAt };
  await responder.save();

  const vehicle = await Vehicle.findOne({ assignedCrewIds: responder._id });
  if (vehicle) {
    vehicle.currentLocation = { latitude, longitude, accuracy, updatedAt };
    await vehicle.save();
    emitToDispatch('unit:location', { unitNo: vehicle.unitNo, latitude, longitude, updatedAt, stale: false });
  }

  emitToDispatch('responder:location', {
    responderId: responder._id,
    callsign: responder.callsign,
    latitude,
    longitude,
    updatedAt,
    stale: false,
  });

  res.json({ success: true, data: responder.currentLocation });
}

export async function listResponders(_req: AuthRequest, res: Response): Promise<void> {
  const responders = await Responder.find()
    .populate('userId', 'fullName contactNumber email status')
    .populate('departmentId', 'name code')
    .lean();

  const enriched = responders.map((r) => ({
    ...r,
    gpsStale: isGpsStale(r.currentLocation?.updatedAt, config.gpsStaleMinutes),
  }));

  res.json({ success: true, data: enriched });
}

export async function listAvailableResponders(_req: AuthRequest, res: Response): Promise<void> {
  const responders = await Responder.find({ availabilityStatus: 'Available' })
    .populate('userId', 'fullName')
    .populate('departmentId', 'name code')
    .lean();
  res.json({ success: true, data: responders });
}

export async function getDispatchQueue(_req: AuthRequest, res: Response): Promise<void> {
  const [incidents, pendingSos, unitsReady] = await Promise.all([
    Incident.find({ status: { $nin: ['Closed', 'False Alarm', 'Resolved'] } })
      .populate('incidentTypeId', 'typeName')
      .populate('locationId')
      .populate('reportedByUserId', 'fullName contactNumber')
      .sort({ priorityLevel: 1, reportedAt: -1 })
      .lean(),
    import('../models/index.js').then((m) => m.SOSRequest.countDocuments({ status: 'Pending' })),
    Vehicle.countDocuments({ status: 'Ready' }),
  ]);

  const priorityOrder: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  incidents.sort(
    (a, b) => (priorityOrder[a.priorityLevel] ?? 9) - (priorityOrder[b.priorityLevel] ?? 9)
  );

  res.json({
    success: true,
    data: { incidents, pendingSos, unitsReady, liveQueue: incidents.length },
  });
}
