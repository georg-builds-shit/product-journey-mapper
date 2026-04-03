"use client";

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "retention", label: "Retention" },
  { id: "products", label: "Products" },
  { id: "explorer", label: "Explorer" },
] as const;

export type TabId = (typeof tabs)[number]["id"];

export default function DashboardTabs({
  activeTab,
  onChange,
}: {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
}) {
  return (
    <div className="flex gap-1 p-1 rounded-lg bg-[var(--card-border)]/30 w-full md:w-fit mb-6 overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex-1 md:flex-initial px-3 py-2 md:px-4 md:py-1.5 text-[13px] md:text-sm font-medium rounded-md transition-all whitespace-nowrap text-center ${
            activeTab === tab.id
              ? "bg-[var(--card-bg)] text-[var(--foreground)] shadow-sm"
              : "text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
