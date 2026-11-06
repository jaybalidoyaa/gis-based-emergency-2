export const ROLES = {
  SYSTEM_ADMINISTRATOR: 'SYSTEM_ADMINISTRATOR',
  CENTRAL_DISPATCHER: 'CENTRAL_DISPATCHER',
  DEPARTMENT_DISPATCHER: 'DEPARTMENT_DISPATCHER',
  EMERGENCY_RESPONDER: 'EMERGENCY_RESPONDER',
  CITIZEN: 'CITIZEN',
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

export const PERMISSIONS = {
  INCIDENTS_READ: 'incidents:read',
  INCIDENTS_WRITE: 'incidents:write',
  INCIDENTS_VERIFY: 'incidents:verify',
  INCIDENTS_ASSIGN: 'incidents:assign',
  INCIDENTS_CLOSE: 'incidents:close',
  SOS_READ: 'sos:read',
  SOS_WRITE: 'sos:write',
  DISPATCH_MANAGE: 'dispatch:manage',
  MAP_MONITOR: 'map:monitor',
  TRANSPORT_MANAGE: 'transport:manage',
  NOTIFICATIONS_MANAGE: 'notifications:manage',
  REPORTS_READ: 'reports:read',
  REPORTS_EXPORT: 'reports:export',
  PERSONNEL_MANAGE: 'personnel:manage',
  ATTENDANCE_MANAGE: 'attendance:manage',
  SHIFTS_MANAGE: 'shifts:manage',
  RESOURCES_MANAGE: 'resources:manage',
  SETTINGS_MANAGE: 'settings:manage',
  RESPONDER_OPERATIONS: 'responder:operations',
  AUDIT_READ: 'audit:read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  [ROLES.SYSTEM_ADMINISTRATOR]: Object.values(PERMISSIONS),
  [ROLES.CENTRAL_DISPATCHER]: [
    PERMISSIONS.INCIDENTS_READ,
    PERMISSIONS.INCIDENTS_WRITE,
    PERMISSIONS.INCIDENTS_VERIFY,
    PERMISSIONS.INCIDENTS_ASSIGN,
    PERMISSIONS.INCIDENTS_CLOSE,
    PERMISSIONS.SOS_READ,
    PERMISSIONS.DISPATCH_MANAGE,
    PERMISSIONS.MAP_MONITOR,
    PERMISSIONS.TRANSPORT_MANAGE,
    PERMISSIONS.NOTIFICATIONS_MANAGE,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.REPORTS_EXPORT,
    PERMISSIONS.PERSONNEL_MANAGE,
    PERMISSIONS.ATTENDANCE_MANAGE,
    PERMISSIONS.SHIFTS_MANAGE,
    PERMISSIONS.RESOURCES_MANAGE,
  ],
  [ROLES.DEPARTMENT_DISPATCHER]: [
    PERMISSIONS.INCIDENTS_READ,
    PERMISSIONS.INCIDENTS_WRITE,
    PERMISSIONS.INCIDENTS_ASSIGN,
    PERMISSIONS.SOS_READ,
    PERMISSIONS.DISPATCH_MANAGE,
    PERMISSIONS.MAP_MONITOR,
    PERMISSIONS.TRANSPORT_MANAGE,
    PERMISSIONS.NOTIFICATIONS_MANAGE,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.ATTENDANCE_MANAGE,
    PERMISSIONS.SHIFTS_MANAGE,
    PERMISSIONS.RESOURCES_MANAGE,
  ],
  [ROLES.EMERGENCY_RESPONDER]: [
    PERMISSIONS.INCIDENTS_READ,
    PERMISSIONS.SOS_READ,
    PERMISSIONS.RESPONDER_OPERATIONS,
    PERMISSIONS.NOTIFICATIONS_MANAGE,
  ],
  [ROLES.CITIZEN]: [
    PERMISSIONS.SOS_WRITE,
    PERMISSIONS.SOS_READ,
    PERMISSIONS.NOTIFICATIONS_MANAGE,
  ],
};

export const INCIDENT_STATUSES = [
  'Pending Verification',
  'Verified',
  'Open',
  'Assigned',
  'En Route',
  'On Scene',
  'Transporting',
  'In Progress',
  'Resolved',
  'Closed',
  'False Alarm',
] as const;

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  'Pending Verification': ['Verified', 'False Alarm'],
  Verified: ['Open', 'False Alarm'],
  Open: ['Assigned', 'Closed'],
  Assigned: ['En Route', 'Open'],
  'En Route': ['On Scene', 'Assigned'],
  'On Scene': ['Transporting', 'In Progress', 'Resolved'],
  Transporting: ['Resolved', 'On Scene'],
  'In Progress': ['Resolved', 'Transporting'],
  Resolved: ['Closed'],
  Closed: [],
  'False Alarm': ['Closed'],
};

export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const UNIT_STATUSES = [
  'Available',
  'Dispatched',
  'En Route',
  'On Scene',
  'Transporting',
  'Out of Service',
] as const;

export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const ASSIGNMENT_STATUSES = [
  'Assigned',
  'Accepted',
  'Rejected',
  'En Route',
  'On Scene',
  'Completed',
] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
