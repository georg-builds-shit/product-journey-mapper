-- Add Klaviyo list/segment count cache column on brand_configs.
-- Populated by /api/segments/discover; lets repeat visits load without
-- re-hitting Klaviyo's tight single-object rate limit.
ALTER TABLE "brand_configs"
  ADD COLUMN IF NOT EXISTS "klaviyo_cache_json" jsonb;
