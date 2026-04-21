"use client";

interface CrossChannelData {
  totalRepeatCustomers: number;
  crossChannelCount: number;
  crossChannelPct: number;
  perOriginChannel?: Record<
    string,
    { repeatCustomers: number; crossCount: number; crossPct: number }
  >;
}

interface ChannelLabel {
  id: string;
  label: string;
}

export default function CrossChannelTile({
  data,
  channelLabels,
}: {
  data: CrossChannelData | null | undefined;
  channelLabels: ChannelLabel[];
}) {
  if (!data || channelLabels.length === 0) {
    return (
      <div className="card stat-card p-5 sm:p-6">
        <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
          Cross-channel customers
        </p>
        <p className="text-2xl font-bold mt-1">—</p>
        <p className="text-[11px] text-[var(--muted)] mt-1">
          Requires at least 2 configured channels. Add channels in Settings to enable this
          metric.
        </p>
      </div>
    );
  }

  const perOrigin = data.perOriginChannel || {};

  return (
    <div className="card stat-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
            Cross-channel customers
          </p>
          <p className="text-2xl sm:text-3xl font-bold mt-1">
            {data.crossChannelPct.toFixed(1)}%
          </p>
          <p className="text-[11px] text-[var(--muted)] mt-1">
            {data.crossChannelCount.toLocaleString()} of{" "}
            {data.totalRepeatCustomers.toLocaleString()} repeat customers match more than one
            channel definition.
          </p>
        </div>
      </div>

      {Object.keys(perOrigin).length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--card-border)] space-y-1">
          {channelLabels.map((ch) => {
            const row = perOrigin[ch.id];
            if (!row || row.repeatCustomers === 0) return null;
            return (
              <div
                key={ch.id}
                className="flex items-center justify-between text-[11px] text-[var(--muted)]"
              >
                <span>{ch.label}</span>
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
