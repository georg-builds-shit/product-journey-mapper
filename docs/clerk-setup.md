# Clerk setup — user + organization auth

This is the go-live guide for swapping shared-secret auth for Clerk. All the
schema plumbing is already in place (migration `0004_user_org_model.sql`,
`users` / `organizations` / `organization_members` tables in `schema.ts`,
nullable `accounts.organization_id` FK).

## 1. Create the Clerk project

1. Sign up at https://clerk.com
2. Create a new application. Enable:
   - **Email** (magic link) or **Email + Password** — your call
   - **Organizations** feature (Settings → Organizations → enable)
   - Keep **Personal accounts** enabled too (one-person agencies)
3. Grab the keys from the API Keys page:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (starts with `pk_live_` or `pk_test_`)
   - `CLERK_SECRET_KEY` (starts with `sk_live_` or `sk_test_`)
4. Add both to Vercel env (production, preview, development).

## 2. Install

```bash
cd app
npm install @clerk/nextjs@latest svix
```

`svix` is needed for webhook signature verification.

## 3. Apply migration 0004

```bash
node scripts/run-migration.mjs drizzle/0004_user_org_model.sql
```

Creates `users`, `organizations`, `organization_members`, adds
`accounts.organization_id` (nullable).

## 4. Drop in the scaffold files

Each file below is a template. Paste into the path and commit.

### `src/middleware.ts`

```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks/clerk",
  "/api/inngest(.*)",
  "/api/klaviyo/callback",
  "/api/cron/(.*)",
  "/api/demo",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
```

### `src/app/layout.tsx` — wrap with `<ClerkProvider>`

```tsx
import { ClerkProvider } from "@clerk/nextjs";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

### `src/app/sign-in/[[...sign-in]]/page.tsx`

```tsx
import { SignIn } from "@clerk/nextjs";
export default function Page() {
  return <SignIn />;
}
```

### `src/app/sign-up/[[...sign-up]]/page.tsx`

```tsx
import { SignUp } from "@clerk/nextjs";
export default function Page() {
  return <SignUp />;
}
```

### `src/app/api/webhooks/clerk/route.ts`

Clerk webhook that keeps local `users` / `organizations` /
`organization_members` in sync. Handles: user.created, user.updated,
user.deleted, organization.created, organization.updated,
organization.deleted, organizationMembership.created,
organizationMembership.updated, organizationMembership.deleted.

```ts
import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { db } from "@/db";
import { users, organizations, organizationMembers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { log } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CLERK_WEBHOOK_SECRET not set" }, { status: 500 });
  }

  const headers = {
    "svix-id": request.headers.get("svix-id")!,
    "svix-timestamp": request.headers.get("svix-timestamp")!,
    "svix-signature": request.headers.get("svix-signature")!,
  };
  const body = await request.text();

  let evt: any;
  try {
    evt = new Webhook(secret).verify(body, headers);
  } catch (err) {
    log.warn("clerk.webhook_verify_failed", {}, err);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const { type, data } = evt as { type: string; data: any };
  log.info("clerk.webhook_received", { type, id: data.id });

  switch (type) {
    case "user.created":
    case "user.updated":
      await db
        .insert(users)
        .values({
          id: data.id,
          email: data.email_addresses?.[0]?.email_address ?? "",
          name: [data.first_name, data.last_name].filter(Boolean).join(" ") || null,
          imageUrl: data.image_url ?? null,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: data.email_addresses?.[0]?.email_address ?? "",
            name: [data.first_name, data.last_name].filter(Boolean).join(" ") || null,
            imageUrl: data.image_url ?? null,
            updatedAt: new Date(),
          },
        });
      break;

    case "user.deleted":
      if (data.id) await db.delete(users).where(eq(users.id, data.id));
      break;

    case "organization.created":
    case "organization.updated":
      await db
        .insert(organizations)
        .values({
          id: data.id,
          name: data.name,
          slug: data.slug ?? null,
          imageUrl: data.image_url ?? null,
        })
        .onConflictDoUpdate({
          target: organizations.id,
          set: {
            name: data.name,
            slug: data.slug ?? null,
            imageUrl: data.image_url ?? null,
            updatedAt: new Date(),
          },
        });
      break;

    case "organization.deleted":
      if (data.id) await db.delete(organizations).where(eq(organizations.id, data.id));
      break;

    case "organizationMembership.created":
    case "organizationMembership.updated":
      await db
        .insert(organizationMembers)
        .values({
          organizationId: data.organization.id,
          userId: data.public_user_data.user_id,
          role: data.role ?? "basic_member",
        })
        .onConflictDoUpdate({
          target: [organizationMembers.organizationId, organizationMembers.userId],
          set: { role: data.role ?? "basic_member" },
        });
      break;

    case "organizationMembership.deleted":
      await db
        .delete(organizationMembers)
        .where(
          eq(organizationMembers.organizationId, data.organization.id)
        );
      break;
  }

  return NextResponse.json({ ok: true });
}
```

Add `CLERK_WEBHOOK_SECRET` to Vercel env — pulled from the Webhooks page
after creating the endpoint `https://product-journey-mapper.vercel.app/api/webhooks/clerk`.

## 5. Replace `requireAuth` call sites

Once Clerk is live, swap `requireAuth(request)` in every API route for the
Clerk session check:

```ts
import { auth } from "@clerk/nextjs/server";

const { userId, orgId } = await auth();
if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// For account-scoped routes, also verify the caller's org owns the account:
if (orgId !== account.organizationId) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

The dashboard client calls (dashboard/page.tsx, settings/page.tsx,
ConnectionStatus.tsx, etc.) that currently pass `x-api-key` can drop the
header entirely — Clerk's session cookie is automatically included.

## 6. Backfill existing accounts

For the single brand already in prod (account `29a83dec-...`), you'll need
to manually link it to an org after signing in:

```sql
-- Run once after signing into the first Clerk org:
UPDATE accounts
SET organization_id = 'org_...'
WHERE email = 'georg@beyondwelcome.com';
```

## 7. RLS policies (defense in depth)

Once every API route resolves `orgId` from Clerk, add RLS so even a bug that
forgets to filter can't leak rows. Run this in Neon:

```sql
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
-- ... every tenant-scoped table

CREATE POLICY accounts_org_isolation ON accounts
  FOR ALL
  USING (organization_id = current_setting('app.current_org_id', true));
-- ... similar for every tenant-scoped table, joining via accounts.organization_id
```

Then in `src/db/index.ts`, set the GUC per request:

```ts
await sql`SET LOCAL app.current_org_id = ${orgId}`;
```

## What we skipped

- **Personal-account migration**: the current single brand is linked to
  `georg@beyondwelcome.com`. It'll sign in as a Clerk user, then create or
  join an org. The one-time SQL in step 6 links the legacy row.
- **Invite flow UI**: Clerk ships an `<OrganizationProfile />` component
  that handles invitations. Drop it on a `/settings/team` page when ready.
- **Role-based UI**: `admin` role can delete accounts / change plan;
  `basic_member` can view + run analyses. Gate via `auth().sessionClaims.org_role`.

## Removing the old APP_SECRET path

Once Clerk is carrying all traffic, drop the `APP_SECRET` + `NEXT_PUBLIC_APP_SECRET`
env vars from Vercel. Delete `src/lib/auth.ts` and remove every `requireAuth(request)`
import. Cron routes keep their own `CRON_SECRET`.
