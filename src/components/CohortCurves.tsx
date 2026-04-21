"use client";

import { useState } from "react";

interface CohortCurveOrderCut {
  n: number;
  by30d: number;
  by60d: number;
  by90d: number;
  by180d: number;
  by365d: number;
}
interface CohortCurveRow {
  cohortLabel: string;
  cohortSize: number;
  byOrderN: CohortCurveOrderCut[];
}
interface CohortCurvesData {
  rows: CohortCurveRow[];
  totalCustomers: number;
}

function cellColor(pct: number): string {
  if (pct >= 40) return "bg-emerald-500/40 text-emerald-200";
  if (pct >= 25) return "bg-emerald-500/25 text-emerald-200";
  if (pct >= 15) return "bg-yellow-500/25 text-yellow-200";
  if (pct >= 5) return "bg-orange-500/20 text-orange-200";
  if (pct > 0) return "bg-red-500/15 text-red-200";
  return "text-[var(--muted)]/40";
}

const DAY_CUTS = [
  { key: "by30d", label: "30d" },
  { key: "by60d", label: "60d" },
  { key: "by90d", label: "90d" },
  { key: "by180d", label: "180d" },
  { key: "by365d", label: "365d" },
] as const;

export default function CohortCurves({
  data,
  onExport,
}: {
  data: CohortCurvesData | null | undefined;
  onExport?: () => void;
}) {
  const [orderN, setOrderN] = useState<2 | 3 | 4>(2);

  if (!data || data.rows.length === 0) {
    return (
      <div className="card p-5 sm:p-6">
        <h3 className="text-base sm:text-lg font-semibold">Cohort retention curves</h3>
        <p className="text-sm text-[var(--muted)] mt-2">
          No cohorts to display. Need customers with repeat orders within the lookback window.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h3 className="text-base sm:text-lg font-semibold">Cohort retention curves</h3>
          <p className="text-[11px] text-[var(--muted)] mt-0.5">
            % of each cohort with ≥ {orderN} order{orderN > 1 ? "s" : ""} by day N. n=
            {data.totalCustomers.toLocaleString()}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="toggle-group flex">
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setOrderN(n as 2 | 3 | 4)}
                className={`toggle-item ${orderN === n ? "active" : ""}`}
              >
                {n}+ orders
              </button>
            ))}
          </div>
          {onExport && (
            <button
              onClick={onExport}
              className="px-2.5 py-1 text-xs rounded border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-all"
              title="Export CSV"
            >
              CSV
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--card-border)]">
              <th className="sticky left-0 bg-[var(--card)] z-10 text-left py-2 pr-4 text-[11px] font-medium text-[var(--muted)] uppercase tracking-wider">
                Cohort
              </th>
              <th className="text-center py-2 px-2 text-[11px] font-medium text-[var(--muted)] uppercase tracking-wider">
                Size
              </th>
              {DAY_CUTS.map((d) => (
                <th
                  key={d.key}
                  className="text-center py-2 px-2 text-[11px] font-medium text-[var(--muted)] uppercase tracking-wider"
                >
                  ≤{d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const cuts = row.byOrderN.find((o) => o.n === orderN);
              return (
                <tr key={row.cohortLabel} className="border-b border-[var(--card-border)]/50">
                  <td className="sticky left-0 bg-[var(--card)] z-10 py-2 pr-4 font-medium">
                    {row.cohortLabel}
                  </td>
                  <td className="text-center py-2 px-2 text-[var(--muted)]">{row.cohortSize}</td>
                  {DAY_CUTS.map((d) => {
                    const pct = (cuts?.[d.key] ?? 0) as number;
                    return (
                      <td key={d.key} className="text-center py-2 px-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cellColor(pct)}`}
                        >
                          {pct > 0 ? `${pct.toFixed(1)}%` : "—"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
