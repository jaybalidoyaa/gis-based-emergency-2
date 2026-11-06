-- v4: training, announcements, escalation, media, notification deliveries, system events
CREATE TABLE IF NOT EXISTS training_records (
  id TEXT PRIMARY KEY,
  responder_id TEXT NOT NULL,
  training_name TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT,
  certification_status TEXT DEFAULT 'passed',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT DEFAULT 'Normal',
  audience TEXT DEFAULT 'ALL',
  published_by TEXT,
  published_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS escalation_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  threshold_seconds INTEGER,
  incident_category TEXT,
  priority_level TEXT,
  notify_roles TEXT,
  message_template TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media_attachments (
  id TEXT PRIMARY KEY,
  incident_id TEXT,
  sos_id TEXT,
  uploaded_by TEXT,
  file_name TEXT,
  content_type TEXT,
  size_bytes INTEGER,
  storage_key TEXT,
  caption TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  notification_id TEXT,
  channel TEXT NOT NULL,
  recipient TEXT,
  message TEXT,
  priority TEXT,
  state TEXT DEFAULT 'queued',
  failure_reason TEXT,
  retry_count INTEGER DEFAULT 0,
  incident_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS system_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  payload TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guest_sos_rate (
  ip_hash TEXT PRIMARY KEY,
  window_start TEXT,
  count INTEGER DEFAULT 0
);
