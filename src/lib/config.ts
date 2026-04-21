import { db } from "@/db";
import { brandConfigs } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { SegmentRule } from "./segment-eval";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/**
 * A single channel definition. Customers are assigned to the first channel
 * whose `rule` they satisfy (priority = array order). Customers matching no
 * channel are bucketed as "unassigned".
 */
export interface ChannelDefinition {
  id: string; // stable key used as channelId in analytics output
  label: string; // display name
  rule:
    | { type: "segment"; rules: SegmentRule[] } // profile-property/location/list/klaviyo-segment rules evaluated in memory
    | { type: "list"; listId: string } // shorthand: profile is in this Klaviyo list
    | { type: "klaviyo_segment"; segmentId: string }; // shorthand: profile is in this Klaviyo segment
}

/**
 * Optional product → product-line grouping. Lookup order:
 *   byProductId → bySku → byProductName → fall back to raw product identifier.
 */
export interface ProductGroupings {
  byProductId?: Record<string, string>;
  bySku?: Record<string, string>;
  byProductName?: Record<string, string>;
  lineLabels?: string[]; // optional canonical list for UI ordering
}

export type CohortGranularity = "monthly" | "quarterly";

export interface BrandConfig {
  id: string;
  accountId: string;
  channels: ChannelDefinition[];
  productGroupings: ProductGroupings | null;
  cohortGranularity: CohortGranularity;
  lookbackMonths: number;
  excludeRefunds: boolean;
  minOrderValue: number;
  excludeTestRules: SegmentRule[];
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: Omit<
  BrandConfig,
  "id" | "accountId" | "createdAt" | "updatedAt"
> = {
  channels: [],
  productGroupings: null,
  cohortGranularity: "monthly",
  lookbackMonths: 24,
  excludeRefunds: true,
  minOrderValue: 0.01,
  excludeTestRules: [],
};

// ─────────────────────────────────────────────────────────────
// Read/write
// ─────────────────────────────────────────────────────────────

/**
 * Load the brand config for an account. Creates a default row if missing so
 * callers never have to handle null.
 */
export async function getBrandConfig(accountId: string): Promise<BrandConfig> {
  const [existing] = await db
    .select()
    .from(brandConfigs)
    .where(eq(brandConfigs.accountId, accountId));

  if (existing) return rowToConfig(existing);

  const [created] = await db
    .insert(brandConfigs)
    .values({ accountId })
    .returning();

  return rowToConfig(created);
}

/**
 * Partial update. Returns the updated config. Validates channel ids are
 * unique and non-empty.
 */
export async function updateBrandConfig(
  accountId: string,
  patch: Partial<
    Omit<BrandConfig, "id" | "accountId" | "createdAt" | "updatedAt">
  >
): Promise<BrandConfig> {
  // Ensure row exists
  await getBrandConfig(accountId);

  if (patch.channels) {
    validateChannels(patch.channels);
  }
  if (patch.cohortGranularity && !["monthly", "quarterly"].includes(patch.cohortGranularity)) {
    throw new Error(`Invalid cohortGranularity: ${patch.cohortGranularity}`);
  }
  if (patch.lookbackMonths !== undefined && (patch.lookbackMonths < 1 || patch.lookbackMonths > 60)) {
    throw new Error("lookbackMonths must be between 1 and 60");
  }
  if (patch.minOrderValue !== undefined && patch.minOrderValue < 0) {
    throw new Error("minOrderValue must be ≥ 0");
  }

  const [updated] = await db
    .update(brandConfigs)
    .set({
      ...(patch.channels !== undefined && { channels: patch.channels }),
      ...(patch.productGroupings !== undefined && { productGroupings: patch.productGroupings }),
      ...(patch.cohortGranularity !== undefined && { cohortGranularity: patch.cohortGranularity }),
      ...(patch.lookbackMonths !== undefined && { lookbackMonths: patch.lookbackMonths }),
      ...(patch.excludeRefunds !== undefined && { excludeRefunds: patch.excludeRefunds }),
      ...(patch.minOrderValue !== undefined && { minOrderValue: patch.minOrderValue }),
      ...(patch.excludeTestRules !== undefined && { excludeTestRules: patch.excludeTestRules }),
      updatedAt: new Date(),
    })
    .where(eq(brandConfigs.accountId, accountId))
    .returning();

  return rowToConfig(updated);
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function rowToConfig(row: typeof brandConfigs.$inferSelect): BrandConfig {
  return {
    id: row.id,
    accountId: row.accountId,
    channels: (row.channels as ChannelDefinition[]) ?? [],
    productGroupings: (row.productGroupings as ProductGroupings | null) ?? null,
    cohortGranularity: (row.cohortGranularity as CohortGranularity) ?? "monthly",
    lookbackMonths: row.lookbackMonths ?? 24,
    excludeRefunds: row.excludeRefunds ?? true,
    minOrderValue: row.minOrderValue ?? 0.01,
    excludeTestRules: (row.excludeTestRules as SegmentRule[]) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function validateChannels(channels: ChannelDefinition[]): void {
  const seen = new Set<string>();
  for (const ch of channels) {
    if (!ch.id || !ch.id.trim()) throw new Error("Channel id is required");
    if (!ch.label || !ch.label.trim()) throw new Error("Channel label is required");
    if (seen.has(ch.id)) throw new Error(`Duplicate channel id: ${ch.id}`);
    seen.add(ch.id);
    if (!ch.rule || !ch.rule.type) throw new Error(`Channel "${ch.label}" is missing a rule`);
    if (ch.rule.type === "segment" && (!ch.rule.rules || ch.rule.rules.length === 0)) {
      throw new Error(`Channel "${ch.label}" segment rule needs at least one rule entry`);
    }
    if (ch.rule.type === "list" && !ch.rule.listId) {
      throw new Error(`Channel "${ch.label}" list rule needs a listId`);
    }
    if (ch.rule.type === "klaviyo_segment" && !ch.rule.segmentId) {
      throw new Error(`Channel "${ch.label}" klaviyo_segment rule needs a segmentId`);
    }
  }
}

/**
 * Apply product grouping to a raw product identifier. Returns the product line
 * label if configured, else the original identifier.
 */
export function applyGrouping(
  product: { productId?: string | null; sku?: string | null; productName: string },
  grouping: ProductGroupings | null
): string {
  if (!grouping) return product.productName;
  if (product.productId && grouping.byProductId?.[product.productId]) {
    return grouping.byProductId[product.productId];
  }
  if (product.sku && grouping.bySku?.[product.sku]) {
    return grouping.bySku[product.sku];
  }
  if (grouping.byProductName?.[product.productName]) {
    return grouping.byProductName[product.productName];
  }
  return product.productName;
}

export const UNASSIGNED_CHANNEL_ID = "unassigned";
export const UNASSIGNED_CHANNEL_LABEL = "Unassigned";
export const COMBINED_CHANNEL_ID = "__combined__";
export const COMBINED_CHANNEL_LABEL = "Combined";
