import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as authController from '../controllers/auth.controller.js';
import * as dashboardController from '../controllers/dashboard.controller.js';
import * as incidentsController from '../controllers/incidents.controller.js';
import * as sosController from '../controllers/sos.controller.js';
import * as respondersController from '../controllers/responders.controller.js';
import * as mapController from '../controllers/map.controller.js';
import * as opsController from '../controllers/operations.controller.js';
import { authenticate, requirePermission } from '../middleware/index.js';
import { PERMISSIONS } from '../constants/index.js';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many attempts, please try again later' },
});

const sosLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many SOS requests. Please wait.' },
});

export const authRouter = Router();
authRouter.post('/register', authLimiter, authController.register);
authRouter.post('/login', authLimiter, authController.login);
authRouter.post('/refresh', authController.refresh);
authRouter.post('/logout', authenticate, authController.logout);
authRouter.get('/me', authenticate, authController.me);

export const dashboardRouter = Router();
dashboardRouter.get('/stats', authenticate, requirePermission(PERMISSIONS.INCIDENTS_READ), dashboardController.getDashboardStats);
dashboardRouter.get('/health', dashboardController.health);

export const incidentsRouter = Router();
incidentsRouter.use(authenticate);
incidentsRouter.get('/types', incidentsController.getIncidentTypes);
incidentsRouter.get('/', requirePermission(PERMISSIONS.INCIDENTS_READ), incidentsController.listIncidents);
incidentsRouter.post('/', requirePermission(PERMISSIONS.INCIDENTS_WRITE), incidentsController.createIncident);
incidentsRouter.get('/:id', requirePermission(PERMISSIONS.INCIDENTS_READ), incidentsController.getIncident);
incidentsRouter.post('/:id/verify', requirePermission(PERMISSIONS.INCIDENTS_VERIFY), incidentsController.verifyIncident);
incidentsRouter.post('/:id/false-alarm', requirePermission(PERMISSIONS.INCIDENTS_VERIFY), incidentsController.falseAlarm);
incidentsRouter.post('/:id/status', requirePermission(PERMISSIONS.INCIDENTS_WRITE), incidentsController.updateStatus);
incidentsRouter.post('/:id/assign', requirePermission(PERMISSIONS.INCIDENTS_ASSIGN), incidentsController.assignUnit);
incidentsRouter.get('/:id/nearby-units', requirePermission(PERMISSIONS.INCIDENTS_ASSIGN), incidentsController.getNearestUnits);
incidentsRouter.get('/:id/timeline', requirePermission(PERMISSIONS.INCIDENTS_READ), incidentsController.getTimeline);
incidentsRouter.post('/:id/notes', requirePermission(PERMISSIONS.INCIDENTS_WRITE), incidentsController.addNote);

export const sosRouter = Router();
sosRouter.get('/types', sosController.getIncidentTypesPublic);
sosRouter.post('/', authenticate, sosLimiter, requirePermission(PERMISSIONS.SOS_WRITE), sosController.createSOS);
sosRouter.get('/my-status', authenticate, requirePermission(PERMISSIONS.SOS_READ), sosController.getCitizenSOSStatus);
sosRouter.get('/', authenticate, requirePermission(PERMISSIONS.SOS_READ), sosController.listSOS);
sosRouter.get('/:id', authenticate, requirePermission(PERMISSIONS.SOS_READ), sosController.getSOS);

