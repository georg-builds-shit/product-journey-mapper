"use client";

interface MatrixCell {
  count: number;
  pct: number;
}

interface FirstToSecondMatrixData {
  rowLabels: string[];
  colLabels: string[];
  cells: MatrixCell[][];
  totalRepeaters: number;
}

function cellColor(pct: number, onDiagonal: boolean): string {
  // Diagonal (replenishment) vs off-diagonal (cross-shop) visually distinct
  if (pct >= 40) return onDiagonal ? "bg-emerald-500/40 text-emerald-200" : "bg-indigo-500/40 text-indigo-200";
  if (pct >= 25) return onDiagonal ? "bg-emerald-500/25 text-emerald-200" : "bg-indigo-500/25 text-indigo-200";
  if (pct >= 15) return onDiagonal ? "bg-emerald-500/15 text-emerald-200" : "bg-indigo-500/15 text-indigo-200";
  if (pct >= 5) return "bg-yellow-500/15 text-yellow-200";
  if (pct > 0) return "bg-orange-500/10 text-orange-200";
  return "text-[var(--muted)]/30";
}

export default function FirstToSecondMatrix({
  data,
  onExport,
}: {
  data: FirstToSecondMatrixData | null | undefined;
  onExport?: () => void;
}) {
  if (!data || data.rowLabels.length === 0) {
    return (
      <div className="card p-5 sm:p-6">
        <h3 className="text-base sm:text-lg font-semibold">First → second order product matrix</h3>
        <p className="text-sm text-[var(--muted)] mt-2">
          No repeat customers to display. Diagonal would show replenishment rates, off-diagonal
          would show cross-shopping.
        </p>
      </div>
    );
  }

  // Truncate long labels
  const truncate = (s: string, n = 18) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h3 className="text-base sm:text-lg font-semibold">
            First → second order product matrix
          </h3>
          <p className="text-[11px] text-[var(--muted)] mt-0.5">
            % of row-first-buyers whose second order included each column product. Green diagonal
            = replenishment, purple off-diagonal = cross-shop. n=
            {data.totalRepeaters.toLocaleString()}.
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

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--card-border)]">
              <th className="sticky left-0 bg-[var(--card)] z-10 text-left py-2 pr-4 text-[11px] font-medium text-[var(--muted)] uppercase tracking-wider">
                1st order ↓ / 2nd →
              </th>
              {data.colLabels.map((col) => (
                <th
                  key={col}
                  className="text-center py-2 px-2 text-[10px] font-medium text-[var(--muted)] tracking-wider min-w-[68px]"
                  title={col}
                >
                  {truncate(col, 14)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rowLabels.map((row, rIdx) => (
              <tr key={row} className="border-b border-[var(--card-border)]/50">
                <td
                  className="sticky left-0 bg-[var(--card)] z-10 py-1.5 pr-4 font-medium max-w-[180px] truncate"
                  title={row}
                >
                  {truncate(row, 22)}
                </td>
                {data.cells[rIdx].map((cell, cIdx) => {
                  const onDiag = data.rowLabels[rIdx] === data.colLabels[cIdx];
                  return (
                    <td key={cIdx} className="text-center py-1.5 px-1">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${cellColor(cell.pct, onDiag)}`}
                        title={`${cell.count} customers`}
                      >
                        {cell.pct > 0 ? `${cell.pct.toFixed(0)}%` : "—"}
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
