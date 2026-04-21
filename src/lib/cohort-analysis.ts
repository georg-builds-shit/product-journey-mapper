import type { OrderedProductEvent } from "./klaviyo";
import type { ChannelDefinition, ProductGroupings, CohortGranularity } from "./config";
import { UNASSIGNED_CHANNEL_ID, applyGrouping } from "./config";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface CohortOrder {
  orderId: string;
  datetime: string; // ISO
  value: number; // sum of line values
  discountCode: string | null; // any discount code seen on this order's lines
  products: Array<{
    name: string;
    productId: string | null;
    sku: string | null;
    line: string; // resolved product line label (falls back to name when no grouping)
    value: number;
  }>;
}

export interface CohortCustomerSequence {
  profileId: string;
  orders: CohortOrder[];
  totalRevenue: number;
}

export type PerChannelResult<T> = {
  combined: T;
  perChannel: Record<string, T>; // keyed by channel id; includes UNASSIGNED_CHANNEL_ID if present
};

// ─── Metric 1: cohort retention curves ───
export interface CohortCurveOrderCut {
  n: number; // 2, 3, 4
  by30d: number;
  by60d: number;
  by90d: number;
  by180d: number;
  by365d: number;
}
export interface CohortCurveRow {
  cohortLabel: string; // "2025-06" (monthly) or "2025-Q3" (quarterly)
  cohortSize: number;
  byOrderN: CohortCurveOrderCut[];
}
export interface CohortCurvesData {
  rows: CohortCurveRow[];
  totalCustomers: number;
}
export type CohortCurvesResult = PerChannelResult<CohortCurvesData>;

// ─── Metric 2: time between orders ───
export interface TimeBetweenOrdersBucket {
  n: number; // 1 → 2, 2 → 3, 3 → 4
  sampleSize: number;
  median: number;
  p25: number;
  p75: number;
  p90: number;
  histogram: Array<{ label: string; minDays: number; maxDays: number; count: number; pct: number }>;
}
export interface TimeBetweenOrdersData {
  perN: TimeBetweenOrdersBucket[];
  totalCustomers: number;
}
export type TimeBetweenOrdersResult = PerChannelResult<TimeBetweenOrdersData>;

// ─── Metric 3: first → second product matrix ───
export interface FirstToSecondMatrixData {
  rowLabels: string[]; // product/line on first order
  colLabels: string[]; // product/line on second order
  // cells[rowIdx][colIdx] = { count, pct } — pct = count / (row sum) × 100
  cells: Array<Array<{ count: number; pct: number }>>;
  totalRepeaters: number;
}
export type FirstToSecondMatrixResult = PerChannelResult<FirstToSecondMatrixData>;

// ─── Metric 4: order count distribution + AOV ───
export interface OrderCountDistributionData {
  distribution: Array<{ bucket: string; count: number; pct: number }>; // "1", "2", "3", "4+"
  aovByOrderNumber: Array<{ orderNumber: string; mean: number; median: number; sampleSize: number }>;
  totalCustomers: number;
}
export type OrderCountDistributionResult = PerChannelResult<OrderCountDistributionData>;

// ─── Metric 5: discount code usage ───
export interface DiscountCodeUsageData {
  available: boolean; // false when <5% of first orders carry a code
  firstOrderWithCodePct: number;
  firstOrderWithoutCodePct: number;
  repeatRateWithCode: number; // % of with-code first-buyers with ≥2 orders within 365d
  repeatRateWithoutCode: number;
  sampleWithCode: number;
  sampleWithoutCode: number;
}
export type DiscountCodeUsageResult = PerChannelResult<DiscountCodeUsageData>;

// ─── Metric 7 (we renumbered — #6 engagement deferred): cross-channel ───
export interface CrossChannelData {
  totalRepeatCustomers: number;
  crossChannelCount: number;
  crossChannelPct: number;
  // for a channel: how many of its repeat customers have at least one order
  // on a different channel
  perOriginChannel?: Record<string, { repeatCustomers: number; crossCount: number; crossPct: number }>;
}
export type CrossChannelResult = CrossChannelData;

// ─── Aggregate output ───
export interface CohortAnalyticsOutput {
  cohortCurves: CohortCurvesResult;
  timeBetweenOrders: TimeBetweenOrdersResult;
  firstToSecondMatrix: FirstToSecondMatrixResult;
  orderCountDistribution: OrderCountDistributionResult;
  discountCodeUsage: DiscountCodeUsageResult;
  crossChannel: CrossChannelResult;
  unassignedSize: number;
  warnings: string[];
  // Echo of channel ids + labels for the UI (so it doesn't need to re-read config)
  channelLabels: Array<{ id: string; label: string }>;
}

