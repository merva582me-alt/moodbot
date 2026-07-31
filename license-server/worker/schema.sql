-- MoodBot License Server — D1 Schema
-- Run once: wrangler d1 execute moodbot-licenses --file=schema.sql

CREATE TABLE IF NOT EXISTS keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT    NOT NULL UNIQUE,
  note         TEXT    NOT NULL DEFAULT '',
  status       TEXT    NOT NULL DEFAULT 'active',  -- active | paused | revoked
  hwid         TEXT,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER,
  activated_at INTEGER,
  last_seen    INTEGER
);

CREATE TABLE IF NOT EXISTS log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id  INTEGER NOT NULL,
  action  TEXT    NOT NULL,
  detail  TEXT    NOT NULL DEFAULT '',
  ts      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_keys_key    ON keys (key);
CREATE INDEX IF NOT EXISTS idx_log_key_id ON log  (key_id);
