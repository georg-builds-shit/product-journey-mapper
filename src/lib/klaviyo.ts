import crypto from "crypto";

const KLAVIYO_AUTH_URL = "https://www.klaviyo.com/oauth/authorize";
const KLAVIYO_TOKEN_URL = "https://a.klaviyo.com/oauth/token";

// Only need read access to events for journey mapping
const SCOPES = ["accounts:read", "events:read", "metrics:read", "profiles:read", "lists:read", "segments:read"].join(" ");

// --- Retry wrapper for Klaviyo API calls ---

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);

    if (res.status === 429) {
      if (attempt === maxRetries) {
        throw new Error(`Klaviyo rate limit exceeded after ${maxRetries + 1} attempts`);
      }
      // Use Retry-After header if available, otherwise exponential backoff
      const retryAfter = res.headers.get("Retry-After");
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : Math.min(1000 * Math.pow(2, attempt), 30000);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    if (res.status >= 500 && attempt < maxRetries) {
      // Retry on server errors with backoff
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 * Math.pow(2, attempt))
      );
      continue;
    }

    return res;
  }

  throw new Error("fetchWithRetry: unreachable");
}

// --- PKCE helpers ---

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function getKlaviyoAuthUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.KLAVIYO_CLIENT_ID!,
    redirect_uri: process.env.KLAVIYO_REDIRECT_URI!,
    scope: SCOPES,
    state,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });

  return `${KLAVIYO_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string, codeVerifier: string) {
  const basicAuth = Buffer.from(
    `${process.env.KLAVIYO_CLIENT_ID!}:${process.env.KLAVIYO_CLIENT_SECRET!}`
  ).toString("base64");

  const response = await fetch(KLAVIYO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: process.env.KLAVIYO_REDIRECT_URI!,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Klaviyo token exchange failed: ${error}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresIn: data.expires_in as number,
  };
}

export async function refreshAccessToken(refreshToken: string) {
  const basicAuth = Buffer.from(
    `${process.env.KLAVIYO_CLIENT_ID!}:${process.env.KLAVIYO_CLIENT_SECRET!}`
  ).toString("base64");

  const response = await fetch(KLAVIYO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Klaviyo token refresh failed: ${error}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresIn: data.expires_in as number,
  };
}

// Fetch all metrics to find the "Ordered Product" metric ID
export async function fetchMetrics(accessToken: string) {
  const response = await fetchWithRetry(
    "https://a.klaviyo.com/api/metrics/",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        revision: "2025-01-15",
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Klaviyo metrics fetch failed: ${response.status} — ${body}`);
  }

  const data = await response.json();
  return data.data.map((m: any) => ({
    id: m.id,
    name: m.attributes.name,
    integration: m.attributes.integration?.name,
  }));
}

