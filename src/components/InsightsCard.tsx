"use client";

interface InsightsCardProps {
  insights: string;
}

export default function InsightsCard({ insights }: InsightsCardProps) {
  if (!insights) return null;

  // Parse numbered insights into individual cards
  const lines = insights.split("\n").filter((l) => l.trim());
  const insightBlocks: { title: string; body: string }[] = [];

  for (const line of lines) {
    const match = line.match(/^\d+\.\s*\*\*(.+?)\*\*\s*[—–-]\s*(.+)$/);
    if (match) {
      insightBlocks.push({ title: match[1], body: match[2] });
    }
  }

  // Fallback: if parsing fails, show raw text
  if (insightBlocks.length === 0) {
    return (
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-5 w-5 rounded bg-[var(--accent-soft)] flex items-center justify-center">
            <span className="text-[var(--accent)] text-xs">AI</span>
          </div>
          <h2 className="text-lg font-semibold">Insights</h2>
        </div>
        <p className="text-sm text-[var(--muted)] leading-relaxed whitespace-pre-line">{insights}</p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-5">
        <div className="h-6 w-6 rounded-md bg-[var(--accent-soft)] flex items-center justify-center">
          <span className="text-[var(--accent)] text-[10px] font-bold">AI</span>
        </div>
        <h2 className="text-lg font-semibold">Insights</h2>
      </div>
      <div className="space-y-4">
        {insightBlocks.map((block, i) => (
          <div key={i} className="group">
            <div className="flex gap-3">
              <span className="flex-shrink-0 h-5 w-5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[11px] font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium mb-0.5">{block.title}</p>
                <p className="text-sm text-[var(--muted)] leading-relaxed">{block.body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
