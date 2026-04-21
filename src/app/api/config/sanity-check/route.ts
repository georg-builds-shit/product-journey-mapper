import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, events, profileCache } from "@/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getBrandConfig, UNASSIGNED_AUDIENCE_ID } from "@/lib/config";
import { fetchListOrSegmentProfileIds } from "@/lib/klaviyo";
import { getFreshAccessToken } from "@/lib/klaviyo-auth";
import { classifyAudiences } from "@/lib/channel-classify";

/**
 * GET /api/config/sanity-check?accountId=X
 *
 * Returns per-audience member counts + discount code prevalence so the analyst
 * can validate audience rules before running a full analysis.
 */
export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  const config = await getBrandConfig(accountId);

  // Pull a representative sample of profile IDs from the local events table
  // — only profiles that have actually placed an order. Cap at 2000 to keep
  // this endpoint snappy.
  const profileRows = await db
    .selectDistinct({ profileId: events.profileId })
    .from(events)
    .where(eq(events.accountId, accountId))
    .limit(2000);
  const uniqueProfileIds = profileRows.map((r) => r.profileId);

  // Load cached profiles
  const cachedProfiles = uniqueProfileIds.length > 0
    ? await db
        .select()
        .from(profileCache)
        .where(
          and(
            eq(profileCache.accountId, accountId),
            inArray(profileCache.klaviyoProfileId, uniqueProfileIds)
          )
        )
    : [];

  const profileData = cachedProfiles.map((p) => ({
    id: p.klaviyoProfileId,
    properties: (p.properties as Record<string, unknown>) || {},
    location: (p.location as Record<string, unknown>) || {},
    listIds: (p.listIds as string[]) || [],
    segmentIds: (p.segmentIds as string[]) || [],
  }));

  // Fetch list/segment membership for any list/klaviyo_segment-type audiences.
  try {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    if (account && account.email !== "demo@productjourneymapper.com") {
      const { accessToken } = await getFreshAccessToken(accountId);
      for (const a of config.audiences) {
        if (a.rule.type === "list") {
          const memberIds = await fetchListOrSegmentProfileIds(accessToken, "lists", a.rule.listId);
          const memberSet = new Set(memberIds);
          for (const p of profileData) {
            if (memberSet.has(p.id) && !p.listIds.includes(a.rule.listId)) {
              p.listIds.push(a.rule.listId);
            }
          }
        } else if (a.rule.type === "klaviyo_segment") {
          const memberIds = await fetchListOrSegmentProfileIds(accessToken, "segments", a.rule.segmentId);
          const memberSet = new Set(memberIds);
          for (const p of profileData) {
            if (memberSet.has(p.id) && !p.segmentIds.includes(a.rule.segmentId)) {
              p.segmentIds.push(a.rule.segmentId);
            }
          }
        } else if (a.rule.type === "segment") {
          for (const rule of a.rule.rules) {
            if ((rule.operator === "in_list" || rule.operator === "not_in_list") && rule.value) {
              const memberIds = await fetchListOrSegmentProfileIds(accessToken, "lists", rule.value);
              const memberSet = new Set(memberIds);
              for (const p of profileData) {
                if (memberSet.has(p.id) && !p.listIds.includes(rule.value)) {
                  p.listIds.push(rule.value);
                }
              }
            } else if ((rule.operator === "in_segment" || rule.operator === "not_in_segment") && rule.value) {
              const memberIds = await fetchListOrSegmentProfileIds(accessToken, "segments", rule.value);
              const memberSet = new Set(memberIds);
              for (const p of profileData) {
                if (memberSet.has(p.id) && !p.segmentIds.includes(rule.value)) {
                  p.segmentIds.push(rule.value);
                }
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("Sanity-check membership fetch failed:", err);
  }

  // Classify
  const profileAudienceMap = classifyAudiences(profileData, config.audiences);

  // Aggregate
  const audienceCounts: Record<string, number> = {
    [UNASSIGNED_AUDIENCE_ID]: 0,
  };
  for (const a of config.audiences) audienceCounts[a.id] = 0;
  for (const pid of uniqueProfileIds) {
    const aud = profileAudienceMap.get(pid) || UNASSIGNED_AUDIENCE_ID;
    audienceCounts[aud] = (audienceCounts[aud] || 0) + 1;
  }

  // Discount code prevalence over all cached events
  const discountCodeStats = await db
    .select({
      total: sql<number>`count(*)`.as("total"),
      withCode: sql<number>`count(*) filter (where ${events.discountCode} is not null and ${events.discountCode} <> '')`.as("withCode"),
    })
    .from(events)
    .where(eq(events.accountId, accountId));

  const totalEvents = Number(discountCodeStats[0]?.total ?? 0);
  const withCode = Number(discountCodeStats[0]?.withCode ?? 0);
  const prevalencePct = totalEvents > 0 ? (withCode / totalEvents) * 100 : 0;

  return NextResponse.json({
    audiences: [
      ...config.audiences.map((a) => ({
        id: a.id,
        label: a.label,
        sampleMemberCount: audienceCounts[a.id] || 0,
      })),
      {
        id: UNASSIGNED_AUDIENCE_ID,
        label: "Unassigned",
        sampleMemberCount: audienceCounts[UNASSIGNED_AUDIENCE_ID] || 0,
      },
    ],
    sampleSize: uniqueProfileIds.length,
    discountCode: {
      eventsWithCode: withCode,
      totalEvents,
      prevalencePct,
      available: prevalencePct >= 5,
    },
  });
}
