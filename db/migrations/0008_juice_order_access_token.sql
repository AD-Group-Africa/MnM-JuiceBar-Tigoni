-- Guest access token for juice order status pages. Only the SHA-256 hash is
-- stored; the raw token is returned once at checkout or after a successful
-- reference + phone lookup.
ALTER TABLE juice_orders ADD COLUMN access_token_hash TEXT;
