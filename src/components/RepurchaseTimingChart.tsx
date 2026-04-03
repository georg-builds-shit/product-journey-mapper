"use client";

import { ResponsiveBar } from "@nivo/bar";

interface RepurchaseTimingBucket {
  label: string;
  count: number;
  pct: number;
}

export default function RepurchaseTimingChart({ data }: { data: RepurchaseTimingBucket[] }) {
  if (!data || data.length === 0) return null;

  const chartData = data.map((d) => ({
    bucket: d.label,
    customers: d.count,
    pct: d.pct,
  }));

  // Find peak bucket for insight
  const peak = data.reduce((max, d) => (d.count > max.count ? d : max), data[0]);

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold mb-1">Time to Second Purchase</h3>
      <p className="text-xs text-[var(--muted)] mb-4">
        Days between 1st and 2nd order · Peak:{" "}
        <span className="text-[var(--foreground)] font-medium">{peak.label}</span> ({peak.pct.toFixed(0)}%)
      </p>
      <div style={{ height: 260 }}>
        <ResponsiveBar
          data={chartData}
          keys={["customers"]}
          indexBy="bucket"
          margin={{ top: 10, right: 10, bottom: 50, left: 40 }}
          padding={0.3}
          colors={["#6366f1"]}
          borderRadius={4}
          axisBottom={{
            tickSize: 0,
            tickPadding: 8,
            tickRotation: -30,
          }}
          axisLeft={{
            tickSize: 0,
            tickPadding: 8,
          }}
          enableLabel={true}
          label={(d) => `${d.value}`}
          labelTextColor="#fff"
          theme={{
            text: { fill: "#94a3b8" },
            axis: { ticks: { text: { fill: "#94a3b8", fontSize: 11 } } },
            grid: { line: { stroke: "#1e293b" } },
            tooltip: {
              container: {
                background: "#1e293b",
                color: "#f8fafc",
                borderRadius: "8px",
                fontSize: "12px",
              },
            },
          }}
          tooltip={({ indexValue, value }) => {
            const bucket = data.find((d) => d.label === indexValue);
            return (
              <div style={{ padding: "6px 10px" }}>
                <strong>{indexValue}</strong>
                <br />
                {value} customers ({bucket?.pct.toFixed(1)}%)
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
