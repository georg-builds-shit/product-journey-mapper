"use client";

import { useState, useEffect } from "react";

interface SegmentRule {
  field: string;
  operator: string;
  value: string;
}

interface DiscoveryData {
  profileProperties: Array<{ key: string; sampleValues: string[] }>;
  eventTypes: Array<{ id: string; name: string; integration: string | null }>;
  lists: Array<{ id: string; name: string; profileCount: number }>;
  klaviyoSegments: Array<{ id: string; name: string; profileCount: number }>;
}

interface SegmentCreatorProps {
  accountId: string;
  onCreated: (segment: any) => void;
  onClose: () => void;
}

type FilterMode = "property" | "list" | "klaviyo_segment" | "event";

export default function SegmentCreator({ accountId, onCreated, onClose }: SegmentCreatorProps) {
  const [name, setName] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("property");
  const [rules, setRules] = useState<SegmentRule[]>([
    { field: "", operator: "equals", value: "" },
  ]);
  const [discovery, setDiscovery] = useState<DiscoveryData | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const headers: Record<string, string> = {};
    if (process.env.NEXT_PUBLIC_APP_SECRET) headers["x-api-key"] = process.env.NEXT_PUBLIC_APP_SECRET;
    fetch(`/api/segments/discover?accountId=${accountId}`, { headers })
      .then((r) => r.json())
      .then((data) => { setDiscovery(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [accountId]);

  const updateRule = (index: number, update: Partial<SegmentRule>) => {
    setRules(rules.map((r, i) => (i === index ? { ...r, ...update } : r)));
  };

  const handleSave = async () => {
    if (!name.trim() || rules.some((r) => !r.value)) return;

    setSaving(true);
    const segmentType = filterMode === "event" ? "event" : "profile";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.NEXT_PUBLIC_APP_SECRET) headers["x-api-key"] = process.env.NEXT_PUBLIC_APP_SECRET;
    const res = await fetch("/api/segments", {
      method: "POST",
      headers,
      body: JSON.stringify({ accountId, name, segmentType, rules }),
    });

    const segment = await res.json();
    setSaving(false);
    onCreated(segment);
  };

  const setFilterModeAndReset = (mode: FilterMode) => {
    setFilterMode(mode);
    if (mode === "list") {
      setRules([{ field: "lists", operator: "in_list", value: "" }]);
    } else if (mode === "klaviyo_segment") {
      setRules([{ field: "segments", operator: "in_segment", value: "" }]);
    } else if (mode === "event") {
      setRules([{ field: "metric_name", operator: "equals", value: "" }]);
    } else {
      setRules([{ field: "", operator: "equals", value: "" }]);
    }
  };

  const profileFieldOptions = [
    ...(discovery?.profileProperties?.map((p) => ({
      value: `properties.${p.key}`,
      label: p.key,
      samples: p.sampleValues,
    })) || []),
    { value: "location.country", label: "Country", samples: [] },
    { value: "location.region", label: "Region", samples: [] },
    { value: "location.city", label: "City", samples: [] },
  ];

  const hasLists = (discovery?.lists?.length || 0) > 0;
  const hasKlaviyoSegments = (discovery?.klaviyoSegments?.length || 0) > 0;
  const hasProperties = profileFieldOptions.length > 3; // more than just location fields
  const hasEventTypes = (discovery?.eventTypes?.length || 0) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="card p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold">Create Segment</h3>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-[var(--muted)] text-sm">Loading available filters...</div>
        ) : (
          <>
            {/* Name */}
            <div className="mb-4">
              <label className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Segment name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Affiliates, VIP Customers, Online Only"
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            {/* Filter mode tabs */}
            <div className="mb-4">
              <label className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Filter by
              </label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {hasLists && (
                  <button
                    onClick={() => setFilterModeAndReset("list")}
                    className={`px-3 py-2 text-sm rounded-lg border transition-all text-left ${
                      filterMode === "list"
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                        : "border-[var(--card-border)] text-[var(--muted)] hover:border-[var(--muted)]"
                    }`}
                  >
                    📋 Klaviyo List
                    <span className="block text-xs mt-0.5 opacity-70">{discovery?.lists?.length} lists available</span>
                  </button>
                )}
                {hasKlaviyoSegments && (
                  <button
                    onClick={() => setFilterModeAndReset("klaviyo_segment")}
                    className={`px-3 py-2 text-sm rounded-lg border transition-all text-left ${
                      filterMode === "klaviyo_segment"
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                        : "border-[var(--card-border)] text-[var(--muted)] hover:border-[var(--muted)]"
                    }`}
                  >
                    🎯 Klaviyo Segment
                    <span className="block text-xs mt-0.5 opacity-70">{discovery?.klaviyoSegments?.length} segments available</span>
                  </button>
                )}
                {hasProperties && (
                  <button
                    onClick={() => setFilterModeAndReset("property")}
                    className={`px-3 py-2 text-sm rounded-lg border transition-all text-left ${
                      filterMode === "property"
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                        : "border-[var(--card-border)] text-[var(--muted)] hover:border-[var(--muted)]"
                    }`}
                  >
                    👤 Profile Property
                    <span className="block text-xs mt-0.5 opacity-70">{discovery?.profileProperties?.length} properties found</span>
                  </button>
                )}
                {hasEventTypes && (
                  <button
                    onClick={() => setFilterModeAndReset("event")}
                    className={`px-3 py-2 text-sm rounded-lg border transition-all text-left ${
                      filterMode === "event"
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                        : "border-[var(--card-border)] text-[var(--muted)] hover:border-[var(--muted)]"
                    }`}
                  >
                    📦 Event Type
                    <span className="block text-xs mt-0.5 opacity-70">{discovery?.eventTypes?.length} event types</span>
                  </button>
                )}
              </div>
            </div>

            {/* Rule configuration */}
            <div className="mb-4">
              <label className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-2 block">
                {filterMode === "list" && "Select list"}
                {filterMode === "klaviyo_segment" && "Select segment"}
                {filterMode === "property" && "Property rule"}
                {filterMode === "event" && "Event type"}
              </label>

              {filterMode === "list" && (
                <div className="space-y-2">
                  <select
                    value={rules[0]?.value || ""}
                    onChange={(e) => updateRule(0, { value: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)]"
                  >
                    <option value="">Select a list...</option>
                    {discovery?.lists?.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.profileCount.toLocaleString()} profiles)
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateRule(0, { operator: "in_list" })}
                      className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-all ${
                        rules[0]?.operator === "in_list"
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                          : "border-[var(--card-border)] text-[var(--muted)]"
                      }`}
                    >
                      In this list
                    </button>
                    <button
                      onClick={() => updateRule(0, { operator: "not_in_list" })}
                      className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-all ${
                        rules[0]?.operator === "not_in_list"
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                          : "border-[var(--card-border)] text-[var(--muted)]"
                      }`}
                    >
                      Not in this list
                    </button>
                  </div>
                </div>
              )}

              {filterMode === "klaviyo_segment" && (
                <div className="space-y-2">
                  <select
                    value={rules[0]?.value || ""}
                    onChange={(e) => updateRule(0, { value: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)]"
                  >
                    <option value="">Select a segment...</option>
                    {discovery?.klaviyoSegments?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.profileCount.toLocaleString()} profiles)
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateRule(0, { operator: "in_segment" })}
                      className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-all ${
                        rules[0]?.operator === "in_segment"
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                          : "border-[var(--card-border)] text-[var(--muted)]"
                      }`}
                    >
                      In this segment
                    </button>
                    <button
                      onClick={() => updateRule(0, { operator: "not_in_segment" })}
                      className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-all ${
                        rules[0]?.operator === "not_in_segment"
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                          : "border-[var(--card-border)] text-[var(--muted)]"
                      }`}
                    >
                      Not in this segment
                    </button>
                  </div>
                </div>
              )}

              {filterMode === "property" && (
                <div className="space-y-2">
                  {rules.map((rule, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select
                        value={rule.field}
                        onChange={(e) => updateRule(i, { field: e.target.value })}
                        className="flex-1 px-2 py-1.5 text-sm rounded border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)]"
                      >
                        <option value="">Select property...</option>
                        <optgroup label="Profile Properties">
                          {discovery?.profileProperties?.map((p) => (
                            <option key={p.key} value={`properties.${p.key}`}>
                              {p.key} {p.sampleValues.length > 0 ? `(e.g., ${p.sampleValues[0]})` : ""}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Location">
                          <option value="location.country">Country</option>
                          <option value="location.region">Region</option>
                          <option value="location.city">City</option>
                        </optgroup>
                      </select>
                      <select
                        value={rule.operator}
                        onChange={(e) => updateRule(i, { operator: e.target.value })}
                        className="w-28 px-2 py-1.5 text-sm rounded border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)]"
                      >
                        <option value="equals">equals</option>
                        <option value="not_equals">not equals</option>
                        <option value="contains">contains</option>
                      </select>
                      <input
                        type="text"
                        value={rule.value}
                        onChange={(e) => updateRule(i, { value: e.target.value })}
                        placeholder="value"
                        className="flex-1 px-2 py-1.5 text-sm rounded border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)]"
                      />
                      {rules.length > 1 && (
                        <button onClick={() => setRules(rules.filter((_, j) => j !== i))} className="text-[var(--muted)] hover:text-red-400">×</button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => setRules([...rules, { field: "", operator: "equals", value: "" }])}
                    className="text-xs text-[var(--accent)] hover:underline"
                  >
                    + Add rule
                  </button>
                </div>
              )}

              {filterMode === "event" && (
                <select
                  value={rules[0]?.value || ""}
                  onChange={(e) => updateRule(0, { field: "metric_name", operator: "equals", value: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)]"
                >
                  <option value="">Select event type...</option>
                  {discovery?.eventTypes?.map((e) => (
                    <option key={e.id} value={e.name}>
                      {e.name} {e.integration ? `(${e.integration})` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-[var(--card-border)]">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--foreground)] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !name.trim() || rules.some((r) => !r.value)}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {saving ? "Saving..." : "Create Segment"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
