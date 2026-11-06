import mongoose, { Schema, Document, Types } from 'mongoose';
import { Permission } from '../constants/index.js';

export interface IRole extends Document {
  name: string;
  permissions: Permission[];
  description?: string;
}

const roleSchema = new Schema<IRole>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    permissions: [{ type: String, required: true }],
    description: { type: String, trim: true },
  },
  { timestamps: true }
);

export const Role = mongoose.model<IRole>('Role', roleSchema);

export interface IDepartment extends Document {
  name: string;
  code: string;
  description?: string;
  isActive: boolean;
}

const departmentSchema = new Schema<IDepartment>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Department = mongoose.model<IDepartment>('Department', departmentSchema);

export interface IUser extends Document {
  roleId: Types.ObjectId;
  fullName: string;
  contactNumber: string;
  email: string;
  passwordHash: string;
  status: 'active' | 'inactive' | 'pending';
  refreshToken?: string;
  lastLoginAt?: Date;
}

const userSchema = new Schema<IUser>(
  {
    roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    fullName: { type: String, required: true, trim: true },
    contactNumber: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    status: {
      type: String,
      enum: ['active', 'inactive', 'pending'],
      default: 'pending',
    },
    refreshToken: { type: String },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>('User', userSchema);

export interface IResponder extends Document {
  userId: Types.ObjectId;
  departmentId: Types.ObjectId;
  callsign?: string;
  availabilityStatus: string;
  operationalStatus: string;
  currentLocation?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    updatedAt: Date;
  };
}

const responderSchema = new Schema<IResponder>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    callsign: { type: String, trim: true },
    availabilityStatus: { type: String, default: 'Available' },
    operationalStatus: { type: String, default: 'Available' },
    currentLocation: {
      latitude: Number,
      longitude: Number,
      accuracy: Number,
      updatedAt: Date,
    },
  },
  { timestamps: true }
);

export const Responder = mongoose.model<IResponder>('Responder', responderSchema);

export interface ICitizen extends Document {
  userId: Types.ObjectId;
  address?: string;
  emergencyContact?: string;
}

const citizenSchema = new Schema<ICitizen>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    address: { type: String, trim: true },
    emergencyContact: { type: String, trim: true },
  },
  { timestamps: true }
);

export const Citizen = mongoose.model<ICitizen>('Citizen', citizenSchema);

export interface ILocation extends Document {
  latitude: number;
  longitude: number;
  addressText?: string;
  landmark?: string;
}

const locationSchema = new Schema<ILocation>(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    addressText: { type: String, trim: true },
    landmark: { type: String, trim: true },
  },
  { timestamps: true }
);

locationSchema.index({ latitude: 1, longitude: 1 });
export const Location = mongoose.model<ILocation>('Location', locationSchema);

export interface IIncidentType extends Document {
  typeName: string;
  description?: string;
  defaultDepartmentId?: Types.ObjectId;
  isActive: boolean;
}

