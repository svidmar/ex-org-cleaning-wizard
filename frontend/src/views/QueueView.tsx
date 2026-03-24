import { useState, useEffect, useCallback } from "react";
import type { Organization } from "../types";
import { fetchOrganizations, fetchCountries } from "../api";
import { WorkflowBadge, ScoreBadge } from "../components/badges";
import { CopyableUuid } from "../components/CopyableUuid";

const PAGE_SIZE = 25;

interface QueuePreset {
  id: string;
  title: string;
  description: string;
  params: Record<string, unknown>;
  color: string;
}

const PRESETS: QueuePreset[] = [
  {
    id: "forapproval-high-match",
    title: "For approval + high match",
    description:
      "For-approval orgs with a high-confidence ROR match (>= 90%). Best candidates for quick linking.",
    params: { workflow: "forApproval", hasRor: false, hasMatch: true, minScore: 0.9, sortBy: "best_match_score", sortDir: "desc" },
    color: "border-emerald-300 bg-emerald-50",
  },
  {
    id: "forapproval-medium-match",
    title: "For approval + medium match",
    description:
      "For-approval orgs with a medium-confidence match (60-89%). Need manual review.",
    params: { workflow: "forApproval", hasRor: false, hasMatch: true, minScore: 0.6, maxScore: 0.9, sortBy: "best_match_score", sortDir: "desc" },
    color: "border-amber-300 bg-amber-50",
  },
  {
    id: "forapproval-no-match",
    title: "For approval, no match",
    description:
      "For-approval orgs where ROR found no good candidates. May need manual search.",
    params: { workflow: "forApproval", hasRor: false, hasMatch: false },
    color: "border-red-300 bg-red-50",
  },
  {
    id: "approved-no-ror",
    title: "Approved, no ROR",
    description:
      "Validated orgs missing a ROR ID. Adding one enables duplicate detection.",
    params: { workflow: "approved", hasRor: false, sortBy: "best_match_score", sortDir: "desc" },
    color: "border-blue-300 bg-blue-50",
  },
  {
    id: "all-with-ror",
    title: "All with ROR",
    description: "Orgs with ROR IDs — useful for finding merge candidates.",
    params: { hasRor: true },
    color: "border-gray-300 bg-gray-50",
  },
  {
    id: "all",
    title: "All organizations",
    description: "Browse everything, no filters.",
    params: {},
    color: "border-gray-300 bg-gray-50",
  },
];

export function QueueView({
  onSelectOrg,
}: {
  onSelectOrg: (org: Organization) => void;
}) {
  const [activePreset, setActivePreset] = useState<QueuePreset | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [countries, setCountries] = useState<string[]>([]);
  const [selectedCountry, setSelectedCountry] = useState("");

  // Load country list once
  useEffect(() => {
    fetchCountries().then(setCountries).catch(() => {});
  }, []);

  const loadOrgs = useCallback(
    async (params: Record<string, unknown>, newOffset = 0) => {
      setLoading(true);
      try {
        const data = await fetchOrganizations({
          ...params,
          offset: newOffset,
          size: PAGE_SIZE,
          country: selectedCountry || undefined,
        } as Parameters<typeof fetchOrganizations>[0]);
        setOrgs(data.items);
        setTotal(data.total);
        setOffset(newOffset);
      } catch {
        setOrgs([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [selectedCountry]
  );

  const activatePreset = useCallback(
    (preset: QueuePreset) => {
      setActivePreset(preset);
      setSearchActive(false);
      setSearchInput("");
      loadOrgs(preset.params, 0);
    },
    [loadOrgs]
  );

  const doSearch = useCallback(() => {
    if (!searchInput.trim()) return;
    setActivePreset(null);
    setSearchActive(true);
    loadOrgs({ search: searchInput.trim() }, 0);
  }, [searchInput, loadOrgs]);

  const goBack = () => {
    setActivePreset(null);
    setSearchActive(false);
    setOrgs([]);
    setTotal(0);
  };

  const currentParams = activePreset
    ? activePreset.params
    : searchActive
      ? { search: searchInput.trim() }
      : {};

  return (
    <div>
      {/* Search bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          doSearch();
        }}
        className="mb-6 flex gap-2"
      >
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search organizations by name..."
          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-[#211a52] px-6 py-3 text-sm font-medium text-white hover:bg-[#594fbf]"
        >
          Search
        </button>
      </form>

      {/* Preset cards */}
      {!activePreset && !searchActive && (
        <div>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            Pick a queue
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => activatePreset(p)}
                className={`rounded-xl border-2 p-4 text-left transition hover:shadow-md ${p.color}`}
              >
                <div className="text-sm font-semibold text-gray-900">
                  {p.title}
                </div>
                <div className="mt-1 text-xs text-gray-600">
                  {p.description}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active queue */}
      {(activePreset || searchActive) && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              onClick={goBack}
              className="text-sm text-[#594fbf] hover:underline"
            >
              &larr; Back to queues
            </button>
            <span className="text-sm font-medium text-gray-700">
              {activePreset?.title || `Search: "${searchInput}"`}
            </span>

            {countries.length > 0 && (
              <select
                value={selectedCountry}
                onChange={(e) => {
                  setSelectedCountry(e.target.value);
                  // Re-run with country filter
                  loadOrgs(
                    { ...currentParams, country: e.target.value || undefined },
                    0
                  );
                }}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:outline-none"
              >
                <option value="">All countries</option>
                {countries.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </div>

          {loading ? (
            <div className="py-12 text-center text-gray-400">Loading...</div>
          ) : (
            <>
              <div className="mb-2 text-sm text-gray-500">
                {total.toLocaleString()} organizations — page{" "}
                {Math.floor(offset / PAGE_SIZE) + 1} of{" "}
                {Math.max(1, Math.ceil(total / PAGE_SIZE))}
              </div>

              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-200 bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">
                        Name
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">
                        Country
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">
                        Workflow
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">
                        Best Match
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">
                        ROR
                      </th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {orgs.map((org) => (
                      <tr
                        key={org.uuid}
                        className="hover:bg-blue-50/50 transition"
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">
                            {org.name}
                          </div>
                          <CopyableUuid uuid={org.uuid} />
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {org.country || (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <WorkflowBadge step={org.workflowStep} />
                        </td>
                        <td className="px-4 py-3">
                          {org.bestMatchScore != null ? (
                            <ScoreBadge score={org.bestMatchScore} />
                          ) : (
                            <span className="text-xs text-gray-300">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {org.hasRor ? (
                            <a
                              href={org.rorId || "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[#594fbf] hover:underline text-xs"
                            >
                              {org.rorId?.replace("https://ror.org/", "")}
                            </a>
                          ) : (
                            <span className="text-xs text-gray-300">None</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => onSelectOrg(org)}
                            className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition"
                          >
                            {org.hasRor ? "View" : "Review"}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {orgs.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-8 text-center text-gray-400"
                        >
                          No organizations found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <button
                  onClick={() =>
                    loadOrgs(currentParams, Math.max(0, offset - PAGE_SIZE))
                  }
                  disabled={offset === 0}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-30"
                >
                  Previous
                </button>
                <button
                  onClick={() =>
                    loadOrgs(currentParams, offset + PAGE_SIZE)
                  }
                  disabled={offset + PAGE_SIZE >= total}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
