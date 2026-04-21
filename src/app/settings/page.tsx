"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ConnectionStatus from "@/components/ConnectionStatus";

interface AudienceRule {
  type: "list" | "klaviyo_segment" | "segment";
  listId?: string;
  segmentId?: string;
  rules?: Array<{ field: string; operator: string; value: string }>;
}

interface AudienceDefinition {
  id: string;
  label: string;
  rule: AudienceRule;
}

interface ProductFamilies {
  byProductId?: Record<string, string>;
  bySku?: Record<string, string>;
  byProductName?: Record<string, string>;
  familyLabels?: string[];
}

interface BrandConfig {
  id: string;
  accountId: string;
  audiences: AudienceDefinition[];
  productFamilies: ProductFamilies | null;
  cohortGranularity: "monthly" | "quarterly";
  lookbackMonths: number;
  excludeRefunds: boolean;
  minOrderValue: number;
  excludeTestRules: Array<{ field: string; operator: string; value: string }>;
}

interface Discovery {
  profileProperties: Array<{ key: string; sampleValues: string[] }>;
  lists: Array<{ id: string; name: string; profileCount: number }>;
  klaviyoSegments: Array<{ id: string; name: string; profileCount: number }>;
}

interface SanityCheck {
  audiences: Array<{ id: string; label: string; sampleMemberCount: number }>;
  sampleSize: number;
  discountCode: {
    eventsWithCode: number;
    totalEvents: number;
    prevalencePct: number;
    available: boolean;
  };
}

