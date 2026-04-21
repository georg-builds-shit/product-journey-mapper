"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import SankeyChart from "@/components/SankeyChart";
import GatewayChart from "@/components/GatewayChart";
import InsightsCard from "@/components/InsightsCard";
import StickinessTable from "@/components/StickinessTable";
import FilterBar from "@/components/FilterBar";
import DashboardTabs, { type TabId } from "@/components/DashboardTabs";
import RepurchaseTimingChart from "@/components/RepurchaseTimingChart";
import RevenueConcentration from "@/components/RevenueConcentration";
import CohortTable from "@/components/CohortTable";
import AffinityMatrix from "@/components/AffinityMatrix";
import JourneyExplorer from "@/components/JourneyExplorer";
import AudienceSelector from "@/components/AudienceSelector";
import CohortCurves from "@/components/CohortCurves";
import TimeBetweenOrders from "@/components/TimeBetweenOrders";
import FirstToSecondMatrix from "@/components/FirstToSecondMatrix";
import OrderCountDistribution from "@/components/OrderCountDistribution";
import DiscountCodeUsage from "@/components/DiscountCodeUsage";
import CrossAudienceTile from "@/components/CrossAudienceTile";
import AudienceOverview from "@/components/AudienceOverview";
import ConnectionStatus from "@/components/ConnectionStatus";
import { ChatButton, ChatPanel } from "@/components/chat";
import { useChat } from "@/hooks/useChat";
import { useIsMobile } from "@/hooks/useIsMobile";

const COMBINED_AUDIENCE_ID = "__combined__";
const UNASSIGNED_AUDIENCE_ID = "unassigned";

interface AnalysisStatus {
  runId?: string;
  status: string;
  ordersSynced?: number;
  uniqueCustomers?: number;
  error?: string;
}

interface DashboardData {
  transitions: any[];
  gateways: any[];
  stickiness: any[];
  insights: string;
  stats: { ordersSynced: number; uniqueCustomers: number };
  filters: { dateFrom: string | null; dateTo: string | null };
  repurchaseTiming: any[] | null;
  revenueConcentration: any | null;
  repurchaseRate: any[] | null;
  cohortRetention: any[] | null;
  productAffinity: any[] | null;
  customerJourneys: any[] | null;
  cohortAnalytics: CohortAnalytics | null;
  audiencesSnapshot: any[] | null;
  configSnapshot: any | null;
}

// Shape mirrors CohortAnalyticsOutput in src/lib/cohort-analysis.ts
interface CohortAnalytics {
  cohortCurves: { combined: any; perAudience: Record<string, any> };
  timeBetweenOrders: { combined: any; perAudience: Record<string, any> };
  firstToSecondMatrix: { combined: any; perAudience: Record<string, any> };
  orderCountDistribution: { combined: any; perAudience: Record<string, any> };
  discountCodeUsage: { combined: any; perAudience: Record<string, any> };
  crossAudience: any;
  unassignedSize: number;
  warnings: string[];
  audienceLabels: Array<{ id: string; label: string }>;
}

/**
 * Pick the right slice of a per-audience metric based on the selected audience.
 */
function pickAudienceSlice<T>(
  result: { combined: T; perAudience: Record<string, T> } | null | undefined,
  audienceId: string
): T | null {
  if (!result) return null;
  if (audienceId === COMBINED_AUDIENCE_ID) return result.combined;
  return result.perAudience[audienceId] ?? null;
}

/**
 * Wraps a metric component and renders it once per selected audience, stacked
 * vertically with a header showing the audience name + n. Keeps all related
 * slices visually grouped so like-for-like comparison is easy.
 */
