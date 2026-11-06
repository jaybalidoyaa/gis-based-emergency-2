-- Separate team vs unit (vehicle) change requests; persist duty unit on responders.
-- npm run db:migrate:v18

ALTER TABLE responders ADD COLUMN assigned_vehicle_id TEXT;

ALTER TABLE unit_change_requests ADD COLUMN request_type TEXT NOT NULL DEFAULT 'team';
ALTER TABLE unit_change_requests ADD COLUMN from_vehicle_id TEXT;
ALTER TABLE unit_change_requests ADD COLUMN to_vehicle_id TEXT;
ALTER TABLE unit_change_requests ADD COLUMN from_unit_label TEXT;
ALTER TABLE unit_change_requests ADD COLUMN to_unit_label TEXT;

UPDATE unit_change_requests SET request_type = 'team' WHERE request_type IS NULL OR request_type = '';
