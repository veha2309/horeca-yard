CREATE TABLE IF NOT EXISTS app_events (
  id bigserial PRIMARY KEY,
  entity text NOT NULL,
  record_id text NOT NULL,
  message text NOT NULL,
  actor_id text,
  audience text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_events_audience ON app_events USING gin(audience);
CREATE TABLE IF NOT EXISTS notification_reads (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_read bigint NOT NULL DEFAULT 0
);
