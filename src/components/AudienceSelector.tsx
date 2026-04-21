"use client";

import { useEffect, useRef, useState } from "react";

export interface AudienceOption {
  id: string;
  label: string;
  count?: number;
}

interface AudienceMultiSelectProps {
  audiences: AudienceOption[];
  selected: string[]; // audience ids
  onChange: (ids: string[]) => void;
  className?: string;
}

/**
 * Multi-select audience picker. Used on the Cohorts tab so the user can see
 * several audiences' data side-by-side (stacked per metric) rather than
 * toggling between them.
 *
 * Renders as a dropdown-style button; clicking opens a checkbox list with
 * "All" / "Clear" shortcuts.
 */
export default function AudienceMultiSelect({
  audiences,
  selected,
  onChange,
  className,
}: AudienceMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (audiences.length === 0) return null;

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  };

  const summary =
    selected.length === 0
      ? "None"
      : selected.length === audiences.length
      ? "All audiences"
      : selected.length === 1
      ? audiences.find((a) => a.id === selected[0])?.label || "1 selected"
      : `${selected.length} audiences`;

  return (
    <div ref={rootRef} className={`relative ${className || ""}`}>
      <div className="flex items-center gap-2">
        <label className="text-[11px] font-medium text-[var(--muted)] uppercase tracking-wider">
          Audiences
        </label>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)] hover:border-[var(--accent)] transition-colors min-w-[180px]"
        >
          <span className="flex-1 text-left truncate">{summary}</span>
          <svg
            className={`h-3 w-3 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="absolute right-0 mt-2 z-30 w-[280px] card shadow-xl">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--card-border)]">
            <button
              onClick={() => onChange(audiences.map((a) => a.id))}
              className="text-[11px] text-[var(--accent)] hover:underline"
            >
              Select all
            </button>
            <button
              onClick={() => onChange([])}
              className="text-[11px] text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              Clear
            </button>
          </div>
          <div className="max-h-[280px] overflow-y-auto py-1">
            {audiences.map((a) => {
              const isSelected = selected.includes(a.id);
              return (
                <label
                  key={a.id}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-[var(--card-hover)]"
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(a.id)}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <span className="flex-1">{a.label}</span>
                  {a.count !== undefined && (
                    <span className="text-[10px] text-[var(--muted)] tabular-nums">
                      n={a.count.toLocaleString()}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
