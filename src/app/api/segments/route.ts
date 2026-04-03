import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { segments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";

// List segments for an account
export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  const result = await db
    .select()
    .from(segments)
    .where(eq(segments.accountId, accountId));

  return NextResponse.json(result);
}

// Create a segment
export async function POST(request: NextRequest) {
  const authError2 = requireAuth(request);
  if (authError2) return authError2;

  const { accountId, name, segmentType, rules } = await request.json();

  if (!accountId || !name || !segmentType || !rules) {
    return NextResponse.json(
      { error: "accountId, name, segmentType, and rules are required" },
      { status: 400 }
    );
  }

  if (!["profile", "event"].includes(segmentType)) {
    return NextResponse.json(
      { error: "segmentType must be 'profile' or 'event'" },
      { status: 400 }
    );
  }

  const [segment] = await db
    .insert(segments)
    .values({ accountId, name, segmentType, rules })
    .returning();

  return NextResponse.json(segment);
}

// Delete a segment
export async function DELETE(request: NextRequest) {
  const authError3 = requireAuth(request);
  if (authError3) return authError3;

  const { segmentId, accountId } = await request.json();

  if (!segmentId || !accountId) {
    return NextResponse.json(
      { error: "segmentId and accountId required" },
      { status: 400 }
    );
  }

  await db
    .delete(segments)
    .where(and(eq(segments.id, segmentId), eq(segments.accountId, accountId)));

  return NextResponse.json({ deleted: true });
}
