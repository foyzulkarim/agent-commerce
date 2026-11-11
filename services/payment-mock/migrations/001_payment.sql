CREATE TABLE IF NOT EXISTS authorizations (
  authorization_id  uuid PRIMARY KEY,
  draft_id          uuid NOT NULL,
  offer_version     integer NOT NULL,
  amount            integer NOT NULL,         -- cents; always the approved offer total
  card_ref          text NOT NULL,
  status            text NOT NULL CHECK (status IN ('authorized','declined','unknown','captured','voided')),
  attempts          integer NOT NULL DEFAULT 1,
  capture_id        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS authorizations_draft_idx ON authorizations (draft_id, created_at DESC);
