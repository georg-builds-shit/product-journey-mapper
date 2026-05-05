import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, analysisRuns } from "@/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { requireAuth } from "@/lib/auth";
import { getBrandConfig } from "@/lib/config";
import { consumeAnalyzeQuota } from "@/lib/quota";
import { log } from "@/lib/logger";

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
          audiences: existingRun.audiencesSnapshotJson ?? [],
          ...(existingRun.configSnapshotJson as Record<string, unknown>),
        })
      : null;
    const currentSignature = currentConfig
      ? JSON.stringify({
          audiences: currentConfig.audiences,
          cohortGranularity: currentConfig.cohortGranularity,
          lookbackMonths: currentConfig.lookbackMonths,
          excludeRefunds: currentConfig.excludeRefunds,
          minOrderValue: currentConfig.minOrderValue,
          excludeTestRules: currentConfig.excludeTestRules,
          productFamilies: currentConfig.productFamilies,
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

  // Per-account quota check. Atomically increments the counter on success;
  // returns 429 when the plan's monthly analyze cap is hit. See src/lib/quota.ts.
  const quota = await consumeAnalyzeQuota(accountId);
  if (!quota.ok) {
    log.warn("analyze.quota_blocked", { accountId, plan: quota.plan, limit: quota.limit });
    return NextResponse.json(
      {
        error: "Monthly analyze quota exceeded",
        plan: quota.plan,
        limit: quota.limit,
        count: quota.count,
      },
      { status: 429 }
    );
  }

  const filters: any = {};
  if (dateFrom) filters.dateFrom = dateFrom;
  if (dateTo) filters.dateTo = dateTo;
  if (segmentId) filters.segmentId = segmentId;

  // Create the run row synchronously so the client gets a runId it can poll.
  // Without this the status endpoint has no way to distinguish "new run queued"
  // from "previous run already complete" and the dashboard shows stale data.
  //
  // The partial unique index `analysis_runs_account_in_progress_idx` ensures
  // at most one in-progress run per account, so a double-click race that
  // slipped past the check above fails here with a 23505 unique violation.
  // In that case the other request already won — return its runId.
  let run: { id: string };
  try {
    const inserted = await db
      .insert(analysisRuns)
      .values({
        accountId: account.id,
        status: "pending",
        filterDateFrom,
        filterDateTo,
        segmentId: segmentId || null,
      })
      .returning();
    run = inserted[0];
  } catch (err: unknown) {
    const code = (err as { code?: string; cause?: { code?: string } })?.code
      ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code !== "23505") throw err;
    const [winner] = await db
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
    if (!winner) {
      return NextResponse.json(
        { error: "Conflicting run could not be resolved" },
        { status: 409 }
      );
    }
    return NextResponse.json({
      status: "in_progress",
      accountId: account.id,
      runId: winner.id,
    });
  }

  await inngest.send({
    name: "journey/analyze",
    data: {
      accountId: account.id,
      runId: run.id,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    },
  });

  return NextResponse.json({
    status: "started",
    accountId: account.id,
    runId: run.id,
  });
}
