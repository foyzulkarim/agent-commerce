-- Demo customers (design §14, seed data and fault triggers). The fault comes from the row, not from a toggle.
INSERT INTO customers (customer_id, name, email, card_ref) VALUES
  ('cust-mia',  'Mia',  'mia@example.test',  'card-ok'),       -- success path
  ('cust-dan',  'Dan',  'dan@example.test',  'card-decline'),  -- payment declined
  ('cust-nora', 'Nora', 'nora@example.test', 'card-ok'),       -- address does not resolve
  ('cust-leo',  'Leo',  'leo@example.test',  'card-ok'),       -- remote postcode: quote differs from the offer
  ('cust-ivy',  'Ivy',  'ivy@example.test',  'card-unknown')   -- payment result unknown
ON CONFLICT (customer_id) DO NOTHING;

INSERT INTO addresses (customer_id, line1, city, postcode) VALUES
  ('cust-mia',  '12 Lygon St',     'Carlton',        '3053'),
  ('cust-dan',  '8 Collins St',    'Melbourne',      '3000'),
  ('cust-nora', '1 Nowhere Rd',    'Atlantis',       '0000'),
  ('cust-leo',  '4 Todd St',       'Alice Springs',  '0870'),
  ('cust-ivy',  '30 Brunswick St', 'Fitzroy',        '3065')
ON CONFLICT (customer_id, line1) DO NOTHING;
