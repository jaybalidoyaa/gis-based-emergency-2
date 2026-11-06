-- Ensure production console accounts (admin + dispatcher).
-- Default password for newly inserted rows: Password123!
-- Existing rows keep their current password_hash.

INSERT OR IGNORE INTO roles (id, name, description) VALUES
  ('role-admin', 'SYSTEM_ADMINISTRATOR', 'System Administrator'),
  ('role-dispatch', 'CENTRAL_DISPATCHER', 'Central Dispatcher');

INSERT OR IGNORE INTO users (id, role_id, full_name, contact_number, email, password_hash, status) VALUES
  ('user-ops-admin', 'role-admin', 'System Administrator', '09170000001', 'admin@emergency.brigadaonse.org', 'pbkdf2:100000:hBAdIVgGuenjb3UnywXucw==:MvasM7wlYe7KlfuRy1YHGv7RsC9e4cXKFALNShGN22s=', 'active'),
  ('user-ops-dispatcher', 'role-dispatch', 'Balidoya Dispatcher', '09170000002', 'balidoya@emergency.brigadaonse.org', 'pbkdf2:100000:hBAdIVgGuenjb3UnywXucw==:MvasM7wlYe7KlfuRy1YHGv7RsC9e4cXKFALNShGN22s=', 'active');

-- If emails already exist under different ids, promote them to the correct roles.
UPDATE users SET role_id = 'role-admin', status = 'active'
WHERE lower(email) = lower('admin@emergency.brigadaonse.org');

UPDATE users SET role_id = 'role-dispatch', status = 'active'
WHERE lower(email) = lower('balidoya@emergency.brigadaonse.org');
