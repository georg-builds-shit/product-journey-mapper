import { db } from "@/db";
import { accounts } from "@/db/schema";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { log } from "@/lib/logger";

/**
 * Per-account analyze quota enforcement.
 *
 * Kept deliberately simple: one DB UPDATE per analyze request that both
 * checks the quota and increments the counter atomically. The window is
 * rolling-month, reset lazily on the first call after the 30d window lapses.
 *
 * Upgrade path: when we add Redis (Upstash) for rate limiting, move this
 * over to a sliding-window counter there and keep the DB column as a
 * long-term usage total for billing.
 */

export type Plan = "free" | "pro" | "enterprise" | "demo";

// No pricing yet — all plans unlimited. The counter still increments so we
// have per-account usage data when pricing lands. Swap these values in when
// tiers are decided; enforcement logic below already branches on null.
const ANALYZE_LIMITS: Record<Plan, number | null> = {
  free: null,
  pro: null,
  enterprise: null,
  demo: null,
};

export type QuotaResult =
  | { ok: true; count: number; limit: number | null; plan: Plan }
  | { ok: false; reason: "quota_exceeded"; count: number; limit: number; plan: Plan };

/**
 * Atomically check + increment the analyze quota for an account.
 * Returns { ok: false } if the limit would be exceeded.
 *
 * Call this in the analyze POST handler after the auth + in-progress checks.
 * If it returns not-ok, respond with 429.
 */
export async function consumeAnalyzeQuota(accountId: string): Promise<QuotaResult> {
  const [account] = await db
    .select({
      plan: accounts.plan,
      count: accounts.analysisCountMonth,
      periodStart: accounts.analysisPeriodStart,
    })
    .from(accounts)
    .where(eq(accounts.id, accountId));

  if (!account) {
    return { ok: false, reason: "quota_exceeded", count: 0, limit: 0, plan: "free" };
  }

  const plan = (account.plan as Plan) || "free";
  const limit = ANALYZE_LIMITS[plan];
  const windowExpired = account.periodStart < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Unlimited plans: count for usage metering only, never reject.
  if (limit === null) {
    await db
      .update(accounts)
      .set({
        analysisCountMonth: windowExpired ? 1 : sql`${accounts.analysisCountMonth} + 1`,
        analysisPeriodStart: windowExpired ? new Date() : account.periodStart,
      })
      .where(eq(accounts.id, accountId));
    return { ok: true, count: windowExpired ? 1 : account.count + 1, limit: null, plan };
  }

  // Conditional update — only succeeds if under the cap or the window has rolled.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const updated = await db
    .update(accounts)
    .set({
      analysisCountMonth: sql`CASE
        WHEN ${accounts.analysisPeriodStart} < ${thirtyDaysAgo} THEN 1
        ELSE ${accounts.analysisCountMonth} + 1
      END`,
      analysisPeriodStart: sql`CASE
        WHEN ${accounts.analysisPeriodStart} < ${thirtyDaysAgo} THEN NOW()
        ELSE ${accounts.analysisPeriodStart}
      END`,
    })
    .where(
      and(
        eq(accounts.id, accountId),
        or(
          lt(accounts.analysisCountMonth, limit),
          lt(accounts.analysisPeriodStart, thirtyDaysAgo)
        )
      )
    )
    .returning({ count: accounts.analysisCountMonth });

  if (updated.length === 0) {
    log.warn("quota.exceeded", { accountId, plan, limit, count: account.count });
    return {
      ok: false,
      reason: "quota_exceeded",
      count: account.count,
      limit,
      plan,
    };
  }

  return { ok: true, count: updated[0].count ?? 0, limit, plan };
}