export interface CohortAnalyticsInput {
  events: OrderedProductEvent[];
  // profileId → primary channelId (first-match-wins; missing → unassigned)
  channelMap: Map<string, string>;
  // profileId → set of ALL channels the profile matches (for cross-channel detection).
  // Optional — when omitted, cross-channel count defaults to 0.
  allMatchesMap?: Map<string, Set<string>>;
  // ordered list of configured channels (for UI display + per-channel iteration)
  channels: ChannelDefinition[];
  granularity: CohortGranularity;
  grouping: ProductGroupings | null;
}

// ─────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────

export function computeCohortAnalytics(input: CohortAnalyticsInput): CohortAnalyticsOutput {
  const { events, channelMap, allMatchesMap, channels, granularity, grouping } = input;

  const sequences = buildCohortSequences(events, grouping);
  const channelIds = [...channels.map((c) => c.id), UNASSIGNED_CHANNEL_ID];

  // Attach firstOrderChannel to each sequence
  const sequencesWithChannel = sequences.map((s) => ({
    sequence: s,
    channel: channelMap.get(s.profileId) ?? UNASSIGNED_CHANNEL_ID,
  }));

  const unassignedSize = sequencesWithChannel.filter(
    (s) => s.channel === UNASSIGNED_CHANNEL_ID
  ).length;

  const cohortCurves = calculateCohortCurves(sequencesWithChannel, channelIds, granularity);
  const timeBetweenOrders = calculateTimeBetweenOrders(sequencesWithChannel, channelIds);
  const firstToSecondMatrix = buildFirstToSecondMatrix(sequencesWithChannel, channelIds);
  const orderCountDistribution = calculateOrderCountDistribution(sequencesWithChannel, channelIds);
  const discountCodeUsage = calculateDiscountCodeUsage(sequencesWithChannel, channelIds);
  const crossChannel = calculateCrossChannelCount(
    sequences,
    channelMap,
    allMatchesMap,
    channels
  );

  const warnings: string[] = [];
  if (granularity === "monthly") {
    const thinCohorts = cohortCurves.combined.rows.filter((r) => r.cohortSize < 50).length;
    if (thinCohorts > 0 && cohortCurves.combined.rows.length > 0) {
      warnings.push("monthly_cohorts_under_50");
    }
  }

  const channelLabels = [
    ...channels.map((c) => ({ id: c.id, label: c.label })),
    { id: UNASSIGNED_CHANNEL_ID, label: "Unassigned" },
  ];

  return {
    cohortCurves,
    timeBetweenOrders,
    firstToSecondMatrix,
    orderCountDistribution,
    discountCodeUsage,
    crossChannel,
    unassignedSize,
    warnings,
    channelLabels,
  };
}

// ─────────────────────────────────────────────────────────────
// Sequence builder (cohort-aware — preserves productId/sku/line/discountCode)
// ─────────────────────────────────────────────────────────────