function MetricStack<T>({
  label,
  audienceIds,
  audienceLabels,
  result,
  render,
}: {
  label: string;
  audienceIds: string[];
  audienceLabels: Array<{ id: string; label: string }>;
  result: { combined: T; perAudience: Record<string, T> } | null | undefined;
  render: (slice: T | null, audienceId: string) => React.ReactNode;
}) {
  const resolveLabel = (id: string): string => {
    if (id === COMBINED_AUDIENCE_ID) return "Combined";
    return audienceLabels.find((a) => a.id === id)?.label ?? id;
  };

  const resolveN = (id: string): number | undefined => {
    const slice = (id === COMBINED_AUDIENCE_ID ? result?.combined : result?.perAudience?.[id]) as
      | { totalCustomers?: number; totalRepeaters?: number; totalRepeatCustomers?: number; sampleSize?: number }
      | null
      | undefined;
    return (
      slice?.totalCustomers ??
      slice?.totalRepeaters ??
      slice?.totalRepeatCustomers ??
      slice?.sampleSize
    );
  };

  if (audienceIds.length === 1) {
    const id = audienceIds[0];
    return <>{render(pickAudienceSlice(result, id), id)}</>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">
        {label}
      </h2>
      {audienceIds.map((id) => {
        const n = resolveN(id);
        return (
          <div key={id}>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-xs font-medium text-[var(--foreground)]">
                {resolveLabel(id)}
              </span>
              {n !== undefined && (
                <span className="text-[10px] text-[var(--muted)] tabular-nums">
                  {n.toLocaleString()} customers
                </span>
              )}
            </div>
            {render(pickAudienceSlice(result, id), id)}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Build the option list for the global audience selector. Always include
 * "Combined" first; include every configured audience; include "Unassigned"
 * only if any customer landed there.
 */
function buildAudienceOptions(cohortAnalytics: CohortAnalytics) {
  const options: Array<{ id: string; label: string; count?: number }> = [
    {
      id: COMBINED_AUDIENCE_ID,
      label: "Combined",
      count: cohortAnalytics.cohortCurves?.combined?.totalCustomers,
    },
  ];
  for (const a of cohortAnalytics.audienceLabels) {
    if (a.id === UNASSIGNED_AUDIENCE_ID && cohortAnalytics.unassignedSize === 0) continue;
    options.push({
      id: a.id,
      label: a.label,
      count: cohortAnalytics.cohortCurves?.perAudience?.[a.id]?.totalCustomers,
    });
  }
  return options;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card stat-card p-4 md:p-5 min-w-[160px] snap-start shrink-0 md:min-w-0 md:shrink">
      <p className="text-[10px] md:text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-1">{label}</p>
      <p className="text-lg md:text-3xl font-bold tracking-tight truncate">{value}</p>
      {sub && <p className="text-[10px] md:text-xs text-[var(--muted)] mt-1">{sub}</p>}
    </div>
  );
}

function CompareStatCard({
  label, valueA, valueB, nameA, nameB, format,
}: {
  label: string; valueA: number; valueB: number; nameA: string; nameB: string; format?: "pct" | "number";
}) {
  const fmt = (v: number) => (format === "pct" ? `${v.toFixed(1)}%` : v.toLocaleString());
  const delta = valueA - valueB;
  const deltaColor = delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-[var(--muted)]";
  const deltaSign = delta > 0 ? "+" : "";

  return (
    <div className="card stat-card p-4 md:p-5 min-w-[200px] snap-start shrink-0 md:min-w-0 md:shrink">
      <p className="text-[10px] md:text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-2">{label}</p>
      <div className="flex items-end gap-3">
        <div>
          <p className="text-xl md:text-2xl font-bold tracking-tight">{fmt(valueA)}</p>
          <p className="text-[10px] text-blue-400 uppercase tracking-wider mt-0.5">{nameA}</p>
        </div>
        <div className="text-[var(--muted)] text-base md:text-lg pb-0.5">vs</div>
        <div>
          <p className="text-xl md:text-2xl font-bold tracking-tight">{fmt(valueB)}</p>
          <p className="text-[10px] text-orange-400 uppercase tracking-wider mt-0.5">{nameB}</p>
        </div>
      </div>
      <p className={`text-xs font-medium mt-2 ${deltaColor}`}>
        {deltaSign}{format === "pct" ? delta.toFixed(1) + "pp" : delta.toLocaleString()} difference
      </p>
    </div>
  );
}

/** Auth header for API calls */
function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const secret = typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_APP_SECRET
    : undefined;
  if (secret) headers["x-api-key"] = secret;
  return headers;
}

/**
 * Trigger a CSV download from the export API. Uses the latest completed run
 * implicitly (the API resolves `runId` from `accountId` when omitted).
 */
function exportCsv(accountId: string | null, metric: string, audienceId: string) {
  if (!accountId) return;
  const params = new URLSearchParams({ accountId, metric });
  if (audienceId && audienceId !== "__combined__") params.set("audience", audienceId);
  const secret = typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_APP_SECRET
    : undefined;
  if (secret) params.set("apiKey", secret);
  // Open in a new tab so the browser handles the download via Content-Disposition.
  window.open(`/api/export?${params.toString()}`, "_blank");
}

/**
 * POST /api/analyze. Returns { runId, cached } — cached=true when the server
 * returned a complete run with a matching config signature (no new job
 * fired). cached=false means a new run row was created and an Inngest job
 * queued; poll the returned runId for status.
 */
async function requestAnalysis(
  accountId: string,
  filters?: { dateFrom?: string; dateTo?: string; segmentId?: string }
): Promise<{ runId: string; cached: boolean }> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: apiHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      accountId,
      dateFrom: filters?.dateFrom,
      dateTo: filters?.dateTo,
      segmentId: filters?.segmentId,
    }),
  });
  const result = await res.json();
  if (!result.runId) {
    throw new Error(result.error || "Analyze request returned no runId");
  }
  return { runId: result.runId, cached: result.status === "cached" };
}

