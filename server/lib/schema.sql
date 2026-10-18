-- Flippy K/V + sets store, backed by Postgres (Neon).
-- Replaces the Redis store used in the earlier WebRok code.

CREATE TABLE IF NOT EXISTS kv (
  k           TEXT PRIMARY KEY,
  v           TEXT NOT NULL,
  expires_at  TIMESTAMPTZ          -- NULL = never expires
);
CREATE INDEX IF NOT EXISTS kv_expires_idx ON kv(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS kv_set (
  k       TEXT NOT NULL,
  member  TEXT NOT NULL,
  PRIMARY KEY (k, member)
);
