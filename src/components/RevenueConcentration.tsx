"use client";

interface RevenueConcentrationData {
  oneTimeCustomers: number;
  repeatCustomers: number;
  oneTimeRevenue: number;
  repeatRevenue: number;
  oneTimeRevenuePct: number;
  repeatRevenuePct: number;
  top10PctCustomerRevenuePct: number;
}

export default function RevenueConcentration({ data }: { data: RevenueConcentrationData }) {
  if (!data) return null;

  const totalRevenue = data.oneTimeRevenue + data.repeatRevenue;

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold mb-1">Revenue Concentration</h3>
      <p className="text-xs text-[var(--muted)] mb-4">
        Where does your revenue come from?
      </p>

      {/* Revenue split bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-[var(--muted)] mb-1.5">
          <span>One-time ({data.oneTimeRevenuePct.toFixed(0)}%)</span>
          <span>Repeat ({data.repeatRevenuePct.toFixed(0)}%)</span>
        </div>
        <div className="h-3 rounded-full overflow-hidden flex bg-[var(--card-border)]">
          <div
            className="bg-orange-400/70 transition-all"
            style={{ width: `${data.oneTimeRevenuePct}%` }}
          />
          <div
            className="bg-emerald-500/70 transition-all"
            style={{ width: `${data.repeatRevenuePct}%` }}
          />
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <p className="text-lg font-bold">${(data.repeatRevenue / 1000).toFixed(1)}k</p>
          <p className="text-[10px] text-[var(--muted)] uppercase tracking-wider">Repeat Revenue</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold">${(data.oneTimeRevenue / 1000).toFixed(1)}k</p>
          <p className="text-[10px] text-[var(--muted)] uppercase tracking-wider">One-time Revenue</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold">{data.top10PctCustomerRevenuePct.toFixed(0)}%</p>
          <p className="text-[10px] text-[var(--muted)] uppercase tracking-wider">From top 10% customers</p>
        </div>
      </div>
    </div>
  );
}
