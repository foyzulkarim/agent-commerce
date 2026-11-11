-- No real email (design rule 9): each email is printed to the console and saved here. The inbox page reads it.
CREATE TABLE IF NOT EXISTS emails (
  email_id       uuid PRIMARY KEY,
  customer_id    text NOT NULL,
  to_address     text NOT NULL,
  draft_id       uuid NOT NULL,
  reason         text NOT NULL,
  subject        text NOT NULL,
  body           text NOT NULL,
  decision_ids   jsonb NOT NULL DEFAULT '[]',
  actions        jsonb NOT NULL DEFAULT '[]',   -- links built by code, never by the agent
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS emails_customer_idx ON emails (customer_id, created_at DESC);
