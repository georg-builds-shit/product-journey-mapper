import { inngest } from "./inngest";
import { runJourneyAnalysis, AnalysisFilters } from "./analyze";
import { syncEvents } from "./sync";
import { decrypt, encrypt } from "./crypto";
import { refreshAccessToken } from "./klaviyo";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";

export const analyzeJourney = inngest.createFunction(
  {
    id: "analyze-journey",
    retries: 3,
    concurrency: { limit: 2 },
    triggers: [{ event: "journey/analyze" }],
  },
  async ({
    event,
  }: {
    event: {
      data: {
        accountId: string;
        filters?: AnalysisFilters;
      };
    };
  }) => {
    const { accountId, filters } = event.data;

    // Read account from DB
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, accountId));

    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    // Check token expiry and auto-refresh if needed
    let accessToken: string;
    const now = new Date();
    const expiresAt = account.klaviyoTokenExpiresAt;
    const bufferMs = 5 * 60 * 1000; // 5 min buffer

    if (expiresAt && expiresAt.getTime() - now.getTime() < bufferMs) {
      // Token expired or about to expire — refresh it
      try {
        const refreshToken = decrypt(account.klaviyoRefreshToken);
        const refreshed = await refreshAccessToken(refreshToken);

        // Store new encrypted tokens
        await db
          .update(accounts)
          .set({
            klaviyoAccessToken: encrypt(refreshed.accessToken),
            klaviyoRefreshToken: encrypt(refreshed.refreshToken),
            klaviyoTokenExpiresAt: new Date(
              Date.now() + refreshed.expiresIn * 1000
            ),
          })
          .where(eq(accounts.id, accountId));

        accessToken = refreshed.accessToken;
      } catch (err) {
        throw new Error(
          `Token refresh failed — the Klaviyo connection may need to be re-authorized. ${err instanceof Error ? err.message : ""}`
        );
      }
    } else {
      accessToken = decrypt(account.klaviyoAccessToken);
    }

    // Step 1: Incremental sync — pull only new events from Klaviyo
    const syncResult = await syncEvents(accountId, accessToken);

    // Step 2: Analyze from local DB (no more Klaviyo API calls)
    const runId = await runJourneyAnalysis(accountId, accessToken, filters);
    return { runId, sync: syncResult };
  }
);

export const inngestFunctions = [analyzeJourney];
