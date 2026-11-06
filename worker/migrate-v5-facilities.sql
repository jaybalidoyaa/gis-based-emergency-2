-- Facility verification metadata (additive)
ALTER TABLE facilities ADD COLUMN address TEXT;
ALTER TABLE facilities ADD COLUMN contact_number TEXT;
ALTER TABLE facilities ADD COLUMN operating_hours TEXT;
ALTER TABLE facilities ADD COLUMN verification_source TEXT;
ALTER TABLE facilities ADD COLUMN last_verified_at TEXT;
ALTER TABLE facilities ADD COLUMN verification_status TEXT DEFAULT 'unverified';

DELETE FROM facilities WHERE id IN ('fac-hydrant-1', 'fac-hydrant-2', 'fac-water', 'fac-risk-flood');

INSERT OR REPLACE INTO facilities (id, name, category, lat, lng, address, contact_number, operating_hours, verification_source, last_verified_at, verification_status) VALUES ('fac-hall', 'Barangay Sun Valley Hall', 'Barangay Hall', 14.48888, 121.03241, 'Barangay Sun Valley, Paranaque City', '(02) 8659-5589', 'Barangay office hours', 'Wikipedia Sun Valley Paranaque; Brgy contact page', '2026-09-04', 'verified');

INSERT OR REPLACE INTO facilities (id, name, category, lat, lng, address, contact_number, operating_hours, verification_source, last_verified_at, verification_status) VALUES ('fac-svfar', 'Brigada Onse SVFAR Base', 'Emergency Base', 14.4895, 121.038, 'Barangay Sun Valley, Paranaque City', NULL, '24/7 operations', 'Organization operations pin pending independent geocode', '2026-09-04', 'operational_estimate');

INSERT OR REPLACE INTO facilities (id, name, category, lat, lng, address, contact_number, operating_hours, verification_source, last_verified_at, verification_status) VALUES ('fac-elem', 'Sun Valley Elementary School (Evacuation)', 'Evacuation Center', 14.4921, 121.0308, 'Sun Valley, Paranaque City', NULL, NULL, 'Pending official DepEd / city GIS verification', '2026-09-04', 'unverified');

INSERT OR REPLACE INTO facilities (id, name, category, lat, lng, address, contact_number, operating_hours, verification_source, last_verified_at, verification_status) VALUES ('fac-nhs', 'Sun Valley National High School (Evacuation)', 'Evacuation Center', 14.4889, 121.0352, 'Sun Valley, Paranaque City', NULL, NULL, 'Pending official DepEd / city GIS verification', '2026-09-04', 'unverified');

INSERT OR REPLACE INTO facilities (id, name, category, lat, lng, address, contact_number, operating_hours, verification_source, last_verified_at, verification_status) VALUES ('fac-health', 'Sun Valley Health Center', 'Hospital', 14.4902, 121.0345, 'Sun Valley, Paranaque City', NULL, NULL, 'Pending DOH / city health office verification', '2026-09-04', 'unverified');

INSERT OR REPLACE INTO facilities (id, name, category, lat, lng, address, contact_number, operating_hours, verification_source, last_verified_at, verification_status) VALUES ('fac-hospital', 'Medical Center Paranaque', 'Hospital', 14.46694, 121.01472, 'Dr. A. Santos Avenue Sucat Road, Paranaque City', '(02) 5318-9900', '24/7 emergency', 'Address confirmed medicalcenterparanaque.com; corridor coords approximate Wikipedia/Wikimapia', '2026-09-04', 'approximate');

INSERT OR REPLACE INTO facilities (id, name, category, lat, lng, address, contact_number, operating_hours, verification_source, last_verified_at, verification_status) VALUES ('fac-police', 'Sun Valley Police Outpost (PNP Block 3)', 'Police Station', 14.4915, 121.0368, 'Barangay Sun Valley, Paranaque City', '(02) 823-0858', NULL, 'Contact on Brgy Sun Valley site; pin pending PNP GIS verification', '2026-09-04', 'unverified');

INSERT OR REPLACE INTO facilities (id, name, category, lat, lng, address, contact_number, operating_hours, verification_source, last_verified_at, verification_status) VALUES ('fac-fire', 'BFP / Fire Station (Paranaque reference)', 'Fire Station', 14.4872, 121.0412, 'Paranaque City Sun Valley vicinity', '(02) 826-9131', '24/7', 'Fire contact on Brgy Sun Valley site; pin pending BFP verification', '2026-09-04', 'unverified');
