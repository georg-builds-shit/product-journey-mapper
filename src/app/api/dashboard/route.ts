import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { productTransitions, gatewayProducts, analysisRuns } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
export async function GET(request: NextRequest) {
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

  const gateways = await db
    .select()
    .from(gatewayProducts)
    .where(eq(gatewayProducts.analysisRunId, targetRunId));

  return NextResponse.json({
    transitions,
    gateways,
    stickiness: run.stickinessJson || [],
    insights: run.insightsText || "",
    stats: {
      ordersSynced: run.ordersSynced,
      uniqueCustomers: run.uniqueCustomers,
    },
    filters: {
      dateFrom: run.filterDateFrom?.toISOString().slice(0, 10) || null,
      dateTo: run.filterDateTo?.toISOString().slice(0, 10) || null,
    },
    // Retention metrics (Phase 3 — null until implemented)
    repurchaseTiming: run.repurchaseTimingJson || null,
    revenueConcentration: run.revenueConcentrationJson || null,
    repurchaseRate: run.repurchaseRateJson || null,
    cohortRetention: run.cohortRetentionJson || null,
    productAffinity: run.productAffinityJson || null,
    customerJourneys: run.customerJourneysJson || null,
  });
}
