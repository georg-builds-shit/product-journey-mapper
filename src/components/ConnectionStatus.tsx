"use client";

import { useEffect, useState, useCallback } from "react";

interface StatusResponse {
  connected: boolean;
  email?: string;
  expiresAt?: string | null;
  reason?: "no_account" | "refresh_failed" | "never_connected";
  message?: string;
  demo?: boolean;
}

function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const secret = typeof window !== "undefined" ? process.env.NEXT_PUBLIC_APP_SECRET : undefined;
  if (secret) headers["x-api-key"] = secret;
  return headers;
}

/**
 * Chip-sized connection indicator for the dashboard header.
 *
 * - Green dot + "Connected" when the refresh call succeeds.
 * - Amber + "Reconnect" when refresh fails (merchant revoked the app or the
 *   refresh token itself is invalid).
 * - Polls every 10 minutes so long-lived sessions pick up a silent expiry.
 */
export default function ConnectionStatus({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/klaviyo/status?accountId=${accountId}`, {
        headers: apiHeaders(),
      });
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ connected: false, reason: "refresh_failed" });
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    poll();
    const id = setInterval(poll, 10 * 60 * 1000); // re-check every 10min
    return () => clearInterval(id);
  }, [accountId, poll]);

  const reconnect = () => {
    window.location.href = "/api/klaviyo/connect";
  };

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 px-2.5 py-1 rounded-full border border-[var(--card-border)] text-[11px] text-[var(--muted)]"
        title="Checking Klaviyo connection…"
      >
        <span className="h-2 w-2 rounded-full bg-[var(--muted)] animate-pulse" />
        <span>Checking…</span>
      </div>
    );
  }

  if (!status) return null;

  if (status.connected) {
    return (
      <div
        className="flex items-center gap-2 px-2.5 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-300"
        title={status.email ? `Connected as ${status.email}` : "Connected to Klaviyo"}
      >
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span>Klaviyo {status.demo ? "· demo" : "connected"}</span>
      </div>
    );
  }

  // Disconnected — show reconnect CTA
  const title =
    status.reason === "refresh_failed"
      ? "The Klaviyo refresh token is no longer valid. Click to re-authorize."
      : status.reason === "no_account"
      ? "No account found for this URL."
      : "Klaviyo is not connected.";

  return (
    <button
      onClick={reconnect}
      className="flex items-center gap-2 px-2.5 py-1 rounded-full border border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-300 hover:bg-amber-500/20 transition-colors"
      title={title}
    >
      <span className="h-2 w-2 rounded-full bg-amber-400" />
      <span>Reconnect Klaviyo</span>
    </button>
  );
}
