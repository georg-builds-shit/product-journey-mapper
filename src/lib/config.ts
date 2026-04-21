import { db } from "@/db";
import { brandConfigs } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { SegmentRule } from "./segment-eval";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/**
 * A single audience definition. Customers are assigned to the first audience
 * whose `rule` they satisfy (priority = array order). Customers matching no
 * audience are bucketed as "unassigned".
 *
 * An audience is the dimension metrics are split along — e.g. DTC vs
 * Affiliate, Wholesale vs Retail, VIP vs Standard. Brands configure as
 * many as they need.
 */
export interface AudienceDefinition {
  id: string; // stable key used in analytics output
  label: string; // display name
  rule:
    | { type: "segment"; rules: SegmentRule[] } // free-form filter rules on profile/location/membership
    | { type: "list"; listId: string } // profile is in this Klaviyo list
    | { type: "klaviyo_segment"; segmentId: string }; // profile is in this Klaviyo segment
}

/**
 * Optional product → product-family mapping. Lookup order:
 *   byProductId → bySku → byProductName → fall back to raw product identifier.
 *
 * A "family" is a brand-internal grouping — e.g. many SKUs collapse into
 * "Kits" / "Supplements" / "Accessories" so charts read as families instead
 * of an explosion of individual SKU names.
 */
export interface ProductFamilies {
  byProductId?: Record<string, string>;
  bySku?: Record<string, string>;
  byProductName?: Record<string, string>;
  familyLabels?: string[]; // optional canonical list for UI ordering
}

export type CohortGranularity = "monthly" | "quarterly";

export interface BrandConfig {
  id: string;
  accountId: string;
  audiences: AudienceDefinition[];
  productFamilies: ProductFamilies | null;
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
  audiences: [],
  productFamilies: null,
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
 * Partial update. Returns the updated config. Validates audience ids are
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

  if (patch.audiences) {
    validateAudiences(patch.audiences);
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
      ...(patch.audiences !== undefined && { audiences: patch.audiences }),
      ...(patch.productFamilies !== undefined && { productFamilies: patch.productFamilies }),
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
    audiences: (row.audiences as AudienceDefinition[]) ?? [],
    productFamilies: (row.productFamilies as ProductFamilies | null) ?? null,
    cohortGranularity: (row.cohortGranularity as CohortGranularity) ?? "monthly",
    lookbackMonths: row.lookbackMonths ?? 24,
    excludeRefunds: row.excludeRefunds ?? true,
    minOrderValue: row.minOrderValue ?? 0.01,
    excludeTestRules: (row.excludeTestRules as SegmentRule[]) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function validateAudiences(audiences: AudienceDefinition[]): void {
  const seen = new Set<string>();
  for (const a of audiences) {
    if (!a.id || !a.id.trim()) throw new Error("Audience id is required");
    if (!a.label || !a.label.trim()) throw new Error("Audience label is required");
    if (seen.has(a.id)) throw new Error(`Duplicate audience id: ${a.id}`);
    seen.add(a.id);
    if (!a.rule || !a.rule.type) throw new Error(`Audience "${a.label}" is missing a rule`);
    if (a.rule.type === "segment" && (!a.rule.rules || a.rule.rules.length === 0)) {
      throw new Error(`Audience "${a.label}" rule needs at least one condition`);
    }
    if (a.rule.type === "list" && !a.rule.listId) {
      throw new Error(`Audience "${a.label}" list rule needs a listId`);
    }
    if (a.rule.type === "klaviyo_segment" && !a.rule.segmentId) {
      throw new Error(`Audience "${a.label}" klaviyo_segment rule needs a segmentId`);
    }
  }
}

/**
 * Apply product-family mapping to a raw product identifier. Returns the family
 * label if configured, else the original identifier.
 */
export function applyFamily(
  product: { productId?: string | null; sku?: string | null; productName: string },
  families: ProductFamilies | null
): string {
  if (!families) return product.productName;
  if (product.productId && families.byProductId?.[product.productId]) {
    return families.byProductId[product.productId];
  }
  if (product.sku && families.bySku?.[product.sku]) {
    return families.bySku[product.sku];
  }
  if (families.byProductName?.[product.productName]) {
    return families.byProductName[product.productName];
  }
  return product.productName;
}

export const UNASSIGNED_AUDIENCE_ID = "unassigned";
export const UNASSIGNED_AUDIENCE_LABEL = "Unassigned";
export const COMBINED_AUDIENCE_ID = "__combined__";
export const COMBINED_AUDIENCE_LABEL = "Combined";
