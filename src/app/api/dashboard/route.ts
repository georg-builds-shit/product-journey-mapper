import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { productTransitions, gatewayProducts, analysisRuns } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { MIN_SAMPLE_SIZE, wilsonLowerBound } from "@/lib/journey";

/**
 * Apply the statistical-significance threshold + Wilson sort to rate-based
 * Products data. Runs on every read so analysis runs created before the
 * threshold was introduced still display cleanly without a re-analyze.
 */
function applyStickinessSignificance(
  rows: unknown[] | null | undefined
): Array<Record<string, unknown>> {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .filter((r) => Number(r.totalBuyers) >= MIN_SAMPLE_SIZE)
    .map((r) => {
      const total = Number(r.totalBuyers);
      const returned = Number(r.buyersWhoReturnedForAny);
      const wilson =
        typeof r.wilsonLower === "number"
          ? r.wilsonLower
          : wilsonLowerBound(returned, total) * 100;
      return { ...r, wilsonLower: wilson };
    })
    .sort((a, b) => Number(b.wilsonLower) - Number(a.wilsonLower));
}

function applyRepurchaseSignificance(
  rows: unknown[] | null | undefined
): Array<Record<string, unknown>> {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .filter((r) => Number(r.totalBuyers) >= MIN_SAMPLE_SIZE)
    .map((r) => {
      const total = Number(r.totalBuyers);
      const repeats = Number(r.sameProdRepeatBuyers);
      const wilson =
        typeof r.wilsonLower === "number"
          ? r.wilsonLower
          : wilsonLowerBound(repeats, total) * 100;
      return { ...r, wilsonLower: wilson };
    })
    .sort((a, b) => Number(b.wilsonLower) - Number(a.wilsonLower));
}

function applyAffinitySignificance(
  rows: unknown[] | null | undefined
): Array<Record<string, unknown>> {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .filter((r) => Number(r.coPurchaseCount) >= MIN_SAMPLE_SIZE);
}

export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const accountId = request.nextUrl.searchParams.get("accountId");
  const runId = request.nextUrl.searchParams.get("runId");

  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  // Get the latest completed run
  let targetRunId = runId;
  if (!targetRunId) {
    const [latestRun] = await db
      .select()
      .from(analysisRuns)
      .where(and(eq(analysisRuns.accountId, accountId), eq(analysisRuns.status, "complete")))
      .orderBy(desc(analysisRuns.createdAt))
      .limit(1);

    if (!latestRun) {
      return NextResponse.json({ error: "No completed analysis found" }, { status: 404 });
    }
    targetRunId = latestRun.id;
  }

  // Get the run details — scope by accountId for security
  const [run] = await db
    .select()
    .from(analysisRuns)
    .where(and(eq(analysisRuns.id, targetRunId), eq(analysisRuns.accountId, accountId)));

  if (!run) {
    return NextResponse.json({ error: "Analysis run not found" }, { status: 404 });
  }

  // Fetch transitions and gateways
  const transitions = await db
    .select()
    .from(productTransitions)
    .where(eq(productTransitions.analysisRunId, targetRunId));

  const gatewaysRaw = await db
    .select()
    .from(gatewayProducts)
    .where(eq(gatewayProducts.analysisRunId, targetRunId));

  // Backward-compat significance filter on gateway products. The DB rows are
  // persisted from older runs that didn't apply the 50-buyer floor; filter
  // here so the dashboard always shows statistically meaningful rows.
  const gateways = gatewaysRaw.filter(
    (g) => (g.firstPurchaseCount ?? 0) >= MIN_SAMPLE_SIZE
  );

  return NextResponse.json({
    transitions,
    gateways,
    stickiness: applyStickinessSignificance(run.stickinessJson as unknown[]),
    insights: run.insightsText || "",
    stats: {
      ordersSynced: run.ordersSynced,
      uniqueCustomers: run.uniqueCustomers,
    },
    filters: {
      dateFrom: run.filterDateFrom?.toISOString().slice(0, 10) || null,
      dateTo: run.filterDateTo?.toISOString().slice(0, 10) || null,
    },
    // Threshold metadata so the UI can render the "showing products with
    // 50+ buyers" footnote without hardcoding the number client-side.
    significance: { minSampleSize: MIN_SAMPLE_SIZE },
    // Retention metrics (Phase 3 — null until implemented)
    repurchaseTiming: run.repurchaseTimingJson || null,
    revenueConcentration: run.revenueConcentrationJson || null,
    repurchaseRate: applyRepurchaseSignificance(run.repurchaseRateJson as unknown[]),
    cohortRetention: run.cohortRetentionJson || null,
    productAffinity: applyAffinitySignificance(run.productAffinityJson as unknown[]),
    customerJourneys: run.customerJourneysJson || null,
    // Cohort & repeat-purchase analytics (Phase 4 — loyalty module)
    cohortAnalytics: run.cohortAnalyticsJson || null,
    audiencesSnapshot: run.audiencesSnapshotJson || null,
    configSnapshot: run.configSnapshotJson || null,
  });
}