const incidentTypeSchema = new Schema<IIncidentType>(
  {
    typeName: { type: String, required: true, unique: true, trim: true },
    description: { type: String, trim: true },
    defaultDepartmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const IncidentType = mongoose.model<IIncidentType>('IncidentType', incidentTypeSchema);

export interface IIncident extends Document {
  displayId: string;
  reportedByUserId: Types.ObjectId;
  incidentTypeId: Types.ObjectId;
  dispatcherId?: Types.ObjectId;
  departmentId?: Types.ObjectId;
  locationId: Types.ObjectId;
  description: string;
  priorityLevel: string;
  status: string;
  reportedAt: Date;
  verifiedAt?: Date;
  resolvedAt?: Date;
  closedAt?: Date;
  isLocked: boolean;
}

const incidentSchema = new Schema<IIncident>(
  {
    displayId: { type: String, required: true, unique: true },
    reportedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    incidentTypeId: { type: Schema.Types.ObjectId, ref: 'IncidentType', required: true },
    dispatcherId: { type: Schema.Types.ObjectId, ref: 'User' },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    description: { type: String, default: '' },
    priorityLevel: { type: String, default: 'Medium' },
    status: { type: String, default: 'Pending Verification' },
    reportedAt: { type: Date, default: Date.now },
    verifiedAt: { type: Date },
    resolvedAt: { type: Date },
    closedAt: { type: Date },
    isLocked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

incidentSchema.index({ status: 1, reportedAt: -1 });
export const Incident = mongoose.model<IIncident>('Incident', incidentSchema);

export interface ISOSRequest extends Document {
  displayId: string;
  incidentId: Types.ObjectId;
  citizenId: Types.ObjectId;
  triggerTime: Date;
  autoLocationFlag: boolean;
  status: string;
}

const sosSchema = new Schema<ISOSRequest>(
  {
    displayId: { type: String, required: true, unique: true },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', required: true },
    citizenId: { type: Schema.Types.ObjectId, ref: 'Citizen', required: true },
    triggerTime: { type: Date, default: Date.now },
    autoLocationFlag: { type: Boolean, default: false },
    status: { type: String, default: 'Pending' },
  },
  { timestamps: true }
);

export const SOSRequest = mongoose.model<ISOSRequest>('SOSRequest', sosSchema);

export interface IVehicle extends Document {
  departmentId: Types.ObjectId;
  unitNo: string;
  vehicleType: string;
  status: string;
  currentLocation?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    updatedAt: Date;
  };
  assignedCrewIds: Types.ObjectId[];
}

const vehicleSchema = new Schema<IVehicle>(
  {
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    unitNo: { type: String, required: true, unique: true, trim: true },
    vehicleType: { type: String, required: true, trim: true },
    status: { type: String, default: 'Ready' },
    currentLocation: {
      latitude: Number,
      longitude: Number,
      accuracy: Number,
      updatedAt: Date,
    },
    assignedCrewIds: [{ type: Schema.Types.ObjectId, ref: 'Responder' }],
  },
  { timestamps: true }
);

export const Vehicle = mongoose.model<IVehicle>('Vehicle', vehicleSchema);

export interface IAssignment extends Document {
  incidentId: Types.ObjectId;
  responderId: Types.ObjectId;
  vehicleId?: Types.ObjectId;
  assignedByDispatcherId: Types.ObjectId;
  assignmentStatus: string;
  assignedAt: Date;
  acceptedAt?: Date;
}

const assignmentSchema = new Schema<IAssignment>(
  {
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', required: true },
    responderId: { type: Schema.Types.ObjectId, ref: 'Responder', required: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
    assignedByDispatcherId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignmentStatus: { type: String, default: 'Assigned' },
    assignedAt: { type: Date, default: Date.now },
    acceptedAt: { type: Date },
  },
  { timestamps: true }
);

export const Assignment = mongoose.model<IAssignment>('Assignment', assignmentSchema);

export interface IActivityLog extends Document {
  incidentId: Types.ObjectId;
  actorUserId?: Types.ObjectId;
  action: string;
  details?: string;
  metadata?: Record<string, unknown>;
  isSystemGenerated: boolean;
}

const activityLogSchema = new Schema<IActivityLog>(
  {
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', required: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    details: { type: String },
    metadata: { type: Schema.Types.Mixed },
    isSystemGenerated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const ActivityLog = mongoose.model<IActivityLog>('ActivityLog', activityLogSchema);

export interface IAuditLog extends Document {
  actorUserId: Types.ObjectId;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  beforeValue?: Record<string, unknown>;
  afterValue?: Record<string, unknown>;
  ipAddress?: string;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorRole: { type: String, required: true },
    action: { type: String, required: true },
    resourceType: { type: String, required: true },
    resourceId: { type: String },
    beforeValue: { type: Schema.Types.Mixed },
    afterValue: { type: Schema.Types.Mixed },
    ipAddress: { type: String },
  },
  { timestamps: true }
);

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', auditLogSchema);

export interface ICounter extends Document {
  key: string;
  year: number;
  seq: number;
}

const counterSchema = new Schema<ICounter>({
  key: { type: String, required: true },
  year: { type: Number, required: true },
  seq: { type: Number, default: 0 },
});

counterSchema.index({ key: 1, year: 1 }, { unique: true });
export const Counter = mongoose.model<ICounter>('Counter', counterSchema);
