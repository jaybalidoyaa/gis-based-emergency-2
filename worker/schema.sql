CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  contact_number TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  refresh_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS responders (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  department_id TEXT NOT NULL,
  callsign TEXT,
  availability_status TEXT DEFAULT 'Available',
  operational_status TEXT DEFAULT 'Available',
  lat REAL,
  lng REAL,
  gps_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS citizens (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  address TEXT,
  emergency_contact TEXT
);

CREATE TABLE IF NOT EXISTS incident_types (
  id TEXT PRIMARY KEY,
  type_name TEXT UNIQUE NOT NULL,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  address_text TEXT,
  landmark TEXT
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  display_id TEXT UNIQUE NOT NULL,
  reported_by_user_id TEXT NOT NULL,
  incident_type_id TEXT NOT NULL,
  dispatcher_id TEXT,
  department_id TEXT,
  location_id TEXT NOT NULL,
  description TEXT DEFAULT '',
  priority_level TEXT DEFAULT 'Medium',
  status TEXT DEFAULT 'Pending Verification',
  reported_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT,
  resolved_at TEXT,
  closed_at TEXT,
  is_locked INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sos_requests (
  id TEXT PRIMARY KEY,
  display_id TEXT UNIQUE NOT NULL,
  incident_id TEXT NOT NULL,
  citizen_id TEXT NOT NULL,
  trigger_time TEXT NOT NULL DEFAULT (datetime('now')),
  auto_location_flag INTEGER DEFAULT 1,
  status TEXT DEFAULT 'Pending'
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL,
  unit_no TEXT UNIQUE NOT NULL,
  vehicle_type TEXT NOT NULL,
  status TEXT DEFAULT 'Ready',
  lat REAL,
  lng REAL,
  gps_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  responder_id TEXT NOT NULL,
  vehicle_id TEXT,
  assigned_by_dispatcher_id TEXT NOT NULL,
  assignment_status TEXT DEFAULT 'Assigned',
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  details TEXT,
  is_system INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT NOT NULL,
  incident_id TEXT,
  type TEXT NOT NULL,
  priority TEXT DEFAULT 'Normal',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT,
  batch_id TEXT,
  sender_user_id TEXT,
  audience TEXT
);

CREATE TABLE IF NOT EXISTS notification_replies (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  notification_id TEXT,
  from_user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS equipment (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  serviceability TEXT DEFAULT 'Ready',
  department_id TEXT
);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  team_name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  shift_status TEXT DEFAULT 'Scheduled',
  scheduled_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transports (
  id TEXT PRIMARY KEY,
  display_id TEXT UNIQUE NOT NULL,
  patient_name TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  scheduled_time TEXT NOT NULL,
  transport_status TEXT DEFAULT 'Scheduled',
  origin_address TEXT,
  destination_address TEXT,
  origin_lat REAL,
  origin_lng REAL,
  destination_lat REAL,
  destination_lng REAL
);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  responder_id TEXT NOT NULL,
  date TEXT NOT NULL,
  check_in_time TEXT,
  check_out_time TEXT,
  status TEXT DEFAULT 'On Duty',
  UNIQUE(responder_id, date)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS counters (
  key TEXT NOT NULL,
  year INTEGER NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, year)
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status, reported_at);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_sos_status ON sos_requests(status);

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