// Fetch all Ordered Product events (paginated), with optional date filtering
export async function fetchOrderedProductEvents(
  accessToken: string,
  metricId: string,
  options?: { dateFrom?: string; dateTo?: string; maxPages?: number }
) {
  const events: OrderedProductEvent[] = [];

  // Build filter string
  const filters: string[] = [`equals(metric_id,"${metricId}")`];
  if (options?.dateFrom) {
    // Support both date-only (YYYY-MM-DD) and full ISO timestamps
    const fromStr = options.dateFrom.includes("T")
      ? options.dateFrom
      : `${options.dateFrom}T00:00:00Z`;
    filters.push(`greater-or-equal(datetime,${fromStr})`);
  }
  if (options?.dateTo) {
    const toStr = options.dateTo.includes("T")
      ? options.dateTo
      : `${options.dateTo}T23:59:59Z`;
    filters.push(`less-than(datetime,${toStr})`);
  }
  const filterStr = filters.length > 1
    ? `and(${filters.join(",")})`
    : filters[0];

  let nextUrl = `https://a.klaviyo.com/api/events/?filter=${filterStr}&page[size]=100`;
  const maxPages = options?.maxPages ?? 500; // safety cap: ~50K events
  let pageCount = 0;

  while (nextUrl && pageCount < maxPages) {
    const res = await fetchWithRetry(nextUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        revision: "2025-01-15",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Klaviyo events fetch failed: ${res.status} — ${errBody}`);
    }

    const body = await res.json();
    // Filter out events with missing critical fields
    const validEvents = (body.data || []).filter(
      (e: any) => e.relationships?.profile?.data?.id && e.attributes?.datetime
    );
    events.push(
      ...validEvents.map((e: any) => ({
        id: e.id,
        profileId: e.relationships.profile.data.id,
        datetime: e.attributes.datetime,
        value: e.attributes.value ?? e.attributes.event_properties?.$value ?? 0,
        productName:
          e.attributes.event_properties?.ProductName ||
          e.attributes.event_properties?.product_name ||
          e.attributes.event_properties?.["Product Name"] ||
          e.attributes.event_properties?.ProductTitle ||
          e.attributes.event_properties?.product_title ||
          e.attributes.event_properties?.Title ||
          e.attributes.event_properties?.title ||
          e.attributes.event_properties?.Name ||
          e.attributes.event_properties?.name ||
          e.attributes.event_properties?.$title ||
          "Unknown",
        productId:
          e.attributes.event_properties?.ProductID ||
          e.attributes.event_properties?.product_id ||
          e.attributes.event_properties?.["Product ID"] ||
          e.attributes.event_properties?.$product_id ||
          null,
        categories:
          e.attributes.event_properties?.Categories ||
          e.attributes.event_properties?.categories ||
          e.attributes.event_properties?.Collections ||
          [],
        productType:
          e.attributes.event_properties?.["Product Type"] ||
          e.attributes.event_properties?.product_type ||
          e.attributes.event_properties?.Type ||
          null,
        brand:
          e.attributes.event_properties?.Brand ||
          e.attributes.event_properties?.brand ||
          e.attributes.event_properties?.Vendor ||
          null,
        quantity:
          e.attributes.event_properties?.Quantity ||
          e.attributes.event_properties?.quantity ||
          1,
        orderId:
          e.attributes.event_properties?.OrderId ||
          e.attributes.event_properties?.order_id ||
          // $event_id format is "orderid:lineitemid:x" — extract the order part
          e.attributes.event_properties?.$event_id?.split(":")?.[0] ||
          null,
        sku:
          e.attributes.event_properties?.SKU ||
          e.attributes.event_properties?.sku ||
          null,
        discountCode: extractDiscountCode(e.attributes.event_properties),
      }))
    );

    nextUrl = body.links?.next || null;
    pageCount++;
  }

  return events;
}

// Fetch profiles by IDs (batched)
export async function fetchProfiles(
  accessToken: string,
  profileIds: string[]
): Promise<
  Array<{
    id: string;
    properties: Record<string, any>;
    location: Record<string, any>;
  }>
> {
  const profiles: Array<{
    id: string;
    properties: Record<string, any>;
    location: Record<string, any>;
  }> = [];

  // Batch in groups of 100
  for (let i = 0; i < profileIds.length; i += 100) {
    const batch = profileIds.slice(i, i + 100);
    const filterStr = `any(id,[${batch.map((id) => `"${id}"`).join(",")}])`;
    const url = `https://a.klaviyo.com/api/profiles/?filter=${filterStr}&page[size]=100`;

    const res = await fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        revision: "2025-01-15",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      console.error(`Profile fetch failed: ${res.status}`);
      continue;
    }

    const body = await res.json();
    for (const p of body.data) {
      profiles.push({
        id: p.id,
        properties: p.attributes?.properties || {},
        location: p.attributes?.location || {},
      });
    }
  }

  return profiles;
}

// Fetch events for multiple metric IDs (for multi-event support)
export async function fetchEventsByMetricIds(
  accessToken: string,
  metricIds: string[],
  options?: { dateFrom?: string; dateTo?: string; maxPages?: number }
): Promise<OrderedProductEvent[]> {
  const allEvents: OrderedProductEvent[] = [];
  for (const metricId of metricIds) {
    const events = await fetchOrderedProductEvents(accessToken, metricId, options);
    allEvents.push(...events);
  }
  return allEvents;
}

