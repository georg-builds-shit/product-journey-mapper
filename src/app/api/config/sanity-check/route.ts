import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, events, profileCache } from "@/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getBrandConfig, UNASSIGNED_CHANNEL_ID } from "@/lib/config";
import { fetchListOrSegmentProfileIds } from "@/lib/klaviyo";
import { getFreshAccessToken } from "@/lib/klaviyo-auth";
import { classifyChannels } from "@/lib/channel-classify";

/**
 * GET /api/config/sanity-check?accountId=X
 *
 * Returns per-channel member counts + discount code prevalence so the analyst
 * can validate channel rules before running a full analysis.
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
    properties: (p.properties as Record<string, any>) || {},
    location: (p.location as Record<string, any>) || {},
    listIds: (p.listIds as string[]) || [],
    segmentIds: (p.segmentIds as string[]) || [],
  }));

  // Fetch list/segment membership for any list/klaviyo_segment-type channels.
  // Only if we have a decrypted access token.
  try {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    if (account && account.email !== "demo@productjourneymapper.com") {
      const { accessToken } = await getFreshAccessToken(accountId);
      for (const ch of config.channels) {
        if (ch.rule.type === "list") {
          const memberIds = await fetchListOrSegmentProfileIds(accessToken, "lists", ch.rule.listId);
          const memberSet = new Set(memberIds);
          for (const p of profileData) {
            if (memberSet.has(p.id) && !p.listIds.includes(ch.rule.listId)) {
              p.listIds.push(ch.rule.listId);
            }
          }
        } else if (ch.rule.type === "klaviyo_segment") {
          const memberIds = await fetchListOrSegmentProfileIds(accessToken, "segments", ch.rule.segmentId);
          const memberSet = new Set(memberIds);
          for (const p of profileData) {
            if (memberSet.has(p.id) && !p.segmentIds.includes(ch.rule.segmentId)) {
              p.segmentIds.push(ch.rule.segmentId);
            }
          }
        } else if (ch.rule.type === "segment") {
          // rules may include in_list / in_segment operators — fetch those too
          for (const rule of ch.rule.rules) {
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
  const profileChannelMap = classifyChannels(profileData, config.channels);

  // Aggregate
  const channelCounts: Record<string, number> = {
    [UNASSIGNED_CHANNEL_ID]: 0,
  };
  for (const ch of config.channels) channelCounts[ch.id] = 0;
  for (const pid of uniqueProfileIds) {
    const channel = profileChannelMap.get(pid) || UNASSIGNED_CHANNEL_ID;
    channelCounts[channel] = (channelCounts[channel] || 0) + 1;
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
    channels: [
      ...config.channels.map((ch) => ({
        id: ch.id,
        label: ch.label,
        sampleMemberCount: channelCounts[ch.id] || 0,
      })),
      {
        id: UNASSIGNED_CHANNEL_ID,
        label: "Unassigned",
        sampleMemberCount: channelCounts[UNASSIGNED_CHANNEL_ID] || 0,
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
