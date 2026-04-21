import { db } from "@/db";
import {
  analysisRuns,
  productTransitions,
  gatewayProducts,
  profileCache,
  segments,
  events,
} from "@/db/schema";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { fetchProfiles, fetchListOrSegmentProfileIds } from "./klaviyo";
import {
  buildOrderSequences,
  buildTransitionMatrix,
  findGatewayProducts,
  calculateJourneyStats,
  calculateStickiness,
  calculateRepurchaseTimingDistribution,
  calculateRevenueConcentration,
  calculateRepurchaseRate,
  calculateCohortRetention,
  calculateProductAffinity,
  buildCustomerJourneys,
} from "./journey";
import { generateJourneyInsights } from "./insights";
import {
  filterEventsByProfileSegment,
  profileMatchesSegment,
  type SegmentRule,
} from "./segment-eval";
import type { OrderedProductEvent } from "./klaviyo";
import { getBrandConfig } from "./config";
import {
  classifyChannels,
  classifyAllMatches,
  collectMembershipRefs,
} from "./channel-classify";
import { computeCohortAnalytics } from "./cohort-analysis";

export interface AnalysisFilters {
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  segmentId?: string;
}

/**
 * Run journey analysis using locally cached events (from the events table).
 * No Klaviyo API calls happen here — sync.ts handles that separately.
 */
