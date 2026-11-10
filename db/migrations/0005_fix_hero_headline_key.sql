-- 0005_fix_hero_headline_key.sql — corrective migration.
--
-- 0003 seeded the homepage headline under the key ' Hero_headline' (a stray
-- leading space). The storefront reads businessSetting("hero_headline"), so the
-- setting never matched and the homepage silently fell back to its hard-coded
-- default. This migration moves the value to the correct key and removes the
-- malformed one. It is idempotent and safe to run on a fresh or existing database.

UPDATE business_settings
   SET key = 'hero_headline'
 WHERE key = ' Hero_headline'
   AND NOT EXISTS (SELECT 1 FROM business_settings WHERE key = 'hero_headline');

DELETE FROM business_settings WHERE key = ' Hero_headline';

-- Seed any homepage settings that are missing (no-ops when already present).
INSERT OR IGNORE INTO business_settings(key, value) VALUES
  ('hero_headline', 'Refreshing drinks, made fresh daily.'),
  ('hero_subhead', 'Juices, smoothies, fruit blends and snacks from MnM Juice Bar, Kabuku, Limuru.'),
  ('hero_cta', 'Order Now');
