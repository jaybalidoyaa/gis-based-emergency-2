export interface User {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  contactNumber?: string;
  status?: string;
}

export type UserRole =
  | 'SYSTEM_ADMINISTRATOR'
  | 'CENTRAL_DISPATCHER'
  | 'DEPARTMENT_DISPATCHER'
  | 'EMERGENCY_RESPONDER'
  | 'CITIZEN';

export interface DashboardStats {
  totalIncidents: number;
  unitsAvailable: number;
  unitsOnScene: number;
  totalPersonnel: number;
  personnelOnDuty: number;
  pendingSos: number;
}

export interface Location {
  _id: string;
  latitude: number;
  longitude: number;
  addressText?: string;
  landmark?: string;
}

export interface Incident {
  _id: string;
  displayId: string;
  status: string;
  priorityLevel: string;
  description: string;
  reportedAt: string;
  incidentTypeId?: { _id?: string; typeName: string };
  locationId?: Location;
  reportedByUserId?: { fullName: string; contactNumber: string; email?: string };
  assignments?: Assignment[];
  timeline?: TimelineEntry[];
  callerName?: string;
  callerPhone?: string;
  subcategory?: string;
  victimCount?: number;
  patientCondition?: string;
  patientName?: string | null;
  vitalRr?: string | null;
  vitalSpo2?: string | null;
  vitalHr?: string | null;
  vitalBp?: string | null;
  oxygenRequired?: boolean;
  oxygenFlow?: string | null;
  knownHazards?: string;
  accessibility?: string;
  reportSource?: string;
  dispatcherNotes?: string;
  environment?: string;
  acknowledged_by?: string;
  acknowledged_at?: string;
}

export interface Assignment {
  _id: string;
  assignmentStatus: string;
  incidentId?: Incident;
  responderId?: { callsign?: string; fullName?: string; userId?: { fullName: string } };
  vehicleId?: { unitNo?: string };
}

export interface TimelineEntry {
  _id: string;
  action: string;
  details?: string;
  createdAt: string;
  isSystemGenerated: boolean;
}

export interface SOSReport {
  _id: string;
  displayId: string;
  status: string;
  triggerTime: string;
  incidentId?: Incident;
  citizenId?: { userId?: { fullName: string; contactNumber: string } };
}

export interface MapFacility {
  _id: string;
  name?: string;
  category?: string;
  address?: string;
  contactNumber?: string;
  operatingHours?: string;
  verificationSource?: string;
  lastVerifiedAt?: string;
  verificationStatus?: string;
  currentLocation?: { latitude: number; longitude: number };
}

export interface MapRoute {
  id: string;
  label: string;
  status: string;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  incidentId: string;
  incidentDisplayId?: string;
}

export interface MapData {
  incidents: Incident[];
  sosPending: unknown[];
  units: MapUnit[];
  responders: MapUnit[];
  facilities: MapFacility[];
  routes?: MapRoute[];
  center: { lat: number; lng: number };
  barangay?: { name: string; city: string };
}

export interface MapUnit {
  _id: string;
  kind?: 'vehicle' | 'responder';
  unitNo?: string;
  callsign?: string;
  fullName?: string;
  department?: string;
  vehicleType?: string;
  status?: string;
  operationalStatus?: string;
  availabilityStatus?: string;
  currentLocation?: { latitude: number; longitude: number; updatedAt: string };
  gpsStale?: boolean;
  assignedIncidentId?: string;
  assignedIncidentDisplayId?: string;
  assignmentStatus?: string;
  crewCount?: number;
  capabilities?: string[];
}

export interface PersonnelAssignment {
  assignmentStatus: string;
  assignedAt?: string;
  incidentId?: string;
  incidentDisplayId?: string;
  incidentType?: string;
  addressText?: string;
  unitNo?: string;
  assignedBy?: string;
}

export interface PersonnelMember {
  id: string;
  fullName: string;
  email: string;
  contactNumber?: string;
  accountStatus: string;
  status?: string;
  createdAt?: string;
  roleName: string;
  roleId?: { name: string };
  responderId?: string;
  callsign?: string;
  availabilityStatus?: string;
  operationalStatus?: string;
  teamName?: string;
  departmentName?: string;
  departmentCode?: string;
  lat?: number;
  lng?: number;
  gpsUpdatedAt?: string;
  assignment?: PersonnelAssignment;
}

export interface NotificationItem {
  _id: string;
  title: string;
  message: string;
  type: string;
  priority: string;
  readAt?: string;
  sentAt: string;
  incidentId?: string;
  incidentDisplayId?: string;
  incidentStatus?: string;
  incidentPriority?: string;
  incidentTypeName?: string;
  batchId?: string;
  senderUserId?: string;
  senderName?: string;
  audience?: string;
  location?: { latitude: number; longitude: number; addressText?: string };
}

export interface NotificationTrackingPerson {
  userId: string;
  fullName: string;
  role: string;
  readAt?: string;
  notificationId?: string;
}

export interface NotificationReplyItem {
  id: string;
  fromUserId: string;
  fullName: string;
  role: string;
  message: string;
  createdAt: string;
  notificationId?: string | null;
}

export interface NotificationTracking {
  batchId: string;
  title: string;
  type: string;
  priority: string;
  audience?: string;
  sentAt: string;
  total: number;
  /** @deprecated Use inAppCreated — was incorrectly equated with push delivery */
  delivered: number;
  inAppCreated: number;
  pushSubscribed: number;
  pushNotSubscribed: number;
  acknowledgedCount: number;
  pendingCount: number;
  failedCount: number;
  deliveredPct: number;
  acknowledgedPct: number;
  pendingPct: number;
  failedPct: number;
  channelNotes: string;
  acknowledged: NotificationTrackingPerson[];
  pending: NotificationTrackingPerson[];
  replies: NotificationReplyItem[];
}
