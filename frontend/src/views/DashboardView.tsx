import { useState, useEffect, useCallback } from "react";
import type { Stats, JobState } from "../types";
import {
  fetchStats,
  fetchHealth,
  startSync,
  getSyncStatus,
  stopSync,
  startMatch,
  getMatchStatus,
  stopMatch,
} from "../api";
import { JobProgress } from "../components/JobProgress";
import { cn } from "../components/utils";

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-2xl font-bold tabular-nums text-gray-900">
        {value.toLocaleString()}
      </div>
      <div className={cn("text-xs font-medium", color || "text-gray-500")}>
        {label}
      </div>
    </div>
  );
}

const IDLE_JOB: JobState = {
  job_name: "",
  status: "idle",
  progress: 0,
  total: 0,
  started_at: null,
  updated_at: null,
  error_message: null,
  checkpoint: null,
};

export function DashboardView() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [syncState, setSyncState] = useState<JobState>(IDLE_JOB);
  const [matchState, setMatchState] = useState<JobState>(IDLE_JOB);
  const [health, setHealth] = useState<{
    pureConfigured: boolean;
    rorAvailable: boolean;
    rorBase: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, ss, ms, h] = await Promise.all([
        fetchStats(),
        getSyncStatus(),
        getMatchStatus(),
        fetchHealth(),
      ]);
      setStats(s);
      setSyncState(ss);
      setMatchState(ms);
      setHealth(h);
    } catch {
      // Will show empty state
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while jobs are running
  useEffect(() => {
    if (syncState.status === "running" || matchState.status === "running") {
      const interval = setInterval(refresh, 2000);
      return () => clearInterval(interval);
    }
  }, [syncState.status, matchState.status, refresh]);

  return (
    <div>
      {/* Health */}
      {health && (
        <div className="mb-6 flex flex-wrap gap-3">
          <span
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium",
              health.pureConfigured
                ? "bg-emerald-100 text-emerald-800"
                : "bg-red-100 text-red-800"
            )}
          >
            Pure API: {health.pureConfigured ? "Connected" : "Not configured"}
          </span>
          <span
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium",
              health.rorAvailable
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800"
            )}
          >
            ROR API ({health.rorBase}):{" "}
            {health.rorAvailable ? "Available" : "Unavailable"}
          </span>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">
            Organizations
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Total" value={stats.total} />
            <StatCard
              label="Approved"
              value={stats.approved}
              color="text-emerald-600"
            />
            <StatCard
              label="For approval"
              value={stats.forApproval}
              color="text-orange-600"
            />
            <StatCard
              label="With ROR"
              value={stats.withRor}
              color="text-blue-600"
            />
            <StatCard
              label="Without ROR"
              value={stats.withoutRor}
              color="text-gray-500"
            />
          </div>
        </div>
      )}

      {stats && (stats.totalMerged > 0 || stats.totalLinked > 0) && (
        <div className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">
            Actions performed
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard
              label="Orgs merged"
              value={stats.totalMerged}
              color="text-emerald-600"
            />
            <StatCard
              label="ROR IDs linked"
              value={stats.totalLinked}
              color="text-blue-600"
            />
          </div>
        </div>
      )}

      {stats && stats.matched > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">
            ROR Match Confidence
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Matched" value={stats.matched} />
            <StatCard
              label="High (>= 90%)"
              value={stats.highConfidence}
              color="text-emerald-600"
            />
            <StatCard
              label="Medium (60-89%)"
              value={stats.mediumConfidence}
              color="text-amber-600"
            />
            <StatCard
              label="Low (< 60%)"
              value={stats.lowConfidence}
              color="text-red-600"
            />
          </div>
        </div>
      )}

      {/* Jobs */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">
            1. Sync from Pure
          </h2>
          <JobProgress
            label="Fetch all external organizations into local database"
            state={syncState}
            onStart={async () => {
              await startSync();
              refresh();
            }}
            onStop={async () => {
              await stopSync();
              refresh();
            }}
          />
        </div>
        <div>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">
            2. Batch ROR Match
          </h2>
          <JobProgress
            label="Match unmatched orgs against ROR API"
            state={matchState}
            onStart={async () => {
              await startMatch();
              refresh();
            }}
            onStop={async () => {
              await stopMatch();
              refresh();
            }}
          />
        </div>
      </div>

      {stats && stats.total === 0 && syncState.status === "idle" && (
        <div className="mt-8 rounded-xl border-2 border-dashed border-gray-300 p-8 text-center">
          <div className="text-lg font-medium text-gray-700">
            Get started
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Click "Start" on the sync job to fetch organizations from Pure into
            the local database. Then run the batch ROR match to find candidates.
          </p>
        </div>
      )}
    </div>
  );
}
