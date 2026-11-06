-- Demo seed. Password for all users: Password123!
-- Hash algorithm: pbkdf2:100000 (see worker/index.ts)

INSERT OR REPLACE INTO roles (id, name, description) VALUES
  ('role-admin', 'SYSTEM_ADMINISTRATOR', 'System Administrator'),
  ('role-dispatch', 'CENTRAL_DISPATCHER', 'Central Dispatcher'),
  ('role-dept', 'DEPARTMENT_DISPATCHER', 'Department Dispatcher'),
  ('role-responder', 'EMERGENCY_RESPONDER', 'Emergency Responder'),
  ('role-citizen', 'CITIZEN', 'Citizen');

INSERT OR REPLACE INTO departments (id, name, code) VALUES
  ('dept-bemo', 'Barangay Emergency Management Office (BEMO/BDRRMO)', 'BEMO'),
  ('dept-popsmo', 'Public Order and Safety Management Office (POPSMO)', 'POPSMO'),
  ('dept-fire', 'Brigada Onse Sun Valley Fire and Rescue', 'FIRE'),
  ('dept-medical', 'Medical / Ambulance', 'MEDICAL'),
  ('dept-police', 'Police / Security', 'POLICE'),
  ('dept-hospital', 'Hospital / Health Center', 'HOSPITAL');

INSERT OR REPLACE INTO incident_types (id, type_name, is_active) VALUES
  ('type-medical', 'Medical Emergency', 1),
  ('type-fire', 'Residential / Structural Fire', 1),
  ('type-alarm', 'Fire Alarm', 1),
  ('type-vehicular', 'Vehicular Accident', 1),
  ('type-rta', 'Road Traffic Accident', 1),
  ('type-trauma', 'Trauma', 1),
  ('type-rescue', 'Rescue Operation', 1),
  ('type-flood', 'Flooded Area', 1),
  ('type-assault', 'Disturbance / Assault', 1),
  ('type-oil', 'Oil Leak / Oil Spill', 1),
  ('type-transport', 'Patient Transport / Conduction', 1),
  ('type-other', 'Other Emergency', 1);

INSERT OR REPLACE INTO users (id, role_id, full_name, contact_number, email, password_hash, status) VALUES
  ('user-ops-admin', 'role-admin', 'System Administrator', '09170000001', 'admin@emergency.brigadaonse.org', 'pbkdf2:100000:hBAdIVgGuenjb3UnywXucw==:MvasM7wlYe7KlfuRy1YHGv7RsC9e4cXKFALNShGN22s=', 'active'),
  ('user-ops-dispatcher', 'role-dispatch', 'Balidoya Dispatcher', '09170000002', 'balidoya@emergency.brigadaonse.org', 'pbkdf2:100000:hBAdIVgGuenjb3UnywXucw==:MvasM7wlYe7KlfuRy1YHGv7RsC9e4cXKFALNShGN22s=', 'active'),
  ('user-admin', 'role-admin', 'System Administrator', '09170000001', 'admin@sunvalley.gov.ph', 'pbkdf2:100000:hBAdIVgGuenjb3UnywXucw==:MvasM7wlYe7KlfuRy1YHGv7RsC9e4cXKFALNShGN22s=', 'active'),
  ('user-dispatch', 'role-dispatch', 'Maria Santos', '09170000002', 'dispatcher@sunvalley.gov.ph', 'pbkdf2:100000:hBAdIVgGuenjb3UnywXucw==:MvasM7wlYe7KlfuRy1YHGv7RsC9e4cXKFALNShGN22s=', 'active'),
  ('user-dept', 'role-dept', 'Juan Dela Cruz', '09170000003', 'dept.dispatcher@sunvalley.gov.ph', 'pbkdf2:100000:hBAdIVgGuenjb3UnywXucw==:MvasM7wlYe7KlfuRy1YHGv7RsC9e4cXKFALNShGN22s=', 'active'),
  ('user-reyes', 'role-responder', 'Fire Officer Reyes', '09171111111', 'reyes@sunvalley.gov.ph', 'pbkdf2:100000:hBAdIVgGuenjb3UnywXucw==:MvasM7wlYe7KlfuRy1YHGv7RsC9e4cXKFALNShGN22s=', 'active'),
  ('user-garcia', 'role-responder', 'Fire Officer Garcia', '09172222222', 'garcia@sunvalley.gov.ph', 'pbkdf2:100000:hBAdIVgGuenjb3UnywXucw==:MvasM7wlYe7KlfuRy1YHGv7RsC9e4cXKFALNShGN22s=', 'active'),
  ('user-cruz', 'role-responder', 'EMT Cruz', '09173333333', 'cruz@sunvalley.gov.ph', 'pbkdf2:100000:hBAdIVgGuenjb3UnywXucw==:MvasM7wlYe7KlfuRy1YHGv7RsC9e4cXKFALNShGN22s=', 'active'),
  ('user-lopez', 'role-responder', 'EMT Lopez', '09174444444', 'lopez@sunvalley.gov.ph', 'pbkdf2:100000:hBAdIVgGuenjb3UnywXucw==:MvasM7wlYe7KlfuRy1YHGv7RsC9e4cXKFALNShGN22s=', 'active'),
  ('user-mendoza', 'role-responder', 'Rescue Officer Mendoza', '09175555555', 'mendoza@sunvalley.gov.ph', 'pbkdf2:100000:hBAdIVgGuenjb3UnywXucw==:MvasM7wlYe7KlfuRy1YHGv7RsC9e4cXKFALNShGN22s=', 'active'),
  ('user-citizen', 'role-citizen', 'Citizen Demo', '09170000099', 'citizen@demo.ph', 'pbkdf2:100000:hBAdIVgGuenjb3UnywXucw==:MvasM7wlYe7KlfuRy1YHGv7RsC9e4cXKFALNShGN22s=', 'active');

