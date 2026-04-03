import { NextResponse } from "next/server";
import { getKlaviyoAuthUrl, generateCodeVerifier, generateCodeChallenge } from "@/lib/klaviyo";
import crypto from "crypto";

export async function GET(request: Request) {
  const state = crypto.randomBytes(32).toString("hex");
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const authUrl = getKlaviyoAuthUrl(state, codeChallenge);

  const response = NextResponse.redirect(authUrl);

  // Store code_verifier and state in cookies for the callback
  response.cookies.set("klaviyo_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });
  response.cookies.set("klaviyo_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
