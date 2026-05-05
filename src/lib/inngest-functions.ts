import { inngest } from "./inngest";
import { runJourneyAnalysis, AnalysisFilters } from "./analyze";
import { syncEvents } from "./sync";
import { getFreshAccessToken } from "./klaviyo-auth";
import { log } from "./logger";

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
    const startedAt = Date.now();

    log.info("analyze.job_started", { accountId, runId, filters });

    try {
      const { accessToken } = await getFreshAccessToken(accountId);

      const syncStartedAt = Date.now();
      const syncResult = await syncEvents(accountId, accessToken);
      log.info("analyze.sync_done", {
        accountId,
        runId,
        newEvents: syncResult.newEvents,
        backfillEvents: syncResult.backfillEvents,
        totalEvents: syncResult.totalEvents,
        profilesSynced: syncResult.profilesSynced,
        durationMs: Date.now() - syncStartedAt,
      });

      const analyzeStartedAt = Date.now();
      await runJourneyAnalysis(accountId, accessToken, runId, filters);
      log.info("analyze.run_done", {
        accountId,
        runId,
        durationMs: Date.now() - analyzeStartedAt,
        totalMs: Date.now() - startedAt,
      });

      return { runId, sync: syncResult };
    } catch (err) {
      log.error("analyze.job_failed", { accountId, runId, totalMs: Date.now() - startedAt }, err);
      throw err;
    }
  }
);

export const inngestFunctions = [analyzeJourney];
