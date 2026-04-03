"use client";

interface ProductAffinityResult {
  productA: string;
  productB: string;
  coPurchaseCount: number;
  productACount: number;
  productBCount: number;
  lift: number;
}

function getLiftBadge(lift: number): { label: string; className: string } {
  if (lift >= 3) return { label: "Very Strong", className: "bg-emerald-500/20 text-emerald-400" };
  if (lift >= 2) return { label: "Strong", className: "bg-emerald-500/15 text-emerald-400" };
  if (lift >= 1.5) return { label: "Moderate", className: "bg-yellow-500/15 text-yellow-400" };
  if (lift >= 1) return { label: "Weak", className: "bg-orange-500/15 text-orange-400" };
  return { label: "Negative", className: "bg-red-500/15 text-red-400" };
}

export default function AffinityMatrix({ data }: { data: ProductAffinityResult[] }) {
  if (!data || data.length === 0) return null;

  // Show top 20 pairs
  const topPairs = data.slice(0, 20);

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold mb-1">Product Affinity</h3>
      <p className="text-xs text-[var(--muted)] mb-4">
        Products frequently bought by the same customer · Lift &gt; 1 = stronger than random
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--card-border)]">
              <th className="text-left py-2 pr-3 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Product A
              </th>
              <th className="text-left py-2 pr-3 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Product B
              </th>
              <th className="hidden md:table-cell text-center py-2 px-2 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Co-purchases
              </th>
              <th className="text-center py-2 px-2 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Lift
              </th>
              <th className="text-center py-2 px-2 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Strength
              </th>
            </tr>
          </thead>
          <tbody>
            {topPairs.map((pair, i) => {
              const badge = getLiftBadge(pair.lift);
              return (
                <tr key={i} className="border-b border-[var(--card-border)]/50">
                  <td className="py-2 pr-3 text-[var(--foreground)] max-w-[120px] truncate">{pair.productA}</td>
                  <td className="py-2 pr-3 text-[var(--foreground)] max-w-[120px] truncate">{pair.productB}</td>
                  <td className="hidden md:table-cell text-center py-2 px-2 text-[var(--muted)]">
                    {pair.coPurchaseCount}
                  </td>
                  <td className="text-center py-2 px-2 font-medium">{pair.lift}x</td>
                  <td className="text-center py-2 px-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${badge.className}`}>
                      {badge.label}
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
