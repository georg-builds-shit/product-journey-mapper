import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { db } from "@/db";
import { users, organizations, organizationMembers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { log } from "@/lib/logger";

/**
 * Clerk webhook sink. Keeps local `users` / `organizations` /
 * `organization_members` in sync with Clerk's identity graph.
 *
 * The endpoint URL `/api/webhooks/clerk` is public (bypassed by
 * middleware in src/middleware.ts) — signature verification via svix
 * + CLERK_WEBHOOK_SECRET is the only auth.
 *
 * To wire up: create a webhook in Clerk dashboard → Configure →
 * Webhooks with this URL and subscribe to:
 *   user.created, user.updated, user.deleted,
 *   organization.created, organization.updated, organization.deleted,
 *   organizationMembership.created, organizationMembership.updated,
 *   organizationMembership.deleted
 * Then copy the signing secret → CLERK_WEBHOOK_SECRET in Vercel env.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    log.error("clerk.webhook_no_secret", {});
    return NextResponse.json({ error: "CLERK_WEBHOOK_SECRET not set" }, { status: 500 });
  }

  const svixHeaders = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  };

  if (!svixHeaders["svix-id"] || !svixHeaders["svix-timestamp"] || !svixHeaders["svix-signature"]) {
    return NextResponse.json({ error: "Missing svix headers" }, { status: 400 });
  }

  const body = await request.text();

  let evt: { type: string; data: Record<string, unknown> };
  try {
    evt = new Webhook(secret).verify(body, svixHeaders) as typeof evt;
  } catch (err) {
    log.warn("clerk.webhook_verify_failed", {}, err);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const { type, data } = evt;
  log.info("clerk.webhook_received", { type, id: (data as { id?: string }).id });

  try {
    await handleEvent(type, data);
  } catch (err) {
    log.error("clerk.webhook_handler_failed", { type, id: (data as { id?: string }).id }, err);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

async function handleEvent(type: string, data: Record<string, unknown>): Promise<void> {
  switch (type) {
    case "user.created":
    case "user.updated": {
      const d = data as {
        id: string;
        email_addresses?: Array<{ email_address: string }>;
        first_name?: string | null;
        last_name?: string | null;
        image_url?: string | null;
      };
      const email = d.email_addresses?.[0]?.email_address ?? "";
      const name = [d.first_name, d.last_name].filter(Boolean).join(" ") || null;
      await db
        .insert(users)
        .values({
          id: d.id,
          email,
          name,
          imageUrl: d.image_url ?? null,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: { email, name, imageUrl: d.image_url ?? null, updatedAt: new Date() },
        });
      return;
    }

    case "user.deleted": {
      const d = data as { id?: string };
      if (d.id) await db.delete(users).where(eq(users.id, d.id));
      return;
    }

    case "organization.created":
    case "organization.updated": {
      const d = data as {
        id: string;
        name: string;
        slug?: string | null;
        image_url?: string | null;
      };
      await db
        .insert(organizations)
        .values({
          id: d.id,
          name: d.name,
          slug: d.slug ?? null,
          imageUrl: d.image_url ?? null,
        })
        .onConflictDoUpdate({
          target: organizations.id,
          set: {
            name: d.name,
            slug: d.slug ?? null,
            imageUrl: d.image_url ?? null,
            updatedAt: new Date(),
          },
        });
      return;
    }

    case "organization.deleted": {
      const d = data as { id?: string };
      if (d.id) await db.delete(organizations).where(eq(organizations.id, d.id));
      return;
    }

    case "organizationMembership.created":
    case "organizationMembership.updated": {
      const d = data as {
        organization: { id: string };
        public_user_data: { user_id: string };
        role?: string;
      };
      await db
        .insert(organizationMembers)
        .values({
          organizationId: d.organization.id,
          userId: d.public_user_data.user_id,
          role: d.role ?? "basic_member",
        })
        .onConflictDoUpdate({
          target: [organizationMembers.organizationId, organizationMembers.userId],
          set: { role: d.role ?? "basic_member" },
        });
      return;
    }

    case "organizationMembership.deleted": {
      const d = data as {
        organization: { id: string };
        public_user_data: { user_id: string };
      };
      await db
        .delete(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, d.organization.id),
            eq(organizationMembers.userId, d.public_user_data.user_id)
          )
        );
      return;
    }

    default:
      // Unhandled event types are acknowledged but logged for visibility.
      log.info("clerk.webhook_unhandled", { type });
  }
}
