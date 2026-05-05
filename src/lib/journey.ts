import type { OrderedProductEvent } from "./klaviyo";

/**
 * Minimum unique buyers required before we surface a product's rate-based
 * metric (stickiness, repurchase rate, gateway %). With fewer buyers the
 * 95% confidence interval is too wide to draw conclusions — e.g. 100% from
 * n=3 has a Wilson lower bound of ~44%, which is meaningless ranking signal.
 *
 * 50 was chosen as a practical floor: tight enough that the displayed rate
 * is within ±~14pp of the true rate, loose enough that mid-size catalogs
 * still produce a useful list. Tune via env var if needed later.
 */
export const MIN_SAMPLE_SIZE = 50;

/**
 * Wilson score interval lower bound at 95% confidence. Returns 0–1.
 *
 * Penalizes small samples without throwing them away: a product with 100%
 * stickiness from 3 buyers scores ~0.44, while 95% from 500 buyers scores
 * ~0.93. Sorting by this instead of the point estimate keeps high-confidence
 * winners on top instead of small-sample noise.
 *
 * https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval
 */
export function wilsonLowerBound(successes: number, total: number): number {
  if (total === 0) return 0;
  const z = 1.96; // 95% CI
  const z2 = z * z;
  const phat = successes / total;
  const denom = 1 + z2 / total;
  const center = phat + z2 / (2 * total);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total);
  return Math.max(0, (center - margin) / denom);
}

// An order is a group of products bought in the same cart
interface Order {
  orderId: string;
  datetime: string;
  products: { name: string; category: string | null; value: number }[];
  totalValue: number;
}

// A customer's ordered sequence of orders
interface CustomerSequence {
  profileId: string;
  orders: Order[];
  totalRevenue: number;
}

interface TransitionRecord {
  fromProduct: string;
  fromCategory: string | null;
  toProduct: string;
  toCategory: string | null;
  step: number; // 1→2 = step 1, 2→3 = step 2, etc.
  daysBetween: number;
}

export interface TransitionResult {
  fromProduct: string;
  fromCategory: string | null;
  toProduct: string;
  toCategory: string | null;
  transitionCount: number;
  transitionPct: number;
  avgDaysBetween: number;
  step: number;
}

export interface GatewayResult {
  productName: string;
  category: string | null;
  firstPurchaseCount: number;
  firstPurchasePct: number;
  avgLtvAfter: number;
  avgOrdersAfter: number;
}

export interface StickinessResult {
  productName: string;
  category: string | null;
  totalBuyers: number;
  buyersWhoReturnedForAny: number;
  stickinessRate: number; // % who placed another order (any product) after buying this
  /**
   * Wilson 95% CI lower bound on stickinessRate (0–100). Used as the sort key
   * so small-sample products don't crowd the top of the table. Optional for
   * backward compat with analysis runs created before this field existed.
   */
  wilsonLower?: number;
  avgDaysToReturn: number;
}

export interface JourneyStats {
  totalCustomers: number;
  repeatCustomers: number;
  repeatRate: number;
  avgOrdersPerCustomer: number;
  medianDaysBetweenOrders: number;
}

/**
 * Build order sequences from raw Ordered Product events.
 * Groups by customer → groups by order → sorts chronologically.
 */
