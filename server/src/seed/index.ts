import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Role, Department, User, Responder, Citizen, IncidentType, Vehicle, Location } from '../models/index.js';
import { Equipment, Facility, ShiftSchedule } from '../models/extra.js';
import { ROLES, ROLE_PERMISSIONS } from '../constants/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const DEPARTMENTS = [
  { name: 'Barangay Emergency Management Office (BEMO/BDRRMO)', code: 'BEMO' },
  { name: 'Public Order and Safety Management Office (POPSMO)', code: 'POPSMO' },
  { name: 'Brigada Onse Sun Valley Fire and Rescue', code: 'FIRE' },
  { name: 'Medical / Ambulance', code: 'MEDICAL' },
  { name: 'Police / Security', code: 'POLICE' },
  { name: 'Hospital / Health Center', code: 'HOSPITAL' },
];

const INCIDENT_TYPES = [
  'Medical Emergency',
  'Residential / Structural Fire',
  'Fire Alarm',
  'Vehicular Accident',
  'Road Traffic Accident',
  'Trauma',
  'Rescue Operation',
  'Flooded Area',
  'Disturbance / Assault',
  'Oil Leak / Oil Spill',
  'Patient Transport / Conduction',
  'Other Emergency',
];

// Barangay Sun Valley approximate center (Parañaque City)
const SUN_VALLEY_CENTER = { lat: 14.4785, lng: 121.0435 };

