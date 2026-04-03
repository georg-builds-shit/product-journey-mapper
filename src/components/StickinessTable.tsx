"use client";

interface StickinessItem {
  productName: string;
  category: string | null;
  totalBuyers: number;
  buyersWhoReturnedForAny: number;
  stickinessRate: number;
  avgDaysToReturn: number;
}

interface StickinessTableProps {
  data: StickinessItem[];
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

export default function StickinessTable({ data }: StickinessTableProps) {
  if (!data || data.length === 0) return null;

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
              <th className="hidden md:table-cell text-right pb-3 pr-6">Buyers</th>
              <th className="hidden md:table-cell text-right pb-3 pr-6">Returned</th>
              <th className="text-left pb-3 pl-2" style={{ width: 200 }}>Stickiness</th>
              <th className="text-right pb-3 pr-6">Avg return</th>
              <th className="hidden md:table-cell text-left pb-3">Rating</th>
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 15).map((item) => {
              const colors = getRatingColor(item.stickinessRate);
              return (
                <tr key={item.productName} className="group hover:bg-white/[0.02] transition-colors">
                  <td className="py-3 text-sm font-medium max-w-[150px] md:max-w-none truncate">{item.productName}</td>
                  <td className="hidden md:table-cell py-3 text-sm text-[var(--muted)] text-right pr-6">{item.totalBuyers}</td>
                  <td className="hidden md:table-cell py-3 text-sm text-[var(--muted)] text-right pr-6">{item.buyersWhoReturnedForAny}</td>
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
                  <td className="py-3 text-sm text-[var(--muted)] text-right pr-6 tabular-nums">{item.avgDaysToReturn}d</td>
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
    </div>
  );
}
