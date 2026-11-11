CREATE TABLE IF NOT EXISTS products (
  sku          text PRIMARY KEY,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  unit_price   integer NOT NULL CHECK (unit_price >= 0)   -- minor units (cents), AUD
);

CREATE TABLE IF NOT EXISTS stock (
  sku       text PRIMARY KEY REFERENCES products (sku),
  quantity  integer NOT NULL CHECK (quantity >= 0)
);

-- One row per draft and SKU. A newer offer version of the same draft replaces the rows.
CREATE TABLE IF NOT EXISTS reservations (
  draft_id       text NOT NULL,
  offer_version  integer NOT NULL,
  sku            text NOT NULL REFERENCES products (sku),
  quantity       integer NOT NULL CHECK (quantity > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_id, sku)
);
