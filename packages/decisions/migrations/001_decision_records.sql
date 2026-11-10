CREATE TABLE IF NOT EXISTS decision_records (
  decision_id     uuid PRIMARY KEY,
  agent           text NOT NULL,
  event_id        uuid NOT NULL,
  event_type      text NOT NULL,
  draft_id        text,
  offer_version   integer,
  model           text NOT NULL,
  started_at      timestamptz NOT NULL,
  duration_ms     integer NOT NULL,
  tokens_in       integer NOT NULL DEFAULT 0,
  tokens_out      integer NOT NULL DEFAULT 0,
  tool_calls      jsonb NOT NULL DEFAULT '[]',
  emitted_events  jsonb NOT NULL DEFAULT '[]',
  output_text     text NOT NULL DEFAULT '',
  status          text NOT NULL CHECK (status IN ('ok', 'limit', 'error'))
);
CREATE INDEX IF NOT EXISTS decision_records_draft_idx ON decision_records (draft_id, started_at);
