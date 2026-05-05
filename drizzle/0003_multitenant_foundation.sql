-- Multi-tenant foundation — defensive fixes for service-readiness.
-- Safe to re-run (idempotent).

-- 1) Partial unique index on analysis_runs: at most one in-progress run
--    per account. Closes the check-then-insert race in POST /api/analyze
--    when a user double-clicks Re-analyze within ~100ms.
CREATE UNIQUE INDEX IF NOT EXISTS "analysis_runs_account_in_progress_idx"
  ON "analysis_runs" ("account_id")
  WHERE status IN ('pending', 'ingesting', 'analyzing');

-- 2) Missing FK-covering indexes on product_transitions.
--    Dashboard queries filter by analysis_run_id; cascade deletes scan by account_id.
CREATE INDEX IF NOT EXISTS "product_transitions_run_idx"
  ON "product_transitions" ("analysis_run_id");

CREATE INDEX IF NOT EXISTS "product_transitions_account_idx"
  ON "product_transitions" ("account_id");

-- 3) Missing FK-covering indexes on gateway_products.
CREATE INDEX IF NOT EXISTS "gateway_products_run_idx"
  ON "gateway_products" ("analysis_run_id");

CREATE INDEX IF NOT EXISTS "gateway_products_account_idx"
  ON "gateway_products" ("account_id");

-- 4) Billing + quota columns on accounts. Enforcement lives in src/lib/quota.ts.
--    Plan is "free" by default for existing rows; adjust manually for paid customers.
ALTER TABLE "accounts"
  ADD COLUMN IF NOT EXISTS "plan" text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS "analysis_count_month" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "analysis_period_start" timestamp NOT NULL DEFAULT now();
