-- Additive migration. Existing rows are preserved.
-- apply-sql.js ignores duplicate-column / already-exists errors.

ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN phone_verified INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'en';
ALTER TABLE users ADD COLUMN consent_at TEXT;
ALTER TABLE users ADD COLUMN mfa_secret TEXT;
ALTER TABLE users ADD COLUMN failed_logins INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;

ALTER TABLE citizens ADD COLUMN medical_alerts TEXT;
ALTER TABLE citizens ADD COLUMN notification_prefs TEXT;
ALTER TABLE citizens ADD COLUMN privacy_consent INTEGER DEFAULT 0;
ALTER TABLE citizens ADD COLUMN terms_accepted INTEGER DEFAULT 0;
ALTER TABLE citizens ADD COLUMN emergency_contact_phone TEXT;
ALTER TABLE citizens ADD COLUMN language TEXT DEFAULT 'en';
ALTER TABLE citizens ADD COLUMN deletion_requested_at TEXT;

ALTER TABLE incidents ADD COLUMN caller_name TEXT;
ALTER TABLE incidents ADD COLUMN caller_phone TEXT;
ALTER TABLE incidents ADD COLUMN subcategory TEXT;
ALTER TABLE incidents ADD COLUMN victim_count INTEGER;
ALTER TABLE incidents ADD COLUMN patient_condition TEXT;
ALTER TABLE incidents ADD COLUMN known_hazards TEXT;
ALTER TABLE incidents ADD COLUMN accessibility TEXT;
ALTER TABLE incidents ADD COLUMN report_source TEXT;
ALTER TABLE incidents ADD COLUMN is_anonymous INTEGER DEFAULT 0;
ALTER TABLE incidents ADD COLUMN callback_confirmed INTEGER DEFAULT 0;
ALTER TABLE incidents ADD COLUMN dispatcher_notes TEXT;
ALTER TABLE incidents ADD COLUMN master_incident_id TEXT;
ALTER TABLE incidents ADD COLUMN cancel_reason TEXT;
ALTER TABLE incidents ADD COLUMN photo_url TEXT;
ALTER TABLE incidents ADD COLUMN acknowledged_at TEXT;
ALTER TABLE incidents ADD COLUMN dispatched_at TEXT;
ALTER TABLE incidents ADD COLUMN enroute_at TEXT;
ALTER TABLE incidents ADD COLUMN onscene_at TEXT;
ALTER TABLE incidents ADD COLUMN transporting_at TEXT;
ALTER TABLE incidents ADD COLUMN destination_at TEXT;
ALTER TABLE incidents ADD COLUMN client_request_id TEXT;

ALTER TABLE sos_requests ADD COLUMN victim_count INTEGER;
ALTER TABLE sos_requests ADD COLUMN hazards TEXT;
ALTER TABLE sos_requests ADD COLUMN photo_url TEXT;
ALTER TABLE sos_requests ADD COLUMN cancel_reason TEXT;
ALTER TABLE sos_requests ADD COLUMN contact_confirmed INTEGER DEFAULT 0;

ALTER TABLE vehicles ADD COLUMN fuel_level REAL;
ALTER TABLE vehicles ADD COLUMN mileage REAL;
ALTER TABLE vehicles ADD COLUMN assigned_station TEXT;
ALTER TABLE vehicles ADD COLUMN readiness_status TEXT;
ALTER TABLE vehicles ADD COLUMN out_of_service_reason TEXT;

ALTER TABLE equipment ADD COLUMN assigned_unit TEXT;
ALTER TABLE equipment ADD COLUMN expiration_date TEXT;
ALTER TABLE equipment ADD COLUMN calibration_date TEXT;
ALTER TABLE equipment ADD COLUMN missing INTEGER DEFAULT 0;

