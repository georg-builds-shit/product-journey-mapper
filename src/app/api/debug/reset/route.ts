import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events, syncRuns, analysisRuns, productTransitions, gatewayProducts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";

// Clears all cached data for an account so it re-syncs fresh
export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const { accountId } = await request.json();
  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  // Delete in correct order (foreign keys)
  await db.delete(productTransitions).where(eq(productTransitions.accountId, accountId));
  await db.delete(gatewayProducts).where(eq(gatewayProducts.accountId, accountId));
  await db.delete(analysisRuns).where(eq(analysisRuns.accountId, accountId));
  await db.delete(events).where(eq(events.accountId, accountId));
  await db.delete(syncRuns).where(eq(syncRuns.accountId, accountId));

  return NextResponse.json({ status: "reset", accountId });
}
