import { db } from "@/db";
import { events, syncRuns, profileCache } from "@/db/schema";
import { eq, and, desc, count, sql, min } from "drizzle-orm";
import {
  fetchMetrics,
  fetchEventsByMetricIds,
  fetchProfiles,
  fetchLists,
  fetchKlaviyoSegments,
  fetchListOrSegmentProfileIds,
  type OrderedProductEvent,
} from "./klaviyo";
import { getBrandConfig } from "./config";
import { log } from "./logger";

export interface SyncResult {
  newEvents: number;
  totalEvents: number;
  profilesSynced: number;
  syncRunId: string;
  backfillEvents: number;
}

// Default lookback if no brand_config exists yet (first sync ever). Matches
// the module's configurable default.
const DEFAULT_LOOKBACK_MONTHS = 24;
// Max pages per fetch — increased from the old 500 cap so 24-month backfills
// don't silently truncate for bigger brands.
const MAX_PAGES_INCREMENTAL = 500;
const MAX_PAGES_BACKFILL = 2000; // ~200K events, enough for most 24mo pulls

/**
 * Incrementally sync Ordered Product events + profiles from Klaviyo into the local DB.
 *
 * Events: pulls newest since last sync (or last 12 months on first sync).
 * Profiles: fetches properties + list/segment membership for all unique profiles in events.
 */
