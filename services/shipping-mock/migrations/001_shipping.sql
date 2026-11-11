CREATE TABLE IF NOT EXISTS quotes (
  quote_id    uuid PRIMARY KEY,
  draft_id    uuid NOT NULL,
  postcode    text NOT NULL,
  zone        text NOT NULL,
  fee         integer NOT NULL,           -- cents
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quotes_draft_idx ON quotes (draft_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bookings (
  tracking_id  text PRIMARY KEY,
  draft_id     uuid NOT NULL,
  quote_id     uuid NOT NULL REFERENCES quotes (quote_id),
  status       text NOT NULL CHECK (status IN ('booked','dispatched','delivered')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_draft_idx ON bookings (draft_id, created_at DESC);
