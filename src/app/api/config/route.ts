import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getBrandConfig, updateBrandConfig } from "@/lib/config";

// GET /api/config?accountId=...
// Returns the brand config, creating a default row if missing.
export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  try {
    const config = await getBrandConfig(accountId);
    return NextResponse.json(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/config
// Body: { accountId, patch: { channels?, productGroupings?, cohortGranularity?, lookbackMonths?, excludeRefunds?, minOrderValue?, excludeTestRules? } }
export async function PATCH(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const body = await request.json();
  const { accountId, patch } = body ?? {};
  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }
  if (!patch || typeof patch !== "object") {
    return NextResponse.json({ error: "patch object required" }, { status: 400 });
  }

  try {
    const updated = await updateBrandConfig(accountId, patch);
    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
