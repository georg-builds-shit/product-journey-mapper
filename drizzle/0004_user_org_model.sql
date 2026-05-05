-- User + organization model for multi-tenant auth (Clerk).
-- Applied independently of the Clerk install — the tables are useful as a
-- shadow of Clerk's identity graph (for JOIN queries, analytics, audits).
-- Clerk's own user_id and org_id are used as primary keys (text, not uuid)
-- so we can upsert from Clerk webhooks with zero ID translation.
--
-- Safe to re-run (idempotent).

-- 1) users — shadow of Clerk users. Upserted from user.created / user.updated webhooks.
CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY,                         -- Clerk user_id e.g. "user_2abc..."
  "email" text NOT NULL,
  "name" text,
  "image_url" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");

-- 2) organizations — shadow of Clerk orgs. One Clerk org = one PJM workspace.
--    Multiple Klaviyo-connected accounts can live under one org (agency use case).
CREATE TABLE IF NOT EXISTS "organizations" (
  "id" text PRIMARY KEY,                         -- Clerk org_id e.g. "org_2abc..."
  "name" text NOT NULL,
  "slug" text,
  "image_url" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "organizations_slug_idx" ON "organizations" ("slug");

-- 3) organization_members — Clerk's role info, kept local for RLS queries.
CREATE TABLE IF NOT EXISTS "organization_members" (
  "organization_id" text NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL
    REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text NOT NULL DEFAULT 'basic_member',   -- Clerk's default roles: "admin" | "basic_member"
  "created_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("organization_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "organization_members_user_idx"
  ON "organization_members" ("user_id");

-- 4) Link accounts → organizations. Nullable on day 0 for backward compat;
--    backfill script (scripts/backfill-accounts-to-orgs.mjs) links existing
--    accounts to orgs after Clerk is live.
ALTER TABLE "accounts"
  ADD COLUMN IF NOT EXISTS "organization_id" text
  REFERENCES "organizations"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "accounts_organization_idx"
  ON "accounts" ("organization_id");