ALTER TABLE transports ADD COLUMN patient_contact TEXT;
ALTER TABLE transports ADD COLUMN requesting_person TEXT;
ALTER TABLE transports ADD COLUMN return_trip INTEGER DEFAULT 0;
ALTER TABLE transports ADD COLUMN priority TEXT DEFAULT 'Moderate';
ALTER TABLE transports ADD COLUMN mobility TEXT;
ALTER TABLE transports ADD COLUMN oxygen_required INTEGER DEFAULT 0;
ALTER TABLE transports ADD COLUMN assigned_vehicle_id TEXT;
ALTER TABLE transports ADD COLUMN assigned_crew TEXT;
ALTER TABLE transports ADD COLUMN recurring_rule TEXT;
ALTER TABLE transports ADD COLUMN cancel_reason TEXT;
ALTER TABLE transports ADD COLUMN notes TEXT;

ALTER TABLE assignments ADD COLUMN is_primary INTEGER DEFAULT 0;
ALTER TABLE assignments ADD COLUMN decline_reason TEXT;
ALTER TABLE assignments ADD COLUMN ack_deadline TEXT;
ALTER TABLE assignments ADD COLUMN client_request_id TEXT;

ALTER TABLE responders ADD COLUMN team_name TEXT;
ALTER TABLE responders ADD COLUMN emergency_contact TEXT;

CREATE TABLE IF NOT EXISTS facilities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS gps_tracks (
  id TEXT PRIMARY KEY,
  responder_id TEXT,
  vehicle_id TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy REAL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS incident_status_history (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_user_id TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  ip TEXT,
  success INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checklists (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT,
  equipment_id TEXT,
  kind TEXT NOT NULL,
  passed INTEGER,
  failed_critical INTEGER DEFAULT 0,
  notes TEXT,
  completed_by TEXT,
  completed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id TEXT PRIMARY KEY,
  checklist_id TEXT NOT NULL,
  label TEXT NOT NULL,
  critical INTEGER DEFAULT 0,
  passed INTEGER
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  department_id TEXT
);

CREATE TABLE IF NOT EXISTS certifications (
  id TEXT PRIMARY KEY,
  responder_id TEXT NOT NULL,
  name TEXT NOT NULL,
  expires_at TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_gps_tracks_responder ON gps_tracks(responder_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_status_history_incident ON incident_status_history(incident_id, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, created_at);
CREATE INDEX IF NOT EXISTS idx_facilities_cat ON facilities(category);

INSERT OR IGNORE INTO incident_types (id, type_name, is_active) VALUES
  ('type-hazmat', 'Hazardous Materials', 1),
  ('type-conduction', 'Conduction', 1);

INSERT OR IGNORE INTO facilities (id, name, category, lat, lng) VALUES
  ('fac-hall', 'Barangay Sun Valley Hall', 'Barangay Hall', 14.4908, 121.0324),
  ('fac-svfar', 'Brigada Onse SVFAR Base', 'Emergency Base', 14.4895, 121.038),
  ('fac-elem', 'Sun Valley Elementary School (Evacuation)', 'Evacuation Center', 14.4921, 121.0308),
  ('fac-nhs', 'Sun Valley National High School (Evacuation)', 'Evacuation Center', 14.4889, 121.0352),
  ('fac-health', 'Sun Valley Health Center', 'Hospital', 14.4902, 121.0345),
  ('fac-hospital', 'Medical Center Parañaque (nearby)', 'Hospital', 14.4868, 121.0438),
  ('fac-police', 'Sun Valley Police Outpost', 'Police Station', 14.4915, 121.0368),
  ('fac-fire', 'Fire Station / BFP satellite', 'Fire Station', 14.4872, 121.0412),
  ('fac-hydrant-1', 'Hydrant — Sun Valley Drive', 'Fire Hydrant', 14.4901, 121.0312),
  ('fac-hydrant-2', 'Hydrant — CAA / Kabihasnan approach', 'Fire Hydrant', 14.4858, 121.0395),
  ('fac-water', 'Water source — drainage canal node', 'Water Source', 14.4848, 121.0284),
  ('fac-risk-flood', 'High-risk flood pocket (low area)', 'High-Risk Area', 14.4846, 121.0272);

INSERT OR IGNORE INTO teams (id, name, department_id) VALUES
  ('team-alpha', 'Team Alpha', 'dept-fire'),
  ('team-bravo', 'Team Bravo', 'dept-medical'),
  ('team-charlie', 'Team Charlie', 'dept-fire');