export async function seedDatabase(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/barangay-dispatch');

  console.log('Clearing existing data...');
  await Promise.all([
    Role.deleteMany({}),
    Department.deleteMany({}),
    User.deleteMany({}),
    Responder.deleteMany({}),
    Citizen.deleteMany({}),
    IncidentType.deleteMany({}),
    Vehicle.deleteMany({}),
    Location.deleteMany({}),
  ]);

  console.log('Creating roles...');
  const roles = await Role.insertMany(
    Object.entries(ROLE_PERMISSIONS).map(([name, permissions]) => ({
      name,
      permissions,
      description: `${name.replace(/_/g, ' ')} role`,
    }))
  );
  const roleMap = Object.fromEntries(roles.map((r) => [r.name, r]));

  console.log('Creating departments...');
  const departments = await Department.insertMany(DEPARTMENTS);
  const deptMap = Object.fromEntries(departments.map((d) => [d.code, d]));

  console.log('Creating incident types...');
  await IncidentType.insertMany(INCIDENT_TYPES.map((typeName) => ({ typeName })));

  const passwordHash = await bcrypt.hash('Password123!', 12);

  console.log('Creating admin and staff users...');
  const admin = await User.create({
    roleId: roleMap[ROLES.SYSTEM_ADMINISTRATOR]._id,
    fullName: 'System Administrator',
    email: 'admin@sunvalley.gov.ph',
    contactNumber: '09170000001',
    passwordHash,
    status: 'active',
  });

  const dispatcher = await User.create({
    roleId: roleMap[ROLES.CENTRAL_DISPATCHER]._id,
    fullName: 'Maria Santos',
    email: 'dispatcher@sunvalley.gov.ph',
    contactNumber: '09170000002',
    passwordHash,
    status: 'active',
  });

  const deptDispatcher = await User.create({
    roleId: roleMap[ROLES.DEPARTMENT_DISPATCHER]._id,
    fullName: 'Juan Dela Cruz',
    email: 'dept.dispatcher@sunvalley.gov.ph',
    contactNumber: '09170000003',
    passwordHash,
    status: 'active',
  });

  const responderUsers = [
    { fullName: 'Fire Officer Reyes', email: 'reyes@sunvalley.gov.ph', callsign: 'FIRE 01', dept: 'FIRE', unit: 'FIRE 01', type: 'Fire Truck' },
    { fullName: 'Fire Officer Garcia', email: 'garcia@sunvalley.gov.ph', callsign: 'FIRE 02', dept: 'FIRE', unit: 'FIRE 02', type: 'Fire Truck' },
    { fullName: 'EMT Cruz', email: 'cruz@sunvalley.gov.ph', callsign: 'RESCUE 02', dept: 'MEDICAL', unit: 'RESCUE 02', type: 'Ambulance' },
    { fullName: 'EMT Lopez', email: 'lopez@sunvalley.gov.ph', callsign: 'RESCUE 04', dept: 'MEDICAL', unit: 'RESCUE 04', type: 'Ambulance' },
    { fullName: 'Rescue Officer Mendoza', email: 'mendoza@sunvalley.gov.ph', callsign: 'RESCUE 05', dept: 'MEDICAL', unit: 'RESCUE 05', type: 'Rescue Vehicle' },
  ];

  for (const r of responderUsers) {
    const user = await User.create({
      roleId: roleMap[ROLES.EMERGENCY_RESPONDER]._id,
      fullName: r.fullName,
      email: r.email,
      contactNumber: `0917${Math.floor(1000000 + Math.random() * 8999999)}`,
      passwordHash,
      status: 'active',
    });

    const responder = await Responder.create({
      userId: user._id,
      departmentId: deptMap[r.dept]._id,
      callsign: r.callsign,
      availabilityStatus: 'Available',
      operationalStatus: 'Available',
      currentLocation: {
        latitude: SUN_VALLEY_CENTER.lat + (Math.random() - 0.5) * 0.01,
        longitude: SUN_VALLEY_CENTER.lng + (Math.random() - 0.5) * 0.01,
        updatedAt: new Date(),
      },
    });

    await Vehicle.create({
      departmentId: deptMap[r.dept]._id,
      unitNo: r.unit,
      vehicleType: r.type,
      status: 'Ready',
      assignedCrewIds: [responder._id],
      currentLocation: responder.currentLocation,
    });
  }

  const citizenUser = await User.create({
    roleId: roleMap[ROLES.CITIZEN]._id,
    fullName: 'Citizen Demo',
    email: 'citizen@demo.ph',
    contactNumber: '09170000099',
    passwordHash,
    status: 'active',
  });

  await Citizen.create({
    userId: citizenUser._id,
    address: 'Sun Valley, Parañaque City',
    emergencyContact: '09171111111',
  });

  // Facility locations for map
  const facilities = [
    { name: 'BEMO Station', lat: 14.479, lng: 121.044, type: 'Fire/Rescue Facility' },
    { name: 'Sun Valley Health Center', lat: 14.477, lng: 121.042, type: 'Health Center' },
    { name: 'Parañaque Hospital', lat: 14.481, lng: 121.046, type: 'Hospital' },
  ];

  for (const f of facilities) {
    const loc = await Location.create({
      latitude: f.lat,
      longitude: f.lng,
      addressText: f.name,
      landmark: f.type,
    });
    await Facility.create({
      name: f.name,
      facilityType: f.type,
      locationId: loc._id,
      departmentId: deptMap['BEMO']._id,
    });
  }

  await ShiftSchedule.insertMany([
    { teamName: 'Team Alpha', startTime: '0600H', endTime: '1800H', shiftStatus: 'Ongoing', scheduledDate: new Date(), responderIds: [] },
    { teamName: 'Team Bravo', startTime: '1800H', endTime: '0600H', shiftStatus: 'Up Next', scheduledDate: new Date(), responderIds: [] },
    { teamName: 'Team Charlie', startTime: '0600H', endTime: '1800H', shiftStatus: 'Scheduled', scheduledDate: new Date(), responderIds: [] },
  ]);

  await Equipment.insertMany([
    { name: 'Fire Hose', category: 'Firefighting', quantity: 10, serviceability: 'Ready', departmentId: deptMap['FIRE']._id },
    { name: 'AED Unit', category: 'Medical', quantity: 3, serviceability: 'Ready', departmentId: deptMap['MEDICAL']._id },
    { name: 'Rescue Rope', category: 'Rescue', quantity: 5, serviceability: 'Ready', departmentId: deptMap['FIRE']._id },
  ]);

  console.log('\nSeed complete!');
  console.log('Demo credentials (all use Password123!):');
  console.log('  Admin:      admin@sunvalley.gov.ph');
  console.log('  Dispatcher: dispatcher@sunvalley.gov.ph');
  console.log('  Dept Disp:  dept.dispatcher@sunvalley.gov.ph');
  console.log('  Responder:  cruz@sunvalley.gov.ph (RESCUE 02)');
  console.log('  Citizen:    citizen@demo.ph');

  await mongoose.disconnect();
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.includes('seed')) {
  seedDatabase().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
