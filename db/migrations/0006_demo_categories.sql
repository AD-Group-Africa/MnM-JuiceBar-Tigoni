-- 0006_demo_categories.sql — additional menu categories for the MnM Juice Bar catalogue.
-- Additive only: two new categories, existing categories are untouched.
-- (The demonstration products themselves live in db/seed-demo.ts, not in a migration,
--  so production databases never inherit demo products.)

INSERT OR IGNORE INTO product_categories(id, name, description, sort_order) VALUES
  (6, 'Milkshakes', 'Thick, creamy milkshakes — classic flavours made to order.', 25),
  (7, 'Mocktails', 'Alcohol-free mixed drinks: fresh, fruity and fun.', 35);
