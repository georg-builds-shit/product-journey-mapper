import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  real,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// Accounts that connected their Klaviyo
export const accounts = pgTable("accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  klaviyoAccessToken: text("klaviyo_access_token").notNull(),
  klaviyoRefreshToken: text("klaviyo_refresh_token").notNull(),
  klaviyoTokenExpiresAt: timestamp("klaviyo_token_expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Tracks each analysis execution
export const analysisRuns = pgTable("analysis_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id")
    .references(() => accounts.id, { onDelete: "cascade" })
    .notNull(),
  status: text("status").notNull().default("pending"), // pending, ingesting, analyzing, complete, failed
  ordersSynced: integer("orders_synced").default(0),
  uniqueCustomers: integer("unique_customers").default(0),
  insightsText: text("insights_text"), // LLM-generated insights
  stickinessJson: jsonb("stickiness_json"), // product stickiness data
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  // Filters applied to this run
  filterDateFrom: timestamp("filter_date_from"),
  filterDateTo: timestamp("filter_date_to"),
  filterProfileProps: jsonb("filter_profile_props"), // e.g. { "is_affiliate": "true", "country": "US" }
  segmentId: uuid("segment_id").references(() => segments.id, { onDelete: "set null" }),
  compareSegmentId: uuid("compare_segment_id").references(() => segments.id, { onDelete: "set null" }),
  // Retention metrics (Phase 3)
  repurchaseTimingJson: jsonb("repurchase_timing_json"),
  revenueConcentrationJson: jsonb("revenue_concentration_json"),
  repurchaseRateJson: jsonb("repurchase_rate_json"),
  cohortRetentionJson: jsonb("cohort_retention_json"),
  productAffinityJson: jsonb("product_affinity_json"),
  customerJourneysJson: jsonb("customer_journeys_json"),
},
(table) => [
  index("analysis_runs_account_status_idx").on(table.accountId, table.status, table.createdAt),
]);

// User-defined segments for filtering and comparison
export const segments = pgTable("segments", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id")
    .references(() => accounts.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(), // "Affiliates", "Online Orders"
  segmentType: text("segment_type").notNull(), // "profile" | "event"
  rules: jsonb("rules").notNull(), // [{ field, operator, value }]
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Cache of Klaviyo profile properties for filtering
export const profileCache = pgTable(
  "profile_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .references(() => accounts.id, { onDelete: "cascade" })
      .notNull(),
    klaviyoProfileId: text("klaviyo_profile_id").notNull(),
    properties: jsonb("properties"), // custom profile properties
    location: jsonb("location"), // { country, region, city, zip }
    listIds: jsonb("list_ids"), // array of Klaviyo list IDs this profile belongs to
    segmentIds: jsonb("segment_ids"), // array of Klaviyo segment IDs this profile belongs to
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("profile_cache_account_profile_idx").on(
      table.accountId,
      table.klaviyoProfileId
    ),
  ]
);

// Cached raw Klaviyo events for incremental sync
export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .references(() => accounts.id, { onDelete: "cascade" })
      .notNull(),
    klaviyoEventId: text("klaviyo_event_id").notNull(),
    profileId: text("profile_id").notNull(),
    datetime: timestamp("datetime").notNull(),
    value: real("value").default(0),
    productName: text("product_name").notNull(),
    productId: text("product_id"),
    categories: jsonb("categories"),
    productType: text("product_type"),
    brand: text("brand"),
    quantity: integer("quantity").default(1),
    orderId: text("order_id"),
    sku: text("sku"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("events_account_klaviyo_idx").on(
      table.accountId,
      table.klaviyoEventId
    ),
    index("events_account_datetime_idx").on(
      table.accountId,
      table.datetime
    ),
  ]
);

// Tracks Klaviyo data sync history for incremental pulls
export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id")
    .references(() => accounts.id, { onDelete: "cascade" })
    .notNull(),
  status: text("status").notNull().default("syncing"), // syncing, complete, failed
  eventsSynced: integer("events_synced").default(0),
  totalEvents: integer("total_events").default(0),
  lastEventDatetime: timestamp("last_event_datetime"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// Product-to-product transitions across sequential orders
export const productTransitions = pgTable("product_transitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id")
    .references(() => accounts.id, { onDelete: "cascade" })
    .notNull(),
  analysisRunId: uuid("analysis_run_id")
    .references(() => analysisRuns.id, { onDelete: "cascade" })
    .notNull(),
  fromProduct: text("from_product").notNull(),
  fromCategory: text("from_category"),
  toProduct: text("to_product").notNull(),
  toCategory: text("to_category"),
  transitionCount: integer("transition_count").notNull(),
  transitionPct: real("transition_pct").notNull(), // % of from_product buyers who then bought to_product
  avgDaysBetween: real("avg_days_between"),
  step: integer("step").notNull(), // 1→2, 2→3, etc.
});

// First-purchase products and their downstream impact
export const gatewayProducts = pgTable("gateway_products", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id")
    .references(() => accounts.id, { onDelete: "cascade" })
    .notNull(),
  analysisRunId: uuid("analysis_run_id")
    .references(() => analysisRuns.id, { onDelete: "cascade" })
    .notNull(),
  productName: text("product_name").notNull(),
  category: text("category"),
  firstPurchaseCount: integer("first_purchase_count").notNull(),
  firstPurchasePct: real("first_purchase_pct").notNull(),
  avgLtvAfter: real("avg_ltv_after"),
  avgOrdersAfter: real("avg_orders_after"),
});
