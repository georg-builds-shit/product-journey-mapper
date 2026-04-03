"use client";

import { useState } from "react";

interface CustomerJourney {
  profileId: string;
  orderCount: number;
  totalRevenue: number;
  firstOrderDate: string;
  lastOrderDate: string;
  products: string[];
  journey: Array<{ date: string; products: string[]; value: number }>;
}

export default function JourneyExplorer({ data }: { data: CustomerJourney[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  if (!data || data.length === 0) return null;

  const filtered = search
    ? data.filter(
        (d) =>
          d.profileId.toLowerCase().includes(search.toLowerCase()) ||
          d.products.some((p) => p.toLowerCase().includes(search.toLowerCase()))
      )
    : data;

  return (
    <div className="card p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Customer Journeys</h3>
          <p className="text-xs text-[var(--muted)]">
            Top {data.length} repeat customers by revenue · Click to expand
          </p>
        </div>
        <input
          type="text"
          placeholder="Search products or IDs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] w-full md:w-56"
        />
      </div>

      <div className="space-y-1 max-h-[500px] overflow-y-auto">
        {filtered.slice(0, 50).map((customer) => (
          <div key={customer.profileId}>
            <button
              onClick={() =>
                setExpandedId(expandedId === customer.profileId ? null : customer.profileId)
              }
              className="w-full flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-[var(--card-border)]/30 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <svg
                  className={`w-3 h-3 text-[var(--muted)] transition-transform ${
                    expandedId === customer.profileId ? "rotate-90" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-sm font-mono text-[var(--muted)]">
                  {customer.profileId.slice(0, 8)}...
                </span>
                <span className="text-sm">
                  {customer.products.slice(0, 3).join(" → ")}
                  {customer.products.length > 3 && ` +${customer.products.length - 3}`}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs text-[var(--muted)]">
                <span>{customer.orderCount} orders</span>
                <span className="font-medium text-[var(--foreground)]">
                  ${customer.totalRevenue.toFixed(0)}
                </span>
              </div>
            </button>

            {expandedId === customer.profileId && (
              <div className="ml-9 mb-2 pl-4 border-l-2 border-[var(--card-border)]">
                {customer.journey.map((step, i) => (
                  <div key={i} className="flex items-start gap-3 py-1.5">
                    <div className="flex-shrink-0 w-2 h-2 rounded-full bg-[var(--accent)] mt-1.5" />
                    <div>
                      <p className="text-xs text-[var(--muted)]">
                        {new Date(step.date).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}{" "}
                        · ${step.value.toFixed(2)}
                      </p>
                      <p className="text-sm">{step.products.join(", ")}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
