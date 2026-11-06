-- Persist exact pickup/destination coordinates for conduction routes.
-- npm run db:migrate:v16

ALTER TABLE transports ADD COLUMN origin_lat REAL;
ALTER TABLE transports ADD COLUMN origin_lng REAL;
ALTER TABLE transports ADD COLUMN destination_lat REAL;
ALTER TABLE transports ADD COLUMN destination_lng REAL;