export function buildCohortSequences(
  events: OrderedProductEvent[],
  grouping: ProductGroupings | null
): CohortCustomerSequence[] {
  const byProfile = new Map<string, OrderedProductEvent[]>();
  for (const e of events) {
    const arr = byProfile.get(e.profileId) || [];
    arr.push(e);
    byProfile.set(e.profileId, arr);
  }

  const sequences: CohortCustomerSequence[] = [];

  for (const [profileId, profileEvents] of byProfile) {
    const byOrder = new Map<string, OrderedProductEvent[]>();
    for (const e of profileEvents) {
      const key = e.orderId || e.id;
      const arr = byOrder.get(key) || [];
      arr.push(e);
      byOrder.set(key, arr);
    }

    const orders: CohortOrder[] = [];
    for (const [orderId, orderEvents] of byOrder) {
      const sorted = orderEvents.sort(
        (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
      );
      const orderDiscount =
        sorted.find((e) => e.discountCode && e.discountCode.trim())?.discountCode ?? null;
      orders.push({
        orderId,
        datetime: sorted[0].datetime,
        value: sorted.reduce((sum, e) => sum + (e.value || 0), 0),
        discountCode: orderDiscount,
        products: sorted.map((e) => ({
          name: e.productName,
          productId: e.productId,
          sku: e.sku,
          line: applyGrouping(
            { productId: e.productId, sku: e.sku, productName: e.productName },
            grouping
          ),
          value: e.value || 0,
        })),
      });
    }

    orders.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

    sequences.push({
      profileId,
      orders,
      totalRevenue: orders.reduce((sum, o) => sum + o.value, 0),
    });
  }

  return sequences;
}

// ─────────────────────────────────────────────────────────────
// Metric helpers
// ─────────────────────────────────────────────────────────────

type WithChannel = { sequence: CohortCustomerSequence; channel: string };

function splitByChannel<T>(
  sequences: WithChannel[],
  channelIds: string[],
  compute: (subset: CohortCustomerSequence[]) => T
): PerChannelResult<T> {
  const combined = compute(sequences.map((s) => s.sequence));
  const perChannel: Record<string, T> = {};
  for (const id of channelIds) {
    const subset = sequences.filter((s) => s.channel === id).map((s) => s.sequence);
    perChannel[id] = compute(subset);
  }
  return { combined, perChannel };
}

function cohortLabel(date: Date, granularity: CohortGranularity): string {
  const y = date.getUTCFullYear();
  if (granularity === "quarterly") {
    const q = Math.floor(date.getUTCMonth() / 3) + 1;
    return `${y}-Q${q}`;
  }
  return `${y}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ─────────────────────────────────────────────────────────────
// Metric 1 — Cohort retention curves (30/60/90/180/365 day × N=2,3,4)
// ─────────────────────────────────────────────────────────────

function calculateCohortCurves(
  sequencesWithChannel: WithChannel[],
  channelIds: string[],
  granularity: CohortGranularity
): CohortCurvesResult {
  return splitByChannel(sequencesWithChannel, channelIds, (subset) => {
    const cohorts = new Map<
      string,
      {
        customers: Array<{ firstDate: string; orderDates: string[] }>;
      }
    >();

    for (const seq of subset) {
      if (seq.orders.length === 0) continue;
      const first = seq.orders[0];
      const label = cohortLabel(new Date(first.datetime), granularity);
      const entry = cohorts.get(label) || { customers: [] };
      entry.customers.push({
        firstDate: first.datetime,
        orderDates: seq.orders.map((o) => o.datetime),
      });
      cohorts.set(label, entry);
    }

    const rows: CohortCurveRow[] = [];
    const cutoffs = [30, 60, 90, 180, 365] as const;

    for (const [label, entry] of cohorts) {
      const size = entry.customers.length;
      if (size === 0) continue;
      const byOrderN: CohortCurveOrderCut[] = [];

      for (const n of [2, 3, 4]) {
        const counts = { 30: 0, 60: 0, 90: 0, 180: 0, 365: 0 };
        for (const c of entry.customers) {
          if (c.orderDates.length < n) continue;
          const nthDate = c.orderDates[n - 1]; // Nth order (0-indexed)
          const days = daysBetween(c.firstDate, nthDate);
          for (const cut of cutoffs) {
            if (days <= cut) counts[cut]++;
          }
        }
        byOrderN.push({
          n,
          by30d: size > 0 ? (counts[30] / size) * 100 : 0,
          by60d: size > 0 ? (counts[60] / size) * 100 : 0,
          by90d: size > 0 ? (counts[90] / size) * 100 : 0,
          by180d: size > 0 ? (counts[180] / size) * 100 : 0,
          by365d: size > 0 ? (counts[365] / size) * 100 : 0,
        });
      }

      rows.push({ cohortLabel: label, cohortSize: size, byOrderN });
    }

    rows.sort((a, b) => a.cohortLabel.localeCompare(b.cohortLabel));

    return { rows, totalCustomers: subset.length };
  });
}

// ─────────────────────────────────────────────────────────────
// Metric 2 — Time between orders (N=1→2, 2→3, 3→4) with percentiles
// ─────────────────────────────────────────────────────────────

function calculateTimeBetweenOrders(
  sequencesWithChannel: WithChannel[],
  channelIds: string[]
): TimeBetweenOrdersResult {
  const BUCKETS = [
    { label: "0–7 days", minDays: 0, maxDays: 7 },
    { label: "8–14 days", minDays: 8, maxDays: 14 },
    { label: "15–30 days", minDays: 15, maxDays: 30 },
    { label: "31–60 days", minDays: 31, maxDays: 60 },
    { label: "61–90 days", minDays: 61, maxDays: 90 },
    { label: "91–180 days", minDays: 91, maxDays: 180 },
    { label: "180+ days", minDays: 181, maxDays: Infinity },
  ];

  return splitByChannel(sequencesWithChannel, channelIds, (subset) => {
    const perN: TimeBetweenOrdersBucket[] = [];
    for (const n of [1, 2, 3]) {
      const gaps: number[] = [];
      for (const seq of subset) {
        if (seq.orders.length > n) {
          gaps.push(daysBetween(seq.orders[n - 1].datetime, seq.orders[n].datetime));
        }
      }
      gaps.sort((a, b) => a - b);
      const histogram = BUCKETS.map((b) => {
        const count = gaps.filter((g) => g >= b.minDays && g <= b.maxDays).length;
        return {
          ...b,
          maxDays: b.maxDays === Infinity ? 10_000 : b.maxDays, // JSON-serializable
          count,
          pct: gaps.length > 0 ? (count / gaps.length) * 100 : 0,
        };
      });
      perN.push({
        n,
        sampleSize: gaps.length,
        median: percentile(gaps, 0.5),
        p25: percentile(gaps, 0.25),
        p75: percentile(gaps, 0.75),
        p90: percentile(gaps, 0.9),
        histogram,
      });
    }
    return { perN, totalCustomers: subset.length };
  });
}

// ─────────────────────────────────────────────────────────────
// Metric 3 — First → second product matrix
// ─────────────────────────────────────────────────────────────

function buildFirstToSecondMatrix(
  sequencesWithChannel: WithChannel[],
  channelIds: string[]
): FirstToSecondMatrixResult {
  return splitByChannel(sequencesWithChannel, channelIds, (subset) => {
    // transitions[rowLine][colLine] = count
    const transitions = new Map<string, Map<string, number>>();
    const rowTotals = new Map<string, number>();
    const allLines = new Set<string>();
    let totalRepeaters = 0;

    for (const seq of subset) {
      if (seq.orders.length < 2) continue;
      totalRepeaters++;
      const firstLines = new Set(seq.orders[0].products.map((p) => p.line));
      const secondLines = new Set(seq.orders[1].products.map((p) => p.line));

      for (const fromLine of firstLines) {
        allLines.add(fromLine);
        rowTotals.set(fromLine, (rowTotals.get(fromLine) || 0) + 1);
        if (!transitions.has(fromLine)) transitions.set(fromLine, new Map());
        const inner = transitions.get(fromLine)!;
        for (const toLine of secondLines) {
          allLines.add(toLine);
          inner.set(toLine, (inner.get(toLine) || 0) + 1);
        }
      }
    }

    // Sort row labels by how many customers had them as first-line (desc),
    // and col labels by total arrivals across all rows (desc).
    const rowLabels = Array.from(rowTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label]) => label);
    const colArrivals = new Map<string, number>();
    for (const inner of transitions.values()) {
      for (const [toLine, count] of inner) {
        colArrivals.set(toLine, (colArrivals.get(toLine) || 0) + count);
      }
    }
    const colLabels = Array.from(colArrivals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label]) => label);

    const cells = rowLabels.map((row) => {
      const rowTotal = rowTotals.get(row) || 0;
      const inner = transitions.get(row) || new Map<string, number>();
      return colLabels.map((col) => {
        const count = inner.get(col) || 0;
        return { count, pct: rowTotal > 0 ? (count / rowTotal) * 100 : 0 };
      });
    });

    return { rowLabels, colLabels, cells, totalRepeaters };
  });
}

// ─────────────────────────────────────────────────────────────
// Metric 4 — Order count distribution + AOV by order number
// ─────────────────────────────────────────────────────────────

function calculateOrderCountDistribution(
  sequencesWithChannel: WithChannel[],
  channelIds: string[]
): OrderCountDistributionResult {
  return splitByChannel(sequencesWithChannel, channelIds, (subset) => {
    const buckets = { "1": 0, "2": 0, "3": 0, "4+": 0 };
    // Per-order-number collected AOV samples
    const aovByOrder: Record<string, number[]> = { "1": [], "2": [], "3": [], "4+": [] };

    for (const seq of subset) {
      const n = seq.orders.length;
      const bucket = n >= 4 ? "4+" : String(n);
      if (bucket in buckets) buckets[bucket as keyof typeof buckets]++;

      for (let i = 0; i < seq.orders.length; i++) {
        const key = i >= 3 ? "4+" : String(i + 1);
        aovByOrder[key].push(seq.orders[i].value);
      }
    }

    const total = subset.length;
    const distribution = (["1", "2", "3", "4+"] as const).map((bucket) => ({
      bucket,
      count: buckets[bucket],
      pct: total > 0 ? (buckets[bucket] / total) * 100 : 0,
    }));

    const aovByOrderNumber = (["1", "2", "3", "4+"] as const).map((key) => {
      const samples = [...aovByOrder[key]].sort((a, b) => a - b);
      const mean = samples.length > 0 ? samples.reduce((s, v) => s + v, 0) / samples.length : 0;
      const median = percentile(samples, 0.5);
      return { orderNumber: key, mean, median, sampleSize: samples.length };
    });

    return { distribution, aovByOrderNumber, totalCustomers: total };
  });
}

// ─────────────────────────────────────────────────────────────
// Metric 5 — First-order discount code usage + repeat rate diff
// ─────────────────────────────────────────────────────────────

function calculateDiscountCodeUsage(
  sequencesWithChannel: WithChannel[],
  channelIds: string[]
): DiscountCodeUsageResult {
  const ONE_YEAR_MS = 365 * 86_400_000;

  return splitByChannel(sequencesWithChannel, channelIds, (subset) => {
    if (subset.length === 0) {
      return {
        available: false,
        firstOrderWithCodePct: 0,
        firstOrderWithoutCodePct: 0,
        repeatRateWithCode: 0,
        repeatRateWithoutCode: 0,
        sampleWithCode: 0,
        sampleWithoutCode: 0,
      };
    }

    let withCode = 0;
    let withoutCode = 0;
    let repeatWithCode = 0;
    let repeatWithoutCode = 0;

    for (const seq of subset) {
      if (seq.orders.length === 0) continue;
      const first = seq.orders[0];
      const hasCode = !!(first.discountCode && first.discountCode.trim());
      const repeated = seq.orders.some(
        (o, i) =>
          i > 0 &&
          new Date(o.datetime).getTime() - new Date(first.datetime).getTime() <= ONE_YEAR_MS
      );
      if (hasCode) {
        withCode++;
        if (repeated) repeatWithCode++;
      } else {
        withoutCode++;
        if (repeated) repeatWithoutCode++;
      }
    }

    const total = withCode + withoutCode;
    const available = total > 0 && (withCode / total) * 100 >= 5;

    return {
      available,
      firstOrderWithCodePct: total > 0 ? (withCode / total) * 100 : 0,
      firstOrderWithoutCodePct: total > 0 ? (withoutCode / total) * 100 : 0,
      repeatRateWithCode: withCode > 0 ? (repeatWithCode / withCode) * 100 : 0,
      repeatRateWithoutCode: withoutCode > 0 ? (repeatWithoutCode / withoutCode) * 100 : 0,
      sampleWithCode: withCode,
      sampleWithoutCode: withoutCode,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// Metric 7 — Cross-channel customer count (stand-alone tile)
// ─────────────────────────────────────────────────────────────

function calculateCrossChannelCount(
  sequences: CohortCustomerSequence[],
  channelMap: Map<string, string>,
  allMatchesMap: Map<string, Set<string>> | undefined,
  channels: ChannelDefinition[]
): CrossChannelData {
  // Cross-channel = a repeat customer whose profile matches ≥2 configured
  // channels (computed independently of first-match-wins assignment). This
  // is a profile-level signal: a customer appearing in both a DTC list and
  // an Affiliate segment is cross-channel regardless of where their first
  // order was bucketed.
  //
  // Limitation: without per-order channel attribution (utm/source on the
  // event) we can't say their orders literally happened on different
  // channels, only that the profile sits in multiple channel definitions.
  // For most brand configs (channels defined by list/segment membership
  // that persists across orders) this is the right signal.

  const channelIds = [...channels.map((c) => c.id), UNASSIGNED_CHANNEL_ID];
  const repeatCustomers = sequences.filter((s) => s.orders.length >= 2);
  const totalRepeatCustomers = repeatCustomers.length;

  let crossChannelCount = 0;
  const perOriginChannel: Record<
    string,
    { repeatCustomers: number; crossCount: number; crossPct: number }
  > = {};
  for (const id of channelIds) {
    perOriginChannel[id] = { repeatCustomers: 0, crossCount: 0, crossPct: 0 };
  }

  for (const seq of repeatCustomers) {
    const originChannel = channelMap.get(seq.profileId) ?? UNASSIGNED_CHANNEL_ID;
    perOriginChannel[originChannel].repeatCustomers++;

    const matches = allMatchesMap?.get(seq.profileId);
    const isCrossChannel = !!matches && matches.size > 1;
    if (isCrossChannel) {
      crossChannelCount++;
      perOriginChannel[originChannel].crossCount++;
    }
  }

  for (const id of channelIds) {
    const bucket = perOriginChannel[id];
    bucket.crossPct =
      bucket.repeatCustomers > 0 ? (bucket.crossCount / bucket.repeatCustomers) * 100 : 0;
  }

  return {
    totalRepeatCustomers,
    crossChannelCount,
    crossChannelPct:
      totalRepeatCustomers > 0 ? (crossChannelCount / totalRepeatCustomers) * 100 : 0,
    perOriginChannel,
  };
}
