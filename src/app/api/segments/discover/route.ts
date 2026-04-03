import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { profileCache, accounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fetchMetrics, fetchLists, fetchKlaviyoSegments } from "@/lib/klaviyo";
import { decrypt } from "@/lib/crypto";
import { requireAuth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  // Get available profile property keys + list/segment membership from cache
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
    const props = p.properties as Record<string, any> | null;
    if (!props) continue;
    for (const [key, value] of Object.entries(props)) {
      propertyKeys.add(key);
      if (!propertySamples[key]) propertySamples[key] = new Set();
      if (propertySamples[key].size < 10 && value != null) {
        propertySamples[key].add(String(value));
      }
    }
  }

  // Get Klaviyo lists, segments, and metrics from the API
  let availableMetrics: Array<{ id: string; name: string; integration: string | null }> = [];
  let availableLists: Array<{ id: string; name: string; profileCount: number }> = [];
  let availableKlaviyoSegments: Array<{ id: string; name: string; profileCount: number }> = [];

  try {
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, accountId));

    const isDemoAccount = account?.email === "demo@productjourneymapper.com";

    if (account && !isDemoAccount) {
      const accessToken = decrypt(account.klaviyoAccessToken);
      [availableMetrics, availableLists, availableKlaviyoSegments] = await Promise.all([
        fetchMetrics(accessToken),
        fetchLists(accessToken),
        fetchKlaviyoSegments(accessToken),
      ]);
    }
  } catch (err) {
    console.error("Klaviyo discover fetch failed:", err);
    // Return the error so we can debug
    return NextResponse.json({
      profileProperties: Array.from(propertyKeys).map((key) => ({
        key,
        sampleValues: Array.from(propertySamples[key] || []),
      })),
      eventTypes: [],
      lists: [],
      klaviyoSegments: [],
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
  });
}
