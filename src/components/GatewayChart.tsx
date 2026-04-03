"use client";

import { ResponsiveBar } from "@nivo/bar";

interface Gateway {
  productName: string;
  firstPurchaseCount: number;
  firstPurchasePct: number;
  avgLtvAfter: number;
  avgOrdersAfter: number;
}

interface GatewayChartProps {
  gateways: Gateway[];
}

export default function GatewayChart({ gateways }: GatewayChartProps) {
  if (gateways.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 rounded-lg border border-dashed border-[var(--card-border)]">
        <p className="text-[var(--muted)]">No gateway product data</p>
      </div>
    );
  }

  const chartData = gateways.slice(0, 8).map((g) => ({
    product: g.productName.length > 20 ? g.productName.slice(0, 18) + "..." : g.productName,
    "First Purchases": g.firstPurchaseCount,
    "Avg LTV": Math.round(g.avgLtvAfter),
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveBar
        data={chartData}
        keys={["First Purchases"]}
        indexBy="product"
        margin={{ top: 8, right: 16, bottom: 70, left: 50 }}
        padding={0.35}
        colors={["#6366f1"]}
        borderRadius={6}
        axisBottom={{
          tickRotation: -45,
          tickSize: 0,
          tickPadding: 8,
        }}
        axisLeft={{
          tickSize: 0,
          tickPadding: 8,
        }}
        labelSkipWidth={12}
        labelSkipHeight={12}
        labelTextColor="#fff"
        enableGridY={false}
        tooltip={({ data }) => (
          <div style={{
            background: "#1c1c21",
            color: "#e4e4e7",
            borderRadius: "8px",
            border: "1px solid #27272a",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            fontSize: "13px",
            padding: "8px 12px",
          }}>
            <strong>{data.product}</strong>
            <div style={{ color: "#a1a1aa", marginTop: 2 }}>{data["First Purchases"]} first purchases</div>
            <div style={{ color: "#a1a1aa" }}>Avg LTV: ${data["Avg LTV"]}</div>
          </div>
        )}
        theme={{
          axis: {
            ticks: {
              text: { fill: "#71717a", fontSize: 11 },
            },
          },
          grid: {
            line: { stroke: "#27272a" },
          },
        }}
      />
    </div>
  );
}
