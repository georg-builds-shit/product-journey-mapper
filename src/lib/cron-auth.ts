import { NextRequest, NextResponse } from "next/server";

/**
 * Vercel Cron auth. In production, Vercel sets `authorization: Bearer <CRON_SECRET>`
 * on every cron invocation when CRON_SECRET is configured. This helper also
 * accepts the header for local testing via curl.
 *
 * If CRON_SECRET is unset (dev mode), the check is a no-op so locally
 * running the endpoint still works.
 */
export function requireCronAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;

  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return null;

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
