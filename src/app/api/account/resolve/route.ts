import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/account/resolve
 *
 * Returns the Klaviyo-connected account for the caller's active organization.
 * Used by the dashboard + settings pages to auto-redirect when they're opened
 * without an explicit `?accountId=` query param.
 *
 * If the org has no connected Klaviyo account yet, returns { accountId: null }
 * so the client can send the user to the Connect Klaviyo flow.
 */
export async function GET() {
  const { userId, orgId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!orgId) {
    return NextResponse.json(
      { error: "No active organization", accountId: null },
      { status: 400 }
    );
  }

  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.organizationId, orgId))
    .limit(1);

  return NextResponse.json({ accountId: account?.id ?? null, orgId });
}
