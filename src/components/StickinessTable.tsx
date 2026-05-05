"use client";

interface StickinessItem {
  productName: string;
  category: string | null;
  totalBuyers: number;
  buyersWhoReturnedForAny: number;
  stickinessRate: number;
  /**
   * Wilson 95% CI lower bound (0–100). Sort key — UI uses it to render the
   * "confidence-adjusted" badge, otherwise unchanged from the point estimate.
   */
  wilsonLower?: number;
  avgDaysToReturn: number;
}

interface StickinessTableProps {
  data: StickinessItem[];
  /** Buyer-count floor used by the data layer. Shown in the footnote. */
  minSampleSize?: number;
}

function getRatingColor(rate: number): { bg: string; text: string; fill: string } {
  if (rate >= 80) return { bg: "bg-emerald-500/10", text: "text-emerald-400", fill: "bg-emerald-500" };
  if (rate >= 60) return { bg: "bg-green-500/10", text: "text-green-400", fill: "bg-green-500" };
  if (rate >= 40) return { bg: "bg-yellow-500/10", text: "text-yellow-400", fill: "bg-yellow-500" };
  if (rate >= 20) return { bg: "bg-orange-500/10", text: "text-orange-400", fill: "bg-orange-500" };
  return { bg: "bg-red-500/10", text: "text-red-400", fill: "bg-red-500" };
}

function getRatingLabel(rate: number): string {
  if (rate >= 80) return "Excellent";
  if (rate >= 60) return "Strong";
  if (rate >= 40) return "Moderate";
  if (rate >= 20) return "Weak";
  return "Dead end";
}

export default function StickinessTable({ data, minSampleSize = 50 }: StickinessTableProps) {
  // Empty state: data may be empty because no product clears the buyer floor.
  // Render the card anyway so the user understands why nothing is shown,
  // instead of silently hiding the entire section.
  if (!data || data.length === 0) {
    return (
      <div className="card p-6">
        <div className="mb-3">
          <h2 className="text-lg font-semibold">Product Stickiness</h2>
          <p className="text-xs text-[var(--muted)] mt-1">
            After buying this product, what % of customers place another order?
          </p>
        </div>
        <div className="text-sm text-[var(--muted)] py-6 text-center">
          Not enough data yet — no product has reached {minSampleSize} unique buyers.
          Stickiness will appear here once your top sellers cross that threshold.
        </div>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold">Product Stickiness</h2>
          <p className="text-xs text-[var(--muted)] mt-1">
            After buying this product, what % of customers place another order?
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full data-table">
          <thead>
            <tr>
              <th className="text-left pb-3">Product</th>
              <th className="text-right pb-3 pr-6">Buyers</th>
              <th className="hidden md:table-cell text-right pb-3 pr-6">Returned</th>
              <th className="text-left pb-3 pl-2" style={{ width: 200 }}>Stickiness</th>
              <th className="hidden md:table-cell text-right pb-3 pr-6">Avg return</th>
              <th className="hidden md:table-cell text-left pb-3">Rating</th>
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 15).map((item) => {
              const colors = getRatingColor(item.stickinessRate);
              return (
                <tr key={item.productName} className="group hover:bg-white/[0.02] transition-colors">
                  <td className="py-3 text-sm font-medium max-w-[150px] md:max-w-none truncate">{item.productName}</td>
                  <td className="py-3 text-sm text-[var(--muted)] text-right pr-6 tabular-nums">{item.totalBuyers}</td>
                  <td className="hidden md:table-cell py-3 text-sm text-[var(--muted)] text-right pr-6 tabular-nums">{item.buyersWhoReturnedForAny}</td>
                  <td className="py-3 pl-2">
                    <div className="flex items-center gap-3">
                      <div className="progress-track flex-1">
                        <div
                          className={`progress-fill ${colors.fill}`}
                          style={{ width: `${Math.min(item.stickinessRate, 100)}%` }}
                        />
                      </div>
                      <span className={`text-sm font-semibold tabular-nums w-10 text-right ${colors.text}`}>
                        {item.stickinessRate.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="hidden md:table-cell py-3 text-sm text-[var(--muted)] text-right pr-6 tabular-nums">{item.avgDaysToReturn}d</td>
                  <td className="hidden md:table-cell py-3">
                    <span className={`badge ${colors.bg} ${colors.text}`}>
                      {getRatingLabel(item.stickinessRate)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Footnote: explains the threshold and the ranking choice. Without
          this, a user looking at e.g. "85% > 95%" ranking will assume the
          table is buggy. The Wilson lower bound is the sort key. */}
      <p className="text-[11px] text-[var(--muted)]/70 mt-4 leading-relaxed">
        Showing products with {minSampleSize}+ unique buyers. Ranked by
        confidence-adjusted stickiness (95% Wilson lower bound), so a high
        rate from a small buyer pool doesn&apos;t outrank a slightly lower
        rate backed by hundreds of buyers.
      </p>
    </div>
  );
}
