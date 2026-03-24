import type { JobState } from "../types";
import { cn } from "./utils";

export function JobProgress({
  label,
  state,
  onStart,
  onStop,
}: {
  label: string;
  state: JobState;
  onStart: () => void;
  onStop: () => void;
}) {
  const pct =
    state.total > 0 ? Math.round((state.progress / state.total) * 100) : 0;
  const isRunning = state.status === "running";
  const isPaused = state.status === "paused";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-gray-900">{label}</div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex rounded px-2 py-0.5 text-xs font-medium",
              state.status === "completed" &&
                "bg-[#0e8563]/10 text-[#0e8563]",
              state.status === "running" && "bg-[#594fbf]/10 text-[#594fbf]",
              state.status === "paused" && "bg-[#df8e2e]/10 text-[#bb5b17]",
              state.status === "error" && "bg-[#cc445b]/10 text-[#cc445b]",
              state.status === "idle" && "bg-gray-100 text-gray-600"
            )}
          >
            {state.status}
          </span>
          {isRunning ? (
            <button
              onClick={onStop}
              className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={onStart}
              className="rounded-lg bg-[#211a52] px-3 py-1 text-xs font-medium text-white hover:bg-[#594fbf]"
            >
              {isPaused ? "Resume" : "Start"}
            </button>
          )}
        </div>
      </div>

      {(isRunning || isPaused || state.status === "completed") && (
        <>
          <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                state.status === "completed"
                  ? "bg-[#0e8563]"
                  : "bg-[#594fbf]"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {state.progress.toLocaleString()} / {state.total.toLocaleString()}{" "}
            ({pct}%)
          </div>
        </>
      )}

      {state.error_message && (
        <div className="mt-2 text-xs text-[#cc445b]">{state.error_message}</div>
      )}
    </div>
  );
}
