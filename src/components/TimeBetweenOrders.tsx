"use client";

interface HistogramBucket {
  label: string;
  minDays: number;
  maxDays: number;
  count: number;
  pct: number;
}

interface TimeBetweenOrdersBucket {
  n: number;
  sampleSize: number;
  median: number;
  p25: number;
  p75: number;
  p90: number;
  histogram: HistogramBucket[];
}

interface TimeBetweenOrdersData {
  perN: TimeBetweenOrdersBucket[];
  totalCustomers: number;
}

function formatDays(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v < 1) return `${(v * 24).toFixed(1)}h`;
  return `${v.toFixed(1)}d`;
}

function PercentileBadge({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider">
        {label}
      </span>
      <span className="text-sm font-semibold">{formatDays(value)}</span>
    </div>
  );
}

function Histogram({ bucket }: { bucket: TimeBetweenOrdersBucket }) {
  const max = Math.max(1, ...bucket.histogram.map((b) => b.count));
  return (
    <div className="flex items-end gap-1 h-20 mt-2">
      {bucket.histogram.map((b) => (
        <div key={b.label} className="flex flex-col items-center flex-1 gap-1" title={`${b.label}: ${b.count} (${b.pct.toFixed(1)}%)`}>
          <div
            className="w-full bg-[var(--accent)]/40 hover:bg-[var(--accent)]/70 rounded-sm transition-all"
            style={{ height: `${(b.count / max) * 100}%` }}
          />
          <span className="text-[9px] text-[var(--muted)] text-center leading-tight">
            {b.label.replace(" days", "d")}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function TimeBetweenOrders({
  data,
  onExport,
}: {
  data: TimeBetweenOrdersData | null | undefined;
  onExport?: () => void;
}) {
  if (!data || data.perN.every((p) => p.sampleSize === 0)) {
    return (
      <div className="card p-5 sm:p-6">
        <h3 className="text-base sm:text-lg font-semibold">Time between orders</h3>
        <p className="text-sm text-[var(--muted)] mt-2">
          Not enough repeat customers to compute order-to-order timing.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h3 className="text-base sm:text-lg font-semibold">Time between orders</h3>
          <p className="text-[11px] text-[var(--muted)] mt-0.5">
            Days between orders N and N+1. Percentiles + histogram.
          </p>
        </div>
        {onExport && (
          <button
            onClick={onExport}
            className="px-2.5 py-1 text-xs rounded border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-all"
          >
            CSV
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {data.perN.map((bucket) => (
          <div
            key={bucket.n}
            className="rounded-lg border border-[var(--card-border)] p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium">
                {bucket.n} → {bucket.n + 1}
              </span>
              <span className="text-[10px] text-[var(--muted)]">
                n={bucket.sampleSize.toLocaleString()}
              </span>
            </div>
            {bucket.sampleSize === 0 ? (
              <p className="text-xs text-[var(--muted)] italic py-4 text-center">
                No customers reached this step.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-2">
                  <PercentileBadge label="p25" value={bucket.p25} />
                  <PercentileBadge label="median" value={bucket.median} />
                  <PercentileBadge label="p75" value={bucket.p75} />
                  <PercentileBadge label="p90" value={bucket.p90} />
                </div>
                <Histogram bucket={bucket} />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
