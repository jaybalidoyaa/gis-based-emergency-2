-- Ops-verified facility pins (2026-09-05). Replace prior approximate / unverified rows.

DELETE FROM facilities WHERE id IN (
  'fac-elem',
  'fac-nhs',
  'fac-police',
  'fac-fire',
  'fac-hospital',
  'fac-health',
  'fac-hydrant-1',
  'fac-hydrant-2',
  'fac-water',
  'fac-risk-flood'
);

INSERT OR REPLACE INTO facilities (id, name, category, lat, lng, address, contact_number, operating_hours, verification_source, last_verified_at, verification_status) VALUES
('fac-hall', 'Barangay Sun Valley Hall / Health Office', 'Barangay Hall', 14.488834, 121.032484, 'Barangay Sun Valley, Parañaque City', '(02) 8659-5589', 'Barangay office hours', 'Ops: hall and barangay health office share this site', '2026-09-05', 'verified');

INSERT OR REPLACE INTO facilities (id, name, category, lat, lng, address, contact_number, operating_hours, verification_source, last_verified_at, verification_status) VALUES
('fac-svfar', 'Barangay Emergency Management Office — SVFAR', 'Emergency Base', 14.48819, 121.037, 'F2QP+8R2 Sampaguita, Manila, 1709 Metro Manila', NULL, '24/7 operations', 'Ops pin F2QP+8R2 SVFAR', '2026-09-05', 'verified');

INSERT OR REPLACE INTO facilities (id, name, category, lat, lng, address, contact_number, operating_hours, verification_source, last_verified_at, verification_status) VALUES
('fac-schools', 'Sun Valley National High School and Elementary School', 'Evacuation Center', 14.489862, 121.029294, 'Elizabeth Avenue / Sta. Ana, Barangay Sun Valley, Parañaque City', '(02) 8823-8031', NULL, 'Ops coordinates 14.489862, 121.029294', '2026-09-05', 'verified');

INSERT OR REPLACE INTO facilities (id, name, category, lat, lng, address, contact_number, operating_hours, verification_source, last_verified_at, verification_status) VALUES
('fac-police-ss7', 'Sun Valley Police Sub-station (SS7)', 'Police Station', 14.490037, 121.032347, 'F2QJ+XW Parañaque, Metro Manila', '(02) 823-0858', NULL, 'Ops pin F2QJ+XW', '2026-09-05', 'verified');

INSERT OR REPLACE INTO facilities (id, name, category, lat, lng, address, contact_number, operating_hours, verification_source, last_verified_at, verification_status) VALUES
('fac-police-city', 'Parañaque City Police Station', 'Police Station', 14.486356, 120.991313, 'Parañaque City', NULL, NULL, 'Ops coordinates 14.486356, 120.991313', '2026-09-05', 'verified');

INSERT OR REPLACE INTO facilities (id, name, category, lat, lng, address, contact_number, operating_hours, verification_source, last_verified_at, verification_status) VALUES
('fac-fire-bfp', 'BFP Parañaque Central Station', 'Fire Station', 14.486698, 120.991275, 'Parañaque City', '(02) 826-9131', '24/7', 'Ops coordinates 14.486698, 120.991275', '2026-09-05', 'verified');

INSERT OR REPLACE INTO facilities (id, name, category, lat, lng, address, contact_number, operating_hours, verification_source, last_verified_at, verification_status) VALUES
('fac-hospital-doctors', 'Parañaque Doctors Hospital', 'Hospital', 14.485753, 121.028259, 'Parañaque City', NULL, '24/7 emergency', 'Ops coordinates 14.485753, 121.028259', '2026-09-05', 'verified');

INSERT OR REPLACE INTO facilities (id, name, category, lat, lng, address, contact_number, operating_hours, verification_source, last_verified_at, verification_status) VALUES
('fac-ospital-d2', 'Ospital ng Parañaque District II', 'Hospital', 14.487723, 121.024143, 'Parañaque City', NULL, '24/7 emergency', 'Ops coordinates 14.487723, 121.024143', '2026-09-05', 'verified');

INSERT OR REPLACE INTO facilities (id, name, category, lat, lng, address, contact_number, operating_hours, verification_source, last_verified_at, verification_status) VALUES
('fac-ospital-d1', 'Ospital ng Parañaque District I', 'Hospital', 14.500476, 120.991391, 'Parañaque City', NULL, '24/7 emergency', 'Ops coordinates 14.500476, 120.991391', '2026-09-05', 'verified');
