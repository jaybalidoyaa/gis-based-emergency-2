import { Response } from 'express';
import { AuthRequest } from '../middleware/index.js';
import { Incident, Vehicle, Responder, SOSRequest } from '../models/index.js';

export async function getDashboardStats(_req: AuthRequest, res: Response): Promise<void> {
  const [totalIncidents, unitsAvailable, unitsOnScene, totalPersonnel, personnelOnDuty, pendingSos] =
    await Promise.all([
      Incident.countDocuments(),
      Vehicle.countDocuments({ status: 'Ready' }),
      Vehicle.countDocuments({ status: { $in: ['On Scene', 'Deployed'] } }),
      Responder.countDocuments(),
      Responder.countDocuments({ availabilityStatus: { $in: ['Available', 'En Route', 'On Scene'] } }),
      SOSRequest.countDocuments({ status: 'Pending' }),
    ]);

  res.json({
    success: true,
    data: {
      totalIncidents,
      unitsAvailable,
      unitsOnScene,
      totalPersonnel,
      personnelOnDuty,
      pendingSos,
    },
  });
}

export async function health(_req: AuthRequest, res: Response): Promise<void> {
  res.json({
    success: true,
    data: {
      status: 'operational',
      version: process.env.VITE_APP_VERSION ?? '1.0.0',
      timestamp: new Date().toISOString(),
    },
  });
}
