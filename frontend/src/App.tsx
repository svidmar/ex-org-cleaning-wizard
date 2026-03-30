import { useState, useEffect } from "react";
import type { Organization, Stats } from "./types";
import { fetchStats } from "./api";
import { useToasts, ToastContainer } from "./components/Toast";
import { cn } from "./components/utils";
import { DashboardView } from "./views/DashboardView";
import { QueueView } from "./views/QueueView";
import { ReviewView } from "./views/ReviewView";
import { MergeView } from "./views/MergeView";
import { HistoryView } from "./views/HistoryView";

type View = "dashboard" | "queue" | "review" | "merge" | "history";

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function App() {
  const { toasts, addToast } = useToasts();
  const [view, setView] = useState<View>("dashboard");
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetchStats().then(setStats).catch(() => {});
    const interval = setInterval(() => {
      fetchStats().then(setStats).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const selectOrg = (org: Organization) => {
    setSelectedOrg(org);
    setView("review");
  };

  const tabs: { id: View; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "queue", label: "Queue" },
    { id: "review", label: "Review" },
    { id: "merge", label: "Merge" },
    { id: "history", label: "History" },
  ];

  return (
    <div className="min-h-screen bg-[#f4f5f7]">
      <ToastContainer toasts={toasts} />

      <header className="bg-[#211a52] text-white">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <img
                src="/logo.svg"
                alt="Pure External Organization Cleaning Wizard"
                className="h-10 w-10"
              />
              <div>
                <h1 className="text-lg font-bold tracking-tight">
                  Pure External Organization Cleaning Wizard
                </h1>
                <p className="text-xs text-white/60">
                  Sync, match, and merge external organizations using ROR
                </p>
              </div>
            </div>
            {stats?.lastSyncedAt && (
              <div className="text-xs text-white/50" title={stats.lastSyncedAt}>
                Last synced: {formatTimeAgo(stats.lastSyncedAt)}
              </div>
            )}
          </div>

          <nav className="mt-4 flex gap-1 border-t border-[#594fbf]/30 pt-3">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  view === t.id
                    ? "bg-[#594fbf] text-white"
                    : "text-white/70 hover:bg-white/10"
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {view === "dashboard" && <DashboardView />}
        {view === "queue" && <QueueView onSelectOrg={selectOrg} />}
        {view === "review" &&
          (selectedOrg ? (
            <ReviewView
              org={selectedOrg}
              onBack={() => setView("queue")}
              addToast={addToast}
            />
          ) : (
            <div className="py-12 text-center text-gray-400">
              Select an organization from the Queue tab to review it.
            </div>
          ))}
        {view === "merge" && <MergeView addToast={addToast} />}
        {view === "history" && <HistoryView />}
      </main>

      <footer className="border-t border-gray-200 bg-white py-4 text-center text-xs text-gray-400">
        Pure External Organization Cleaning Wizard &middot; MIT License &middot;{" "}
        <a
          href="https://github.com/svidmar"
          target="_blank"
          rel="noreferrer"
          className="text-[#594fbf] hover:underline"
        >
          github.com/svidmar
        </a>
      </footer>
    </div>
  );
}
