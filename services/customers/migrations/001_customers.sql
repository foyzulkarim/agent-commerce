CREATE TABLE IF NOT EXISTS customers (
  customer_id  text PRIMARY KEY,
  name         text NOT NULL,
  email        text NOT NULL,
  card_ref     text NOT NULL
);

CREATE TABLE IF NOT EXISTS addresses (
  customer_id  text NOT NULL REFERENCES customers (customer_id),
  line1        text NOT NULL,
  city         text NOT NULL,
  postcode     text NOT NULL,
  is_default   boolean NOT NULL DEFAULT true,
  PRIMARY KEY (customer_id, line1)
);
