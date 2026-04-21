-- Cohort & repeat-purchase analytics module — Phase A migration
-- Applies to the live schema (existing tables: accounts, events, sync_runs,
-- profile_cache, segments, analysis_runs, product_transitions, gateway_products).
--
-- This diff is idempotent. Safe to run multiple times. If the repo normally
-- uses `drizzle-kit push` and you're fine with that, you can skip this file
-- and just run `npx drizzle-kit push`.

-- 1) brand_configs — one row per account
CREATE TABLE IF NOT EXISTS "brand_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL,
  "channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "product_groupings" jsonb,
  "cohort_granularity" text DEFAULT 'monthly' NOT NULL,
  "lookback_months" integer DEFAULT 24 NOT NULL,
  "exclude_refunds" boolean DEFAULT true NOT NULL,
  "min_order_value" real DEFAULT 0.01 NOT NULL,
  "exclude_test_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "brand_configs_account_id_accounts_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "brand_configs_account_idx"
  ON "brand_configs" ("account_id");

-- 2) analysis_runs — three new JSONB columns
ALTER TABLE "analysis_runs"
  ADD COLUMN IF NOT EXISTS "cohort_analytics_json" jsonb,
  ADD COLUMN IF NOT EXISTS "channels_snapshot_json" jsonb,
  ADD COLUMN IF NOT EXISTS "config_snapshot_json" jsonb;

-- 3) events — nullable discount_code column
ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "discount_code" text;