export async function syncEvents(
  accountId: string,
  accessToken: string
): Promise<SyncResult> {
  const [run] = await db
    .insert(syncRuns)
    .values({ accountId, status: "syncing" })
    .returning();

  try {
    // ── Step 0: Load brand config (for lookback_months) ──

    let lookbackMonths = DEFAULT_LOOKBACK_MONTHS;
    try {
      const config = await getBrandConfig(accountId);
      lookbackMonths = config.lookbackMonths;
    } catch (err) {
      log.warn("sync.brand_config_load_failed", { accountId }, err);
    }

    // ── Step 1: Sync events ──

    const [lastSync] = await db
      .select()
      .from(syncRuns)
      .where(
        and(
          eq(syncRuns.accountId, accountId),
          eq(syncRuns.status, "complete")
        )
      )
      .orderBy(desc(syncRuns.completedAt))
      .limit(1);

    const lastDatetime = lastSync?.lastEventDatetime ?? null;

    const metrics = await fetchMetrics(accessToken);
    const orderedProductMetric = metrics.find(
      (m: { name: string }) => m.name === "Ordered Product"
    );

    if (!orderedProductMetric) {
      throw new Error(
        "No 'Ordered Product' metric found in Klaviyo. Make sure your Shopify integration is active."
      );
    }

    // ── Step 1a: Optional historical backfill ──
    // If the config's lookback window extends further back than the earliest
    // event we currently have, pull the missing [target..earliest] window.
    // This handles the case where the user bumped lookbackMonths after an
    // initial sync: simply raising a constant wouldn't pull older data because
    // incremental sync only walks forward from the high-water mark.
    let backfillEvents = 0;
    {
      const target = new Date();
      target.setMonth(target.getMonth() - lookbackMonths);

      const [{ earliest }] = await db
        .select({ earliest: min(events.datetime) })
        .from(events)
        .where(eq(events.accountId, accountId));

      if (earliest && earliest.getTime() > target.getTime()) {
        const backfillFrom = target.toISOString();
        const backfillTo = new Date(earliest.getTime() - 1000).toISOString();
        await db
          .update(syncRuns)
          .set({ status: "backfilling" })
          .where(eq(syncRuns.id, run.id));

        const backfillRaw = await fetchEventsByMetricIds(
          accessToken,
          [orderedProductMetric.id],
          { dateFrom: backfillFrom, dateTo: backfillTo, maxPages: MAX_PAGES_BACKFILL }
        );

        backfillEvents = await upsertEventBatches(accountId, backfillRaw);

        await db
          .update(syncRuns)
          .set({ status: "syncing" })
          .where(eq(syncRuns.id, run.id));
      }
    }

    // ── Step 1b: Forward/incremental pull ──
    const fetchOptions: { dateFrom?: string; maxPages?: number } = {};
    if (lastDatetime) {
      const from = new Date(lastDatetime.getTime() + 1000);
      fetchOptions.dateFrom = from.toISOString();
    } else {
      const lookbackStart = new Date();
      lookbackStart.setMonth(lookbackStart.getMonth() - lookbackMonths);
      fetchOptions.dateFrom = lookbackStart.toISOString().slice(0, 10);
    }
    fetchOptions.maxPages = MAX_PAGES_INCREMENTAL;

    const rawEvents = await fetchEventsByMetricIds(
      accessToken,
      [orderedProductMetric.id],
      fetchOptions
    );

    // Upsert events
    const inserted = await upsertEventBatches(accountId, rawEvents);

    // ── Step 2: Sync profiles ──

    // Get all unique profile IDs from events table
    const profileRows = await db
      .selectDistinct({ profileId: events.profileId })
      .from(events)
      .where(eq(events.accountId, accountId));

    const allProfileIds = profileRows.map((r) => r.profileId);

    // Check which profiles are already cached
    const cachedRows = await db
      .select({ klaviyoProfileId: profileCache.klaviyoProfileId })
      .from(profileCache)
      .where(eq(profileCache.accountId, accountId));

    const cachedIds = new Set(cachedRows.map((r) => r.klaviyoProfileId));
    const missingIds = allProfileIds.filter((id) => !cachedIds.has(id));

    // Fetch missing profiles from Klaviyo
    let profilesSynced = 0;
    if (missingIds.length > 0) {
      const freshProfiles = await fetchProfiles(accessToken, missingIds);
      const profileBatchSize = 100;

      for (let i = 0; i < freshProfiles.length; i += profileBatchSize) {
        const batch = freshProfiles.slice(i, i + profileBatchSize);
        const values = batch.map((p) => ({
          accountId,
          klaviyoProfileId: p.id,
          properties: p.properties,
          location: p.location,
        }));

        if (values.length > 0) {
          await db
            .insert(profileCache)
            .values(values)
            .onConflictDoUpdate({
              target: [profileCache.accountId, profileCache.klaviyoProfileId],
              set: {
                properties: sql`EXCLUDED.properties`,
                location: sql`EXCLUDED.location`,
                updatedAt: new Date(),
              },
            });
          profilesSynced += values.length;
        }
      }
    }

    // List/segment membership is fetched on-demand when a segment filter is applied,
    // not during sync (too heavy — 32 lists × paginated fetches).

    // ── Finalize ──

    const [{ total }] = await db
      .select({ total: count() })
      .from(events)
      .where(eq(events.accountId, accountId));

    const newestDatetime =
      rawEvents.length > 0
        ? new Date(
            Math.max(...rawEvents.map((e) => new Date(e.datetime).getTime()))
          )
        : lastDatetime;

    await db
      .update(syncRuns)
      .set({
        status: "complete",
        eventsSynced: inserted,
        totalEvents: Number(total),
        lastEventDatetime: newestDatetime,
        completedAt: new Date(),
      })
      .where(eq(syncRuns.id, run.id));

    return {
      newEvents: inserted,
      totalEvents: Number(total),
      profilesSynced,
      syncRunId: run.id,
      backfillEvents,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await db
      .update(syncRuns)
      .set({
        status: "failed",
        error: message,
        completedAt: new Date(),
      })
      .where(eq(syncRuns.id, run.id));
    throw error;
  }
}

/**
 * Upsert a list of raw Klaviyo events into the `events` table. Batches in
 * groups of 100; idempotent on (account_id, klaviyo_event_id). Returns the
 * number of newly inserted rows (conflicts skipped).
 */
async function upsertEventBatches(
  accountId: string,
  rawEvents: OrderedProductEvent[]
): Promise<number> {
  const batchSize = 100;
  let inserted = 0;

  for (let i = 0; i < rawEvents.length; i += batchSize) {
    const batch = rawEvents.slice(i, i + batchSize);
    const values = batch
      .filter((e) => e.profileId && e.datetime)
      .map((e) => ({
        accountId,
        klaviyoEventId: e.id,
        profileId: e.profileId,
        datetime: new Date(e.datetime),
        value: e.value || 0,
        productName: e.productName || "Unknown",
        productId: e.productId || null,
        categories: e.categories || [],
        productType: e.productType || null,
        brand: e.brand || null,
        quantity: e.quantity || 1,
        orderId: e.orderId || null,
        sku: e.sku || null,
        discountCode: e.discountCode || null,
      }));

    if (values.length > 0) {
      const result = await db
        .insert(events)
        .values(values)
        .onConflictDoNothing({
          target: [events.accountId, events.klaviyoEventId],
        })
        .returning({ id: events.id });
      inserted += result.length;
    }
  }

  return inserted;
}
