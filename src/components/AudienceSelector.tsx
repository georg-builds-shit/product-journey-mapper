"use client";

export interface AudienceOption {
  id: string;
  label: string;
  count?: number;
}

interface AudienceSelectorProps {
  audiences: AudienceOption[];
  value: string; // audience id or "__combined__"
  onChange: (audienceId: string) => void;
  className?: string;
}

/**
 * Dropdown-style audience picker applied across Retention/Products/Cohorts tabs.
 * Always includes an explicit "Combined" option at the top. Unassigned is
 * included only if the run has unassigned customers (caller decides).
 */
export default function AudienceSelector({
  audiences,
  value,
  onChange,
  className,
}: AudienceSelectorProps) {
  if (audiences.length === 0) return null;

  return (
    <div className={`flex items-center gap-2 ${className || ""}`}>
      <label className="text-[11px] font-medium text-[var(--muted)] uppercase tracking-wider">
        Audience
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-1.5 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
      >
        {audiences.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
            {a.count !== undefined ? ` (n=${a.count.toLocaleString()})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
