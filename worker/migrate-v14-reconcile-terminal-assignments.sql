-- Reconcile legacy open assignments that still point at terminal incidents.
-- Review before applying: npm run db:migrate:v14
-- Reverse note: this cannot restore prior assignment_status / responder / vehicle values;
-- restore from a D1 backup if a rollback is required.

-- Cancel open assignments on terminal incidents
UPDATE assignments
SET assignment_status = 'Cancelled'
WHERE assignment_status NOT IN ('Completed', 'Rejected', 'Declined', 'Cancelled')
  AND incident_id IN (
    SELECT id FROM incidents
    WHERE status IN ('Cancelled', 'Closed', 'False Alarm', 'Duplicate', 'Resolved')
  );

-- Free responders with no remaining open assignment on a live incident
UPDATE responders
SET availability_status = 'Available', operational_status = 'Available'
WHERE id NOT IN (
  SELECT a.responder_id FROM assignments a
  JOIN incidents i ON i.id = a.incident_id
  WHERE a.responder_id IS NOT NULL
    AND a.assignment_status NOT IN ('Completed', 'Rejected', 'Declined', 'Cancelled')
    AND i.status NOT IN ('Cancelled', 'Closed', 'False Alarm', 'Duplicate', 'Resolved')
)
AND availability_status NOT IN ('Off Duty', 'Out of Service');

-- Free vehicles that are not Out of Service and have no remaining open live assignment
UPDATE vehicles
SET status = 'Ready', out_of_service_reason = NULL
WHERE status NOT IN ('Out of Service', 'Ready', 'Available')
  AND id NOT IN (
    SELECT a.vehicle_id FROM assignments a
    JOIN incidents i ON i.id = a.incident_id
    WHERE a.vehicle_id IS NOT NULL
      AND a.assignment_status NOT IN ('Completed', 'Rejected', 'Declined', 'Cancelled')
      AND i.status NOT IN ('Cancelled', 'Closed', 'False Alarm', 'Duplicate', 'Resolved')
  );
