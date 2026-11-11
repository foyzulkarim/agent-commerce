-- Demo catalogue (design §14). coffee-1kg starts out of stock: Mia's request waits for a restock.
-- The kettle is in stock, but the shipping mock has no courier for it (courier_unavailable).
INSERT INTO products (sku, name, description, unit_price) VALUES
  ('coffee-1kg',  'Coffee beans 1 kg',   'Medium roast whole beans, 1 kg bag',   3800),
  ('coffee-500g', 'Coffee beans 500 g',  'Medium roast whole beans, 500 g bag',  2000),
  ('tea-250g',    'Black tea 250 g',     'Loose leaf black tea, 250 g tin',      1200),
  ('kettle',      'Stovetop kettle',     'Steel stovetop kettle, 2 L, bulky',    5900)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO stock (sku, quantity) VALUES
  ('coffee-1kg', 0), ('coffee-500g', 10), ('tea-250g', 20), ('kettle', 5)
ON CONFLICT (sku) DO NOTHING;
