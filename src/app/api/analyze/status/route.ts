import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { analysisRuns } from "@/db/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get("accountId");
  const segmentId = request.nextUrl.searchParams.get("segmentId");

  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  // Build filter conditions
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
