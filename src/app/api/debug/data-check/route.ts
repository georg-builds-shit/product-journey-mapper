import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  // Total events
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(events)
    .where(eq(events.accountId, accountId));

  // Unique profiles
  const [{ profiles }] = await db
    .select({ profiles: sql<number>`count(distinct ${events.profileId})` })
    .from(events)
    .where(eq(events.accountId, accountId));

  // Unique orderIds
  const [{ orders }] = await db
    .select({ orders: sql<number>`count(distinct ${events.orderId})` })
    .from(events)
    .where(eq(events.accountId, accountId));

  // Sample: first 5 events with their orderIds
  const sampleEvents = await db
    .select({
      profileId: events.profileId,
      orderId: events.orderId,
      productName: events.productName,
      datetime: events.datetime,
      value: events.value,
    })
    .from(events)
    .where(eq(events.accountId, accountId))
    .orderBy(events.datetime)
    .limit(10);

  // Distribution: how many events per orderId (top 10)
  const orderSizes = await db
    .select({
      orderId: events.orderId,
      eventCount: sql<number>`count(*)`,
    })
    .from(events)
    .where(eq(events.accountId, accountId))
    .groupBy(events.orderId)
    .orderBy(sql`count(*) desc`)
    .limit(10);

  // Distribution: how many orders per profile (top 10)
  const profileOrderCounts = await db
    .select({
      profileId: events.profileId,
      orderCount: sql<number>`count(distinct ${events.orderId})`,
      eventCount: sql<number>`count(*)`,
    })
    .from(events)
    .where(eq(events.accountId, accountId))
    .groupBy(events.profileId)
    .orderBy(sql`count(distinct ${events.orderId}) desc`)
    .limit(10);

  // How many null orderIds?
  const [{ nullOrders }] = await db
    .select({ nullOrders: sql<number>`count(*)` })
    .from(events)
    .where(sql`${events.accountId} = ${accountId} AND ${events.orderId} IS NULL`);

  return NextResponse.json({
    summary: { totalEvents: total, uniqueProfiles: profiles, uniqueOrders: orders, nullOrderIds: nullOrders },
    sampleEvents,
    largestOrders: orderSizes,
    topRepeatCustomers: profileOrderCounts,
  });
}
