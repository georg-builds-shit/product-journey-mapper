"use client";

interface CohortRow {
  cohortMonth: string;
  cohortSize: number;
  retention: { monthOffset: number; retainedCount: number; retainedPct: number }[];
}

function getCellColor(pct: number): string {
  if (pct >= 40) return "bg-emerald-500/40 text-emerald-200";
  if (pct >= 25) return "bg-emerald-500/25 text-emerald-300";
  if (pct >= 15) return "bg-yellow-500/25 text-yellow-300";
  if (pct >= 5) return "bg-orange-500/20 text-orange-300";
  if (pct > 0) return "bg-red-500/15 text-red-300";
  return "text-[var(--muted)]/40";
}

export default function CohortTable({ data }: { data: CohortRow[] }) {
  if (!data || data.length === 0) return null;

  // Find max month offset across all cohorts
  const maxOffset = Math.max(...data.flatMap((d) => d.retention.map((r) => r.monthOffset)));

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold mb-1">Cohort Retention</h3>
      <p className="text-xs text-[var(--muted)] mb-4">
        % of customers from each cohort who purchased again in subsequent months
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--card-border)]">
              <th className="sticky left-0 bg-[var(--card)] z-10 text-left py-2 pr-4 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Cohort
              </th>
              <th className="text-center py-2 px-2 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Size
              </th>
              {Array.from({ length: maxOffset }, (_, i) => (
                <th
                  key={i}
                  className="text-center py-2 px-2 text-xs font-medium text-[var(--muted)] uppercase tracking-wider"
                >
                  M+{i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.cohortMonth} className="border-b border-[var(--card-border)]/50">
                <td className="sticky left-0 bg-[var(--card)] z-10 py-2 pr-4 font-medium text-[var(--foreground)]">
                  {row.cohortMonth}
                </td>
                <td className="text-center py-2 px-2 text-[var(--muted)]">
                  {row.cohortSize}
                </td>
                {Array.from({ length: maxOffset }, (_, i) => {
                  const retention = row.retention.find((r) => r.monthOffset === i + 1);
                  const pct = retention?.retainedPct ?? 0;
                  return (
                    <td key={i} className="text-center py-2 px-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getCellColor(pct)}`}
                        title={`${retention?.retainedCount ?? 0} customers`}
                      >
                        {pct > 0 ? `${pct.toFixed(0)}%` : "—"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
