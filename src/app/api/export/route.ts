import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { analysisRuns } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";

const COMBINED = "__combined__";

/**
 * GET /api/export?accountId=X&metric=Y[&runId=Z][&channel=C]
 *
 * Streams CSV. Metric keys:
 *   cohort-curves, time-between-orders, first-to-second-matrix,
 *   order-count-distribution, discount-code-usage, cross-channel,
 *   stickiness, repurchase-timing, cohort-retention
 */
export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const accountId = request.nextUrl.searchParams.get("accountId");
  const metric = request.nextUrl.searchParams.get("metric");
  const runIdParam = request.nextUrl.searchParams.get("runId");
  const channel = request.nextUrl.searchParams.get("channel") || COMBINED;

  if (!accountId || !metric) {
    return NextResponse.json({ error: "accountId and metric required" }, { status: 400 });
  }

  let runId = runIdParam;
  if (!runId) {
    const [latest] = await db
      .select()
      .from(analysisRuns)
      .where(and(eq(analysisRuns.accountId, accountId), eq(analysisRuns.status, "complete")))
      .orderBy(desc(analysisRuns.createdAt))
      .limit(1);
    if (!latest) {
      return NextResponse.json({ error: "No completed analysis found" }, { status: 404 });
    }
    runId = latest.id;
  }

  const [run] = await db
    .select()
    .from(analysisRuns)
    .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.accountId, accountId)));

  if (!run) {
    return NextResponse.json({ error: "Analysis run not found" }, { status: 404 });
  }

  const analytics = run.cohortAnalyticsJson as any;

  const serializers: Record<string, () => string> = {
    "cohort-curves": () => serializeCohortCurves(pickSlice(analytics?.cohortCurves, channel)),
    "time-between-orders": () =>
      serializeTimeBetweenOrders(pickSlice(analytics?.timeBetweenOrders, channel)),
    "first-to-second-matrix": () =>
      serializeFirstToSecondMatrix(pickSlice(analytics?.firstToSecondMatrix, channel)),
    "order-count-distribution": () =>
      serializeOrderCountDistribution(
        pickSlice(analytics?.orderCountDistribution, channel)
      ),
    "discount-code-usage": () =>
      serializeDiscountCodeUsage(pickSlice(analytics?.discountCodeUsage, channel)),
    "cross-channel": () => serializeCrossChannel(analytics?.crossChannel),
    stickiness: () => serializeStickiness(run.stickinessJson as any[]),
    "repurchase-timing": () => serializeRepurchaseTiming(run.repurchaseTimingJson as any[]),
    "cohort-retention": () => serializeCohortRetention(run.cohortRetentionJson as any[]),
  };

  const serialize = serializers[metric];
  if (!serialize) {
    return NextResponse.json({ error: `Unknown metric: ${metric}` }, { status: 400 });
  }

  let body: string;
  try {
    body = serialize();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const filename = `${metric}${channel !== COMBINED ? `-${channel}` : ""}-${runId.slice(0, 8)}.csv`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function pickSlice<T>(
  metric: { combined: T; perChannel: Record<string, T> } | undefined,
  channel: string
): T | null {
  if (!metric) return null;
  if (channel === COMBINED) return metric.combined;
  return metric.perChannel?.[channel] ?? null;
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows: Array<Array<unknown>>): string {
  return rows.map((r) => r.map(escapeCsv).join(",")).join("\n") + "\n";
}

function empty(metric: string): string {
  return `${metric}\nno data\n`;
}

// ─── Metric serializers ───

function serializeCohortCurves(data: any): string {
  if (!data || !data.rows || data.rows.length === 0) return empty("cohort_label,cohort_size");
  const header = [
    "cohort_label",
    "cohort_size",
    "order_n",
    "by_30d_pct",
    "by_60d_pct",
    "by_90d_pct",
    "by_180d_pct",
    "by_365d_pct",
  ];
  const rows: Array<Array<unknown>> = [header];
  for (const cohort of data.rows) {
    for (const cut of cohort.byOrderN) {
      rows.push([
        cohort.cohortLabel,
        cohort.cohortSize,
        cut.n,
        cut.by30d.toFixed(2),
        cut.by60d.toFixed(2),
        cut.by90d.toFixed(2),
        cut.by180d.toFixed(2),
        cut.by365d.toFixed(2),
      ]);
    }
  }
  return toCsv(rows);
}

function serializeTimeBetweenOrders(data: any): string {
  if (!data || !data.perN) return empty("n,bucket");
  const header = [
    "n_to_n_plus_1",
    "sample_size",
    "median_days",
    "p25_days",
    "p75_days",
    "p90_days",
    "bucket_label",
    "bucket_count",
    "bucket_pct",
  ];
  const rows: Array<Array<unknown>> = [header];
  for (const bucket of data.perN) {
    if (!bucket.histogram || bucket.histogram.length === 0) {
      rows.push([
        `${bucket.n}->${bucket.n + 1}`,
        bucket.sampleSize,
        bucket.median.toFixed(2),
        bucket.p25.toFixed(2),
        bucket.p75.toFixed(2),
        bucket.p90.toFixed(2),
        "",
        "",
        "",
      ]);
      continue;
    }
    for (const h of bucket.histogram) {
      rows.push([
        `${bucket.n}->${bucket.n + 1}`,
        bucket.sampleSize,
        bucket.median.toFixed(2),
        bucket.p25.toFixed(2),
        bucket.p75.toFixed(2),
        bucket.p90.toFixed(2),
        h.label,
        h.count,
        h.pct.toFixed(2),
      ]);
    }
  }
  return toCsv(rows);
}

function serializeFirstToSecondMatrix(data: any): string {
  if (!data || !data.rowLabels || data.rowLabels.length === 0)
    return empty("first_order_product,second_order_product");
  const header = ["first_order_product", "", ...data.colLabels];
  const rows: Array<Array<unknown>> = [header];
  const subheader = ["", "pct_or_count_format: pct (count)"];
  for (const _ of data.colLabels) subheader.push("");
  rows.push(subheader);
  for (let r = 0; r < data.rowLabels.length; r++) {
    const line: Array<unknown> = [data.rowLabels[r], ""];
    for (let c = 0; c < data.colLabels.length; c++) {
      const cell = data.cells[r][c];
      line.push(`${cell.pct.toFixed(1)}% (${cell.count})`);
    }
    rows.push(line);
  }
  return toCsv(rows);
}

function serializeOrderCountDistribution(data: any): string {
  if (!data) return empty("section,bucket_or_order_number,count,pct_or_mean,median,sample_size");
  const header = [
    "section",
    "bucket_or_order_number",
    "count",
    "pct_or_mean",
    "median",
    "sample_size",
  ];
  const rows: Array<Array<unknown>> = [header];
  for (const d of data.distribution || []) {
    rows.push(["distribution", d.bucket, d.count, d.pct.toFixed(2), "", ""]);
  }
  for (const a of data.aovByOrderNumber || []) {
    rows.push([
      "aov",
      a.orderNumber,
      "",
      a.mean.toFixed(2),
      a.median.toFixed(2),
      a.sampleSize,
    ]);
  }
  return toCsv(rows);
}

function serializeDiscountCodeUsage(data: any): string {
  if (!data) return empty("metric,value");
  const rows: Array<Array<unknown>> = [["metric", "value"]];
  rows.push(["available", data.available ? "yes" : "no"]);
  rows.push(["first_order_with_code_pct", data.firstOrderWithCodePct.toFixed(2)]);
  rows.push(["first_order_without_code_pct", data.firstOrderWithoutCodePct.toFixed(2)]);
  rows.push(["repeat_rate_with_code_pct", data.repeatRateWithCode.toFixed(2)]);
  rows.push(["repeat_rate_without_code_pct", data.repeatRateWithoutCode.toFixed(2)]);
  rows.push(["sample_with_code", data.sampleWithCode]);
  rows.push(["sample_without_code", data.sampleWithoutCode]);
  return toCsv(rows);
}

function serializeCrossChannel(data: any): string {
  if (!data) return empty("channel,repeat_customers,cross_count,cross_pct");
  const rows: Array<Array<unknown>> = [
    ["channel", "repeat_customers", "cross_count", "cross_pct"],
    ["__total__", data.totalRepeatCustomers, data.crossChannelCount, data.crossChannelPct.toFixed(2)],
  ];
  for (const [id, entry] of Object.entries(data.perOriginChannel || {})) {
    const e = entry as { repeatCustomers: number; crossCount: number; crossPct: number };
    rows.push([id, e.repeatCustomers, e.crossCount, e.crossPct.toFixed(2)]);
  }
  return toCsv(rows);
}

function serializeStickiness(data: any[] | null): string {
  if (!data || data.length === 0) return empty("product");
  const header = [
    "product_name",
    "category",
    "total_buyers",
    "buyers_who_returned_for_any",
    "stickiness_rate",
    "avg_days_to_return",
  ];
  const rows: Array<Array<unknown>> = [header];
  for (const d of data) {
    rows.push([
      d.productName,
      d.category ?? "",
      d.totalBuyers,
      d.buyersWhoReturnedForAny,
      d.stickinessRate?.toFixed(2) ?? "",
      d.avgDaysToReturn ?? "",
    ]);
  }
  return toCsv(rows);
}

function serializeRepurchaseTiming(data: any[] | null): string {
  if (!data || data.length === 0) return empty("bucket");
  const rows: Array<Array<unknown>> = [["bucket", "min_days", "max_days", "count", "pct"]];
  for (const d of data) {
    rows.push([
      d.label,
      d.minDays,
      d.maxDays === Infinity ? "" : d.maxDays,
      d.count,
      d.pct?.toFixed(2) ?? "",
    ]);
  }
  return toCsv(rows);
}

function serializeCohortRetention(data: any[] | null): string {
  if (!data || data.length === 0) return empty("cohort_month");
  const rows: Array<Array<unknown>> = [
    ["cohort_month", "cohort_size", "month_offset", "retained_count", "retained_pct"],
  ];
  for (const cohort of data) {
    for (const r of cohort.retention) {
      rows.push([
        cohort.cohortMonth,
        cohort.cohortSize,
        r.monthOffset,
        r.retainedCount,
        r.retainedPct?.toFixed(2) ?? "",
      ]);
    }
  }
  return toCsv(rows);
}
