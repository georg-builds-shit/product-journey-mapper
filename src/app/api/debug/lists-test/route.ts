import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";

export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) return NextResponse.json({ error: "accountId required" });

  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account) return NextResponse.json({ error: "not found" });

  const accessToken = decrypt(account.klaviyoAccessToken);

  // Raw lists call
  const listsRes = await fetch("https://a.klaviyo.com/api/lists/", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      revision: "2025-01-15",
      Accept: "application/json",
    },
  });

  const listsBody = await listsRes.json();

  // Raw segments call
  const segRes = await fetch("https://a.klaviyo.com/api/segments/", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      revision: "2025-01-15",
      Accept: "application/json",
    },
  });

  const segBody = await segRes.json();

  return NextResponse.json({
    listsStatus: listsRes.status,
    listsCount: listsBody.data?.length ?? 0,
    listsFirstItem: listsBody.data?.[0] || null,
    listsError: listsBody.errors || null,
    segmentsStatus: segRes.status,
    segmentsCount: segBody.data?.length ?? 0,
    segmentsFirstItem: segBody.data?.[0] || null,
    segmentsError: segBody.errors || null,
  });
}
