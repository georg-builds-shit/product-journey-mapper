import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { fetchMetrics } from "@/lib/klaviyo";

export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId));

  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const isDemoAccount = account.email === "demo@productjourneymapper.com";
  if (isDemoAccount) {
    return NextResponse.json({ error: "Demo account" }, { status: 400 });
  }

  const accessToken = decrypt(account.klaviyoAccessToken);
  const metrics = await fetchMetrics(accessToken);
  const orderedProductMetric = metrics.find(
    (m: { name: string }) => m.name === "Ordered Product"
  );

  if (!orderedProductMetric) {
    return NextResponse.json({ error: "No Ordered Product metric", metrics });
  }

  // Fetch just 1 event to see the field names
  const res = await fetch(
    `https://a.klaviyo.com/api/events/?filter=equals(metric_id,"${orderedProductMetric.id}")&page[size]=1`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        revision: "2024-10-15",
        Accept: "application/json",
      },
    }
  );

  const body = await res.json();
  const sampleEvent = body.data?.[0];

  return NextResponse.json({
    metricId: orderedProductMetric.id,
    eventProperties: sampleEvent?.attributes?.event_properties || null,
    allAttributeKeys: sampleEvent?.attributes ? Object.keys(sampleEvent.attributes) : [],
    rawAttributes: sampleEvent?.attributes || null,
  });
}
