-- PostgreSQL 16+ / PGlite. Amounts are integer paise inside JSONB snapshots.
-- Application writes validate their schemas and lock app_lock(1) transactionally.
CREATE TABLE IF NOT EXISTS app_records (
  id text PRIMARY KEY,
  kind text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS records_kind ON app_records(kind);
CREATE TABLE IF NOT EXISTS app_lock (id integer PRIMARY KEY);
INSERT INTO app_lock(id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
  role text NOT NULL CHECK (role IN ('Owner','Sales','Warehouse')),
  password text NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS password_resets (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (name text PRIMARY KEY, value integer NOT NULL);
CREATE TABLE IF NOT EXISTS request_keys (
  key text PRIMARY KEY, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
