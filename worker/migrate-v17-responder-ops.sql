-- Responder profile fields, unit-change requests, and patient vitals.
-- npm run db:migrate:v17
-- Some responder columns may already exist from earlier migrates; apply-sql skips duplicates.

ALTER TABLE responders ADD COLUMN home_address TEXT;
ALTER TABLE responders ADD COLUMN emergency_contact TEXT;
ALTER TABLE responders ADD COLUMN medical_alerts TEXT;

ALTER TABLE incidents ADD COLUMN patient_name TEXT;
ALTER TABLE incidents ADD COLUMN vital_rr TEXT;
ALTER TABLE incidents ADD COLUMN vital_spo2 TEXT;
ALTER TABLE incidents ADD COLUMN vital_hr TEXT;
ALTER TABLE incidents ADD COLUMN vital_bp TEXT;
ALTER TABLE incidents ADD COLUMN oxygen_required INTEGER DEFAULT 0;
ALTER TABLE incidents ADD COLUMN oxygen_flow TEXT;

CREATE TABLE IF NOT EXISTS unit_change_requests (
  id TEXT PRIMARY KEY,
  responder_id TEXT NOT NULL,
  from_team TEXT,
  to_team TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  reviewed_by TEXT,
  review_note TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_unit_change_pending ON unit_change_requests(status, created_at);
