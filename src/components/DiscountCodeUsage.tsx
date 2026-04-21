"use client";

interface DiscountCodeUsageData {
  available: boolean;
  firstOrderWithCodePct: number;
  firstOrderWithoutCodePct: number;
  repeatRateWithCode: number;
  repeatRateWithoutCode: number;
  sampleWithCode: number;
  sampleWithoutCode: number;
}

export default function DiscountCodeUsage({
  data,
  onExport,
}: {
  data: DiscountCodeUsageData | null | undefined;
  onExport?: () => void;
}) {
  if (!data) {
    return (
      <div className="card p-5 sm:p-6">
        <h3 className="text-base sm:text-lg font-semibold">First-order discount code usage</h3>
        <p className="text-sm text-[var(--muted)] mt-2">No data.</p>
      </div>
    );
  }

  if (!data.available) {
    return (
      <div className="card p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base sm:text-lg font-semibold">
              First-order discount code usage
            </h3>
            <p className="text-xs text-[var(--muted)] mt-1">
              Discount code data not available in your Klaviyo Ordered Product events (&lt; 5%
              of first orders carry a code). If this is unexpected, verify with your Klaviyo
              integration owner whether the <code>DiscountCode</code>, <code>PromoCode</code>,
              or <code>discount_codes[]</code> field is populated on Placed Order events.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const lift = data.repeatRateWithCode - data.repeatRateWithoutCode;
  const liftColor =
    lift > 0 ? "text-[var(--success)]" : lift < 0 ? "text-[var(--danger)]" : "text-[var(--muted)]";

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h3 className="text-base sm:text-lg font-semibold">First-order discount code usage</h3>
          <p className="text-[11px] text-[var(--muted)] mt-0.5">
            Repeat rate (≥2 orders within 365d) for customers who used / didn&apos;t use a code
            on their first order.
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-lg border border-[var(--card-border)] p-4">
          <p className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider">
            Used a code
          </p>
          <p className="text-2xl font-bold mt-1">{data.repeatRateWithCode.toFixed(1)}%</p>
          <p className="text-[11px] text-[var(--muted)] mt-1">
            repeat rate · {data.firstOrderWithCodePct.toFixed(0)}% of first orders · n=
            {data.sampleWithCode.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--card-border)] p-4">
          <p className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider">
            No code
          </p>
          <p className="text-2xl font-bold mt-1">{data.repeatRateWithoutCode.toFixed(1)}%</p>
          <p className="text-[11px] text-[var(--muted)] mt-1">
            repeat rate · {data.firstOrderWithoutCodePct.toFixed(0)}% of first orders · n=
            {data.sampleWithoutCode.toLocaleString()}
          </p>
        </div>
      </div>

      <p className={`text-xs mt-3 font-medium ${liftColor}`}>
        {lift > 0 ? "+" : ""}
        {lift.toFixed(1)}pp repeat-rate difference for code users.
      </p>
    </div>
  );
}
