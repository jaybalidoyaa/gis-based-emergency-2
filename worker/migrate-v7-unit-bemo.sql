-- Stage all fire / rescue / ambulance units at Barangay Emergency Management Office (SVFAR).
-- BEMO_BASE: 14.48819, 121.037

UPDATE vehicles
SET lat = 14.48819, lng = 121.037, gps_updated_at = datetime('now')
WHERE lower(coalesce(vehicle_type, '')) LIKE '%fire%'
   OR lower(coalesce(vehicle_type, '')) LIKE '%rescue%'
   OR lower(coalesce(vehicle_type, '')) LIKE '%ambulance%'
   OR lower(coalesce(unit_no, '')) LIKE 'fire%'
   OR lower(coalesce(unit_no, '')) LIKE 'rescue%';

UPDATE responders
SET lat = 14.48819, lng = 121.037, gps_updated_at = datetime('now')
WHERE department_id IN ('dept-fire', 'dept-medical')
   OR lower(coalesce(callsign, '')) LIKE 'fire%'
   OR lower(coalesce(callsign, '')) LIKE 'rescue%';
