import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/index.js';
import {
  SOSRequest,
  Incident,
  Location,
  Citizen,
  IncidentType,
  User,
} from '../models/index.js';
import { generateDisplayId } from '../utils/index.js';
import { logActivity } from '../services/timeline.service.js';
import { createNotification } from '../services/notification.service.js';
import { emitToDispatch } from '../sockets/index.js';
import { ROLES } from '../constants/index.js';

const sosSchema = z.object({
  incidentTypeId: z.string(),
  description: z.string().default(''),
  priorityLevel: z.string().default('High'),
  latitude: z.number(),
  longitude: z.number(),
  addressText: z.string().optional(),
  landmark: z.string().optional(),
  autoLocationFlag: z.boolean().default(true),
});

export async function createSOS(req: AuthRequest, res: Response): Promise<void> {
  const parsed = sosSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.errors[0]?.message });
    return;
  }

  const citizen = await Citizen.findOne({ userId: req.user!.userId });
  if (!citizen) {
    res.status(403).json({ success: false, message: 'Citizen profile required' });
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

  const sosDisplayId = await generateDisplayId('SOS');
  const sos = await SOSRequest.create({
    displayId: sosDisplayId,
    incidentId: incident._id,
    citizenId: citizen._id,
    autoLocationFlag: parsed.data.autoLocationFlag,
    status: 'Pending',
  });

  await logActivity({
    incidentId: incident._id,
    actorUserId: req.user!.userId,
    action: 'SOS Received',
    details: 'Citizen SOS emergency request submitted',
  });

  const dispatchers = await User.find({ status: 'active' }).populate('roleId');
  for (const d of dispatchers) {
    const role = d.roleId as unknown as { name: string };
    if ([ROLES.CENTRAL_DISPATCHER, ROLES.DEPARTMENT_DISPATCHER, ROLES.SYSTEM_ADMINISTRATOR].includes(role.name as never)) {
      await createNotification({
        recipientUserId: d._id,
        incidentId: incident._id,
        type: 'Emergency/SOS',
        priority: 'Urgent',
        title: 'New SOS Alert',
        message: `${sosDisplayId} — ${parsed.data.description || 'Emergency reported'}`,
      });
    }
  }

  emitToDispatch('sos:new', { sos, incident, location });
  res.status(201).json({ success: true, data: { sos, incident } });
}

export async function listSOS(req: AuthRequest, res: Response): Promise<void> {
  const { status } = req.query as { status?: string };
  const filter: Record<string, unknown> = {};
  if (status && status !== 'All') filter.status = status;

  const reports = await SOSRequest.find(filter)
    .populate({
      path: 'incidentId',
      populate: [
        { path: 'incidentTypeId', select: 'typeName' },
        { path: 'locationId' },
        { path: 'reportedByUserId', select: 'fullName contactNumber email' },
      ],
    })
    .populate({ path: 'citizenId', populate: { path: 'userId', select: 'fullName contactNumber email' } })
    .sort({ triggerTime: -1 })
    .lean();

  res.json({ success: true, data: reports });
}

export async function getSOS(req: AuthRequest, res: Response): Promise<void> {
  const sos = await SOSRequest.findById(req.params.id)
    .populate({
      path: 'incidentId',
      populate: ['incidentTypeId', 'locationId', 'reportedByUserId'],
    })
    .populate({ path: 'citizenId', populate: { path: 'userId' } })
    .lean();

  if (!sos) {
    res.status(404).json({ success: false, message: 'SOS not found' });
    return;
  }
  res.json({ success: true, data: sos });
}

export async function getCitizenSOSStatus(req: AuthRequest, res: Response): Promise<void> {
  const citizen = await Citizen.findOne({ userId: req.user!.userId });
  if (!citizen) {
    res.status(404).json({ success: false, message: 'Citizen not found' });
    return;
  }

  const latest = await SOSRequest.findOne({ citizenId: citizen._id })
    .populate({ path: 'incidentId', populate: ['incidentTypeId', 'locationId'] })
    .sort({ triggerTime: -1 })
    .lean();

  res.json({ success: true, data: latest });
}

export async function getIncidentTypesPublic(_req: AuthRequest, res: Response): Promise<void> {
  const types = await IncidentType.find({ isActive: true }).select('typeName _id').lean();
  res.json({ success: true, data: types });
}
