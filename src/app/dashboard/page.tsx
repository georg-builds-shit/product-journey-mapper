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

/** Helper: call /api/analyze, return runId if cached, else null */
async function requestAnalysis(
  accountId: string,
  filters?: { dateFrom?: string; dateTo?: string; segmentId?: string }
): Promise<string | null> {
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
  return result.status === "cached" ? result.runId : null;
}

/** Helper: poll /api/analyze/status until complete, return runId */
function pollUntilComplete(
  accountId: string,
  segmentId?: string,
  onStatus?: (s: AnalysisStatus) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ accountId });
    if (segmentId) params.set("segmentId", segmentId);
    const url = `/api/analyze/status?${params}`;

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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      const primaryCached = await requestAnalysis(accountId, {
        dateFrom: filters?.dateFrom,
        dateTo: filters?.dateTo,
        segmentId: filters?.segmentId,
      });

      let primaryRunId = primaryCached;
      if (!primaryRunId) {
        primaryRunId = await pollUntilComplete(accountId, filters?.segmentId, setStatus);
      }

      const primaryData = await fetchDashboardData(primaryRunId);
      setData(primaryData);

      // ── Run comparison analysis (if requested) ──
      if (filters?.compareSegmentId) {
        const compareCached = await requestAnalysis(accountId, {
          dateFrom: filters?.dateFrom,
          dateTo: filters?.dateTo,
          segmentId: filters.compareSegmentId,
        });

        let compareRunId = compareCached;
        if (!compareRunId) {
          compareRunId = await pollUntilComplete(accountId, filters.compareSegmentId);
        }

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
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Product Journey</h1>
          <button onClick={handleReanalyze} className="shrink-0 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)] transition-all">
            Re-analyze
          </button>
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

      <DashboardTabs activeTab={activeTab} onChange={setActiveTab} />

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