export async function runJourneyAnalysis(
  accountId: string,
  accessToken: string,
  filters?: AnalysisFilters
) {
  // Load segment definition if provided
  let segment: { segmentType: string; rules: SegmentRule[] } | null = null;
  if (filters?.segmentId) {
    const [seg] = await db
      .select()
      .from(segments)
      .where(eq(segments.id, filters.segmentId));
    if (seg) {
      segment = {
        segmentType: seg.segmentType,
        rules: seg.rules as SegmentRule[],
      };
    }
  }

  // Create analysis run with filter metadata
  const [run] = await db
    .insert(analysisRuns)
    .values({
      accountId,
      status: "analyzing",
      filterDateFrom: filters?.dateFrom ? new Date(filters.dateFrom) : null,
      filterDateTo: filters?.dateTo ? new Date(filters.dateTo) : null,
      segmentId: filters?.segmentId || null,
    })
    .returning();

  try {
    // ── Read events from local DB (no Klaviyo API calls) ──

    const conditions = [eq(events.accountId, accountId)];

    if (filters?.dateFrom) {
      conditions.push(gte(events.datetime, new Date(filters.dateFrom)));
    }
    if (filters?.dateTo) {
      conditions.push(
        lte(events.datetime, new Date(filters.dateTo + "T23:59:59Z"))
      );
    }

    const dbEvents = await db
      .select()
      .from(events)
      .where(and(...conditions));

    // Convert DB rows to OrderedProductEvent format
    let eventList: OrderedProductEvent[] = dbEvents.map((e) => ({
      id: e.klaviyoEventId,
      profileId: e.profileId,
      datetime: e.datetime.toISOString(),
      value: e.value || 0,
      productName: e.productName,
      productId: e.productId || null,
      categories: (e.categories as string[]) || [],
      productType: e.productType || null,
      brand: e.brand || null,
      quantity: e.quantity || 1,
      orderId: e.orderId || null,
      sku: e.sku || null,
      discountCode: e.discountCode || null,
    }));

    // Apply profile segment filter if applicable
    if (segment?.segmentType === "profile" && eventList.length > 0) {
      const uniqueProfileIds = [
        ...new Set(eventList.map((e) => e.profileId)),
      ];

      // Read from local profileCache first
      const cachedProfiles = await db
        .select()
        .from(profileCache)
        .where(
          and(
            eq(profileCache.accountId, accountId),
            inArray(profileCache.klaviyoProfileId, uniqueProfileIds)
          )
        );

      const cachedIds = new Set(cachedProfiles.map((p) => p.klaviyoProfileId));
      const missingIds = uniqueProfileIds.filter((id) => !cachedIds.has(id));

      // Only fetch missing profiles from Klaviyo API
      let allProfileData = cachedProfiles.map((p) => ({
        id: p.klaviyoProfileId,
        properties: (p.properties as Record<string, any>) || {},
        location: (p.location as Record<string, any>) || {},
        listIds: (p.listIds as string[]) || [],
        segmentIds: (p.segmentIds as string[]) || [],
      }));

      if (missingIds.length > 0) {
        const freshProfiles = await fetchProfiles(accessToken, missingIds);

        // Cache the newly fetched profiles
        for (const p of freshProfiles) {
          await db
            .insert(profileCache)
            .values({
              accountId,
              klaviyoProfileId: p.id,
              properties: p.properties,
              location: p.location,
            })
            .onConflictDoUpdate({
              target: [profileCache.accountId, profileCache.klaviyoProfileId],
              set: {
                properties: p.properties,
                location: p.location,
                updatedAt: new Date(),
              },
            });
        }

        allProfileData = [
          ...allProfileData,
          ...freshProfiles.map((p) => ({
            ...p,
            listIds: [] as string[],
            segmentIds: [] as string[],
          })),
        ];
      }

      // On-demand: fetch list/segment membership if the filter uses in_list or in_segment
      const hasListRule = segment.rules.some((r) => r.operator === "in_list" || r.operator === "not_in_list");
      const hasSegmentRule = segment.rules.some((r) => r.operator === "in_segment" || r.operator === "not_in_segment");

      if (hasListRule || hasSegmentRule) {
        for (const rule of segment.rules) {
          let memberIds: string[] = [];
          if ((rule.operator === "in_list" || rule.operator === "not_in_list") && rule.value) {
            memberIds = await fetchListOrSegmentProfileIds(accessToken, "lists", rule.value);
          } else if ((rule.operator === "in_segment" || rule.operator === "not_in_segment") && rule.value) {
            memberIds = await fetchListOrSegmentProfileIds(accessToken, "segments", rule.value);
          }

          // Tag matching profiles with list/segment membership
          const memberSet = new Set(memberIds);
          for (const profile of allProfileData) {
            if (memberSet.has(profile.id)) {
              if (rule.operator === "in_list" || rule.operator === "not_in_list") {
                if (!profile.listIds.includes(rule.value)) {
                  profile.listIds.push(rule.value);
                }
              } else {
                if (!profile.segmentIds.includes(rule.value)) {
                  profile.segmentIds.push(rule.value);
                }
              }
            }
          }
        }
      }

      eventList = filterEventsByProfileSegment(
        eventList,
        allProfileData,
        segment.rules
      );
    }

    await db
      .update(analysisRuns)
      .set({ ordersSynced: eventList.length })
      .where(eq(analysisRuns.id, run.id));

    // Build order sequences
    const sequences = buildOrderSequences(eventList);
    const stats = calculateJourneyStats(sequences);

    await db
      .update(analysisRuns)
      .set({ uniqueCustomers: stats.repeatCustomers })
      .where(eq(analysisRuns.id, run.id));

    // Check minimum data threshold
    if (stats.repeatCustomers < 10) {
      await db
        .update(analysisRuns)
        .set({
          status: "complete",
          insightsText:
            "Not enough repeat purchase data to map product journeys. Need at least 10 customers with 2+ orders.",
          completedAt: new Date(),
        })
        .where(eq(analysisRuns.id, run.id));
      return run.id;
    }

    // Build transition matrix
    const transitions = buildTransitionMatrix(sequences);

    // Save top 20 transitions PER STEP (not global top 100, which would all be step 1)
    const transitionsByStep = new Map<number, typeof transitions>();
    for (const t of transitions) {
      const stepList = transitionsByStep.get(t.step) || [];
      stepList.push(t);
      transitionsByStep.set(t.step, stepList);
    }
    const topTransitions: typeof transitions = [];
    for (let step = 1; step <= 5; step++) {
      const stepTransitions = transitionsByStep.get(step) || [];
      topTransitions.push(...stepTransitions.slice(0, 20));
    }

    if (topTransitions.length > 0) {
      await db.insert(productTransitions).values(
        topTransitions.map((t) => ({
          accountId,
          analysisRunId: run.id,
          fromProduct: t.fromProduct,
          fromCategory: t.fromCategory,
          toProduct: t.toProduct,
          toCategory: t.toCategory,
          transitionCount: t.transitionCount,
          transitionPct: t.transitionPct,
          avgDaysBetween: t.avgDaysBetween,
          step: t.step,
        }))
      );
    }

    // Find gateway products
    const gateways = findGatewayProducts(sequences);

    const topGateways = gateways.slice(0, 20);
    if (topGateways.length > 0) {
      await db.insert(gatewayProducts).values(
        topGateways.map((g) => ({
          accountId,
          analysisRunId: run.id,
          productName: g.productName,
          category: g.category,
          firstPurchaseCount: g.firstPurchaseCount,
          firstPurchasePct: g.firstPurchasePct,
          avgLtvAfter: g.avgLtvAfter,
          avgOrdersAfter: g.avgOrdersAfter,
        }))
      );
    }

    // Compute all metrics
    const stickiness = calculateStickiness(sequences);
    const repurchaseTiming =
      calculateRepurchaseTimingDistribution(sequences);
    const revenueConcentration = calculateRevenueConcentration(sequences);
    const repurchaseRate = calculateRepurchaseRate(sequences);
    const cohortRetention = calculateCohortRetention(sequences);
    const productAffinity = calculateProductAffinity(sequences);
    const customerJourneys = buildCustomerJourneys(sequences);

    // ── Cohort & repeat-purchase analytics (channel-splittable) ──
    // Runs alongside existing metrics so the dashboard response stays a
    // single run. Failures here should not lose the rest of the analysis.
    let cohortAnalytics: any = null;
    let channelsSnapshot: any = null;
    let configSnapshot: any = null;
    try {
      const config = await getBrandConfig(accountId);
      channelsSnapshot = config.channels;
      configSnapshot = {
        cohortGranularity: config.cohortGranularity,
        lookbackMonths: config.lookbackMonths,
        excludeRefunds: config.excludeRefunds,
        minOrderValue: config.minOrderValue,
        excludeTestRules: config.excludeTestRules,
        productGroupings: config.productGroupings,
      };

      // Apply order-level filters: min value + refunds (if excludeRefunds, drop value<=0)
      let filteredEvents: OrderedProductEvent[] = eventList.filter((e) => {
        if (config.excludeRefunds && (e.value || 0) <= 0) return false;
        if ((e.value || 0) < config.minOrderValue) return false;
        return true;
      });

      // Build profile data index for channel classification (+ test-order rules)
      const uniqueProfileIds = [
        ...new Set(filteredEvents.map((e) => e.profileId)),
      ];

      const profileDataMap = new Map<
        string,
        {
          id: string;
          properties: Record<string, any>;
          location: Record<string, any>;
          listIds: string[];
          segmentIds: string[];
        }
      >();

      if (uniqueProfileIds.length > 0) {
        const cached = await db
          .select()
          .from(profileCache)
          .where(
            and(
              eq(profileCache.accountId, accountId),
              inArray(profileCache.klaviyoProfileId, uniqueProfileIds)
            )
          );
        for (const p of cached) {
          profileDataMap.set(p.klaviyoProfileId, {
            id: p.klaviyoProfileId,
            properties: (p.properties as Record<string, any>) || {},
            location: (p.location as Record<string, any>) || {},
            listIds: (p.listIds as string[]) || [],
            segmentIds: (p.segmentIds as string[]) || [],
          });
        }
      }

      // Fetch list/segment membership for every channel rule + test-rule reference.
      const channelRefs = collectMembershipRefs(config.channels);
      const testRefs = collectMembershipRefs([
        {
          id: "__test__",
          label: "__test__",
          rule: { type: "segment", rules: config.excludeTestRules },
        },
      ]);
      const allListIds = Array.from(
        new Set([...channelRefs.listIds, ...testRefs.listIds])
      );
      const allSegmentIds = Array.from(
        new Set([...channelRefs.segmentIds, ...testRefs.segmentIds])
      );

      for (const listId of allListIds) {
        try {
          const memberIds = await fetchListOrSegmentProfileIds(accessToken, "lists", listId);
          const memberSet = new Set(memberIds);
          for (const pid of memberSet) {
            const p = profileDataMap.get(pid);
            if (p && !p.listIds.includes(listId)) p.listIds.push(listId);
          }
        } catch (err) {
          console.error(`List membership fetch failed for ${listId}:`, err);
        }
      }
      for (const segId of allSegmentIds) {
        try {
          const memberIds = await fetchListOrSegmentProfileIds(accessToken, "segments", segId);
          const memberSet = new Set(memberIds);
          for (const pid of memberSet) {
            const p = profileDataMap.get(pid);
            if (p && !p.segmentIds.includes(segId)) p.segmentIds.push(segId);
          }
        } catch (err) {
          console.error(`Segment membership fetch failed for ${segId}:`, err);
        }
      }

      const profiles = Array.from(profileDataMap.values());

      // Apply test-order exclusion: drop events from any profile matching the rules.
      if (config.excludeTestRules.length > 0) {
        const excluded = new Set<string>();
        for (const p of profiles) {
          if (
            profileMatchesSegment(
              {
                id: p.id,
                properties: p.properties,
                location: p.location,
                listIds: p.listIds,
                segmentIds: p.segmentIds,
              },
              config.excludeTestRules
            )
          ) {
            excluded.add(p.id);
          }
        }
        filteredEvents = filteredEvents.filter((e) => !excluded.has(e.profileId));
      }

      const channelMap = classifyChannels(profiles, config.channels);
      const allMatchesMap = classifyAllMatches(profiles, config.channels);

      cohortAnalytics = computeCohortAnalytics({
        events: filteredEvents,
        channelMap,
        allMatchesMap,
        channels: config.channels,
        granularity: config.cohortGranularity,
        grouping: config.productGroupings,
      });
    } catch (err) {
      console.error("Cohort analytics computation failed:", err);
      cohortAnalytics = null;
    }

    // Generate AI insights (non-fatal — don't lose all data if Claude API fails)
    let insights: string;
    try {
      insights = await generateJourneyInsights(transitions, gateways, stats);
    } catch (insightsError) {
      console.error("AI insights generation failed:", insightsError);
      insights =
        "AI insights could not be generated at this time. All other analytics are available below.";
    }

    // Mark complete
    await db
      .update(analysisRuns)
      .set({
        status: "complete",
        insightsText: insights,
        stickinessJson: stickiness,
        repurchaseTimingJson: repurchaseTiming,
        revenueConcentrationJson: revenueConcentration,
        repurchaseRateJson: repurchaseRate,
        cohortRetentionJson: cohortRetention,
        productAffinityJson: productAffinity,
        customerJourneysJson: customerJourneys,
        cohortAnalyticsJson: cohortAnalytics,
        channelsSnapshotJson: channelsSnapshot,
        configSnapshotJson: configSnapshot,
        completedAt: new Date(),
      })
      .where(eq(analysisRuns.id, run.id));

    return run.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await db
      .update(analysisRuns)
      .set({ status: "failed", error: message, completedAt: new Date() })
      .where(eq(analysisRuns.id, run.id));
    throw error;
  }
}
