import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { profileCache, accounts, brandConfigs } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  fetchMetrics,
  fetchLists,
  fetchKlaviyoSegments,
  type KlaviyoListOrSegment,
} from "@/lib/klaviyo";
import { requireAuth } from "@/lib/auth";
import { getFreshAccessToken } from "@/lib/klaviyo-auth";

// Cache TTL for Klaviyo list/segment counts. 1 hour is a comfortable window:
// segment membership changes slowly enough in practice that stale-by-an-hour
// counts are fine in the picker UI, and it keeps the settings page snappy
// on repeat visits instead of re-hitting Klaviyo's tight single-object
// rate limit (~1 req/s per endpoint).
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  id: string;
  name: string;
  profileCount: number;
  fetchedAt: string; // ISO
}

interface KlaviyoCache {
  lists?: Record<string, CacheEntry>;
  segments?: Record<string, CacheEntry>;
}

export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const accountId = request.nextUrl.searchParams.get("accountId");
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  // ─── Profile properties (from local cache, always fresh-enough) ───
  const profiles = await db
    .select({
      properties: profileCache.properties,
      listIds: profileCache.listIds,
      segmentIds: profileCache.segmentIds,
    })
    .from(profileCache)
    .where(eq(profileCache.accountId, accountId))
    .limit(200);

  const propertyKeys = new Set<string>();
  const propertySamples: Record<string, Set<string>> = {};

  for (const p of profiles) {
    const props = p.properties as Record<string, unknown> | null;
    if (!props) continue;
    for (const [key, value] of Object.entries(props)) {
      propertyKeys.add(key);
      if (!propertySamples[key]) propertySamples[key] = new Set();
      if (propertySamples[key].size < 10 && value != null) {
        propertySamples[key].add(String(value));
      }
    }
  }

  // ─── Load existing Klaviyo cache (populated by previous discover calls) ───
  const [cfg] = await db
    .select({ klaviyoCacheJson: brandConfigs.klaviyoCacheJson })
    .from(brandConfigs)
    .where(eq(brandConfigs.accountId, accountId));
  const cache: KlaviyoCache = (cfg?.klaviyoCacheJson as KlaviyoCache) || {};

  const cacheStale = (entries: Record<string, CacheEntry> | undefined): boolean => {
    if (!entries) return true;
    const values = Object.values(entries);
    if (values.length === 0) return true;
    const oldest = Math.min(
      ...values.map((e) => new Date(e.fetchedAt).getTime())
    );
    return Date.now() - oldest > CACHE_TTL_MS;
  };

  const listsStale = cacheStale(cache.lists);
  const segmentsStale = cacheStale(cache.segments);

  let availableMetrics: Array<{ id: string; name: string; integration: string | null }> = [];
  let availableLists: KlaviyoListOrSegment[] = [];
  let availableKlaviyoSegments: KlaviyoListOrSegment[] = [];

  try {
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, accountId));

    const isDemoAccount = account?.email === "demo@productjourneymapper.com";

    if (account && !isDemoAccount) {
      // Always refresh metrics (lightweight) and any stale cache shards
      const { accessToken } = await getFreshAccessToken(accountId);

      const metricsP = fetchMetrics(accessToken);
      const listsP =
        forceRefresh || listsStale
          ? fetchLists(accessToken)
          : Promise.resolve(Object.values(cache.lists || {}));
      const segmentsP =
        forceRefresh || segmentsStale
          ? fetchKlaviyoSegments(accessToken)
          : Promise.resolve(Object.values(cache.segments || {}));

      [availableMetrics, availableLists, availableKlaviyoSegments] = await Promise.all([
        metricsP,
        listsP,
        segmentsP,
      ]);

      // Write-through to cache if we hit Klaviyo this round
      if (forceRefresh || listsStale || segmentsStale) {
        const now = new Date().toISOString();
        const newCache: KlaviyoCache = {
          lists: Object.fromEntries(
            availableLists.map((l) => [
              l.id,
              { id: l.id, name: l.name, profileCount: l.profileCount, fetchedAt: now },
            ])
          ),
          segments: Object.fromEntries(
            availableKlaviyoSegments.map((s) => [
              s.id,
              { id: s.id, name: s.name, profileCount: s.profileCount, fetchedAt: now },
            ])
          ),
        };
        // Only overwrite shards we refreshed
        const merged: KlaviyoCache = { ...cache };
        if (forceRefresh || listsStale) merged.lists = newCache.lists;
        if (forceRefresh || segmentsStale) merged.segments = newCache.segments;

        await db
          .update(brandConfigs)
          .set({ klaviyoCacheJson: merged, updatedAt: new Date() })
          .where(eq(brandConfigs.accountId, accountId));
      }
    }
  } catch (err) {
    console.error("Klaviyo discover fetch failed:", err);
    return NextResponse.json({
      profileProperties: Array.from(propertyKeys).map((key) => ({
        key,
        sampleValues: Array.from(propertySamples[key] || []),
      })),
      eventTypes: [],
      lists: Object.values(cache.lists || {}),
      klaviyoSegments: Object.values(cache.segments || {}),
      _error: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({
    profileProperties: Array.from(propertyKeys).map((key) => ({
      key,
      sampleValues: Array.from(propertySamples[key] || []),
    })),
    eventTypes: availableMetrics.map((m) => ({
      id: m.id,
      name: m.name,
      integration: m.integration,
    })),
    lists: availableLists,
    klaviyoSegments: availableKlaviyoSegments,
    _cacheAgeSeconds: listsStale && segmentsStale ? 0 : cacheAge(cache),
  });
}

function cacheAge(cache: KlaviyoCache): number {
  const all = [
    ...Object.values(cache.lists || {}),
    ...Object.values(cache.segments || {}),
  ];
  if (all.length === 0) return 0;
  const oldest = Math.min(...all.map((e) => new Date(e.fetchedAt).getTime()));
  return Math.round((Date.now() - oldest) / 1000);
}
