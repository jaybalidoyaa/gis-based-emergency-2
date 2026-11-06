-- Group multi-recipient sends + track replies / acknowledgements
ALTER TABLE notifications ADD COLUMN batch_id TEXT;
ALTER TABLE notifications ADD COLUMN sender_user_id TEXT;
ALTER TABLE notifications ADD COLUMN audience TEXT;

CREATE TABLE IF NOT EXISTS notification_replies (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  notification_id TEXT,
  from_user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_batch ON notifications(batch_id);
CREATE INDEX IF NOT EXISTS idx_notifications_sender ON notifications(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_notification_replies_batch ON notification_replies(batch_id);
