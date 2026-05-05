import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { log } from "@/lib/logger";

/**
 * GDPR-compliant account purge. All tenant-scoped tables cascade from
 * `accounts` (events, analysis_runs, product_transitions, gateway_products,
 * sync_runs, profile_cache, segments, brand_configs) so a single delete
 * wipes every row. Klaviyo tokens go with the accounts row.
 *
 * Irreversible. Intended to be wired up behind a confirm-with-email step
 * in the UI before public launch.
 */
export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const { accountId, confirm } = await request.json().catch(() => ({}));

  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  if (confirm !== "DELETE") {
    return NextResponse.json(
      { error: "confirm must be the literal string 'DELETE'" },
      { status: 400 }
    );
  }

  const [existing] = await db
    .select({ id: accounts.id, email: accounts.email })
    .from(accounts)
    .where(eq(accounts.id, accountId));

  if (!existing) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  await db.delete(accounts).where(eq(accounts.id, accountId));

  log.warn("account.deleted", {
    accountId,
    emailHash: hashEmail(existing.email),
  });

  return NextResponse.json({ status: "deleted", accountId });
}

// One-way hash so we can prove a deletion happened without re-storing the PII.
function hashEmail(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) {
    h = (h * 31 + email.charCodeAt(i)) | 0;
  }
  return `h${(h >>> 0).toString(16)}`;
}
