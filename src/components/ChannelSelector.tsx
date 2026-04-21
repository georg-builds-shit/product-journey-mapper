"use client";

export interface ChannelOption {
  id: string;
  label: string;
  count?: number;
}

interface ChannelSelectorProps {
  channels: ChannelOption[];
  value: string; // channel id or "__combined__"
  onChange: (channelId: string) => void;
  className?: string;
}

/**
 * Dropdown-style channel picker applied across Retention/Products/Cohorts tabs.
 * Always includes an explicit "Combined" option at the top. Unassigned is
 * included only if the run has unassigned customers (caller decides).
 */
export default function ChannelSelector({
  channels,
  value,
  onChange,
  className,
}: ChannelSelectorProps) {
  if (channels.length === 0) return null;

  return (
    <div className={`flex items-center gap-2 ${className || ""}`}>
      <label className="text-[11px] font-medium text-[var(--muted)] uppercase tracking-wider">
        Channel
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-1.5 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
      >
        {channels.map((ch) => (
          <option key={ch.id} value={ch.id}>
            {ch.label}
            {ch.count !== undefined ? ` (n=${ch.count.toLocaleString()})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
