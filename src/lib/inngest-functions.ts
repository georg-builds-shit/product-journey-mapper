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
        runId: string;
        filters?: AnalysisFilters;
      };
    };
  }) => {
    const { accountId, runId, filters } = event.data;

    // Refresh-aware token fetch — shared with /api/segments/discover and
    // /api/config/sanity-check so all Klaviyo-calling paths get a fresh token.
    const { accessToken } = await getFreshAccessToken(accountId);

    // Step 1: Incremental sync — pull only new events from Klaviyo
    const syncResult = await syncEvents(accountId, accessToken);

    // Step 2: Analyze the pre-created run row from the POST /api/analyze handler
    await runJourneyAnalysis(accountId, accessToken, runId, filters);
    return { runId, sync: syncResult };
  }
);

export const inngestFunctions = [analyzeJourney];
