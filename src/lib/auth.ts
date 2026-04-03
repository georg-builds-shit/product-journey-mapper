import { NextRequest, NextResponse } from "next/server";

/**
 * Simple API key auth for protecting routes before full auth (Clerk) is added.
 * Set APP_SECRET in env vars. Pass it as `x-api-key` header or `apiKey` query param.
 * The demo endpoint and OAuth callback are exempt (public-facing).
 *
 * For the client-side dashboard, also set NEXT_PUBLIC_APP_SECRET to the same value
 * so the browser can include it in API calls. This is NOT a long-term solution —
 * replace with Clerk/NextAuth session auth before public launch.
 */
export function requireAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.APP_SECRET;

  // If no secret configured, skip auth (dev mode / not yet set up)
  if (!secret) return null;

  const apiKey =
    request.headers.get("x-api-key") ||
    request.nextUrl.searchParams.get("apiKey");

  if (apiKey !== secret) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  return null; // Auth passed
}
