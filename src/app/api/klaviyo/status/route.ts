import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getFreshAccessToken } from "@/lib/klaviyo-auth";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/klaviyo/status?accountId=X
 *
 * Returns the Klaviyo connection health for a given account. The dashboard
 * header polls this on mount and shows a green "Connected" chip, or an
 * amber "Reconnect" button when the refresh token no longer works.
 *
 * Response:
 *   { connected: true, email, expiresAt, willRefreshAt }
 *   { connected: false, reason: "no_account" | "refresh_failed" | "never_connected", message? }
 */
export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId));

  if (!account) {
    return NextResponse.json({
      connected: false,
      reason: "no_account",
    });
  }

  if (account.email === "demo@productjourneymapper.com") {
    return NextResponse.json({
      connected: true,
      email: account.email,
      demo: true,
    });
  }

  try {
    // This will refresh the token if it's expired (and persist the new one).
    // Succeeds = we have a live connection to Klaviyo. Fails = merchant has
    // revoked the app or the refresh token itself is invalid.
    await getFreshAccessToken(accountId);

    // Re-read so we return the freshly-stored expiry
    const [fresh] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, accountId));

    return NextResponse.json({
      connected: true,
      email: fresh.email,
      expiresAt: fresh.klaviyoTokenExpiresAt?.toISOString() ?? null,
    });
  } catch (err) {
    return NextResponse.json({
      connected: false,
      reason: "refresh_failed",
      email: account.email,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