export function buildOrderSequences(events: OrderedProductEvent[]): CustomerSequence[] {
  // Group events by profile (customer)
  const byProfile = new Map<string, OrderedProductEvent[]>();
  for (const event of events) {
    const existing = byProfile.get(event.profileId) || [];
    existing.push(event);
    byProfile.set(event.profileId, existing);
  }

  const sequences: CustomerSequence[] = [];

  for (const [profileId, profileEvents] of byProfile) {
    // Group by orderId (items in same cart)
    const byOrder = new Map<string, OrderedProductEvent[]>();
    for (const event of profileEvents) {
      const key = event.orderId || event.id; // fallback to event ID if no orderId
      const existing = byOrder.get(key) || [];
      existing.push(event);
      byOrder.set(key, existing);
    }

    // Build orders sorted by datetime
    const orders: Order[] = [];
    for (const [orderId, orderEvents] of byOrder) {
      const sortedEvents = orderEvents.sort(
        (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
      );
      orders.push({
        orderId,
        datetime: sortedEvents[0].datetime,
        products: sortedEvents.map((e) => ({
          name: e.productName,
          category: e.categories?.[0] || e.productType || null,
          value: e.value,
        })),
        totalValue: sortedEvents.reduce((sum, e) => sum + e.value, 0),
      });
    }

    // Sort orders chronologically
    orders.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

    const totalRevenue = orders.reduce((sum, o) => sum + o.totalValue, 0);
    sequences.push({ profileId, orders, totalRevenue });
  }

  return sequences;
}

/**
 * Build transition matrix from customer sequences.
 * For each customer: Order N products → Order N+1 products = transitions.
 */
export function buildTransitionMatrix(
  sequences: CustomerSequence[],
  maxSteps: number = 5
): TransitionResult[] {
  const transitions: TransitionRecord[] = [];

  for (const seq of sequences) {
    if (seq.orders.length < 2) continue; // need at least 2 orders

    const stepsToProcess = Math.min(seq.orders.length - 1, maxSteps);
    for (let i = 0; i < stepsToProcess; i++) {
      const fromOrder = seq.orders[i];
      const toOrder = seq.orders[i + 1];
      const daysBetween =
        (new Date(toOrder.datetime).getTime() - new Date(fromOrder.datetime).getTime()) /
        (1000 * 60 * 60 * 24);

      // Each product in from-order transitions to each product in to-order
      for (const fromProduct of fromOrder.products) {
        for (const toProduct of toOrder.products) {
          transitions.push({
            fromProduct: fromProduct.name,
            fromCategory: fromProduct.category,
            toProduct: toProduct.name,
            toCategory: toProduct.category,
            step: i + 1,
            daysBetween,
          });
        }
      }
    }
  }

  // Aggregate transitions
  const aggregated = new Map<string, {
    fromProduct: string;
    fromCategory: string | null;
    toProduct: string;
    toCategory: string | null;
    step: number;
    count: number;
    totalDays: number;
  }>();

  for (const t of transitions) {
    const key = `${t.step}:${t.fromProduct}→${t.toProduct}`;
    const existing = aggregated.get(key);
    if (existing) {
      existing.count++;
      existing.totalDays += t.daysBetween;
    } else {
      aggregated.set(key, {
        fromProduct: t.fromProduct,
        fromCategory: t.fromCategory,
        toProduct: t.toProduct,
        toCategory: t.toCategory,
        step: t.step,
        count: 1,
        totalDays: t.daysBetween,
      });
    }
  }

  // Calculate percentages (per from-product per step)
  const fromCounts = new Map<string, number>();
  for (const entry of aggregated.values()) {
    const key = `${entry.step}:${entry.fromProduct}`;
    fromCounts.set(key, (fromCounts.get(key) || 0) + entry.count);
  }

  const results: TransitionResult[] = [];
  for (const entry of aggregated.values()) {
    const fromKey = `${entry.step}:${entry.fromProduct}`;
    const totalFromCount = fromCounts.get(fromKey) || 1;
    results.push({
      fromProduct: entry.fromProduct,
      fromCategory: entry.fromCategory,
      toProduct: entry.toProduct,
      toCategory: entry.toCategory,
      transitionCount: entry.count,
      transitionPct: (entry.count / totalFromCount) * 100,
      avgDaysBetween: entry.totalDays / entry.count,
      step: entry.step,
    });
  }

  // Sort by step, then by count descending
  return results.sort((a, b) => a.step - b.step || b.transitionCount - a.transitionCount);
}

/**
 * Identify gateway products — what do first-time buyers purchase?
 */
export function findGatewayProducts(sequences: CustomerSequence[]): GatewayResult[] {
  const gateways = new Map<string, {
    category: string | null;
    count: number;
    totalLtv: number;
    totalOrders: number;
  }>();

  for (const seq of sequences) {
    if (seq.orders.length === 0) continue;

    const firstOrder = seq.orders[0];
    for (const product of firstOrder.products) {
      const existing = gateways.get(product.name);
      if (existing) {
        existing.count++;
        existing.totalLtv += seq.totalRevenue;
        existing.totalOrders += seq.orders.length;
      } else {
        gateways.set(product.name, {
          category: product.category,
          count: 1,
          totalLtv: seq.totalRevenue,
          totalOrders: seq.orders.length,
        });
      }
    }
  }

  const totalFirstOrders = sequences.filter((s) => s.orders.length > 0).length;

  const results: GatewayResult[] = [];
  for (const [productName, data] of gateways) {
    // Skip products that haven't been a first-purchase for at least 50 customers.
    // Below that, the LTV-after average is too noisy to use for "where do
    // first-time buyers come from" decisions.
    if (data.count < MIN_SAMPLE_SIZE) continue;
    results.push({
      productName,
      category: data.category,
      firstPurchaseCount: data.count,
      firstPurchasePct: (data.count / totalFirstOrders) * 100,
      avgLtvAfter: data.totalLtv / data.count,
      avgOrdersAfter: data.totalOrders / data.count,
    });
  }

  return results.sort((a, b) => b.firstPurchaseCount - a.firstPurchaseCount);
}

/**
 * Calculate product stickiness — for each product, what % of buyers come back for another order?
 */
export function calculateStickiness(sequences: CustomerSequence[]): StickinessResult[] {
  // Track per product: how many unique buyers, how many placed another order after
  const productStats = new Map<string, {
    category: string | null;
    buyers: Set<string>;
    returnedBuyers: Set<string>;
    returnDays: number[];
  }>();

  for (const seq of sequences) {
    for (let i = 0; i < seq.orders.length; i++) {
      const order = seq.orders[i];
      const hasNextOrder = i < seq.orders.length - 1;

      for (const product of order.products) {
        let stats = productStats.get(product.name);
        if (!stats) {
          stats = { category: product.category, buyers: new Set(), returnedBuyers: new Set(), returnDays: [] };
          productStats.set(product.name, stats);
        }

        stats.buyers.add(seq.profileId);

        if (hasNextOrder) {
          stats.returnedBuyers.add(seq.profileId);
          const gap = (new Date(seq.orders[i + 1].datetime).getTime() - new Date(order.datetime).getTime()) / (1000 * 60 * 60 * 24);
          stats.returnDays.push(gap);
        }
      }
    }
  }

  const results: StickinessResult[] = [];
  for (const [productName, stats] of productStats) {
    // Hard floor: products with < 50 buyers don't produce trustworthy rates.
    // 100% from n=3 is meaningless next to 60% from n=500.
    if (stats.buyers.size < MIN_SAMPLE_SIZE) continue;
    const total = stats.buyers.size;
    const returned = stats.returnedBuyers.size;
    const avgDays = stats.returnDays.length > 0
      ? stats.returnDays.reduce((a, b) => a + b, 0) / stats.returnDays.length
      : 0;
    results.push({
      productName,
      category: stats.category,
      totalBuyers: total,
      buyersWhoReturnedForAny: returned,
      stickinessRate: (returned / total) * 100,
      wilsonLower: wilsonLowerBound(returned, total) * 100,
      avgDaysToReturn: Math.round(avgDays),
    });
  }

  // Sort by Wilson lower bound (confidence-adjusted), not point estimate.
  // Falls back to point estimate if wilsonLower is missing (shouldn't happen
  // for new runs, but keeps sort stable if the field is ever stripped).
  return results.sort(
    (a, b) => (b.wilsonLower ?? b.stickinessRate) - (a.wilsonLower ?? a.stickinessRate)
  );
}

/**
 * Calculate overall journey stats.
 */
export function calculateJourneyStats(sequences: CustomerSequence[]): JourneyStats {
  const totalCustomers = sequences.length;
  const repeatCustomers = sequences.filter((s) => s.orders.length >= 2).length;

  const allGaps: number[] = [];
  let totalOrders = 0;

  for (const seq of sequences) {
    totalOrders += seq.orders.length;
    for (let i = 1; i < seq.orders.length; i++) {
      const gap =
        (new Date(seq.orders[i].datetime).getTime() -
          new Date(seq.orders[i - 1].datetime).getTime()) /
        (1000 * 60 * 60 * 24);
      allGaps.push(gap);
    }
  }

  allGaps.sort((a, b) => a - b);
  const medianGap = allGaps.length > 0 ? allGaps[Math.floor(allGaps.length / 2)] : 0;

  return {
    totalCustomers,
    repeatCustomers,
    repeatRate: totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0,
    avgOrdersPerCustomer: totalCustomers > 0 ? totalOrders / totalCustomers : 0,
    medianDaysBetweenOrders: Math.round(medianGap),
  };
}

// ─── Retention Metrics (Phase 3) ───────────────────────────────────

export interface RepurchaseTimingBucket {
  label: string;
  minDays: number;
  maxDays: number;
  count: number;
  pct: number;
}

/**
 * Time-to-second-purchase distribution — bucketed histogram.
 * Answers: "When should I send the win-back email?"
 */
export function calculateRepurchaseTimingDistribution(
  sequences: CustomerSequence[]
): RepurchaseTimingBucket[] {
  const buckets = [
    { label: "0–7 days", minDays: 0, maxDays: 7 },
    { label: "8–14 days", minDays: 8, maxDays: 14 },
    { label: "15–30 days", minDays: 15, maxDays: 30 },
    { label: "31–60 days", minDays: 31, maxDays: 60 },
    { label: "61–90 days", minDays: 61, maxDays: 90 },
    { label: "90+ days", minDays: 91, maxDays: Infinity },
  ];

  const counts = new Array(buckets.length).fill(0);
  let total = 0;

  for (const seq of sequences) {
    if (seq.orders.length < 2) continue;
    const gap =
      (new Date(seq.orders[1].datetime).getTime() -
        new Date(seq.orders[0].datetime).getTime()) /
      (1000 * 60 * 60 * 24);

    for (let i = 0; i < buckets.length; i++) {
      if (gap >= buckets[i].minDays && gap <= buckets[i].maxDays) {
        counts[i]++;
        total++;
        break;
      }
    }
  }

  return buckets.map((b, i) => ({
    ...b,
    count: counts[i],
    pct: total > 0 ? (counts[i] / total) * 100 : 0,
  }));
}

export interface RevenueConcentration {
  oneTimeCustomers: number;
  repeatCustomers: number;
  oneTimeRevenue: number;
  repeatRevenue: number;
  oneTimeRevenuePct: number;
  repeatRevenuePct: number;
  top10PctCustomerRevenuePct: number;
}

/**
 * Revenue concentration — what % of revenue comes from repeat buyers?
 * Answers: "Should I invest in acquisition or retention?"
 */
export function calculateRevenueConcentration(
  sequences: CustomerSequence[]
): RevenueConcentration {
  let oneTimeRevenue = 0;
  let repeatRevenue = 0;
  let oneTimeCount = 0;
  let repeatCount = 0;

  const allRevenues: number[] = [];

  for (const seq of sequences) {
    allRevenues.push(seq.totalRevenue);
    if (seq.orders.length === 1) {
      oneTimeRevenue += seq.totalRevenue;
      oneTimeCount++;
    } else {
      repeatRevenue += seq.totalRevenue;
      repeatCount++;
    }
  }

  const totalRevenue = oneTimeRevenue + repeatRevenue;

  // Top 10% customer revenue concentration
  allRevenues.sort((a, b) => b - a);
  const top10Count = Math.max(1, Math.ceil(allRevenues.length * 0.1));
  const top10Revenue = allRevenues.slice(0, top10Count).reduce((a, b) => a + b, 0);

  return {
    oneTimeCustomers: oneTimeCount,
    repeatCustomers: repeatCount,
    oneTimeRevenue: Math.round(oneTimeRevenue * 100) / 100,
    repeatRevenue: Math.round(repeatRevenue * 100) / 100,
    oneTimeRevenuePct: totalRevenue > 0 ? (oneTimeRevenue / totalRevenue) * 100 : 0,
    repeatRevenuePct: totalRevenue > 0 ? (repeatRevenue / totalRevenue) * 100 : 0,
    top10PctCustomerRevenuePct: totalRevenue > 0 ? (top10Revenue / totalRevenue) * 100 : 0,
  };
}

export interface RepurchaseRateResult {
  productName: string;
  category: string | null;
  totalBuyers: number;
  sameProdRepeatBuyers: number;
  repurchaseRate: number; // % who bought the same product again
  /** Wilson 95% CI lower bound on repurchaseRate (0–100). Sort key. */
  wilsonLower?: number;
  avgRepurchaseDays: number;
}

/**
 * Same-product repurchase rate — do they rebuy THIS product?
 * Critical for consumables and subscription-style products.
 */
export function calculateRepurchaseRate(
  sequences: CustomerSequence[]
): RepurchaseRateResult[] {
  const productStats = new Map<
    string,
    {
      category: string | null;
      buyers: Set<string>;
      repeatBuyers: Set<string>;
      repeatDays: number[];
    }
  >();

  for (const seq of sequences) {
    // Track which products this customer bought and when
    const productPurchases = new Map<string, string[]>(); // product → datetimes

    for (const order of seq.orders) {
      for (const product of order.products) {
        if (!productStats.has(product.name)) {
          productStats.set(product.name, {
            category: product.category,
            buyers: new Set(),
            repeatBuyers: new Set(),
            repeatDays: [],
          });
        }
        productStats.get(product.name)!.buyers.add(seq.profileId);

        const dates = productPurchases.get(product.name) || [];
        dates.push(order.datetime);
        productPurchases.set(product.name, dates);
      }
    }

    // Check for repeat purchases of same product
    for (const [productName, dates] of productPurchases) {
      if (dates.length >= 2) {
        const stats = productStats.get(productName)!;
        stats.repeatBuyers.add(seq.profileId);
        // Avg days between first and last purchase of this product
        const first = new Date(dates[0]).getTime();
        const last = new Date(dates[dates.length - 1]).getTime();
        stats.repeatDays.push((last - first) / (1000 * 60 * 60 * 24));
      }
    }
  }

  const results: RepurchaseRateResult[] = [];
  for (const [productName, stats] of productStats) {
    if (stats.buyers.size < MIN_SAMPLE_SIZE) continue;
    const total = stats.buyers.size;
    const repeats = stats.repeatBuyers.size;
    const avgDays =
      stats.repeatDays.length > 0
        ? stats.repeatDays.reduce((a, b) => a + b, 0) / stats.repeatDays.length
        : 0;
    results.push({
      productName,
      category: stats.category,
      totalBuyers: total,
      sameProdRepeatBuyers: repeats,
      repurchaseRate: (repeats / total) * 100,
      wilsonLower: wilsonLowerBound(repeats, total) * 100,
      avgRepurchaseDays: Math.round(avgDays),
    });
  }

  return results.sort(
    (a, b) => (b.wilsonLower ?? b.repurchaseRate) - (a.wilsonLower ?? a.repurchaseRate)
  );
}

export interface CohortRow {
  cohortMonth: string; // "2025-06"
  cohortSize: number;
  retention: { monthOffset: number; retainedCount: number; retainedPct: number }[];
}

/**
 * Monthly cohort retention — group by first-purchase month,
 * track what % are still buying in subsequent months.
 */
export function calculateCohortRetention(
  sequences: CustomerSequence[]
): CohortRow[] {
  // Group customers by first purchase month
  const cohorts = new Map<
    string,
    { profileIds: Set<string>; ordersByProfile: Map<string, string[]> }
  >();

  for (const seq of sequences) {
    if (seq.orders.length === 0) continue;
    const firstDate = new Date(seq.orders[0].datetime);
    const cohortMonth = `${firstDate.getFullYear()}-${String(firstDate.getMonth() + 1).padStart(2, "0")}`;

    if (!cohorts.has(cohortMonth)) {
      cohorts.set(cohortMonth, { profileIds: new Set(), ordersByProfile: new Map() });
    }
    const cohort = cohorts.get(cohortMonth)!;
    cohort.profileIds.add(seq.profileId);

    // Store all order months for this profile
    const orderMonths = seq.orders.map((o) => {
      const d = new Date(o.datetime);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
    cohort.ordersByProfile.set(seq.profileId, orderMonths);
  }

  const results: CohortRow[] = [];
  const sortedCohorts = Array.from(cohorts.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  for (const [cohortMonth, data] of sortedCohorts) {
    if (data.profileIds.size < 3) continue; // skip tiny cohorts

    const cohortDate = new Date(cohortMonth + "-01");
    const retention: CohortRow["retention"] = [];

    // Track up to 6 months out
    for (let offset = 1; offset <= 6; offset++) {
      const targetDate = new Date(cohortDate);
      targetDate.setMonth(targetDate.getMonth() + offset);
      const targetMonth = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, "0")}`;

      let retained = 0;
      for (const [profileId, orderMonths] of data.ordersByProfile) {
        if (orderMonths.includes(targetMonth)) {
          retained++;
        }
      }

      retention.push({
        monthOffset: offset,
        retainedCount: retained,
        retainedPct: (retained / data.profileIds.size) * 100,
      });
    }

    results.push({
      cohortMonth,
      cohortSize: data.profileIds.size,
      retention,
    });
  }

  return results;
}

export interface ProductAffinityResult {
  productA: string;
  productB: string;
  coPurchaseCount: number; // customers who bought both (any order)
  productACount: number;
  productBCount: number;
  lift: number; // how much more likely than random
}

/**
 * Product affinity — which products are frequently bought by the same customer?
 * Not sequential — co-occurrence across any orders.
 */
export function calculateProductAffinity(
  sequences: CustomerSequence[]
): ProductAffinityResult[] {
  // Build product → set of buyers
  const productBuyers = new Map<string, Set<string>>();

  for (const seq of sequences) {
    const allProducts = new Set<string>();
    for (const order of seq.orders) {
      for (const product of order.products) {
        allProducts.add(product.name);
      }
    }
    for (const product of allProducts) {
      if (!productBuyers.has(product)) {
        productBuyers.set(product, new Set());
      }
      productBuyers.get(product)!.add(seq.profileId);
    }
  }

  const totalCustomers = sequences.length;
  // Each product needs MIN_SAMPLE_SIZE buyers before it's eligible to appear
  // in a pair — pairs from products with tiny buyer counts produce inflated
  // lift values that mislead more than they help.
  const products = Array.from(productBuyers.keys()).filter(
    (p) => (productBuyers.get(p)?.size || 0) >= MIN_SAMPLE_SIZE
  );

  const results: ProductAffinityResult[] = [];

  // Calculate pairwise co-purchase
  for (let i = 0; i < products.length; i++) {
    for (let j = i + 1; j < products.length; j++) {
      const buyersA = productBuyers.get(products[i])!;
      const buyersB = productBuyers.get(products[j])!;

      let coPurchase = 0;
      for (const buyer of buyersA) {
        if (buyersB.has(buyer)) coPurchase++;
      }

      // Lift from <50 co-purchases is dominated by noise — a single quirky
      // shopper can swing a pair to 10x lift. Require a real co-purchase
      // base before reporting affinity.
      if (coPurchase < MIN_SAMPLE_SIZE) continue;

      // Lift = P(A∩B) / (P(A) × P(B))
      const pA = buyersA.size / totalCustomers;
      const pB = buyersB.size / totalCustomers;
      const pAB = coPurchase / totalCustomers;
      const lift = pA * pB > 0 ? pAB / (pA * pB) : 0;

      results.push({
        productA: products[i],
        productB: products[j],
        coPurchaseCount: coPurchase,
        productACount: buyersA.size,
        productBCount: buyersB.size,
        lift: Math.round(lift * 100) / 100,
      });
    }
  }

  return results.sort((a, b) => b.lift - a.lift);
}

/**
 * Build top customer journeys for the explorer view.
 * Returns top 100 customers by revenue with their full order sequences.
 */
export function buildCustomerJourneys(
  sequences: CustomerSequence[],
  limit: number = 100
): Array<{
  profileId: string;
  orderCount: number;
  totalRevenue: number;
  firstOrderDate: string;
  lastOrderDate: string;
  products: string[];
  journey: Array<{ date: string; products: string[]; value: number }>;
}> {
  return sequences
    .filter((s) => s.orders.length >= 2)
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, limit)
    .map((seq) => ({
      profileId: seq.profileId,
      orderCount: seq.orders.length,
      totalRevenue: Math.round(seq.totalRevenue * 100) / 100,
      firstOrderDate: seq.orders[0].datetime,
      lastOrderDate: seq.orders[seq.orders.length - 1].datetime,
      products: [...new Set(seq.orders.flatMap((o) => o.products.map((p) => p.name)))],
      journey: seq.orders.map((o) => ({
        date: o.datetime,
        products: o.products.map((p) => p.name),
        value: Math.round(o.totalValue * 100) / 100,
      })),
    }));
}
