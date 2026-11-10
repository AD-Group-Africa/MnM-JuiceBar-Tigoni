-- 0007_tigoni_branding.sql — Rebrand storefront to "M&M Juice Bar Tigoni".
--
-- Additive only. Updates existing business_settings rows; nothing is deleted.
-- Safe to re-run (UPDATE is idempotent for the same value).
-- Physical address (Kabuku, Limuru) is preserved — it is the real operating location.

UPDATE business_settings
   SET value = 'M&M Juice Bar',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE key = 'business_name';

UPDATE business_settings
   SET value = 'Tigoni''s fresh juice bar. Handmade daily.',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE key = 'tagline';

UPDATE business_settings
   SET value = 'Tigoni''s fresh juice bar. Handmade daily.',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE key = 'hero_headline';

UPDATE business_settings
   SET value = 'Fresh juices, smoothies, fruit blends and snacks — pressed fresh at M&M Juice Bar Tigoni.',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE key = 'hero_subhead';

UPDATE business_settings
   SET value = 'Order Now',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE key = 'hero_cta';