export const respondersRouter = Router();
respondersRouter.use(authenticate);
respondersRouter.get('/', requirePermission(PERMISSIONS.INCIDENTS_READ), respondersController.listResponders);
respondersRouter.get('/available', requirePermission(PERMISSIONS.INCIDENTS_ASSIGN), respondersController.listAvailableResponders);
respondersRouter.get('/dispatch-queue', requirePermission(PERMISSIONS.DISPATCH_MANAGE), respondersController.getDispatchQueue);
respondersRouter.get('/assignments/mine', requirePermission(PERMISSIONS.RESPONDER_OPERATIONS), respondersController.getMyAssignments);
respondersRouter.patch('/me/status', requirePermission(PERMISSIONS.RESPONDER_OPERATIONS), respondersController.updateResponderStatus);
respondersRouter.post('/me/location', requirePermission(PERMISSIONS.RESPONDER_OPERATIONS), respondersController.updateResponderLocation);
respondersRouter.post('/assignments/:id/accept', requirePermission(PERMISSIONS.RESPONDER_OPERATIONS), respondersController.acceptAssignment);
respondersRouter.post('/assignments/:id/reject', requirePermission(PERMISSIONS.RESPONDER_OPERATIONS), respondersController.rejectAssignment);
respondersRouter.post('/assignments/:id/status', requirePermission(PERMISSIONS.RESPONDER_OPERATIONS), respondersController.updateAssignmentStatus);

export const mapRouter = Router();
mapRouter.get('/data', authenticate, requirePermission(PERMISSIONS.MAP_MONITOR), mapController.getMapData);

export const transportsRouter = Router();
transportsRouter.use(authenticate, requirePermission(PERMISSIONS.TRANSPORT_MANAGE));
transportsRouter.get('/', opsController.listTransports);
transportsRouter.post('/', opsController.createTransport);
transportsRouter.patch('/:id', opsController.updateTransport);

export const personnelRouter = Router();
personnelRouter.use(authenticate, requirePermission(PERMISSIONS.PERSONNEL_MANAGE));
personnelRouter.get('/', opsController.listPersonnel);
personnelRouter.patch('/:id/status', opsController.updatePersonnelStatus);

export const attendanceRouter = Router();
attendanceRouter.use(authenticate);
attendanceRouter.get('/', requirePermission(PERMISSIONS.ATTENDANCE_MANAGE), opsController.listAttendance);
attendanceRouter.post('/check-in', requirePermission(PERMISSIONS.RESPONDER_OPERATIONS), opsController.checkIn);
attendanceRouter.post('/check-out', requirePermission(PERMISSIONS.RESPONDER_OPERATIONS), opsController.checkOut);

export const shiftsRouter = Router();
shiftsRouter.use(authenticate, requirePermission(PERMISSIONS.SHIFTS_MANAGE));
shiftsRouter.get('/', opsController.listShifts);
shiftsRouter.post('/', opsController.createShift);

export const resourcesRouter = Router();
resourcesRouter.use(authenticate, requirePermission(PERMISSIONS.RESOURCES_MANAGE));
resourcesRouter.get('/vehicles', opsController.listVehicles);
resourcesRouter.patch('/vehicles/:id/status', opsController.updateVehicleStatus);
resourcesRouter.get('/equipment', opsController.listEquipment);
resourcesRouter.patch('/equipment/:id', opsController.updateEquipmentStatus);

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);
notificationsRouter.get('/', opsController.listNotifications);
notificationsRouter.patch('/:id/read', opsController.markNotificationRead);
notificationsRouter.post('/read-all', opsController.markAllNotificationsRead);

export const reportsRouter = Router();
reportsRouter.use(authenticate, requirePermission(PERMISSIONS.REPORTS_READ));
reportsRouter.get('/', opsController.listReports);
reportsRouter.get('/export', requirePermission(PERMISSIONS.REPORTS_EXPORT), opsController.exportReports);

export const settingsRouter = Router();
settingsRouter.use(authenticate, requirePermission(PERMISSIONS.SETTINGS_MANAGE));
settingsRouter.get('/', opsController.getSettings);
settingsRouter.get('/audit-logs', requirePermission(PERMISSIONS.AUDIT_READ), opsController.getAuditLogs);

export const chatRouter = Router();
chatRouter.use(authenticate);
chatRouter.get('/incident/:incidentId', opsController.getChatMessages);
chatRouter.post('/incident/:incidentId', opsController.sendChatMessage);
