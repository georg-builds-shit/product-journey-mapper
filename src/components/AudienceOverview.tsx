"use client";

interface AudienceOverviewProps {
  audienceLabels: Array<{ id: string; label: string }>;
  cohortCurves: { combined: { totalCustomers: number }; perAudience: Record<string, { totalCustomers: number }> };
  crossAudience: {
    totalRepeatCustomers: number;
    perOriginAudience?: Record<string, { repeatCustomers: number }>;
  };
}

/**
 * Per-audience summary table shown at the top of the Cohorts tab.
 *
 * Columns:
 *  - Audience name
 *  - Customers : buyers (≥1 order) classified to this audience
 *  - Repeat    : ≥2-order customers classified to this audience
 *  - Repeat rate: ratio
 *
 * The "Combined" row at the bottom gives totals across all audiences
 * including Unassigned.
 */
export default function AudienceOverview({
  audienceLabels,
  cohortCurves,
  crossAudience,
}: AudienceOverviewProps) {
  const rows = audienceLabels.map((a) => {
    const customers = cohortCurves.perAudience[a.id]?.totalCustomers ?? 0;
    const repeat = crossAudience.perOriginAudience?.[a.id]?.repeatCustomers ?? 0;
    const repeatRate = customers > 0 ? (repeat / customers) * 100 : 0;
    const isUnassigned = a.id === "unassigned";
    return { id: a.id, label: a.label, customers, repeat, repeatRate, isUnassigned };
  });

  const combinedCustomers = cohortCurves.combined.totalCustomers;
  const combinedRepeat = crossAudience.totalRepeatCustomers;
  const combinedRate = combinedCustomers > 0 ? (combinedRepeat / combinedCustomers) * 100 : 0;

  return (
    <div className="card p-5 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold mb-1">Audience breakdown</h3>
      <p className="text-[11px] text-[var(--muted)] mb-4">
        Customers = buyers with ≥1 order in the lookback window. Repeat = ≥2 orders. Repeat
        rate = repeat ÷ customers.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--card-border)]">
              <th className="text-left py-2 pr-4 text-[11px] font-medium text-[var(--muted)] uppercase tracking-wider">
                Audience
              </th>
              <th className="text-right py-2 px-3 text-[11px] font-medium text-[var(--muted)] uppercase tracking-wider">
                Customers
              </th>
              <th className="text-right py-2 px-3 text-[11px] font-medium text-[var(--muted)] uppercase tracking-wider">
                Repeat
              </th>
              <th className="text-right py-2 pl-3 text-[11px] font-medium text-[var(--muted)] uppercase tracking-wider">
                Repeat rate
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[var(--card-border)]/40">
                <td
                  className={`py-2 pr-4 font-medium ${
                    r.isUnassigned ? "text-[var(--warning)]" : ""
                  }`}
                >
                  {r.label}
                </td>
                <td className="text-right py-2 px-3 tabular-nums">
                  {r.customers.toLocaleString()}
                </td>
                <td className="text-right py-2 px-3 tabular-nums text-[var(--muted)]">
                  {r.repeat.toLocaleString()}
                </td>
                <td className="text-right py-2 pl-3 tabular-nums font-medium">
                  {r.customers === 0 ? "—" : `${r.repeatRate.toFixed(1)}%`}
                </td>
              </tr>
            ))}
            <tr className="border-t border-[var(--card-border)] bg-[var(--card-hover)]/40">
              <td className="py-2 pr-4 font-semibold">Combined</td>
              <td className="text-right py-2 px-3 tabular-nums font-semibold">
                {combinedCustomers.toLocaleString()}
              </td>
              <td className="text-right py-2 px-3 tabular-nums font-semibold">
                {combinedRepeat.toLocaleString()}
              </td>
              <td className="text-right py-2 pl-3 tabular-nums font-semibold">
                {combinedCustomers === 0 ? "—" : `${combinedRate.toFixed(1)}%`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
