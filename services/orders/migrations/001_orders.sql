-- Orders owns the draft, its offers, its stock watches and the outbox (design §14).
CREATE TABLE IF NOT EXISTS drafts (
  draft_id              uuid PRIMARY KEY,
  customer_id           text NOT NULL,
  sku                   text NOT NULL,
  quantity              integer NOT NULL CHECK (quantity > 0),
  max_price             integer CHECK (max_price >= 0),        -- per unit, cents; null = no limit
  state                 text NOT NULL CHECK (state IN
                          ('waiting','offered','confirmed','rejected','expired','cancelled','failed','completed')),
  delivery_status       text CHECK (delivery_status IN ('address_pending','booked','dispatched','delivered')),
  payment_status        text CHECK (payment_status IN ('authorized','captured')),
  address               jsonb NOT NULL,                        -- the agreed delivery address
  current_offer_version integer NOT NULL DEFAULT 0,
  address_wait_until    timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offers (
  offer_id      uuid PRIMARY KEY,
  draft_id      uuid NOT NULL REFERENCES drafts (draft_id),
  version       integer NOT NULL CHECK (version > 0),
  items         jsonb NOT NULL,                                -- [{sku, name, quantity, unit_price, line_total}]
  items_total   integer NOT NULL,
  shipping_fee  integer NOT NULL,
  total         integer NOT NULL,
  status        text NOT NULL CHECK (status IN ('open','approved','rejected','expired','superseded','sold_out')),
  expires_at    timestamptz NOT NULL,
  decision_id   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, version)
);

CREATE TABLE IF NOT EXISTS stock_watches (
  watch_id    uuid PRIMARY KEY,
  draft_id    uuid NOT NULL REFERENCES drafts (draft_id),
  sku         text NOT NULL,
  quantity    integer NOT NULL CHECK (quantity > 0),
  max_price   integer,
  status      text NOT NULL CHECK (status IN ('open','matched','expired','closed')),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_watches_open_idx ON stock_watches (sku, created_at) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS outbox (
  id            bigserial PRIMARY KEY,
  event         jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox (id) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS dropped_events (
  id          bigserial PRIMARY KEY,
  event_id    uuid NOT NULL,
  event_type  text NOT NULL,
  reason      text NOT NULL,
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- What happened to a draft, for the board page and the demo.
CREATE TABLE IF NOT EXISTS draft_history (
  id           bigserial PRIMARY KEY,
  draft_id     uuid NOT NULL,
  what         text NOT NULL,
  event_type   text,
  decision_id  text,
  detail       jsonb,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS draft_history_draft_idx ON draft_history (draft_id, id);
