"use client";

interface CrossAudienceData {
  totalRepeatCustomers: number;
  crossAudienceCount: number;
  crossAudiencePct: number;
  perOriginAudience?: Record<
    string,
    { repeatCustomers: number; crossCount: number; crossPct: number }
  >;
}

interface AudienceLabel {
  id: string;
  label: string;
}

export default function CrossAudienceTile({
  data,
  audienceLabels,
}: {
  data: CrossAudienceData | null | undefined;
  audienceLabels: AudienceLabel[];
}) {
  if (!data || audienceLabels.length === 0) {
    return (
      <div className="card stat-card p-5 sm:p-6">
        <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
          Cross-audience customers
        </p>
        <p className="text-2xl font-bold mt-1">—</p>
        <p className="text-[11px] text-[var(--muted)] mt-1">
          Requires at least 2 configured audiences. Add audiences in Settings to enable this
          metric.
        </p>
      </div>
    );
  }

  const perOrigin = data.perOriginAudience || {};

  return (
    <div className="card stat-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
            Cross-audience customers
          </p>
          <p className="text-2xl sm:text-3xl font-bold mt-1">
            {data.crossAudiencePct.toFixed(1)}%
          </p>
          <p className="text-[11px] text-[var(--muted)] mt-1">
            {data.crossAudienceCount.toLocaleString()} of{" "}
            {data.totalRepeatCustomers.toLocaleString()} repeat customers match more than one
            audience definition.
          </p>
        </div>
      </div>

      {Object.keys(perOrigin).length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--card-border)] space-y-1">
          {audienceLabels.map((a) => {
            const row = perOrigin[a.id];
            if (!row || row.repeatCustomers === 0) return null;
            return (
              <div
                key={a.id}
                className="flex items-center justify-between text-[11px] text-[var(--muted)]"
              >
                <span>{a.label}</span>
                <span className="tabular-nums">
                  {row.crossCount.toLocaleString()} / {row.repeatCustomers.toLocaleString()} (
                  {row.crossPct.toFixed(1)}%)
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
