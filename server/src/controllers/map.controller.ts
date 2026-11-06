import { Response } from 'express';
import { AuthRequest } from '../middleware/index.js';
import { Incident, Vehicle, Responder, SOSRequest } from '../models/index.js';
import { Facility } from '../models/extra.js';
import { config } from '../config/index.js';
import { isGpsStale } from '../utils/index.js';

export async function getMapData(_req: AuthRequest, res: Response): Promise<void> {
  const [incidents, sosPending, vehicles, responders, facilities] = await Promise.all([
    Incident.find({ status: { $nin: ['Closed', 'False Alarm'] } })
      .populate('locationId')
      .populate('incidentTypeId', 'typeName')
      .lean(),
    SOSRequest.find({ status: 'Pending' })
      .populate({ path: 'incidentId', populate: { path: 'locationId' } })
      .lean(),
    Vehicle.find().populate('departmentId', 'name code').lean(),
    Responder.find().populate('userId', 'fullName').populate('departmentId', 'code').lean(),
    Facility.find({ isActive: true }).populate('locationId').lean(),
  ]);

  const units = vehicles.map((v) => ({
    ...v,
    gpsStale: isGpsStale(v.currentLocation?.updatedAt, config.gpsStaleMinutes),
  }));

  const responderUnits = responders.map((r) => ({
    ...r,
    gpsStale: isGpsStale(r.currentLocation?.updatedAt, config.gpsStaleMinutes),
  }));

  res.json({
    success: true,
    data: {
      incidents,
      sosPending,
      units,
      responders: responderUnits,
      facilities,
      center: { lat: 14.4785, lng: 121.0435 },
    },
  });
}
