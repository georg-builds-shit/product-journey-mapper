import { NextRequest, NextResponse } from "next/server";

/**
 * Shared-secret API key auth for protecting routes before user/org auth lands.
 * Set APP_SECRET in env vars. Pass it as `x-api-key` header only.
 *
 * Query-param fallback was removed — URL-borne secrets leak via referrer
 * headers, browser history, server logs, and support screenshots.
 *
 * For the client-side dashboard, also set NEXT_PUBLIC_APP_SECRET to the same
 * value so the browser can include it in API calls as a header. This is NOT a
 * long-term solution — replace with session auth (Clerk/NextAuth) before
 * public launch.
 */
export function requireAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.APP_SECRET;

  // If no secret configured, skip auth (dev mode / not yet set up)
  if (!secret) return null;

  const apiKey = request.headers.get("x-api-key");

  if (apiKey !== secret) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  return null;
}
