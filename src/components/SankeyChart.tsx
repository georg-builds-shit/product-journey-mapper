"use client";

import { useState, useEffect } from "react";
import { ResponsiveSankey } from "@nivo/sankey";
import { useIsMobile } from "@/hooks/useIsMobile";

interface Transition {
  fromProduct: string;
  toProduct: string;
  transitionCount: number;
  step: number;
}

interface SankeyChartProps {
  transitions: Transition[];
  viewMode: "product" | "category";
}

/**
 * For products that appear at non-adjacent steps (e.g., step 1 and step 4),
 * add synthetic pass-through transitions so d3-sankey places them in the
 * correct columns and there are no visual jumps.
 *
 * Without this, a product with no incoming links at step 4 would be treated
 * as a source node and placed in column 0 (leftmost) by d3-sankey's layout.
 */
function addPassthroughs(transitions: Transition[]): Transition[] {
  // Map product name → set of column indices it appears in
  const productColumns = new Map<string, Set<number>>();

  const mark = (product: string, col: number) => {
    if (!productColumns.has(product)) productColumns.set(product, new Set());
    productColumns.get(product)!.add(col);
  };

  for (const t of transitions) {
    mark(t.fromProduct, t.step);       // source node lives at column t.step
    mark(t.toProduct, t.step + 1);     // target node lives at column t.step + 1
  }

  const synthetics: Transition[] = [];

  for (const [product, colSet] of productColumns) {
    const cols = Array.from(colSet).sort((a, b) => a - b);

    for (let i = 0; i < cols.length - 1; i++) {
      const colA = cols[i];
      const colB = cols[i + 1];

      if (colB === colA + 1) continue; // already adjacent — no gap to fill

      // Bridge the gap: add a chain colA → colA+1 → … → colB
      for (let s = colA; s <= colB - 1; s++) {
        synthetics.push({
          fromProduct: product,
          toProduct: product,
          transitionCount: 1,
          step: s,
        });
      }
    }
  }

  return [...transitions, ...synthetics];
}

function buildSankeyData(transitions: Transition[]) {
  const augmented = addPassthroughs(transitions);

  const nodeSet = new Set<string>();
  const links: { source: string; target: string; value: number }[] = [];

  for (const t of augmented) {
    const sourceId = `s${t.step}_${t.fromProduct}`;
    const targetId = `s${t.step + 1}_${t.toProduct}`;

    nodeSet.add(sourceId);
    nodeSet.add(targetId);

    links.push({
      source: sourceId,
      target: targetId,
      value: t.transitionCount,
    });
  }

  const nodes = Array.from(nodeSet).map((id) => ({
    id,
    label: id.replace(/^s\d+_/, ""),
  }));

  return { nodes, links };
}

const SANKEY_COLORS = [
  "#6366f1", "#8b5cf6", "#a78bfa", "#c084fc",
  "#22c55e", "#4ade80", "#86efac",
  "#f59e0b", "#fbbf24", "#fcd34d",
  "#ef4444", "#f87171",
  "#06b6d4", "#22d3ee",
  "#ec4899", "#f472b6",
];

const LIMIT_OPTIONS = [
  { value: 5, label: "Top 5" },
  { value: 10, label: "Top 10" },
  { value: 20, label: "Top 20" },
  { value: 0, label: "All" },
];

export default function SankeyChart({ transitions, viewMode }: SankeyChartProps) {
  const isMobile = useIsMobile();
  const [limitPerStep, setLimitPerStep] = useState(10);

  // Default to Top 5 on mobile for a less cramped chart
  useEffect(() => {
    if (isMobile) setLimitPerStep(5);
  }, [isMobile]);

  if (transitions.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 rounded-lg border border-dashed border-[var(--card-border)]">
        <p className="text-[var(--muted)]">Not enough data to display product flows</p>
      </div>
    );
  }

  // Group by step and apply limit
  const transitionsByStep = new Map<number, Transition[]>();
  for (const t of transitions) {
    const existing = transitionsByStep.get(t.step) || [];
    existing.push(t);
    transitionsByStep.set(t.step, existing);
  }

  const filteredTransitions: Transition[] = [];
  for (let step = 1; step <= 5; step++) {
    const stepTransitions = transitionsByStep.get(step) || [];
    // Sort by count descending within step
    stepTransitions.sort((a, b) => b.transitionCount - a.transitionCount);
    if (limitPerStep === 0) {
      filteredTransitions.push(...stepTransitions);
    } else {
      filteredTransitions.push(...stepTransitions.slice(0, limitPerStep));
    }
  }

  const data = buildSankeyData(filteredTransitions);

  // Dynamic height based on number of nodes
  const nodeCount = data.nodes.length;
  const chartHeight = Math.max(500, Math.min(1200, nodeCount * 28));

  return (
    <div style={{ minWidth: isMobile ? "700px" : undefined }}>
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-end gap-2 mb-3">
        <span className="text-xs text-[var(--muted)]">Per step:</span>
        <div className="toggle-group flex">
          {LIMIT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setLimitPerStep(opt.value)}
              className={`toggle-item text-xs !px-2.5 !py-1 ${
                limitPerStep === opt.value ? "active" : ""
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ height: `${chartHeight}px` }} className="w-full">
        <ResponsiveSankey
          data={data}
          margin={isMobile ? { top: 16, right: 120, bottom: 16, left: 120 } : { top: 20, right: 140, bottom: 20, left: 140 }}
          align="justify"
          colors={SANKEY_COLORS}
          nodeOpacity={1}
          nodeHoverOthersOpacity={0.15}
          nodeThickness={16}
          nodeSpacing={20}
          nodeBorderWidth={0}
          nodeBorderRadius={4}
          linkOpacity={isMobile ? 0.7 : 0.3}
          linkHoverOpacity={0.6}
          linkHoverOthersOpacity={0.05}
          linkContract={isMobile ? 0 : 3}
          linkBlendMode={isMobile ? "normal" : "screen"}
          enableLinkGradient={!isMobile}
          label={(node) => (node as any).label || node.id.replace(/^s\d+_/, "")}
          labelPosition="outside"
          labelOrientation="horizontal"
          labelPadding={12}
          labelTextColor="#a1a1aa"
          theme={{
            tooltip: {
              container: {
                background: "#1c1c21",
                color: "#e4e4e7",
                borderRadius: "8px",
                border: "1px solid #27272a",
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                fontSize: "13px",
                padding: "8px 12px",
              },
            },
          }}
        />
      </div>
    </div>
  );
}
