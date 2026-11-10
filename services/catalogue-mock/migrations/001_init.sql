-- catalogue-mock: first migration. One table to start; add columns in a new file, never edit an applied file.
CREATE TABLE IF NOT EXISTS catalogue-mock_events_seen (
  event_id    uuid PRIMARY KEY,
  event_type  text NOT NULL,
  seen_at     timestamptz NOT NULL DEFAULT now()
);
