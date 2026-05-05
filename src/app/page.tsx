"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, UserButton } from "@clerk/nextjs";
import Link from "next/link";

export default function Home() {
  const router = useRouter();
  const [demoLoading, setDemoLoading] = useState(false);
  const { isLoaded, isSignedIn } = useAuth();

  const handleDemo = async () => {
    setDemoLoading(true);
    try {
      const res = await fetch("/api/demo", { method: "POST" });
      const data = await res.json();
      if (data.accountId) {
        router.push(`/dashboard?accountId=${data.accountId}`);
      }
    } catch {
      setDemoLoading(false);
    }
  };

  return (
    <main className="flex-1 flex items-center justify-center relative overflow-hidden">
      {/* Subtle gradient background */}
      <div className="absolute inset-0 bg-gradient-to-b from-[var(--accent)]/[0.04] via-transparent to-transparent pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[var(--accent)]/[0.03] rounded-full blur-3xl pointer-events-none" />

      {/* Top-right auth controls */}
      <div className="absolute top-4 right-4 flex items-center gap-3 z-20">
        {isLoaded && isSignedIn && (
          <>
            <Link
              href="/dashboard"
              className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              Dashboard
            </Link>
            <UserButton />
          </>
        )}
        {isLoaded && !isSignedIn && (
          <>
            <Link
              href="/sign-in"
              className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="text-sm px-3 py-1.5 rounded-md border border-[var(--card-border)] hover:border-[var(--accent)]/50 transition-colors"
            >
              Sign up
            </Link>
          </>
        )}
      </div>

      <div className="max-w-2xl mx-auto px-6 py-24 text-center relative z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-xs font-medium mb-6">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
          Klaviyo-powered analytics
        </div>

        <h1 className="text-5xl font-bold tracking-tight mb-5 bg-gradient-to-b from-white to-[#a1a1aa] bg-clip-text text-transparent">
          Product Journey Mapper
        </h1>
        <p className="text-lg text-[var(--muted)] mb-4 max-w-lg mx-auto">
          See the product journey your customers actually take — not the one you designed.
        </p>
        <p className="text-sm text-[var(--muted)]/70 mb-10 max-w-md mx-auto leading-relaxed">
          Connect your Klaviyo account and we&apos;ll map every purchase path: gateway products, purchase flows, stickiness scores, and AI-powered insights.
        </p>

        <div className="flex items-center justify-center gap-3">
          <a
            href="/api/klaviyo/connect"
            className="inline-flex items-center px-7 py-3.5 bg-[var(--accent)] text-white font-semibold rounded-lg hover:bg-[#5558e6] transition-all shadow-lg shadow-[var(--accent)]/20 text-[15px]"
          >
            Connect Klaviyo &rarr;
          </a>
          <button
            onClick={handleDemo}
            disabled={demoLoading}
            className="inline-flex items-center px-7 py-3.5 border border-[var(--card-border)] text-[var(--muted)] font-semibold rounded-lg hover:border-[var(--accent)]/50 hover:text-[var(--foreground)] transition-all text-[15px] disabled:opacity-50"
          >
            {demoLoading ? (
              <>
                <span className="animate-spin h-4 w-4 border-2 border-[var(--card-border)] border-t-[var(--accent)] rounded-full mr-2" />
                Loading...
              </>
            ) : (
              "Try Demo"
            )}
          </button>
        </div>

        <div className="mt-20 grid grid-cols-3 gap-6 text-left">
          {[
            {
              title: "Gateway Products",
              desc: "Which products bring customers in — and which lead to the highest lifetime value.",
              icon: "G",
            },
            {
              title: "Purchase Paths",
              desc: "Interactive Sankey diagram showing how customers flow from product to product across orders.",
              icon: "P",
            },
            {
              title: "AI Insights",
              desc: "Actionable recommendations: when to cross-sell, what to recommend, and where you're losing buyers.",
              icon: "AI",
            },
          ].map((item) => (
            <div key={item.title} className="card p-5 group hover:border-[var(--accent)]/20 transition-colors">
              <div className="h-8 w-8 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center mb-3">
                <span className="text-[var(--accent)] text-xs font-bold">{item.icon}</span>
              </div>
              <h3 className="font-semibold text-sm mb-1.5">{item.title}</h3>
              <p className="text-xs text-[var(--muted)] leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
