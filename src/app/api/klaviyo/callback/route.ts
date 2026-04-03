import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/klaviyo";
import { encrypt } from "@/lib/crypto";
import { db } from "@/db";
import { accounts } from "@/db/schema";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");

  if (error) {
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL("/?error=no_code", request.url));
  }

  // Retrieve PKCE code_verifier and state from cookies
  const codeVerifier = request.cookies.get("klaviyo_code_verifier")?.value;
  const storedState = request.cookies.get("klaviyo_state")?.value;

  if (!codeVerifier) {
    return NextResponse.redirect(new URL("/?error=missing_verifier", request.url));
  }

  if (!storedState || state !== storedState) {
    return NextResponse.redirect(new URL("/?error=state_mismatch", request.url));
  }

  try {
    const tokens = await exchangeCodeForTokens(code, codeVerifier);
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    const [account] = await db
      .insert(accounts)
      .values({
        email: "pending@setup.com",
        klaviyoAccessToken: encrypt(tokens.accessToken),
        klaviyoRefreshToken: encrypt(tokens.refreshToken),
        klaviyoTokenExpiresAt: expiresAt,
      })
      .returning();

    const response = NextResponse.redirect(
      new URL(`/dashboard?accountId=${account.id}`, request.url)
    );

    // Clear the PKCE cookies
    response.cookies.delete("klaviyo_code_verifier");
    response.cookies.delete("klaviyo_state");

    return response;
  } catch (err) {
    console.error("Klaviyo OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/?error=token_exchange_failed", request.url)
    );
  }
}