/** Poll /api/analyze/status?runId=X until the specific run is complete. */
function pollUntilComplete(
  accountId: string,
  runId: string,
  onStatus?: (s: AnalysisStatus) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = `/api/analyze/status?accountId=${accountId}&runId=${runId}`;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(url, { headers: apiHeaders() });
        const result: AnalysisStatus = await res.json();
        onStatus?.(result);
        if (result.status === "complete" && result.runId) {
          clearInterval(interval);
          resolve(result.runId);
        } else if (result.status === "failed") {
          clearInterval(interval);
          reject(new Error(result.error || "Analysis failed"));
        }
      } catch {
        clearInterval(interval);
        reject(new Error("Polling failed"));
      }
    }, 3000);
  });
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const accountId = searchParams.get("accountId");

  const [status, setStatus] = useState<AnalysisStatus | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [compareData, setCompareData] = useState<DashboardData | null>(null);
  const [compareSegmentName, setCompareSegmentName] = useState("");
  const [primarySegmentName, setPrimarySegmentName] = useState("");
  const [viewMode, setViewMode] = useState<"product" | "category">("product");
  const [loading, setLoading] = useState(true);
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [activeSegmentId, setActiveSegmentId] = useState("");
  const [selectedAudienceIds, setSelectedAudienceIds] = useState<string[]>([COMBINED_AUDIENCE_ID]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const isMobile = useIsMobile();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chat = useChat({ dashboardData: data });

  const fetchDashboardData = useCallback(
    async (runId: string): Promise<DashboardData> => {
      const res = await fetch(`/api/dashboard?accountId=${accountId}&runId=${runId}`, {
        headers: apiHeaders(),
      });
      return res.json();
    },
    [accountId]
  );

  const triggerAnalysis = useCallback(
    async (filters?: {
      dateFrom?: string;
      dateTo?: string;
      segmentId?: string;
      compareSegmentId?: string;
      primaryName?: string;
      compareName?: string;
    }) => {
      if (!accountId) return;

      // Stop any existing polling
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }

      setLoading(true);
      setData(null);
      setCompareData(null);
      setIsReanalyzing(true);
      if (filters?.primaryName) setPrimarySegmentName(filters.primaryName);
      if (filters?.compareName) setCompareSegmentName(filters.compareName);
      if (!filters?.compareSegmentId) setCompareData(null);

      // ── Run primary analysis ──
      const primary = await requestAnalysis(accountId, {
        dateFrom: filters?.dateFrom,
        dateTo: filters?.dateTo,
        segmentId: filters?.segmentId,
      });

      const primaryRunId = primary.cached
        ? primary.runId
        : await pollUntilComplete(accountId, primary.runId, setStatus);

      const primaryData = await fetchDashboardData(primaryRunId);
      setData(primaryData);

      // ── Run comparison analysis (if requested) ──
      if (filters?.compareSegmentId) {
        const compare = await requestAnalysis(accountId, {
          dateFrom: filters?.dateFrom,
          dateTo: filters?.dateTo,
          segmentId: filters.compareSegmentId,
        });

        const compareRunId = compare.cached
          ? compare.runId
          : await pollUntilComplete(accountId, compare.runId);

        const cData = await fetchDashboardData(compareRunId);
        setCompareData(cData);
      }

      setLoading(false);
      setIsReanalyzing(false);
    },
    [accountId, fetchDashboardData]
  );

  // Initial load — poll for existing run
  useEffect(() => {
    if (!accountId) return;

    const init = async () => {
      const res = await fetch(`/api/analyze/status?accountId=${accountId}`, { headers: apiHeaders() });
      const result: AnalysisStatus = await res.json();
      setStatus(result);

      if (result.status === "complete" && result.runId) {
        const dashboardData = await fetchDashboardData(result.runId);
        setData(dashboardData);
        setLoading(false);
      } else if (result.status === "failed") {
        setLoading(false);
      } else if (result.status === "none") {
        triggerAnalysis();
      } else {
        // Still running — poll
        pollRef.current = setInterval(async () => {
          const r = await fetch(`/api/analyze/status?accountId=${accountId}`, { headers: apiHeaders() });
          const s: AnalysisStatus = await r.json();
          setStatus(s);
          if (s.status === "complete" && s.runId) {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            const d = await fetchDashboardData(s.runId);
            setData(d);
            setLoading(false);
          } else if (s.status === "failed") {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setLoading(false);
          }
        }, 3000);
      }
    };

    init();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [accountId, fetchDashboardData, triggerAnalysis]);

  useEffect(() => {
    if (data?.filters) {
      setFilterDateFrom(data.filters.dateFrom || "");
      setFilterDateTo(data.filters.dateTo || "");
    }
  }, [data]);

  // When a new analysis run's cohort data loads, default-select Combined +
  // every configured audience. User can uncheck to simplify.
  useEffect(() => {
    if (!data?.cohortAnalytics) return;
    const configured = data.cohortAnalytics.audienceLabels
      .filter((a) => a.id !== UNASSIGNED_AUDIENCE_ID)
      .map((a) => a.id);
    setSelectedAudienceIds([COMBINED_AUDIENCE_ID, ...configured]);
  }, [data?.cohortAnalytics]);

  const handleFilterApply = (filters: {
    dateFrom: string;
    dateTo: string;
    segmentId?: string;
    compareSegmentId?: string;
    primaryName?: string;
    compareName?: string;
  }) => {
    setFilterDateFrom(filters.dateFrom);
    setFilterDateTo(filters.dateTo);
    setActiveSegmentId(filters.segmentId || "");
    triggerAnalysis({
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      segmentId: filters.segmentId,
      compareSegmentId: filters.compareSegmentId,
      primaryName: filters.primaryName,
      compareName: filters.compareName,
    });
  };

  if (!accountId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--muted)]">
          No account connected.{" "}
          <a href="/" className="text-[var(--accent)] hover:underline">Go back</a>
        </p>
      </div>
    );
  }

  if (loading && status?.status !== "failed") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <div className="relative">
          <div className="h-12 w-12 rounded-full border-2 border-[var(--card-border)]" />
          <div className="absolute inset-0 h-12 w-12 rounded-full border-2 border-transparent border-t-[var(--accent)] animate-spin" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">
            {status?.status === "ingesting" && "Pulling order data from Klaviyo..."}
            {status?.status === "analyzing" && `Analyzing ${status.ordersSynced?.toLocaleString() || 0} orders...`}
            {(!status || status.status === "pending" || status.status === "none") && "Starting analysis..."}
          </p>
          {status?.ordersSynced && (
            <p className="text-xs text-[var(--muted)] mt-2">{status.ordersSynced.toLocaleString()} order events synced</p>
          )}
        </div>
      </div>
    );
  }

  if (status?.status === "failed") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="card p-8 text-center max-w-md">
          <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <span className="text-red-400 text-lg">!</span>
          </div>
          <p className="font-medium mb-2">Analysis failed</p>
          <p className="text-sm text-[var(--muted)] mb-4">{status.error}</p>
          <a href="/" className="text-sm text-[var(--accent)] hover:underline">Try again</a>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const handleReanalyze = () => {
    triggerAnalysis({
      dateFrom: filterDateFrom || undefined,
      dateTo: filterDateTo || undefined,
      segmentId: activeSegmentId || undefined,
    });
  };

  const isComparing = !!compareData;
  const nameA = primarySegmentName || "Primary";
  const nameB = compareSegmentName || "Comparison";

  const repeatRateA =
    data.stats.uniqueCustomers && data.stats.ordersSynced
      ? (data.stats.uniqueCustomers / (data.stats.ordersSynced / 2)) * 100
      : 0;
  const repeatRateB =
    compareData?.stats.uniqueCustomers && compareData?.stats.ordersSynced
      ? (compareData.stats.uniqueCustomers / (compareData.stats.ordersSynced / 2)) * 100
      : 0;

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 sm:px-8 sm:py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Product Journey</h1>
            <ConnectionStatus accountId={accountId} />
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/settings?accountId=${accountId}`}
              className="shrink-0 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)] transition-all"
            >
              Settings
            </a>
            <button onClick={handleReanalyze} className="shrink-0 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)] transition-all">
              Re-analyze
            </button>
          </div>
        </div>
        <p className="text-xs sm:text-sm text-[var(--muted)] mt-1">
          {isComparing ? (
            <>
              Comparing <span className="text-blue-400 font-medium">{nameA}</span>
              {" vs "}
              <span className="text-orange-400 font-medium">{nameB}</span>
            </>
          ) : (
            <>
              {data.stats.ordersSynced?.toLocaleString()} orders analyzed
              {(data.filters?.dateFrom || data.filters?.dateTo) && (
                <span className="text-[var(--accent)]"> · Filtered</span>
              )}
            </>
          )}
        </p>
        {activeTab === "overview" && !isComparing && (
          <div className="toggle-group flex w-fit mt-3">
            <button onClick={() => setViewMode("product")} className={`toggle-item ${viewMode === "product" ? "active" : ""}`}>Product</button>
            <button onClick={() => setViewMode("category")} className={`toggle-item ${viewMode === "category" ? "active" : ""}`}>Category</button>
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <FilterBar
        accountId={accountId}
        dateFrom={filterDateFrom}
        dateTo={filterDateTo}
        onApply={handleFilterApply}
        isLoading={isReanalyzing}
        activeFilters={{ ...data.filters, segmentId: activeSegmentId || null }}
      />

      {/* Stats */}
      {isComparing ? (
        <div className="flex overflow-x-auto gap-3 pb-2 -mx-4 px-4 snap-x md:grid md:grid-cols-3 md:overflow-visible md:mx-0 md:px-0 md:pb-0 mb-6">
          <CompareStatCard label="Repeat Rate" valueA={repeatRateA} valueB={repeatRateB} nameA={nameA} nameB={nameB} format="pct" />
          <CompareStatCard label="Orders Analyzed" valueA={data.stats.ordersSynced || 0} valueB={compareData.stats.ordersSynced || 0} nameA={nameA} nameB={nameB} format="number" />
          <CompareStatCard label="Repeat Customers" valueA={data.stats.uniqueCustomers || 0} valueB={compareData.stats.uniqueCustomers || 0} nameA={nameA} nameB={nameB} format="number" />
        </div>
      ) : (
        <div className="flex overflow-x-auto gap-3 pb-2 -mx-4 px-4 snap-x md:grid md:grid-cols-4 md:overflow-visible md:mx-0 md:px-0 md:pb-0 mb-6">
          <StatCard label="Repeat Rate" value={`${repeatRateA.toFixed(1)}%`} sub="customers with 2+ orders" />
          <StatCard label="Orders Analyzed" value={data.stats.ordersSynced?.toLocaleString() || "—"} sub="total order events" />
          <StatCard label="Repeat Customers" value={data.stats.uniqueCustomers?.toLocaleString() || "—"} sub="placed 2+ orders" />
          <StatCard label="Top Gateway" value={data.gateways?.[0]?.productName || "—"} sub={data.gateways?.[0] ? `${data.gateways[0].firstPurchasePct?.toFixed(0)}% of first orders` : undefined} />
        </div>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <DashboardTabs activeTab={activeTab} onChange={setActiveTab} />
        {!isComparing && data.cohortAnalytics && activeTab === "cohorts" && (
          <AudienceSelector
            audiences={buildAudienceOptions(data.cohortAnalytics)}
            selected={selectedAudienceIds}
            onChange={setSelectedAudienceIds}
            className="mb-6"
          />
        )}
      </div>

      {/* Overview */}
      {activeTab === "overview" && (
        <>
          <div className="sankey-container p-4 sm:p-6 mb-8">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base sm:text-lg font-semibold">
                Purchase Flow
                {isComparing && <span className="text-sm text-blue-400 ml-2">({nameA})</span>}
              </h2>
            </div>
            <div className="overflow-x-auto -mx-4 px-4 sm:-mx-6 sm:px-6">
            <SankeyChart
              transitions={viewMode === "category" ? data.transitions.map((t: any) => ({ ...t, fromProduct: t.fromCategory || "Uncategorized", toProduct: t.toCategory || "Uncategorized" })) : data.transitions}
              viewMode={viewMode}
            />
            </div>
          </div>

          {isComparing && (
            <div className="sankey-container p-4 sm:p-6 mb-8">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-base sm:text-lg font-semibold">
                  Purchase Flow <span className="text-sm text-orange-400 ml-2">({nameB})</span>
                </h2>
              </div>
              <div className="overflow-x-auto -mx-4 px-4 sm:-mx-6 sm:px-6">
                <SankeyChart transitions={compareData.transitions} viewMode={viewMode} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2 card p-6">
              <h2 className="text-lg font-semibold mb-4">Gateway Products</h2>
              <GatewayChart gateways={data.gateways} />
              {isComparing && (
                <div className="mt-6 pt-4 border-t border-[var(--card-border)]">
                  <p className="text-xs text-orange-400 uppercase tracking-wider font-medium mb-3">{nameB}</p>
                  <GatewayChart gateways={compareData.gateways} />
                </div>
              )}
            </div>
            <div className="lg:col-span-3">
              <InsightsCard insights={data.insights} />
            </div>
          </div>
        </>
      )}

      {/* Retention */}
      {activeTab === "retention" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {data.repurchaseTiming && (
              <div>
                {isComparing && <p className="text-xs text-blue-400 uppercase tracking-wider font-medium mb-2">{nameA}</p>}
                <RepurchaseTimingChart data={data.repurchaseTiming} />
              </div>
            )}
            {isComparing && compareData?.repurchaseTiming ? (
              <div>
                <p className="text-xs text-orange-400 uppercase tracking-wider font-medium mb-2">{nameB}</p>
                <RepurchaseTimingChart data={compareData.repurchaseTiming} />
              </div>
            ) : (
              data.revenueConcentration && <RevenueConcentration data={data.revenueConcentration} />
            )}
          </div>
          {isComparing && data.revenueConcentration && compareData?.revenueConcentration && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div><p className="text-xs text-blue-400 uppercase tracking-wider font-medium mb-2">{nameA}</p><RevenueConcentration data={data.revenueConcentration} /></div>
              <div><p className="text-xs text-orange-400 uppercase tracking-wider font-medium mb-2">{nameB}</p><RevenueConcentration data={compareData.revenueConcentration} /></div>
            </div>
          )}
          {data.cohortRetention && data.cohortRetention.length > 0 && <CohortTable data={data.cohortRetention} />}
        </div>
      )}

      {/* Cohorts (loyalty module) */}
      {activeTab === "cohorts" && (
        <div className="space-y-6">
          {!data.cohortAnalytics ? (
            <div className="card p-8 text-center">
              <h3 className="text-base font-semibold">No cohort analytics yet</h3>
              <p className="text-sm text-[var(--muted)] mt-2 max-w-md mx-auto">
                Cohort analytics needs a brand config. Open{" "}
                <a
                  href={`/settings?accountId=${accountId}`}
                  className="text-[var(--accent)] hover:underline"
                >
                  Settings
                </a>{" "}
                to configure channels and re-run analysis.
              </p>
            </div>
          ) : (
            <>
              {/* Warnings */}
              {data.cohortAnalytics.warnings.includes("monthly_cohorts_under_50") && (
                <div className="card p-4 border-l-4 border-l-[var(--warning)]">
                  <p className="text-sm">
                    <span className="font-medium text-[var(--warning)]">Thin cohorts.</span>{" "}
                    Some monthly cohorts have fewer than 50 customers. Consider switching to
                    quarterly granularity in{" "}
                    <a
                      href={`/settings?accountId=${accountId}`}
                      className="text-[var(--accent)] hover:underline"
                    >
                      Settings
                    </a>
                    .
                  </p>
                </div>
              )}

              {/* Per-audience breakdown */}
              <AudienceOverview
                audienceLabels={data.cohortAnalytics.audienceLabels}
                cohortCurves={data.cohortAnalytics.cohortCurves}
                crossAudience={data.cohortAnalytics.crossAudience}
              />

              {/* Top tiles: cross-audience + unassigned visibility */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <CrossAudienceTile
                  data={data.cohortAnalytics.crossAudience}
                  audienceLabels={data.cohortAnalytics.audienceLabels.filter(
                    (a) => a.id !== UNASSIGNED_AUDIENCE_ID
                  )}
                />
                {data.cohortAnalytics.unassignedSize > 0 && (
                  <div className="card stat-card p-5 sm:p-6">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
                      Unassigned customers
                    </p>
                    <p className="text-2xl sm:text-3xl font-bold mt-1">
                      {data.cohortAnalytics.unassignedSize.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-[var(--muted)] mt-1">
                      Customers matching no configured audience. Review audiences in{" "}
                      <a
                        href={`/settings?accountId=${accountId}`}
                        className="text-[var(--accent)] hover:underline"
                      >
                        Settings
                      </a>{" "}
                      if this seems high.
                    </p>
                  </div>
                )}
              </div>

              {selectedAudienceIds.length === 0 ? (
                <div className="card p-8 text-center text-sm text-[var(--muted)]">
                  Pick at least one audience above to see its metrics.
                </div>
              ) : (
                <>
                  <MetricStack
                    label="Cohort retention curves"
                    audienceIds={selectedAudienceIds}
                    audienceLabels={data.cohortAnalytics.audienceLabels}
                    result={data.cohortAnalytics.cohortCurves}
                    render={(slice, audienceId) => (
                      <CohortCurves
                        data={slice}
                        onExport={() =>
                          exportCsv(accountId, "cohort-curves", audienceId)
                        }
                      />
                    )}
                  />

                  <MetricStack
                    label="Time between orders"
                    audienceIds={selectedAudienceIds}
                    audienceLabels={data.cohortAnalytics.audienceLabels}
                    result={data.cohortAnalytics.timeBetweenOrders}
                    render={(slice, audienceId) => (
                      <TimeBetweenOrders
                        data={slice}
                        onExport={() =>
                          exportCsv(accountId, "time-between-orders", audienceId)
                        }
                      />
                    )}
                  />

                  <MetricStack
                    label="First → second order product matrix"
                    audienceIds={selectedAudienceIds}
                    audienceLabels={data.cohortAnalytics.audienceLabels}
                    result={data.cohortAnalytics.firstToSecondMatrix}
                    render={(slice, audienceId) => (
                      <FirstToSecondMatrix
                        data={slice}
                        onExport={() =>
                          exportCsv(accountId, "first-to-second-matrix", audienceId)
                        }
                      />
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <MetricStack
                      label="Order count & AOV"
                      audienceIds={selectedAudienceIds}
                      audienceLabels={data.cohortAnalytics.audienceLabels}
                      result={data.cohortAnalytics.orderCountDistribution}
                      render={(slice, audienceId) => (
                        <OrderCountDistribution
                          data={slice}
                          onExport={() =>
                            exportCsv(accountId, "order-count-distribution", audienceId)
                          }
                        />
                      )}
                    />

                    <MetricStack
                      label="Discount code usage"
                      audienceIds={selectedAudienceIds}
                      audienceLabels={data.cohortAnalytics.audienceLabels}
                      result={data.cohortAnalytics.discountCodeUsage}
                      render={(slice, audienceId) => (
                        <DiscountCodeUsage
                          data={slice}
                          onExport={() =>
                            exportCsv(accountId, "discount-code-usage", audienceId)
                          }
                        />
                      )}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Products */}
      {activeTab === "products" && (
        <div className="space-y-6">
          {data.stickiness && data.stickiness.length > 0 && <StickinessTable data={data.stickiness} />}
          {data.productAffinity && data.productAffinity.length > 0 && <AffinityMatrix data={data.productAffinity} />}
        </div>
      )}

      {/* Explorer */}
      {activeTab === "explorer" && (
        <div className="space-y-6">
          {data.customerJourneys && data.customerJourneys.length > 0 && <JourneyExplorer data={data.customerJourneys} />}
        </div>
      )}

      {/* Chat */}
      <ChatButton isOpen={isChatOpen} onClick={() => setIsChatOpen(!isChatOpen)} />
      {isChatOpen && (
        <ChatPanel
          messages={chat.messages}
          isStreaming={chat.isStreaming}
          error={chat.error}
          onSend={chat.sendMessage}
          onClear={chat.clearMessages}
          onClose={() => setIsChatOpen(false)}
          isMobile={isMobile}
        />
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center"><p className="text-[var(--muted)]">Loading...</p></div>}>
      <DashboardContent />
    </Suspense>
  );
}
