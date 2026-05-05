import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, brandConfigs } from "@/db/schema";
import { eq, ne } from "drizzle-orm";
import { requireCronAuth } from "@/lib/cron-auth";
import { getFreshAccessToken } from "@/lib/klaviyo-auth";
import { fetchLists, fetchKlaviyoSegments } from "@/lib/klaviyo";
import { log } from "@/lib/logger";

/**
 * Nightly pre-warm of each account's Klaviyo list/segment count cache.
 *
 * The /api/segments/discover endpoint (used by the Settings page) reads this
 * cache. A cold load can take 15–60s because Klaviyo's profile-count enrich
 * path is aggressively rate-limited per-object. The cron runs at 02:00 UTC
 * so the cache is warm when merchants open PJM during the day.
 *
 * Errors are isolated per-account — one bad merchant doesn't block the others.
 */
export async function GET(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const startedAt = Date.now();

  const rows = await db
    .select({ id: accounts.id, email: accounts.email })
    .from(accounts)
    .where(ne(accounts.email, "demo@productjourneymapper.com"));

  const results: Array<{
    accountId: string;
    ok: boolean;
    lists?: number;
    segments?: number;
    error?: string;
  }> = [];

  for (const account of rows) {
    try {
      const { accessToken } = await getFreshAccessToken(account.id);
      const [lists, segments] = await Promise.all([
        fetchLists(accessToken),
        fetchKlaviyoSegments(accessToken),
      ]);

      const now = Date.now();
      const listsCache: Record<string, unknown> = {};
      for (const l of lists) {
        listsCache[l.id] = {
          profileCount: l.profileCount ?? null,
          name: l.name,
          fetchedAt: now,
        };
      }
      const segmentsCache: Record<string, unknown> = {};
      for (const s of segments) {
        segmentsCache[s.id] = {
          profileCount: s.profileCount ?? null,
          name: s.name,
          fetchedAt: now,
        };
      }

      await db
        .insert(brandConfigs)
        .values({
          accountId: account.id,
          klaviyoCacheJson: { lists: listsCache, segments: segmentsCache },
        })
        .onConflictDoUpdate({
          target: brandConfigs.accountId,
          set: {
            klaviyoCacheJson: { lists: listsCache, segments: segmentsCache },
            updatedAt: new Date(),
          },
        });

      results.push({
        accountId: account.id,
        ok: true,
        lists: lists.length,
        segments: segments.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("cron.klaviyo_prewarm_failed", { accountId: account.id }, err);
      results.push({ accountId: account.id, ok: false, error: message });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  log.info("cron.klaviyo_prewarm_done", {
    scanned: rows.length,
    ok,
    failed: rows.length - ok,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json({ scanned: rows.length, ok, results });
}
