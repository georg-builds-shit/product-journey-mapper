import { inngest } from "./inngest";
import { runJourneyAnalysis, AnalysisFilters } from "./analyze";
import { syncEvents } from "./sync";
import { getFreshAccessToken } from "./klaviyo-auth";

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

    // Refresh-aware token fetch — shared with /api/segments/discover and
    // /api/config/sanity-check so all Klaviyo-calling paths get a fresh token.
    const { accessToken } = await getFreshAccessToken(accountId);

    // Step 1: Incremental sync — pull only new events from Klaviyo
    const syncResult = await syncEvents(accountId, accessToken);

    // Step 2: Analyze from local DB (no more Klaviyo API calls)
    const runId = await runJourneyAnalysis(accountId, accessToken, filters);
    return { runId, sync: syncResult };
  }
);

export const inngestFunctions = [analyzeJourney];
