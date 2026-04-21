import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, analysisRuns } from "@/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { requireAuth } from "@/lib/auth";
import { getBrandConfig } from "@/lib/config";

export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const { accountId, dateFrom, dateTo, segmentId } = await request.json();

  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId));

  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const filterDateFrom = dateFrom ? new Date(dateFrom) : null;
  const filterDateTo = dateTo ? new Date(dateTo) : null;

  // Check for in-progress run with same filters (race condition guard)
  const [inProgressRun] = await db
    .select()
    .from(analysisRuns)
    .where(
      and(
        eq(analysisRuns.accountId, accountId),
        inArray(analysisRuns.status, ["pending", "ingesting", "analyzing"])
      )
    )
    .orderBy(desc(analysisRuns.createdAt))
    .limit(1);

  if (inProgressRun) {
    return NextResponse.json({
      status: "in_progress",
      accountId: account.id,
      runId: inProgressRun.id,
    });
  }

  // Check for cached completed run with identical filters + segment
  const [existingRun] = await db
    .select()
    .from(analysisRuns)
    .where(
      and(
        eq(analysisRuns.accountId, accountId),
        eq(analysisRuns.status, "complete")
      )
    )
    .orderBy(desc(analysisRuns.createdAt))
    .limit(1);

  if (existingRun) {
    const sameFrom =
      (!filterDateFrom && !existingRun.filterDateFrom) ||
      (filterDateFrom &&
        existingRun.filterDateFrom &&
        filterDateFrom.toISOString().slice(0, 10) ===
          existingRun.filterDateFrom.toISOString().slice(0, 10));
    const sameTo =
      (!filterDateTo && !existingRun.filterDateTo) ||
      (filterDateTo &&
        existingRun.filterDateTo &&
        filterDateTo.toISOString().slice(0, 10) ===
          existingRun.filterDateTo.toISOString().slice(0, 10));
    const sameSegment =
      (!segmentId && !existingRun.segmentId) ||
      segmentId === existingRun.segmentId;

    // Invalidate cache if brand config has changed since the run (e.g. channels,
    // groupings, granularity). Compare a coarse signature of the snapshot.
    const currentConfig = await getBrandConfig(accountId).catch(() => null);
    const runSignature = existingRun.configSnapshotJson
      ? JSON.stringify({
          channels: existingRun.channelsSnapshotJson ?? [],
          ...(existingRun.configSnapshotJson as Record<string, unknown>),
        })
      : null;
    const currentSignature = currentConfig
      ? JSON.stringify({
          channels: currentConfig.channels,
          cohortGranularity: currentConfig.cohortGranularity,
          lookbackMonths: currentConfig.lookbackMonths,
          excludeRefunds: currentConfig.excludeRefunds,
          minOrderValue: currentConfig.minOrderValue,
          excludeTestRules: currentConfig.excludeTestRules,
          productGroupings: currentConfig.productGroupings,
        })
      : null;
    const sameConfig =
      currentSignature === null || // no config → treat as match (unchanged behavior)
      runSignature === currentSignature;

    if (sameFrom && sameTo && sameSegment && sameConfig) {
      return NextResponse.json({
        status: "cached",
        accountId: account.id,
        runId: existingRun.id,
      });
    }
  }

  const filters: any = {};
  if (dateFrom) filters.dateFrom = dateFrom;
  if (dateTo) filters.dateTo = dateTo;
  if (segmentId) filters.segmentId = segmentId;

  await inngest.send({
    name: "journey/analyze",
    data: {
      accountId: account.id,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    },
  });

  return NextResponse.json({ status: "started", accountId: account.id });
}
