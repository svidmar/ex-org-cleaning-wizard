import { useState, useEffect } from "react";
import type { Dependencies } from "../types";
import { fetchDependencies } from "../api";

export function DependencyInfo({ uuid }: { uuid: string }) {
  const [deps, setDeps] = useState<Dependencies | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchDependencies(uuid)
      .then(setDeps)
      .catch(() => setDeps(null))
      .finally(() => setLoading(false));
  }, [uuid]);

  if (loading)
    return <span className="text-xs text-gray-400">Loading deps...</span>;
  if (!deps) return null;

  if (deps.total === 0) {
    return <span className="text-xs text-gray-400">No dependents</span>;
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
      {Object.entries(deps.byType).map(([type, count]) => (
        <span key={type} title={type} className="truncate max-w-48">
          {count} {type}
        </span>
      ))}
      <span className="text-gray-400 shrink-0">({deps.total} total)</span>
    </span>
  );
}
