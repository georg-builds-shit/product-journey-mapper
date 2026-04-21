import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { analysisRuns } from "@/db/schema";
import { eq, and, desc, isNull } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get("accountId");
  const segmentId = request.nextUrl.searchParams.get("segmentId");
  const runId = request.nextUrl.searchParams.get("runId");

  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  // If runId is provided, look up that specific row. This is the correct
  // poll path when the client has a runId from POST /api/analyze — it
  // avoids the race where the Inngest job hasn't yet created/adopted its
  // row and the poll accidentally picks up a previously-completed run.
  if (runId) {
    const [run] = await db
      .select()
      .from(analysisRuns)
      .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.accountId, accountId)));
    if (!run) {
      return NextResponse.json({ status: "none" });
    }
    return NextResponse.json({
      runId: run.id,
      status: run.status,
      ordersSynced: run.ordersSynced,
      uniqueCustomers: run.uniqueCustomers,
      error: run.error,
    });
  }

  // Fallback (used on initial page load, before the user triggered anything):
  // return the newest run matching the filter scope.
  const conditions = [eq(analysisRuns.accountId, accountId)];
  if (segmentId) {
    conditions.push(eq(analysisRuns.segmentId, segmentId));
  } else {
    conditions.push(isNull(analysisRuns.segmentId));
  }

  const [latestRun] = await db
    .select()
    .from(analysisRuns)
    .where(and(...conditions))
    .orderBy(desc(analysisRuns.createdAt))
    .limit(1);

  if (!latestRun) {
    return NextResponse.json({ status: "none" });
  }

  return NextResponse.json({
    runId: latestRun.id,
    status: latestRun.status,
    ordersSynced: latestRun.ordersSynced,
    uniqueCustomers: latestRun.uniqueCustomers,
    error: latestRun.error,
  });
}
