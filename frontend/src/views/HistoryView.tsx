import { useState, useEffect, useCallback } from "react";
import type { HistoryEntry } from "../types";
import { fetchHistory } from "../api";
import { CopyableUuid } from "../components/CopyableUuid";
import { cn } from "../components/utils";

const PAGE_SIZE = 50;

export function HistoryView() {
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (newOffset = 0) => {
    setLoading(true);
    try {
      const data = await fetchHistory(PAGE_SIZE, newOffset);
      setItems(data.items);
      setTotal(data.total);
      setOffset(newOffset);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(0);
  }, [load]);

  if (loading) {
    return <div className="py-12 text-center text-gray-400">Loading...</div>;
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-12 text-center text-gray-400">
        No actions recorded yet.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-gray-500">{total} total actions</div>
        <a
          href="/api/history/download"
          download
          className="rounded-lg bg-[#211a52] px-4 py-2 text-xs font-medium text-white hover:bg-[#594fbf] transition"
        >
          Download CSV
        </a>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-xs">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-600">
                Action
              </th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">
                Organization
              </th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">
                Merged into
              </th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">
                ROR
              </th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">
                Time
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((h) => {
              const details = parseDetails(h.details);
              return (
                <tr key={h.id}>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium",
                        h.action === "linked" &&
                          "bg-[#594fbf]/10 text-[#594fbf]",
                        h.action === "merged" &&
                          "bg-[#0e8563]/10 text-[#0e8563]",
                        h.action === "skipped" && "bg-gray-100 text-gray-600"
                      )}
                    >
                      {h.action}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-gray-800">{h.orgName}</div>
                    <CopyableUuid uuid={h.orgUuid} />
                  </td>
                  <td className="px-3 py-2">
                    {details.target_name ? (
                      <>
                        <div className="text-gray-800">
                          {details.target_name}
                        </div>
                        {details.target_uuid && (
                          <CopyableUuid uuid={details.target_uuid} />
                        )}
                      </>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-500">
                    {h.rorId?.replace("https://ror.org/", "") || "-"}
                  </td>
                  <td className="px-3 py-2 text-gray-400">
                    {h.createdAt
                      ? new Date(h.createdAt).toLocaleString()
                      : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
          disabled={offset === 0}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-30"
        >
          Previous
        </button>
        <button
          onClick={() => load(offset + PAGE_SIZE)}
          disabled={offset + PAGE_SIZE >= total}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-30"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function parseDetails(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