function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const secret = typeof window !== "undefined" ? process.env.NEXT_PUBLIC_APP_SECRET : undefined;
  if (secret) headers["x-api-key"] = secret;
  return headers;
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const accountId = searchParams.get("accountId");

  const [config, setConfig] = useState<BrandConfig | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [sanity, setSanity] = useState<SanityCheck | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [familiesText, setFamiliesText] = useState("");
  const [saveMessage, setSaveMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (!accountId) return;
    Promise.all([
      fetch(`/api/config?accountId=${accountId}`, { headers: apiHeaders() }).then((r) => r.json()),
      fetch(`/api/segments/discover?accountId=${accountId}`, { headers: apiHeaders() }).then((r) => r.json()),
    ])
      .then(([cfg, disc]) => {
        setConfig(cfg);
        setDiscovery(disc);
        setFamiliesText(familiesToCsv(cfg.productFamilies));
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, [accountId]);

  const handleSave = async () => {
    if (!config || !accountId) return;
    setSaving(true);
    setSaveMessage(null);

    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: apiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          accountId,
          patch: {
            audiences: config.audiences,
            productFamilies: parseFamiliesCsv(familiesText),
            cohortGranularity: config.cohortGranularity,
            lookbackMonths: config.lookbackMonths,
            excludeRefunds: config.excludeRefunds,
            minOrderValue: config.minOrderValue,
            excludeTestRules: config.excludeTestRules,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setConfig(data);
      setFamiliesText(familiesToCsv(data.productFamilies));
      setSaveMessage({ type: "ok", text: "Saved." });
    } catch (err) {
      setSaveMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Save failed",
      });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMessage(null), 4000);
    }
  };

  const handleSanityCheck = async () => {
    if (!accountId) return;
    setSanity(null);
    try {
      const res = await fetch(`/api/config/sanity-check?accountId=${accountId}`, {
        headers: apiHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sanity check failed");
      setSanity(data);
    } catch (err) {
      setSaveMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Sanity check failed",
      });
    }
  };

  if (!accountId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--muted)]">
          No account specified.{" "}
          <a href="/" className="text-[var(--accent)] hover:underline">
            Go back
          </a>
        </p>
      </div>
    );
  }

  if (loading || !config) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="h-10 w-10 rounded-full border-2 border-[var(--card-border)] border-t-[var(--accent)] animate-spin" />
      </div>
    );
  }

  const updateConfig = (patch: Partial<BrandConfig>) =>
    setConfig((c) => (c ? { ...c, ...patch } : c));

  const addAudience = () => {
    const id = `audience_${Date.now()}`;
    updateConfig({
      audiences: [
        ...config.audiences,
        { id, label: "New audience", rule: { type: "list", listId: "" } },
      ],
    });
  };

  const updateAudience = (index: number, patch: Partial<AudienceDefinition>) => {
    const next = config.audiences.map((a, i) => (i === index ? { ...a, ...patch } : a));
    updateConfig({ audiences: next });
  };

  const moveAudience = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= config.audiences.length) return;
    const next = [...config.audiences];
    [next[index], next[target]] = [next[target], next[index]];
    updateConfig({ audiences: next });
  };

  const removeAudience = (index: number) => {
    updateConfig({ audiences: config.audiences.filter((_, i) => i !== index) });
  };

  return (
    <div className="max-w-[900px] mx-auto px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Settings</h1>
            <p className="text-xs sm:text-sm text-[var(--muted)] mt-1">
              Per-brand configuration for cohort &amp; repeat-purchase analytics.
            </p>
          </div>
          <ConnectionStatus accountId={accountId} />
        </div>
        <a
          href={`/dashboard?accountId=${accountId}`}
          className="shrink-0 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)] transition-all"
        >
          ← Dashboard
        </a>
      </div>

      {/* ── Audiences ── */}
      <section className="card p-5 sm:p-6 mb-5">
        <div className="flex items-center justify-between gap-4 mb-2">
          <h2 className="text-base sm:text-lg font-semibold">Audiences</h2>
          <button
            onClick={addAudience}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-dashed border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-all"
          >
            + Add audience
          </button>
        </div>
        <div className="text-xs text-[var(--muted)] space-y-2 mb-4">
          <p>
            An audience is a named group of customers — e.g. <em>DTC</em>, <em>Affiliate</em>,{" "}
            <em>B2B</em>. Every metric on the Cohorts tab gets split by audience, so you can
            compare repeat rates, time-between-orders, and product paths across them.
          </p>
          <p>
            <strong className="text-[var(--foreground)]">
              Add one audience per group you want to see separately.
            </strong>{" "}
            Want to compare Affiliate vs DTC? Add two audiences — label them <em>Affiliate</em>{" "}
            and <em>DTC</em>, pick the Klaviyo segment (or list) that defines each. The Cohorts
            tab will let you switch between them.
          </p>
          <p>
            <strong className="text-[var(--foreground)]">First match wins.</strong> Customers are
            assigned to the first audience they match in this order — so put narrower groups
            (e.g. VIP) above broader ones (e.g. DTC). Anyone matching none shows up as{" "}
            <em>Unassigned</em>.
          </p>
        </div>

        {config.audiences.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--card-border)] p-4 mb-3">
            <p className="text-sm text-[var(--muted)] mb-2">
              <strong className="text-[var(--foreground)]">No audiences yet.</strong> Add at
              least one to unlock per-audience charts.
            </p>
            <p className="text-xs text-[var(--muted)]">
              Most brands start with 2–3: one per sales channel (DTC, Affiliate, Wholesale). Each
              audience = one Klaviyo segment or list.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {config.audiences.map((a, idx) => (
            <AudienceRow
              key={a.id}
              audience={a}
              discovery={discovery}
              isFirst={idx === 0}
              isLast={idx === config.audiences.length - 1}
              onChange={(patch) => updateAudience(idx, patch)}
              onMoveUp={() => moveAudience(idx, -1)}
              onMoveDown={() => moveAudience(idx, 1)}
              onRemove={() => removeAudience(idx)}
            />
          ))}
        </div>
      </section>

      {/* ── Product families ── */}
      <section className="card p-5 sm:p-6 mb-5">
        <h2 className="text-base sm:text-lg font-semibold mb-2">Product families</h2>
        <div className="text-xs text-[var(--muted)] space-y-1 mb-4">
          <p>
            <em>Optional.</em> Collapse many SKUs into a smaller number of families so charts
            read at a glance. For example, with 20 different cleanse SKUs mapped to{" "}
            <em>Cleanse</em>, the product-path matrix shows{" "}
            <strong className="text-[var(--foreground)]">&quot;Cleanse&nbsp;→&nbsp;Cleanse 42%&quot;</strong>{" "}
            instead of a 20×20 grid of individual SKU names.
          </p>
          <p>
            Paste CSV rows below, one per line:{" "}
            <code className="text-[var(--foreground)] bg-[var(--card-border)]/40 px-1 rounded">
              product_id,family
            </code>{" "}
            or{" "}
            <code className="text-[var(--foreground)] bg-[var(--card-border)]/40 px-1 rounded">
              SKU,family
            </code>{" "}
            or{" "}
            <code className="text-[var(--foreground)] bg-[var(--card-border)]/40 px-1 rounded">
              exact product name,family
            </code>
            . Blank = per-SKU analysis (no grouping applied).
          </p>
        </div>
        <textarea
          value={familiesText}
          onChange={(e) => setFamiliesText(e.target.value)}
          placeholder={`# Example:
CLEANSE-STARTER,Cleanse
CLEANSE-ADVANCED,Cleanse
PROBIOTIC-30,Supplements
PROBIOTIC-60,Supplements
# …and so on. Leave blank for per-SKU analysis.`}
          rows={7}
          className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
        />
        {familiesText.trim() && (
          <p className="text-[11px] text-[var(--muted)] mt-2">
            {parseFamiliesCsv(familiesText)?.familyLabels?.length || 0} families will be applied.
          </p>
        )}
      </section>

      {/* ── Cohort settings ── */}
      <section className="card p-5 sm:p-6 mb-5">
        <h2 className="text-base sm:text-lg font-semibold mb-4">Cohort settings</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-2">
              Granularity
            </label>
            <div className="toggle-group flex w-fit">
              <button
                onClick={() => updateConfig({ cohortGranularity: "monthly" })}
                className={`toggle-item ${config.cohortGranularity === "monthly" ? "active" : ""}`}
              >
                Monthly
              </button>
              <button
                onClick={() => updateConfig({ cohortGranularity: "quarterly" })}
                className={`toggle-item ${config.cohortGranularity === "quarterly" ? "active" : ""}`}
              >
                Quarterly
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-2">
              Lookback (months)
            </label>
            <input
              type="number"
              min={1}
              max={60}
              value={config.lookbackMonths}
              onChange={(e) => updateConfig({ lookbackMonths: parseInt(e.target.value) || 24 })}
              className="w-32 px-3 py-2 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
            />
            <p className="text-[11px] text-[var(--muted)] mt-1">
              Next sync will backfill events older than the current earliest if increased.
            </p>
          </div>
        </div>
      </section>

      {/* ── Order filters ── */}
      <section className="card p-5 sm:p-6 mb-5">
        <h2 className="text-base sm:text-lg font-semibold mb-4">Order filters</h2>
        <div className="space-y-4">
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={config.excludeRefunds}
              onChange={(e) => updateConfig({ excludeRefunds: e.target.checked })}
              className="h-4 w-4 rounded accent-[var(--accent)]"
            />
            <span>Exclude refunded / negative-value orders</span>
          </label>

          <div>
            <label className="block text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-2">
              Minimum order value
            </label>
            <input
              type="number"
              step={0.01}
              min={0}
              value={config.minOrderValue}
              onChange={(e) => updateConfig({ minOrderValue: parseFloat(e.target.value) || 0 })}
              className="w-32 px-3 py-2 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
            />
            <p className="text-[11px] text-[var(--muted)] mt-1">
              Excludes $0 orders by default. Set to 0 to include free/gift orders.
            </p>
          </div>
        </div>
      </section>

      {/* ── Sanity check ── */}
      <section className="card p-5 sm:p-6 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base sm:text-lg font-semibold">Sanity check</h2>
          <button
            onClick={handleSanityCheck}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-all"
          >
            Run check
          </button>
        </div>
        <p className="text-xs text-[var(--muted)] mb-4">
          Runs on a sample of cached customers &amp; events. Confirms audience assignment looks
          reasonable and whether discount code data is present.
        </p>

        {sanity && (
          <div className="space-y-4">
            <div>
              <p className="text-[11px] font-medium text-[var(--muted)] uppercase tracking-wider mb-2">
                Audience membership (sample n={sanity.sampleSize})
              </p>
              <div className="space-y-1.5">
                {sanity.audiences.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-sm">
                    <span className={a.id === "unassigned" ? "text-[var(--warning)]" : ""}>
                      {a.label}
                    </span>
                    <span className="text-[var(--muted)] font-mono">
                      {a.sampleMemberCount} customers
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--card-border)]">
              <p className="text-[11px] font-medium text-[var(--muted)] uppercase tracking-wider mb-2">
                Discount code prevalence
              </p>
              <p className="text-sm">
                {sanity.discountCode.totalEvents === 0 ? (
                  <span className="text-[var(--muted)]">No events synced yet.</span>
                ) : sanity.discountCode.available ? (
                  <>
                    <span className="text-[var(--success)] font-medium">
                      {sanity.discountCode.prevalencePct.toFixed(1)}%
                    </span>{" "}
                    <span className="text-[var(--muted)]">
                      of {sanity.discountCode.totalEvents.toLocaleString()} events include a
                      discount code. Discount code metric will render.
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-[var(--warning)] font-medium">
                      {sanity.discountCode.prevalencePct.toFixed(1)}%
                    </span>{" "}
                    <span className="text-[var(--muted)]">
                      prevalence &lt; 5% — discount code metric will show &quot;data not
                      available&quot;.
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ── Save bar ── */}
      <div className="sticky bottom-4 flex items-center justify-between gap-4 card p-3 sm:p-4 backdrop-blur">
        <div className="text-xs text-[var(--muted)]">
          {saveMessage ? (
            <span
              className={
                saveMessage.type === "ok" ? "text-[var(--success)]" : "text-[var(--danger)]"
              }
            >
              {saveMessage.text}
            </span>
          ) : (
            <>Changes are applied on the next analysis run.</>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────

function AudienceRow({
  audience,
  discovery,
  isFirst,
  isLast,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  audience: AudienceDefinition;
  discovery: Discovery | null;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<AudienceDefinition>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const ruleType = audience.rule.type;

  const setRuleType = (type: AudienceRule["type"]) => {
    if (type === "list") onChange({ rule: { type: "list", listId: "" } });
    else if (type === "klaviyo_segment") onChange({ rule: { type: "klaviyo_segment", segmentId: "" } });
    else
      onChange({
        rule: { type: "segment", rules: [{ field: "", operator: "equals", value: "" }] },
      });
  };

  return (
    <div className="rounded-lg border border-[var(--card-border)] p-3">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex flex-col gap-0.5">
          <button
            disabled={isFirst}
            onClick={onMoveUp}
            className="text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-30 text-xs"
            title="Move up"
          >
            ▲
          </button>
          <button
            disabled={isLast}
            onClick={onMoveDown}
            className="text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-30 text-xs"
            title="Move down"
          >
            ▼
          </button>
        </div>
        <input
          type="text"
          value={audience.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Label (e.g. DTC, Affiliate)"
          className="flex-1 px-3 py-1.5 text-sm font-medium rounded border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:border-[var(--accent)]"
        />
        <input
          type="text"
          value={audience.id}
          onChange={(e) => onChange({ id: e.target.value })}
          placeholder="id"
          className="w-32 px-3 py-1.5 text-xs font-mono rounded border border-[var(--card-border)] bg-[var(--background)] text-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
          title="Stable id used in URLs and CSV exports"
        />
        <button
          onClick={onRemove}
          className="text-[var(--muted)] hover:text-[var(--danger)] px-1.5"
          title="Remove audience"
        >
          ×
        </button>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] font-medium text-[var(--muted)] uppercase tracking-wider">
          Match by:
        </span>
        {(["list", "klaviyo_segment", "segment"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setRuleType(t)}
            className={`px-2.5 py-1 text-xs rounded border transition-all ${
              ruleType === t
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--card-border)] text-[var(--muted)]"
            }`}
          >
            {t === "list" ? "Klaviyo list" : t === "klaviyo_segment" ? "Klaviyo segment" : "Custom rule"}
          </button>
        ))}
      </div>

      {ruleType === "list" && (
        <select
          value={audience.rule.listId || ""}
          onChange={(e) => onChange({ rule: { type: "list", listId: e.target.value } })}
          className="w-full px-3 py-2 text-sm rounded border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:border-[var(--accent)]"
        >
          <option value="">Select a list…</option>
          {discovery?.lists
            .slice()
            .sort((a, b) => (b.profileCount || 0) - (a.profileCount || 0))
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.profileCount > 0 ? ` · ${l.profileCount.toLocaleString()} profiles` : ""}
              </option>
            ))}
        </select>
      )}

      {ruleType === "klaviyo_segment" && (
        <select
          value={audience.rule.segmentId || ""}
          onChange={(e) =>
            onChange({ rule: { type: "klaviyo_segment", segmentId: e.target.value } })
          }
          className="w-full px-3 py-2 text-sm rounded border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:border-[var(--accent)]"
        >
          <option value="">Select a segment…</option>
          {discovery?.klaviyoSegments
            .slice()
            .sort((a, b) => (b.profileCount || 0) - (a.profileCount || 0))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.profileCount > 0 ? ` · ${s.profileCount.toLocaleString()} profiles` : ""}
              </option>
            ))}
        </select>
      )}

      {ruleType === "segment" && (
        <RuleBuilder
          rules={audience.rule.rules || []}
          discovery={discovery}
          onChange={(rules) => onChange({ rule: { type: "segment", rules } })}
        />
      )}
    </div>
  );
}

