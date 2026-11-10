-- Phase 1 stub. Phase 2 adds offers, stock_watches, dropped_events and more columns.
CREATE TABLE IF NOT EXISTS drafts (
  draft_id     uuid PRIMARY KEY,
  customer_id  text NOT NULL,
  sku          text NOT NULL,
  quantity     integer NOT NULL CHECK (quantity > 0),
  state        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox (
  id            bigserial PRIMARY KEY,
  event         jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox (id) WHERE published_at IS NULL;
