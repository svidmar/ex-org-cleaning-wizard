import { useState, useEffect, useCallback } from "react";
import type { MergeGroup, Organization } from "../types";
import { fetchMergeCandidates, mergeOrganizations } from "../api";
import { WorkflowBadge, ScoreBadge } from "../components/badges";
import { CopyableUuid } from "../components/CopyableUuid";
import { DependencyInfo } from "../components/DependencyInfo";
import { ConfirmModal } from "../components/ConfirmModal";

export function MergeView({
  addToast,
}: {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}) {
  const [groups, setGroups] = useState<MergeGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmMerge, setConfirmMerge] = useState<{
    group: MergeGroup;
    selected: Organization[];
    linkRor: boolean;
  } | null>(null);
  const [merging, setMerging] = useState(false);
  const [expandedUuid, setExpandedUuid] = useState<string | null>(null);
  const [minScore, setMinScore] = useState(0.8);
  const [search, setSearch] = useState("");
  // Track selected merge target per group (by group index) when multiple approved
  const [selectedTarget, setSelectedTarget] = useState<Record<number, string>>({});
  // Track whether to skip ROR linking per group
  const [skipRor, setSkipRor] = useState<Record<number, boolean>>({});
  const [mergeError, setMergeError] = useState<string | null>(null);

  // Track deselected UUIDs per group (by index). Everything is selected by default.
  const [deselected, setDeselected] = useState<Record<number, Set<string>>>(
    {}
  );

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchMergeCandidates(minScore);
      setGroups(data.groups);
      setDeselected({});
    } catch (e) {
      addToast(`Failed to load merge candidates: ${e}`, "error");
    } finally {
      setLoading(false);
    }
  }, [addToast, minScore]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const toggleOrg = (groupIdx: number, uuid: string) => {
    setDeselected((prev) => {
      const next = { ...prev };
      const set = new Set(next[groupIdx] || []);
      if (set.has(uuid)) {
        set.delete(uuid);
      } else {
        set.add(uuid);
      }
      next[groupIdx] = set;
      return next;
    });
  };

  const getSelected = (groupIdx: number, group: MergeGroup) => {
    const excluded = deselected[groupIdx] || new Set();
    return group.forApproval.filter((o) => !excluded.has(o.uuid));
  };

  const doMerge = useCallback(
    async (group: MergeGroup, selected: Organization[], linkRor: boolean) => {
      if (group.approved.length !== 1) {
        addToast("Need exactly one approved org as target.", "error");
        return;
      }
      if (selected.length === 0) {
        addToast("No orgs selected to merge.", "error");
        return;
      }
      setMerging(true);
      try {
        const target = group.approved[0];
        const sources = selected.map((o) => o.uuid);
        const result = await mergeOrganizations(
          target.uuid,
          sources,
          linkRor ? group.rorId : undefined
        );

        // Build success message
        const actions = [];
        if (result.rorLinked) actions.push("linked ROR");
        if (result.mergedCount > 0) actions.push(`merged ${result.mergedCount} org(s)`);

        if (result.mergedCount > 0) {
          addToast(
            `${actions.join(" + ")} into ${target.name}`,
            "success"
          );
        }

        // Remove successfully merged orgs from the group
        const mergedUuids = sources.filter(
          (uuid) => !result.failed.some((f) => f.uuid === uuid)
        );
        setGroups((gs) =>
          gs
            .map((g) => {
              if (g !== group) return g;
              const remaining = g.forApproval.filter(
                (o) => !mergedUuids.includes(o.uuid)
              );
              if (remaining.length === 0) return null;
              return { ...g, forApproval: remaining, total: g.approved.length + remaining.length };
            })
            .filter((g): g is MergeGroup => g !== null)
        );

        // Show failures if any
        if (result.failed.length > 0) {
          const failLines = result.failed.map(
            (f) => `${f.name} (${f.uuid.slice(0, 8)}...): ${f.error}`
          );
          setMergeError(
            `${result.mergedCount} merged, ${result.failedCount} failed:\n\n${failLines.join("\n\n")}`
          );
        } else {
          setConfirmMerge(null);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setMergeError(msg);
      } finally {
        setMerging(false);
      }
    },
    [addToast]
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="text-sm text-gray-600">
          Duplicate groups identified by ROR match. Uncheck any false positives
          before merging. The ROR ID will be linked automatically if needed.
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-600">
            Min score
          </label>
          <select
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:outline-none"
          >
            <option value={0.9}>90%+</option>
            <option value={0.8}>80%+</option>
            <option value={0.7}>70%+</option>
            <option value={0.6}>60%+</option>
          </select>
        </div>
      </div>

      {/* Search */}
      {groups.length > 0 && (
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter groups by name, ROR ID, or country..."
            className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-[#594fbf] focus:ring-1 focus:ring-[#594fbf] focus:outline-none"
          />
        </div>
      )}

      {(() => {
        const q = search.toLowerCase().trim();
        const filtered = q
          ? groups.filter((g) => {
              const allNames = [
                ...g.approved.map((o) => o.name),
                ...g.forApproval.map((o) => o.name),
              ];
              return (
                allNames.some((n) => n.toLowerCase().includes(q)) ||
                (g.rorName && g.rorName.toLowerCase().includes(q)) ||
                g.rorId.toLowerCase().includes(q) ||
                (g.country && g.country.toLowerCase().includes(q))
              );
            })
          : groups;

        return (
          <>
            {mergeError && (
              <div className="mb-4 rounded-xl border border-[#cc445b]/30 bg-[#cc445b]/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-[#cc445b]">Merge failed</div>
                    <div className="mt-1 text-xs text-gray-700 whitespace-pre-wrap break-words">
                      {mergeError}
                    </div>
                  </div>
                  <button
                    onClick={() => setMergeError(null)}
                    className="shrink-0 text-gray-400 hover:text-gray-600 text-lg leading-none"
                  >
                    &times;
                  </button>
                </div>
              </div>
            )}

            {loading ? (
              <div className="py-12 text-center text-gray-400">
                Loading merge candidates...
              </div>
            ) : groups.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white px-4 py-12 text-center text-gray-400">
                No merge candidates found. Run the batch ROR match first, then
                duplicates will appear here.
              </div>
            ) : (
              <div className="mb-3 text-sm text-gray-500">
                {search
                  ? `${filtered.length} of ${groups.length} group(s)`
                  : `${groups.length} duplicate group(s)`}
              </div>
            )}

            <div className="flex flex-col gap-3">
              {filtered.map((g) => {
                const origIdx = groups.indexOf(g);
                const hasMultipleApproved = g.approved.length > 1;
                const chosenTargetUuid = hasMultipleApproved
                  ? selectedTarget[origIdx]
                  : g.approved[0]?.uuid;
                const target = g.approved.find((o) => o.uuid === chosenTargetUuid) || g.approved[0];
                const canMerge = !!chosenTargetUuid;
                const targetHasRor = target?.hasRor;
                const selected = getSelected(origIdx, g);

                return (
                  <div
                    key={origIdx}
                    className="rounded-xl border border-gray-200 bg-white p-4"
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900 truncate">
                            {target?.name || "Select a merge target"}
                          </span>
                          {canMerge && <WorkflowBadge step="Approved" />}
                          {canMerge && !targetHasRor && (
                            <span className="rounded bg-[#594fbf]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#594fbf]">
                              + link ROR
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                          {g.country && <span>{g.country}</span>}
                          <span className="text-gray-300">|</span>
                          <span>
                            ROR:{" "}
                            <a
                              href={g.rorId}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[#594fbf] hover:underline"
                            >
                              {g.rorName ||
                                g.rorId.replace("https://ror.org/", "")}
                            </a>
                          </span>
                          <span className="text-gray-300">|</span>
                          <span>
                            {selected.length}/{g.forApproval.length} selected
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setMergeError(null);
                          setConfirmMerge({
                            group: { ...g, approved: [target] },
                            selected,
                            linkRor: !skipRor[origIdx],
                          });
                        }
                        }
                        disabled={!canMerge || selected.length === 0}
                        className="shrink-0 rounded-lg bg-[#0e8563] px-4 py-2 text-xs font-medium text-white hover:bg-[#0e8563]/80 disabled:opacity-30"
                      >
                        Merge {selected.length > 0 ? `(${selected.length})` : ""}
                      </button>
                    </div>

                    {/* Option to skip ROR linking */}
                    {!target?.hasRor && (
                      <div className="mt-2 flex items-center gap-2">
                        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!skipRor[origIdx]}
                            onChange={() =>
                              setSkipRor((prev) => ({
                                ...prev,
                                [origIdx]: !prev[origIdx],
                              }))
                            }
                          />
                          Don't link ROR ID (wrong match)
                        </label>
                      </div>
                    )}

                    {/* Multiple approved: select target */}
                    {hasMultipleApproved && (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <div className="text-xs font-medium text-amber-800 mb-2">
                          {g.approved.length} approved organizations — select which one to keep as the merge target:
                        </div>
                        <div className="space-y-1.5">
                          {g.approved.map((o) => (
                            <label
                              key={o.uuid}
                              className={`flex items-start gap-2 rounded p-2 text-xs cursor-pointer transition ${
                                chosenTargetUuid === o.uuid
                                  ? "bg-[#0e8563]/10 border border-[#0e8563]/30"
                                  : "bg-white hover:bg-gray-50"
                              }`}
                            >
                              <input
                                type="radio"
                                name={`target-${origIdx}`}
                                checked={chosenTargetUuid === o.uuid}
                                onChange={() =>
                                  setSelectedTarget((prev) => ({
                                    ...prev,
                                    [origIdx]: o.uuid,
                                  }))
                                }
                                className="mt-0.5 shrink-0"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-gray-900 truncate">
                                  {o.name}
                                </div>
                                <CopyableUuid uuid={o.uuid} />
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 text-gray-500">
                                  {o.country && <span>{o.country}</span>}
                                  {o.rorId && (
                                    <>
                                      <span className="text-gray-300">|</span>
                                      <span>
                                        ROR:{" "}
                                        <a
                                          href={o.rorId}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-[#594fbf] hover:underline"
                                        >
                                          {o.rorId.replace("https://ror.org/", "")}
                                        </a>
                                      </span>
                                    </>
                                  )}
                                </div>
                                <div className="mt-1">
                                  <DependencyInfo uuid={o.uuid} />
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

              {/* For-approval org rows with checkboxes */}
              <div className="mt-3 space-y-1">
                {g.forApproval.map((o) => {
                  const isSelected = !(
                    deselected[origIdx] && deselected[origIdx].has(o.uuid)
                  );
                  return (
                    <OrgRow
                      key={o.uuid}
                      org={o}
                      selected={isSelected}
                      onToggleSelect={() => toggleOrg(origIdx, o.uuid)}
                      expanded={expandedUuid === o.uuid}
                      onToggleExpand={() =>
                        setExpandedUuid(
                          expandedUuid === o.uuid ? null : o.uuid
                        )
                      }
                    />
                  );
                })}
              </div>

            </div>
          );
        })}
            </div>
          </>
        );
      })()}

      {/* Confirm modal */}
      {confirmMerge && (
        <ConfirmModal
          title="Confirm Merge"
          confirmLabel={
            merging
              ? "Merging..."
              : `Confirm Merge (${confirmMerge.selected.length})`
          }
          onConfirm={() =>
            doMerge(confirmMerge.group, confirmMerge.selected, confirmMerge.linkRor)
          }
          onCancel={() => setConfirmMerge(null)}
        >
          <div className="space-y-3">
            <div>
              <div className="text-xs font-medium uppercase text-gray-400 mb-1">
                Target (survivor)
              </div>
              {confirmMerge.group.approved.map((o) => (
                <div
                  key={o.uuid}
                  className="rounded-lg bg-emerald-50 p-3 text-sm"
                >
                  <div className="font-medium text-gray-900">{o.name}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {o.country || "No country"} &middot; {o.uuid}
                  </div>
                  <div className="mt-2">
                    <DependencyInfo uuid={o.uuid} />
                  </div>
                  {!o.hasRor && confirmMerge.linkRor && (
                    <div className="mt-2 rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">
                      ROR ID{" "}
                      <span className="font-mono">
                        {confirmMerge.group.rorId.replace(
                          "https://ror.org/",
                          ""
                        )}
                      </span>{" "}
                      will be linked to this org
                    </div>
                  )}
                  {!o.hasRor && !confirmMerge.linkRor && (
                    <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
                      ROR ID will NOT be linked (skipped)
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div>
              <div className="text-xs font-medium uppercase text-gray-400 mb-1">
                Will be merged in ({confirmMerge.selected.length})
              </div>
              <div className="space-y-2">
                {confirmMerge.selected.map((o) => (
                  <div
                    key={o.uuid}
                    className="rounded-lg bg-orange-50 p-3 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-gray-800">{o.name}</span>
                      {o.bestMatchScore != null && (
                        <ScoreBadge score={o.bestMatchScore} />
                      )}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {o.country || "No country"} &middot; {o.uuid}
                    </div>
                    <div className="mt-2">
                      <DependencyInfo uuid={o.uuid} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-blue-50 p-2 text-xs text-blue-800">
              All content from the selected for-approval orgs will be
              transferred to the approved target. This cannot be undone.
            </div>

            {mergeError && (
              <div className="rounded-lg border border-[#cc445b]/30 bg-[#cc445b]/5 p-3 mt-3">
                <div className="text-sm font-medium text-[#cc445b]">Merge failed</div>
                <div className="mt-1 text-xs text-gray-700 whitespace-pre-wrap break-words">
                  {mergeError}
                </div>
              </div>
            )}
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}

function OrgRow({
  org,
  selected,
  onToggleSelect,
  expanded,
  onToggleExpand,
}: {
  org: Organization;
  selected: boolean;
  onToggleSelect: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  return (
    <div
      className={`rounded text-xs transition ${
        selected ? "bg-gray-50" : "bg-gray-50/50 opacity-50"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="shrink-0"
        />
        <button
          onClick={onToggleExpand}
          className="flex flex-1 items-center gap-2 text-left hover:text-gray-900 transition min-w-0"
        >
          <WorkflowBadge step="For approval" />
          <span className="flex-1 text-gray-700 truncate">{org.name}</span>
          {org.bestMatchScore != null && (
            <ScoreBadge score={org.bestMatchScore} />
          )}
          <span className="text-gray-400 shrink-0">
            {expanded ? "-" : "+"}
          </span>
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-2 pl-9 space-y-1">
          <CopyableUuid uuid={org.uuid} />
          {org.country && (
            <div className="text-gray-500">Country: {org.country}</div>
          )}
          <DependencyInfo uuid={org.uuid} />
        </div>
      )}
    </div>
  );
}
