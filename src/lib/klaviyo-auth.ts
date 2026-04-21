import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "./crypto";
import { refreshAccessToken } from "./klaviyo";

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh if token expires within 5 min

/**
 * Load the account row and return a usable Klaviyo access token, refreshing
 * it in-place if it's expired or within the 5-minute refresh window. Every
 * route or background job that hits the Klaviyo API should get its token
 * through this function so refreshes are never missed.
 *
 * Throws if the account doesn't exist, if the refresh itself fails, or if
 * the merchant has revoked the app (in which case they must re-authorize).
 */
export async function getFreshAccessToken(
  accountId: string
): Promise<{ accessToken: string; accountEmail: string }> {
  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId));

  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  // Demo accounts have no real Klaviyo connection — skip.
  if (account.email === "demo@productjourneymapper.com") {
    throw new Error("Demo account has no Klaviyo connection");
  }

  const now = Date.now();
  const expiresAt = account.klaviyoTokenExpiresAt?.getTime() ?? 0;
  const needsRefresh = expiresAt - now < REFRESH_BUFFER_MS;

  if (!needsRefresh) {
    return {
      accessToken: decrypt(account.klaviyoAccessToken),
      accountEmail: account.email,
    };
  }

  // Refresh
  try {
    const refreshToken = decrypt(account.klaviyoRefreshToken);
    const refreshed = await refreshAccessToken(refreshToken);

    await db
      .update(accounts)
      .set({
        klaviyoAccessToken: encrypt(refreshed.accessToken),
        klaviyoRefreshToken: encrypt(refreshed.refreshToken),
        klaviyoTokenExpiresAt: new Date(now + refreshed.expiresIn * 1000),
      })
      .where(eq(accounts.id, accountId));

    return {
      accessToken: refreshed.accessToken,
      accountEmail: account.email,
    };
  } catch (err) {
    throw new Error(
      `Klaviyo token refresh failed — the merchant may need to re-authorize. ${
        err instanceof Error ? err.message : ""
      }`
    );
  }
}