function RuleBuilder({
  rules,
  discovery,
  onChange,
}: {
  rules: Array<{ field: string; operator: string; value: string }>;
  discovery: Discovery | null;
  onChange: (rules: Array<{ field: string; operator: string; value: string }>) => void;
}) {
  const updateRule = (i: number, patch: Partial<{ field: string; operator: string; value: string }>) => {
    onChange(rules.map((r, j) => (i === j ? { ...r, ...patch } : r)));
  };

  const addRule = () =>
    onChange([...rules, { field: "", operator: "equals", value: "" }]);

  const removeRule = (i: number) => onChange(rules.filter((_, j) => j !== i));

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-[var(--muted)]">
        All conditions must match (AND). Operators: equals, contains, not_equals, in_list,
        in_segment, not_in_list, not_in_segment.
      </p>
      {rules.map((rule, i) => (
        <div key={i} className="flex items-center gap-2">
          <select
            value={rule.field}
            onChange={(e) => updateRule(i, { field: e.target.value })}
            className="flex-1 px-2 py-1.5 text-xs rounded border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="">field…</option>
            <optgroup label="Profile properties">
              {discovery?.profileProperties.map((p) => (
                <option key={p.key} value={`properties.${p.key}`}>
                  {p.key}
                </option>
              ))}
            </optgroup>
            <optgroup label="Location">
              <option value="location.country">Country</option>
              <option value="location.region">Region</option>
              <option value="location.city">City</option>
            </optgroup>
            <optgroup label="Membership">
              <option value="lists">lists</option>
              <option value="segments">segments</option>
            </optgroup>
          </select>
          <select
            value={rule.operator}
            onChange={(e) => updateRule(i, { operator: e.target.value })}
            className="w-28 px-2 py-1.5 text-xs rounded border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="equals">equals</option>
            <option value="not_equals">not equals</option>
            <option value="contains">contains</option>
            <option value="in_list">in_list</option>
            <option value="not_in_list">not_in_list</option>
            <option value="in_segment">in_segment</option>
            <option value="not_in_segment">not_in_segment</option>
          </select>
          <input
            type="text"
            value={rule.value}
            onChange={(e) => updateRule(i, { value: e.target.value })}
            placeholder="value"
            className="flex-1 px-2 py-1.5 text-xs rounded border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:border-[var(--accent)]"
          />
          {rules.length > 1 && (
            <button
              onClick={() => removeRule(i)}
              className="text-[var(--muted)] hover:text-[var(--danger)]"
              title="Remove condition"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        onClick={addRule}
        className="text-[11px] text-[var(--accent)] hover:underline"
      >
        + Add condition
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function familiesToCsv(families: ProductFamilies | null): string {
  if (!families) return "";
  const rows: string[] = [];
  for (const [k, v] of Object.entries(families.byProductId || {})) rows.push(`${k},${v}`);
  for (const [k, v] of Object.entries(families.bySku || {})) rows.push(`${k},${v}`);
  for (const [k, v] of Object.entries(families.byProductName || {})) rows.push(`${k},${v}`);
  return rows.join("\n");
}

/**
 * Parse "key,family" CSV into a ProductFamilies object. Heuristic:
 *  - key starts with "gid://" or is all-numeric → byProductId
 *  - else if no spaces and short → bySku
 *  - else → byProductName
 */
function parseFamiliesCsv(text: string): ProductFamilies | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (lines.length === 0) return null;

  const byProductId: Record<string, string> = {};
  const bySku: Record<string, string> = {};
  const byProductName: Record<string, string> = {};

  for (const line of lines) {
    const commaIdx = line.indexOf(",");
    if (commaIdx === -1) continue;
    const key = line.slice(0, commaIdx).trim();
    const value = line.slice(commaIdx + 1).trim();
    if (!key || !value) continue;

    if (/^gid:\/\//i.test(key) || /^\d+$/.test(key)) {
      byProductId[key] = value;
    } else if (/\s/.test(key) || key.length > 32) {
      byProductName[key] = value;
    } else {
      bySku[key] = value;
    }
  }

  const hasAny =
    Object.keys(byProductId).length ||
    Object.keys(bySku).length ||
    Object.keys(byProductName).length;
  if (!hasAny) return null;

  const familyLabels = Array.from(
    new Set([
      ...Object.values(byProductId),
      ...Object.values(bySku),
      ...Object.values(byProductName),
    ])
  );

  return {
    ...(Object.keys(byProductId).length && { byProductId }),
    ...(Object.keys(bySku).length && { bySku }),
    ...(Object.keys(byProductName).length && { byProductName }),
    familyLabels,
  };
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center">
          <div className="h-10 w-10 rounded-full border-2 border-[var(--card-border)] border-t-[var(--accent)] animate-spin" />
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}
