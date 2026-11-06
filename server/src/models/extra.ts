import mongoose, { Schema, Document, Types } from 'mongoose';

export interface INotification extends Document {
  incidentId?: Types.ObjectId;
  recipientUserId: Types.ObjectId;
  type: string;
  priority: string;
  title: string;
  message: string;
  channel: string;
  sentAt: Date;
  deliveryStatus: string;
  readAt?: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident' },
    recipientUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    priority: { type: String, default: 'Normal' },
    title: { type: String, required: true },
    message: { type: String, required: true },
    channel: { type: String, default: 'in-app' },
    sentAt: { type: Date, default: Date.now },
    deliveryStatus: { type: String, default: 'pending' },
    readAt: { type: Date },
  },
  { timestamps: true }
);

export const Notification = mongoose.model<INotification>('Notification', notificationSchema);

export interface ITransportSchedule extends Document {
  displayId: string;
  incidentId?: Types.ObjectId;
  patientName: string;
  age?: number;
  sex?: string;
  contactNumber?: string;
  vehicleId?: Types.ObjectId;
  originLocationId: Types.ObjectId;
  destinationLocationId: Types.ObjectId;
  scheduledDate: Date;
  scheduledTime: string;
  medicalNotes?: string;
  transportStatus: string;
  assignedTeam?: string;
}

const transportSchema = new Schema<ITransportSchedule>(
  {
    displayId: { type: String, required: true, unique: true },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident' },
    patientName: { type: String, required: true },
    age: Number,
    sex: String,
    contactNumber: String,
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
    originLocationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    destinationLocationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    scheduledDate: { type: Date, required: true },
    scheduledTime: { type: String, required: true },
    medicalNotes: String,
    transportStatus: { type: String, default: 'Scheduled' },
    assignedTeam: String,
  },
  { timestamps: true }
);

export const TransportSchedule = mongoose.model<ITransportSchedule>('TransportSchedule', transportSchema);

export interface IEquipment extends Document {
  name: string;
  category: string;
  quantity: number;
  serviceability: string;
  assignedLocation?: string;
  lastInspection?: Date;
  remarks?: string;
  departmentId?: Types.ObjectId;
}

const equipmentSchema = new Schema<IEquipment>(
  {
    name: { type: String, required: true },
    category: { type: String, required: true },
    quantity: { type: Number, default: 1 },
    serviceability: { type: String, default: 'Ready' },
    assignedLocation: String,
    lastInspection: Date,
    remarks: String,
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
  },
  { timestamps: true }
);

export const Equipment = mongoose.model<IEquipment>('Equipment', equipmentSchema);

export interface IChatMessage extends Document {
  incidentId: Types.ObjectId;
  senderUserId: Types.ObjectId;
  senderRole: string;
  senderDepartment?: string;
  message: string;
  deliveryStatus: string;
  readAt?: Date;
}

const chatSchema = new Schema<IChatMessage>(
  {
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', required: true },
    senderUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, required: true },
    senderDepartment: String,
    message: { type: String, required: true },
    deliveryStatus: { type: String, default: 'delivered' },
    readAt: Date,
  },
  { timestamps: true }
);

export const ChatMessage = mongoose.model<IChatMessage>('ChatMessage', chatSchema);

export interface IAttendance extends Document {
  responderId: Types.ObjectId;
  date: Date;
  checkInTime?: Date;
  checkOutTime?: Date;
  status: string;
}

const attendanceSchema = new Schema<IAttendance>(
  {
    responderId: { type: Schema.Types.ObjectId, ref: 'Responder', required: true },
    date: { type: Date, required: true },
    checkInTime: Date,
    checkOutTime: Date,
    status: { type: String, default: 'On Duty' },
  },
  { timestamps: true }
);

attendanceSchema.index({ responderId: 1, date: 1 }, { unique: true });
export const Attendance = mongoose.model<IAttendance>('Attendance', attendanceSchema);

export interface IShiftSchedule extends Document {
  teamName: string;
  startTime: string;
  endTime: string;
  shiftStatus: string;
  responderIds: Types.ObjectId[];
  scheduledDate: Date;
}

const shiftSchema = new Schema<IShiftSchedule>(
  {
    teamName: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    shiftStatus: { type: String, default: 'Scheduled' },
    responderIds: [{ type: Schema.Types.ObjectId, ref: 'Responder' }],
    scheduledDate: { type: Date, required: true },
  },
  { timestamps: true }
);

export const ShiftSchedule = mongoose.model<IShiftSchedule>('ShiftSchedule', shiftSchema);

export interface ITrainingRecord extends Document {
  responderId: Types.ObjectId;
  trainingName: string;
  completionDate: Date;
  certificationStatus: string;
}

const trainingSchema = new Schema<ITrainingRecord>(
  {
    responderId: { type: Schema.Types.ObjectId, ref: 'Responder', required: true },
    trainingName: { type: String, required: true },
    completionDate: { type: Date, required: true },
    certificationStatus: { type: String, default: 'passed' },
  },
  { timestamps: true }
);

export const TrainingRecord = mongoose.model<ITrainingRecord>('TrainingRecord', trainingSchema);

export interface IMediaAttachment extends Document {
  incidentId: Types.ObjectId;
  uploadedByUserId: Types.ObjectId;
  mediaType: string;
  fileName: string;
  filePath: string;
  uploadedAt: Date;
}

const mediaSchema = new Schema<IMediaAttachment>(
  {
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', required: true },
    uploadedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mediaType: { type: String, required: true },
    fileName: { type: String, required: true },
    filePath: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const MediaAttachment = mongoose.model<IMediaAttachment>('MediaAttachment', mediaSchema);

export interface IFacility extends Document {
  name: string;
  facilityType: string;
  locationId: Types.ObjectId;
  departmentId?: Types.ObjectId;
  isActive: boolean;
}

const facilitySchema = new Schema<IFacility>(
  {
    name: { type: String, required: true },
    facilityType: { type: String, required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Facility = mongoose.model<IFacility>('Facility', facilitySchema);

export interface ISystemSetting extends Document {
  key: string;
  value: unknown;
  category: string;
}

const settingSchema = new Schema<ISystemSetting>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    category: { type: String, default: 'general' },
  },
  { timestamps: true }
);

export const SystemSetting = mongoose.model<ISystemSetting>('SystemSetting', settingSchema);
