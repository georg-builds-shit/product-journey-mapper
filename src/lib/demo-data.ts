import type { OrderedProductEvent } from "./klaviyo";

// Simulates a skincare/beauty e-commerce store with ~200 customers and realistic purchase patterns
// Gateway products: Starter Kit, Facial Cleanser
// Common paths: Starter Kit → Moisturizer → Serum → Eye Cream
// Budget path: Facial Cleanser → Toner → Moisturizer
// Premium path: Starter Kit → Anti-Aging Serum → Eye Cream → Night Cream → Retinol Treatment

const PRODUCTS = [
  { name: "Starter Kit", category: "Kits", price: 29.99 },
  { name: "Facial Cleanser", category: "Cleansers", price: 14.99 },
  { name: "Daily Moisturizer", category: "Moisturizers", price: 24.99 },
  { name: "Hydrating Toner", category: "Toners", price: 18.99 },
  { name: "Vitamin C Serum", category: "Serums", price: 39.99 },
  { name: "Anti-Aging Serum", category: "Serums", price: 54.99 },
  { name: "Eye Cream", category: "Eye Care", price: 34.99 },
  { name: "Night Cream", category: "Moisturizers", price: 32.99 },
  { name: "SPF 50 Sunscreen", category: "Sun Care", price: 19.99 },
  { name: "Retinol Treatment", category: "Treatments", price: 44.99 },
  { name: "Clay Mask", category: "Masks", price: 22.99 },
  { name: "Lip Balm", category: "Lip Care", price: 9.99 },
  { name: "Body Lotion", category: "Body Care", price: 16.99 },
  { name: "Exfoliating Scrub", category: "Exfoliators", price: 21.99 },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

// Purchase path templates — weighted probabilities
const JOURNEY_TEMPLATES = [
  // 35% — Starter Kit path (high LTV)
  {
    weight: 35,
    orders: [
      ["Starter Kit"],
      ["Daily Moisturizer", "SPF 50 Sunscreen"],
      ["Vitamin C Serum"],
      ["Eye Cream", "Night Cream"],
    ],
  },
  // 20% — Budget cleanser path
  {
    weight: 20,
    orders: [
      ["Facial Cleanser"],
      ["Hydrating Toner"],
      ["Daily Moisturizer"],
    ],
  },
  // 15% — Premium anti-aging path (highest LTV)
  {
    weight: 15,
    orders: [
      ["Starter Kit", "Facial Cleanser"],
      ["Anti-Aging Serum", "Eye Cream"],
      ["Night Cream", "Retinol Treatment"],
      ["Vitamin C Serum", "SPF 50 Sunscreen"],
      ["Anti-Aging Serum"], // repeat purchase
    ],
  },
  // 10% — One-and-done (low LTV, drop-off)
  {
    weight: 10,
    orders: [["Facial Cleanser"]],
  },
  // 8% — Gift buyers
  {
    weight: 8,
    orders: [
      ["Starter Kit"],
      ["Starter Kit"], // buying again as gift
    ],
  },
  // 7% — Body care path
  {
    weight: 7,
    orders: [
      ["Body Lotion", "Lip Balm"],
      ["Exfoliating Scrub", "Clay Mask"],
      ["Body Lotion"], // repeat
    ],
  },
  // 5% — Mask enthusiasts
  {
    weight: 5,
    orders: [
      ["Clay Mask"],
      ["Exfoliating Scrub", "Hydrating Toner"],
      ["Clay Mask", "Vitamin C Serum"],
    ],
  },
];

function pickJourney(): typeof JOURNEY_TEMPLATES[number] {
  const total = JOURNEY_TEMPLATES.reduce((sum, t) => sum + t.weight, 0);
  let r = Math.random() * total;
  for (const template of JOURNEY_TEMPLATES) {
    r -= template.weight;
    if (r <= 0) return template;
  }
  return JOURNEY_TEMPLATES[0];
}

export interface DemoProfile {
  id: string;
  properties: Record<string, any>;
  location: Record<string, any>;
}

/**
 * Generate demo profile data with affiliate flags, sources, and locations.
 * ~20% are affiliates, ~30% are from a specific region, etc.
 */
export function generateDemoProfiles(customerCount = 200): DemoProfile[] {
  const countries = ["US", "US", "US", "CA", "UK", "AU", "DE"]; // weighted US
  const sources = ["organic", "organic", "organic", "paid_social", "paid_search", "affiliate", "affiliate", "referral"];
  const cities: Record<string, string[]> = {
    US: ["New York", "Los Angeles", "Chicago", "Austin", "Miami"],
    CA: ["Toronto", "Vancouver"],
    UK: ["London", "Manchester"],
    AU: ["Sydney", "Melbourne"],
    DE: ["Berlin", "Munich"],
  };

  return Array.from({ length: customerCount }, (_, i) => {
    const profileId = `demo_profile_${i.toString().padStart(4, "0")}`;
    const country = pick(countries);
    const source = pick(sources);
    const isAffiliate = source === "affiliate";

    return {
      id: profileId,
      properties: {
        source,
        is_affiliate: isAffiliate,
        customer_type: isAffiliate ? "affiliate" : "direct",
        loyalty_tier: pick(["bronze", "bronze", "silver", "silver", "gold"]),
        tags: isAffiliate ? "affiliate,partner" : "customer",
      },
      location: {
        country,
        city: pick(cities[country] || ["Unknown"]),
        region: country === "US" ? pick(["NY", "CA", "IL", "TX", "FL"]) : null,
      },
    };
  });
}

export function generateDemoEvents(customerCount = 200): OrderedProductEvent[] {
  const events: OrderedProductEvent[] = [];
  const startDate = new Date("2025-06-01");
  const endDate = new Date("2026-03-15");
  let eventId = 1;

  for (let c = 0; c < customerCount; c++) {
    const profileId = `demo_profile_${c.toString().padStart(4, "0")}`;
    const journey = pickJourney();

    // Random first order date
    let orderDate = randomDate(startDate, addDays(endDate, -90));

    for (let orderIdx = 0; orderIdx < journey.orders.length; orderIdx++) {
      const orderProducts = journey.orders[orderIdx];
      const orderId = `demo_order_${eventId}`;

      // Add some randomness: maybe skip an order step (10% chance after first)
      if (orderIdx > 0 && Math.random() < 0.1) continue;

      for (const productName of orderProducts) {
        const product = PRODUCTS.find((p) => p.name === productName)!;
        // Add small price variation
        const price = product.price * (0.9 + Math.random() * 0.2);

        events.push({
          id: `demo_event_${eventId++}`,
          profileId,
          datetime: orderDate.toISOString(),
          value: Math.round(price * 100) / 100,
          productName: product.name,
          productId: `prod_${product.name.toLowerCase().replace(/\s/g, "_")}`,
          categories: [product.category],
          productType: product.category,
          brand: "GlowLab",
          quantity: 1,
          orderId,
          sku: `GL-${product.name.substring(0, 3).toUpperCase()}-001`,
        });
      }

      // Time gap between orders: 14-60 days, with some variation
      const gap = 14 + Math.random() * 46;
      orderDate = addDays(orderDate, gap);

      // Stop if past end date
      if (orderDate > endDate) break;
    }
  }

  return events;
}

/**
 * Generate POS (offline) events — a subset of customers also buy in-store.
 * ~15% of customers have at least one offline purchase.
 */
export function generateDemoPOSEvents(customerCount = 200): OrderedProductEvent[] {
  const events: OrderedProductEvent[] = [];
  const startDate = new Date("2025-06-01");
  const endDate = new Date("2026-03-15");
  let eventId = 10000;

  // ~15% of customers have POS purchases
  const posCustomerCount = Math.floor(customerCount * 0.15);

  for (let c = 0; c < posCustomerCount; c++) {
    // Use some of the same profile IDs so there's overlap with online
    const profileId = `demo_profile_${(c * 3).toString().padStart(4, "0")}`;
    const orderDate = randomDate(startDate, endDate);
    const orderId = `demo_pos_order_${eventId}`;

    // POS purchases tend to be simpler — 1-2 products
    const posProducts = [pick(PRODUCTS)];
    if (Math.random() > 0.6) posProducts.push(pick(PRODUCTS));

    for (const product of posProducts) {
      const price = product.price * (0.9 + Math.random() * 0.2);
      events.push({
        id: `demo_pos_event_${eventId++}`,
        profileId,
        datetime: orderDate.toISOString(),
        value: Math.round(price * 100) / 100,
        productName: product.name,
        productId: `prod_${product.name.toLowerCase().replace(/\s/g, "_")}`,
        categories: [product.category],
        productType: product.category,
        brand: "GlowLab",
        quantity: 1,
        orderId,
        sku: `GL-${product.name.substring(0, 3).toUpperCase()}-001`,
      });
    }
  }

  return events;
}
