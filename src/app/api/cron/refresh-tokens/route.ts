import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { and, lt, ne } from "drizzle-orm";
import { requireCronAuth } from "@/lib/cron-auth";
import { getFreshAccessToken } from "@/lib/klaviyo-auth";
import { log } from "@/lib/logger";

/**
 * Proactively refresh Klaviyo OAuth tokens that expire in the next 36 hours.
 *
 * Without this, a merchant who hasn't opened PJM in 30+ days would hit
 * "token expired" on their first page load and have to wait for the
 * on-demand refresh to complete. The cron keeps tokens warm.
 *
 * Runs once daily at 03:00 UTC (Vercel Hobby tier caps at daily cron).
 * 36-hour look-ahead means every token gets at least one refresh attempt
 * before actually expiring, with a 12-hour safety buffer.
 */
export async function GET(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const startedAt = Date.now();
  const lookAhead = new Date(Date.now() + 36 * 60 * 60 * 1000);

  const expiring = await db
    .select({ id: accounts.id, email: accounts.email })
    .from(accounts)
    .where(
      and(
        lt(accounts.klaviyoTokenExpiresAt, lookAhead),
        ne(accounts.email, "demo@productjourneymapper.com")
      )
    );

  const results: Array<{ accountId: string; ok: boolean; error?: string }> = [];
  for (const account of expiring) {
    try {
      await getFreshAccessToken(account.id);
      results.push({ accountId: account.id, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("cron.token_refresh_failed", { accountId: account.id }, err);
      results.push({ accountId: account.id, ok: false, error: message });
    }
  }

  const refreshed = results.filter((r) => r.ok).length;
  const failed = results.length - refreshed;

  log.info("cron.token_refresh_done", {
    scanned: expiring.length,
    refreshed,
    failed,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json({
    scanned: expiring.length,
    refreshed,
    failed,
    results,
  });
}
