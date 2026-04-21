"use client";

interface DistributionRow {
  bucket: string; // "1" | "2" | "3" | "4+"
  count: number;
  pct: number;
}
interface AovRow {
  orderNumber: string;
  mean: number;
  median: number;
  sampleSize: number;
}

interface OrderCountDistributionData {
  distribution: DistributionRow[];
  aovByOrderNumber: AovRow[];
  totalCustomers: number;
}

function formatCurrency(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "—";
  return `$${v.toFixed(2)}`;
}

export default function OrderCountDistribution({
  data,
  onExport,
}: {
  data: OrderCountDistributionData | null | undefined;
  onExport?: () => void;
}) {
  if (!data || data.totalCustomers === 0) {
    return (
      <div className="card p-5 sm:p-6">
        <h3 className="text-base sm:text-lg font-semibold">
          Order count distribution &amp; AOV
        </h3>
        <p className="text-sm text-[var(--muted)] mt-2">No customers in this channel.</p>
      </div>
    );
  }

  const maxPct = Math.max(...data.distribution.map((d) => d.pct), 1);

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h3 className="text-base sm:text-lg font-semibold">
            Order count distribution &amp; AOV
          </h3>
          <p className="text-[11px] text-[var(--muted)] mt-0.5">
            % of customers by total order count, with AOV at each position.
            n={data.totalCustomers.toLocaleString()}.
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <p className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider mb-2">
            Customer order count
          </p>
          <div className="space-y-1.5">
            {data.distribution.map((row) => (
              <div key={row.bucket} className="flex items-center gap-3">
                <span className="text-xs font-medium w-8 text-[var(--muted)]">
                  {row.bucket}
                </span>
                <div className="flex-1 h-4 bg-[var(--card-border)]/40 rounded overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[var(--accent)] to-indigo-400 transition-all"
                    style={{ width: `${(row.pct / maxPct) * 100}%` }}
                  />
                </div>
                <span className="text-xs tabular-nums w-20 text-right">
                  {row.pct.toFixed(1)}%
                </span>
                <span className="text-[10px] text-[var(--muted)] tabular-nums w-14 text-right">
                  {row.count.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider mb-2">
            AOV by order number
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--card-border)]">
                <th className="text-left py-1.5 text-[10px] font-medium text-[var(--muted)] uppercase">
                  Order #
                </th>
                <th className="text-right py-1.5 text-[10px] font-medium text-[var(--muted)] uppercase">
                  Mean
                </th>
                <th className="text-right py-1.5 text-[10px] font-medium text-[var(--muted)] uppercase">
                  Median
                </th>
                <th className="text-right py-1.5 text-[10px] font-medium text-[var(--muted)] uppercase">
                  n
                </th>
              </tr>
            </thead>
            <tbody>
              {data.aovByOrderNumber.map((row) => (
                <tr key={row.orderNumber} className="border-b border-[var(--card-border)]/40">
                  <td className="py-1.5 font-medium">{row.orderNumber}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatCurrency(row.mean)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatCurrency(row.median)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-[var(--muted)]">
                    {row.sampleSize.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
