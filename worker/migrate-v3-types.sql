-- Soft-disable duplicate Patient Transport category; Conduction remains for scheduled transport.
UPDATE incident_types SET is_active = 0 WHERE type_name LIKE 'Patient Transport%';