INSERT OR REPLACE INTO citizens (id, user_id, address, emergency_contact) VALUES
  ('cit-demo', 'user-citizen', 'Sun Valley, Parañaque City', '09171111111');

INSERT OR REPLACE INTO responders (id, user_id, department_id, callsign, availability_status, operational_status, lat, lng, gps_updated_at) VALUES
  ('resp-fire01', 'user-reyes', 'dept-fire', 'FIRE 01', 'Available', 'Available', 14.48819, 121.037, datetime('now')),
  ('resp-fire02', 'user-garcia', 'dept-fire', 'FIRE 02', 'Available', 'Available', 14.48819, 121.037, datetime('now')),
  ('resp-rescue02', 'user-cruz', 'dept-medical', 'RESCUE 02', 'Available', 'Available', 14.48819, 121.037, datetime('now')),
  ('resp-rescue04', 'user-lopez', 'dept-medical', 'RESCUE 04', 'Available', 'Available', 14.48819, 121.037, datetime('now')),
  ('resp-rescue05', 'user-mendoza', 'dept-medical', 'RESCUE 05', 'Available', 'Available', 14.48819, 121.037, datetime('now'));

INSERT OR REPLACE INTO vehicles (id, department_id, unit_no, vehicle_type, status, lat, lng, gps_updated_at) VALUES
  ('veh-fire01', 'dept-fire', 'FIRE 01', 'Fire Truck', 'Ready', 14.48819, 121.037, datetime('now')),
  ('veh-fire02', 'dept-fire', 'FIRE 02', 'Fire Truck', 'Ready', 14.48819, 121.037, datetime('now')),
  ('veh-rescue02', 'dept-medical', 'RESCUE 02', 'Ambulance', 'Ready', 14.48819, 121.037, datetime('now')),
  ('veh-rescue04', 'dept-medical', 'RESCUE 04', 'Ambulance', 'Ready', 14.48819, 121.037, datetime('now')),
  ('veh-rescue05', 'dept-medical', 'RESCUE 05', 'Rescue Vehicle', 'Ready', 14.48819, 121.037, datetime('now'));

INSERT OR REPLACE INTO shifts (id, team_name, start_time, end_time, shift_status, scheduled_date) VALUES
  ('shift-a', 'Team Alpha', '0600H', '1800H', 'Ongoing', date('now')),
  ('shift-b', 'Team Bravo', '1800H', '0600H', 'Up Next', date('now')),
  ('shift-c', 'Team Charlie', '0600H', '1800H', 'Scheduled', date('now'));

INSERT OR REPLACE INTO equipment (id, name, category, quantity, serviceability, department_id) VALUES
  ('eq-hose', 'Fire Hose', 'Firefighting', 10, 'Ready', 'dept-fire'),
  ('eq-aed', 'AED Unit', 'Medical', 3, 'Ready', 'dept-medical'),
  ('eq-rope', 'Rescue Rope', 'Rescue', 5, 'Ready', 'dept-fire');

INSERT OR IGNORE INTO facilities (id, name, category, lat, lng) VALUES
  ('fac-hall', 'Barangay Sun Valley Hall / Health Office', 'Barangay Hall', 14.488834, 121.032484),
  ('fac-svfar', 'Barangay Emergency Management Office — SVFAR', 'Emergency Base', 14.48819, 121.037),
  ('fac-schools', 'Sun Valley National High School and Elementary School', 'Evacuation Center', 14.489862, 121.029294),
  ('fac-police-ss7', 'Sun Valley Police Sub-station (SS7)', 'Police Station', 14.490037, 121.032347),
  ('fac-police-city', 'Parañaque City Police Station', 'Police Station', 14.486356, 120.991313),
  ('fac-fire-bfp', 'BFP Parañaque Central Station', 'Fire Station', 14.486698, 120.991275),
  ('fac-hospital-doctors', 'Parañaque Doctors Hospital', 'Hospital', 14.485753, 121.028259),
  ('fac-ospital-d2', 'Ospital ng Parañaque District II', 'Hospital', 14.487723, 121.024143),
  ('fac-ospital-d1', 'Ospital ng Parañaque District I', 'Hospital', 14.500476, 120.991391);

INSERT OR IGNORE INTO incident_types (id, type_name, is_active) VALUES
  ('type-hazmat', 'Hazardous Materials', 1),
  ('type-conduction', 'Conduction', 1);
