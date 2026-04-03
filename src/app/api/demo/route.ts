import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, analysisRuns, productTransitions, gatewayProducts, profileCache, segments, events as eventsTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateDemoEvents, generateDemoProfiles, generateDemoPOSEvents } from "@/lib/demo-data";
import { filterEventsByProfileSegment, type SegmentRule } from "@/lib/segment-eval";
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
} from "@/lib/journey";
import { generateJourneyInsights } from "@/lib/insights";

// Simple in-memory rate limiter: 1 request per IP per 30 seconds
const recentRequests = new Map<string, number>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const lastRequest = recentRequests.get(ip);
  if (lastRequest && now - lastRequest < 30_000) {
    return true;
  }
  recentRequests.set(ip, now);
  // Clean old entries every 100 requests
  if (recentRequests.size > 100) {
    for (const [key, time] of recentRequests) {
      if (now - time > 60_000) recentRequests.delete(key);
    }
  }
  return false;
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait 30 seconds." },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { dateFrom, dateTo, segmentId } = body;

    // Create or find demo account
    const demoEmail = "demo@productjourneymapper.com";
    let [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.email, demoEmail));

    if (!account) {
      [account] = await db
        .insert(accounts)
        .values({
          email: demoEmail,
          klaviyoAccessToken: "demo_token",
          klaviyoRefreshToken: "demo_refresh",
          klaviyoTokenExpiresAt: new Date("2099-01-01"),
        })
        .returning();
    }

    // Seed demo profiles into profileCache
    const demoProfiles = generateDemoProfiles(200);
    for (const p of demoProfiles) {
      await db
        .insert(profileCache)
        .values({
          accountId: account.id,
          klaviyoProfileId: p.id,
          properties: p.properties,
          location: p.location,
        })
        .onConflictDoUpdate({
          target: [profileCache.accountId, profileCache.klaviyoProfileId],
          set: { properties: p.properties, location: p.location, updatedAt: new Date() },
        });
    }

    // Create demo segments (if they don't exist)
    const existingSegments = await db
      .select()
      .from(segments)
      .where(eq(segments.accountId, account.id));

    if (existingSegments.length === 0) {
      await db.insert(segments).values([
        {
          accountId: account.id,
          name: "Affiliates",
          segmentType: "profile",
          rules: [{ field: "properties.is_affiliate", operator: "equals", value: "true" }],
        },
        {
          accountId: account.id,
          name: "Non-Affiliates",
          segmentType: "profile",
          rules: [{ field: "properties.is_affiliate", operator: "not_equals", value: "true" }],
        },
        {
          accountId: account.id,
          name: "US Customers",
          segmentType: "profile",
          rules: [{ field: "location.country", operator: "equals", value: "US" }],
        },
      ]);
    }

    // Create analysis run with filter metadata
    const [run] = await db
      .insert(analysisRuns)
      .values({
        accountId: account.id,
        status: "analyzing",
        filterDateFrom: dateFrom ? new Date(dateFrom) : null,
        filterDateTo: dateTo ? new Date(dateTo) : null,
      })
      .returning();

    // Generate demo events and cache them in the events table
    const allDemoEvents = generateDemoEvents(200);

    // Insert into events table (skip duplicates)
    const batchSize = 100;
    for (let i = 0; i < allDemoEvents.length; i += batchSize) {
      const batch = allDemoEvents.slice(i, i + batchSize);
      await db
        .insert(eventsTable)
        .values(
          batch.map((e) => ({
            accountId: account.id,
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
          }))
        )
        .onConflictDoNothing({
          target: [eventsTable.accountId, eventsTable.klaviyoEventId],
        });
    }

    let events = allDemoEvents;

    // Apply date filter to demo events
    if (dateFrom) {
      const from = new Date(dateFrom);
      events = events.filter((e) => new Date(e.datetime) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo + "T23:59:59Z");
      events = events.filter((e) => new Date(e.datetime) <= to);
    }

    // Apply profile segment filter if provided
    if (segmentId) {
      const [seg] = await db
        .select()
        .from(segments)
        .where(eq(segments.id, segmentId));

      if (seg && seg.segmentType === "profile") {
        events = filterEventsByProfileSegment(
          events,
          demoProfiles,
          seg.rules as SegmentRule[]
        );
      }

      // Update run with segment reference
      await db
        .update(analysisRuns)
        .set({ segmentId })
        .where(eq(analysisRuns.id, run.id));
    }

    // Build sequences and analyze
    const sequences = buildOrderSequences(events);
    const stats = calculateJourneyStats(sequences);
    const transitions = buildTransitionMatrix(sequences);
    const gateways = findGatewayProducts(sequences);

    // Save transitions (top 100)
    const topTransitions = transitions.slice(0, 100);
    if (topTransitions.length > 0) {
      await db.insert(productTransitions).values(
        topTransitions.map((t) => ({
          accountId: account.id,
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

    // Save gateways (top 20)
    const topGateways = gateways.slice(0, 20);
    if (topGateways.length > 0) {
      await db.insert(gatewayProducts).values(
        topGateways.map((g) => ({
          accountId: account.id,
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
    const repurchaseTiming = calculateRepurchaseTimingDistribution(sequences);
    const revenueConcentration = calculateRevenueConcentration(sequences);
    const repurchaseRate = calculateRepurchaseRate(sequences);
    const cohortRetention = calculateCohortRetention(sequences);
    const productAffinity = calculateProductAffinity(sequences);
    const customerJourneys = buildCustomerJourneys(sequences);

    // Generate AI insights (non-fatal)
    let insights: string;
    try {
      insights = await generateJourneyInsights(transitions, gateways, stats);
    } catch {
      insights = "AI insights could not be generated at this time. All other analytics are available below.";
    }

    // Mark complete
    await db
      .update(analysisRuns)
      .set({
        status: "complete",
        ordersSynced: events.length,
        uniqueCustomers: stats.repeatCustomers,
        insightsText: insights,
        stickinessJson: stickiness,
        repurchaseTimingJson: repurchaseTiming,
        revenueConcentrationJson: revenueConcentration,
        repurchaseRateJson: repurchaseRate,
        cohortRetentionJson: cohortRetention,
        productAffinityJson: productAffinity,
        customerJourneysJson: customerJourneys,
        completedAt: new Date(),
      })
      .where(eq(analysisRuns.id, run.id));

    return NextResponse.json({
      accountId: account.id,
      runId: run.id,
      stats: {
        totalEvents: events.length,
        totalCustomers: stats.totalCustomers,
        repeatCustomers: stats.repeatCustomers,
        transitions: topTransitions.length,
        gateways: topGateways.length,
      },
    });
  } catch (error) {
    console.error("Demo seed error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
