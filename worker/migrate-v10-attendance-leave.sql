-- v10: attendance remarks + leave requests
ALTER TABLE attendance ADD COLUMN remarks TEXT;
ALTER TABLE attendance ADD COLUMN leave_type TEXT;

CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  responder_id TEXT NOT NULL,
  leave_type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT DEFAULT 'Pending',
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
