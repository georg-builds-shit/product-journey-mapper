"use client";

import { useState, useEffect } from "react";
import SegmentCreator from "./SegmentCreator";

interface Segment {
  id: string;
  name: string;
  segmentType: string;
}

interface FilterBarProps {
  accountId: string;
  dateFrom: string;
  dateTo: string;
  onApply: (filters: {
    dateFrom: string;
    dateTo: string;
    segmentId?: string;
    compareSegmentId?: string;
  }) => void;
  isLoading?: boolean;
  activeFilters?: {
    dateFrom: string | null;
    dateTo: string | null;
    segmentId?: string | null;
  };
}

export default function FilterBar({
  accountId,
  dateFrom,
  dateTo,
  onApply,
  isLoading,
  activeFilters,
}: FilterBarProps) {
  const [localFrom, setLocalFrom] = useState(dateFrom);
  const [localTo, setLocalTo] = useState(dateTo);
  const [expanded, setExpanded] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>("");
  const [compareSegmentId, setCompareSegmentId] = useState<string>("");
  const [compareMode, setCompareMode] = useState(false);
  const [showCreator, setShowCreator] = useState(false);

  // Load segments
  useEffect(() => {
    if (!accountId) return;
    const headers: Record<string, string> = {};
    if (process.env.NEXT_PUBLIC_APP_SECRET) headers["x-api-key"] = process.env.NEXT_PUBLIC_APP_SECRET;
    fetch(`/api/segments?accountId=${accountId}`, { headers })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setSegments(data);
      })
      .catch(() => {});
  }, [accountId]);

  const hasActiveFilter =
    activeFilters?.dateFrom ||
    activeFilters?.dateTo ||
    activeFilters?.segmentId;

  const hasChanges =
    localFrom !== (activeFilters?.dateFrom || "") ||
    localTo !== (activeFilters?.dateTo || "") ||
    selectedSegmentId !== (activeFilters?.segmentId || "");

  const handleApply = () => {
    const primarySeg = segments.find((s) => s.id === selectedSegmentId);
    const compareSeg = segments.find((s) => s.id === compareSegmentId);
    onApply({
      dateFrom: localFrom,
      dateTo: localTo,
      segmentId: selectedSegmentId || undefined,
      compareSegmentId: compareMode && compareSegmentId ? compareSegmentId : undefined,
      primaryName: primarySeg?.name,
      compareName: compareSeg?.name,
    } as any);
  };

  const handleClear = () => {
    setLocalFrom("");
    setLocalTo("");
    setSelectedSegmentId("");
    setCompareSegmentId("");
    setCompareMode(false);
    onApply({ dateFrom: "", dateTo: "" });
  };

  const handleSegmentCreated = (segment: Segment) => {
    setSegments([...segments, segment]);
    setSelectedSegmentId(segment.id);
    setShowCreator(false);
  };

  const activeSegment = segments.find((s) => s.id === activeFilters?.segmentId);

  return (
    <>
      <div className="mb-6">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
        >
          <svg
            className={`w-4 h-4 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-medium">Filters</span>
          {hasActiveFilter && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--accent)]/10 text-[var(--accent)]">
              Active
              {activeSegment && ` · ${activeSegment.name}`}
            </span>
          )}
        </button>

        {expanded && (
          <div className="mt-3 card p-4 space-y-4">
            {/* Date filters */}
            <div className="flex items-end gap-4 flex-wrap">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  From
                </label>
                <input
                  type="date"
                  value={localFrom}
                  onChange={(e) => setLocalFrom(e.target.value)}
                  className="w-full md:w-auto px-3 py-2 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  To
                </label>
                <input
                  type="date"
                  value={localTo}
                  onChange={(e) => setLocalTo(e.target.value)}
                  className="w-full md:w-auto px-3 py-2 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>

            {/* Segment filter */}
            <div className="flex items-end gap-4 flex-wrap">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  Segment
                </label>
                <div className="flex gap-2">
                  <select
                    value={selectedSegmentId}
                    onChange={(e) => setSelectedSegmentId(e.target.value)}
                    className="px-3 py-2 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] min-w-[180px]"
                  >
                    <option value="">All data</option>
                    {segments.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.segmentType === "profile" ? "👤" : "📦"} {s.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setShowCreator(true)}
                    className="px-3 py-2 text-sm rounded-lg border border-dashed border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-all"
                  >
                    + New
                  </button>
                </div>
              </div>

              {/* Compare toggle */}
              {selectedSegmentId && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                    Compare with
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCompareMode(!compareMode)}
                      className={`px-3 py-2 text-sm rounded-lg border transition-all ${
                        compareMode
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                          : "border-[var(--card-border)] text-[var(--muted)]"
                      }`}
                    >
                      {compareMode ? "Comparing" : "Compare"}
                    </button>
                    {compareMode && (
                      <select
                        value={compareSegmentId}
                        onChange={(e) => setCompareSegmentId(e.target.value)}
                        className="px-3 py-2 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] min-w-[180px]"
                      >
                        <option value="">Select segment...</option>
                        {segments
                          .filter((s) => s.id !== selectedSegmentId)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.segmentType === "profile" ? "👤" : "📦"} {s.name}
                            </option>
                          ))}
                      </select>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2 border-t border-[var(--card-border)]">
              <button
                onClick={handleApply}
                disabled={isLoading || !hasChanges}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isLoading ? "Analyzing..." : "Apply Filters"}
              </button>

              {hasActiveFilter && (
                <button
                  onClick={handleClear}
                  disabled={isLoading}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)] transition-all disabled:opacity-40"
                >
                  Clear all
                </button>
              )}

              {hasActiveFilter && (
                <p className="hidden md:block text-xs text-[var(--muted)] ml-auto">
                  {activeFilters?.dateFrom && (
                    <>
                      {activeFilters.dateFrom} → {activeFilters?.dateTo || "present"}
                    </>
                  )}
                  {activeSegment && (
                    <>
                      {activeFilters?.dateFrom ? " · " : ""}
                      Segment: <span className="text-[var(--foreground)]">{activeSegment.name}</span>
                    </>
                  )}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {showCreator && (
        <SegmentCreator
          accountId={accountId}
          onCreated={handleSegmentCreated}
          onClose={() => setShowCreator(false)}
        />
      )}
    </>
  );
}