// Fetch all Klaviyo lists.
// profile_count is an "additional-field" — must be opted in explicitly.
// Default page size is 20; bumping to 100 so big accounts paginate faster.
export async function fetchLists(
  accessToken: string
): Promise<Array<{ id: string; name: string; profileCount: number }>> {
  const lists: Array<{ id: string; name: string; profileCount: number }> = [];
  let nextUrl: string | null =
    "https://a.klaviyo.com/api/lists/?page%5Bsize%5D=100&additional-fields%5Blist%5D=profile_count";

  while (nextUrl) {
    const res = await fetchWithRetry(nextUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        revision: "2025-01-15",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`Klaviyo lists fetch failed: ${res.status} — ${errBody}`);
      break;
    }
    const body = await res.json();
    for (const l of body.data || []) {
      lists.push({
        id: l.id,
        name: l.attributes?.name || "Unnamed",
        profileCount: l.attributes?.profile_count ?? l.attributes?.member_count ?? 0,
      });
    }
    nextUrl = body.links?.next || null;
  }

  return lists;
}

// Fetch all Klaviyo segments (their segments, not ours).
// Same treatment: request profile_count as an additional field + page[size]=100.
export async function fetchKlaviyoSegments(
  accessToken: string
): Promise<Array<{ id: string; name: string; profileCount: number }>> {
  const segments: Array<{ id: string; name: string; profileCount: number }> = [];
  let nextUrl: string | null =
    "https://a.klaviyo.com/api/segments/?page%5Bsize%5D=100&additional-fields%5Bsegment%5D=profile_count";

  while (nextUrl) {
    const res = await fetchWithRetry(nextUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        revision: "2025-01-15",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`Klaviyo segments fetch failed: ${res.status} — ${errBody}`);
      break;
    }
    const body = await res.json();
    for (const s of body.data || []) {
      segments.push({
        id: s.id,
        name: s.attributes?.name || "Unnamed",
        profileCount: s.attributes?.profile_count ?? 0,
      });
    }
    nextUrl = body.links?.next || null;
  }

  return segments;
}

// Fetch profile IDs belonging to a specific list or segment
export async function fetchListOrSegmentProfileIds(
  accessToken: string,
  type: "lists" | "segments",
  id: string,
  maxPages = 100
): Promise<string[]> {
  const profileIds: string[] = [];
  let nextUrl: string | null = `https://a.klaviyo.com/api/${type}/${id}/profiles/?page[size]=100`;
  let pageCount = 0;

  while (nextUrl && pageCount < maxPages) {
    const res = await fetchWithRetry(nextUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        revision: "2025-01-15",
        Accept: "application/json",
      },
    });

    if (!res.ok) break;
    const body = await res.json();
    for (const p of body.data || []) {
      profileIds.push(p.id);
    }
    nextUrl = body.links?.next || null;
    pageCount++;
  }

  return profileIds;
}

// Extract a discount code from event_properties using the same fallback-chain
// pattern as other fields. Returns null when none of the known shapes produce
// a non-empty string. Handles both direct code fields and Shopify's
// discount_codes[] array shape.
function extractDiscountCode(props: any): string | null {
  if (!props) return null;
  const direct =
    props.DiscountCode ||
    props.discount_code ||
    props["Discount Code"] ||
    props.PromoCode ||
    props.promo_code ||
    props["Promo Code"] ||
    props.coupon ||
    props.Coupon ||
    null;
  if (direct && typeof direct === "string" && direct.trim()) return direct.trim();

  // Shopify-style: discount_codes is an array of { code, amount, type }
  const arr = props.discount_codes || props.DiscountCodes || props.discounts;
  if (Array.isArray(arr) && arr.length > 0) {
    const first = arr[0];
    if (typeof first === "string" && first.trim()) return first.trim();
    if (first && typeof first === "object") {
      const code = first.code || first.Code || first.title || first.name;
      if (code && typeof code === "string" && code.trim()) return code.trim();
    }
  }

  return null;
}

// Types
export interface OrderedProductEvent {
  id: string;
  profileId: string;
  datetime: string;
  value: number;
  productName: string;
  productId: string | null;
  categories: string[];
  productType: string | null;
  brand: string | null;
  quantity: number;
  orderId: string | null;
  sku: string | null;
  discountCode: string | null;
}
