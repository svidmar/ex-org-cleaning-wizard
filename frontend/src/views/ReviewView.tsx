import { useState, useEffect, useCallback } from "react";
import type { Organization, OrgWithMatches, RorCandidate } from "../types";
import {
  fetchOrganization,
  linkRor,
  rematchOrganization,
} from "../api";
import {
  WorkflowBadge,
  CountryBadge,
  MatchTypeBadge,
  ScoreBadge,
} from "../components/badges";
import { CopyableUuid } from "../components/CopyableUuid";
import { DependencyInfo } from "../components/DependencyInfo";
import { ConfirmModal } from "../components/ConfirmModal";

export function ReviewView({
  org: initialOrg,
  onBack,
  addToast,
}: {
  org: Organization;
  onBack: () => void;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}) {
  const [orgDetail, setOrgDetail] = useState<OrgWithMatches | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedRor, setSelectedRor] = useState<RorCandidate | null>(null);
  const [confirmLink, setConfirmLink] = useState(false);
  const [linking, setLinking] = useState(false);
  const [rematching, setRematching] = useState(false);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await fetchOrganization(initialOrg.uuid);
      setOrgDetail(detail);
      // Auto-select top candidate if high confidence
      if (detail.rorMatches.length > 0 && detail.rorMatches[0].score >= 0.7) {
        setSelectedRor(detail.rorMatches[0]);
      }
    } catch (e) {
      addToast(`Failed to load org details: ${e}`, "error");
    } finally {
      setLoading(false);
    }
  }, [initialOrg.uuid, addToast]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const doLink = useCallback(async () => {
    if (!orgDetail || !selectedRor) return;
    setLinking(true);
    try {
      const result = await linkRor(
        orgDetail.uuid,
        selectedRor.rorId,
        selectedRor.rorName
      );
      if (result.status === "already_linked") {
        addToast("Already has a ROR ID linked.", "info");
      } else {
        addToast(`Linked ROR ID to ${orgDetail.name}`, "success");
      }
      setConfirmLink(false);
      // Refresh
      await loadDetail();
    } catch (e) {
      addToast(`Failed to link: ${e}`, "error");
    } finally {
      setLinking(false);
    }
  }, [orgDetail, selectedRor, addToast, loadDetail]);

  const doRematch = useCallback(async () => {
    if (!orgDetail) return;
    setRematching(true);
    try {
      await rematchOrganization(orgDetail.uuid);
      addToast("Re-matched against ROR", "success");
      await loadDetail();
    } catch (e) {
      addToast(`Re-match failed: ${e}`, "error");
    } finally {
      setRematching(false);
    }
  }, [orgDetail, addToast, loadDetail]);

  if (loading) {
    return <div className="py-12 text-center text-gray-400">Loading...</div>;
  }

  if (!orgDetail) {
    return (
      <div className="py-12 text-center text-gray-400">
        Organization not found.
      </div>
    );
  }

  const candidates = orgDetail.rorMatches || [];

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 text-sm text-[#594fbf] hover:underline"
      >
        &larr; Back to queue
      </button>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Pure org details */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
            Pure External Organization
          </div>
          <h2 className="text-lg font-semibold text-gray-900">
            {orgDetail.name}
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <WorkflowBadge step={orgDetail.workflowStep} />
            {orgDetail.country && (
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                {orgDetail.country}
              </span>
            )}
          </div>

          <div className="mt-3">
            <CopyableUuid uuid={orgDetail.uuid} />
          </div>

          <div className="mt-3">
            <DependencyInfo uuid={orgDetail.uuid} />
          </div>

          {orgDetail.identifiers.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 text-xs font-medium text-gray-500">
                Identifiers
              </div>
              <div className="flex flex-wrap gap-1">
                {orgDetail.identifiers.map(
                  (id: { type?: { term?: { en_GB?: string } }; id: string }, i: number) => (
                    <span
                      key={i}
                      className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                    >
                      {id.type?.term?.en_GB || "ID"}: {id.id}
                    </span>
                  )
                )}
              </div>
            </div>
          )}

          {Object.keys(orgDetail.nameLocales).length > 1 && (
            <div className="mt-4">
              <div className="mb-1 text-xs font-medium text-gray-500">
                Name variants
              </div>
              {Object.entries(orgDetail.nameLocales).map(([locale, name]) => (
                <div key={locale} className="text-xs text-gray-600">
                  <span className="font-mono text-gray-400">{locale}:</span>{" "}
                  {name}
                </div>
              ))}
            </div>
          )}

          {orgDetail.hasRor && (
            <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
              ROR ID:{" "}
              <a
                href={orgDetail.rorId || "#"}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline"
              >
                {orgDetail.rorId}
              </a>
            </div>
          )}
        </div>

        {/* Right: ROR candidates */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-gray-700">
              ROR Candidates ({candidates.length})
            </div>
            <div className="flex gap-2">
              <button
                onClick={doRematch}
                disabled={rematching}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {rematching ? "Matching..." : "Re-match"}
              </button>
              {selectedRor && !orgDetail.hasRor && (
                <button
                  onClick={() => setConfirmLink(true)}
                  className="rounded-lg bg-[#211a52] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#594fbf]"
                >
                  Link selected ROR
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {candidates.map((c) => (
              <label
                key={c.rorId}
                className={`cursor-pointer rounded-xl border bg-white p-4 transition ${
                  selectedRor?.rorId === c.rorId
                    ? "border-blue-500 ring-2 ring-blue-200"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="ror-candidate"
                    checked={selectedRor?.rorId === c.rorId}
                    onChange={() => setSelectedRor(c)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">
                        {c.rorName}
                      </span>
                      {c.chosen === 1 && (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
                          ROR Pick
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <ScoreBadge score={c.score} />
                      <MatchTypeBadge type={c.matchingType} />
                      <CountryBadge
                        pureCountry={orgDetail.country}
                        rorCountry={c.country}
                      />
                    </div>

                    {c.city && (
                      <div className="mt-1 text-xs text-gray-500">
                        {c.city}, {c.country}
                      </div>
                    )}

                    {c.aliases.length > 0 && (
                      <div className="mt-1 text-xs text-gray-400">
                        Also known as: {c.aliases.slice(0, 3).join(", ")}
                        {c.aliases.length > 3 &&
                          ` +${c.aliases.length - 3} more`}
                      </div>
                    )}

                    <div className="mt-1">
                      <a
                        href={c.rorId}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-500 hover:underline"
                      >
                        {c.rorId}
                      </a>
                    </div>
                  </div>
                </div>
              </label>
            ))}

            {candidates.length === 0 && !orgDetail.hasRor && (
              <div className="rounded-xl border border-gray-200 bg-white p-5 text-center text-gray-500">
                No ROR matches found. Try clicking "Re-match" to search again.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirm link modal */}
      {confirmLink && selectedRor && (
        <ConfirmModal
          title="Confirm ROR Link"
          confirmLabel={linking ? "Linking..." : "Confirm & Link"}
          onConfirm={doLink}
          onCancel={() => setConfirmLink(false)}
        >
          <div className="space-y-2">
            <p>
              <span className="font-medium">Organization:</span>{" "}
              {orgDetail.name}
            </p>
            <p>
              <span className="font-medium">UUID:</span> {orgDetail.uuid}
            </p>
            <p>
              <span className="font-medium">Country:</span>{" "}
              {orgDetail.country || "Not set"}
            </p>
            <hr className="my-2" />
            <p>
              <span className="font-medium">ROR match:</span>{" "}
              {selectedRor.rorName}
            </p>
            <p>
              <span className="font-medium">ROR ID:</span> {selectedRor.rorId}
            </p>
            <p>
              <span className="font-medium">ROR Country:</span>{" "}
              {selectedRor.country || "Unknown"}
            </p>
            <div className="flex gap-2">
              <ScoreBadge score={selectedRor.score} />
              <MatchTypeBadge type={selectedRor.matchingType} />
              <CountryBadge
                pureCountry={orgDetail.country}
                rorCountry={selectedRor.country}
              />
            </div>
            {orgDetail.country &&
              selectedRor.country &&
              orgDetail.country.toLowerCase() !==
                selectedRor.country.toLowerCase() && (
                <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                  Warning: Country mismatch! Pure says "{orgDetail.country}" but
                  ROR says "{selectedRor.country}".
                </div>
              )}
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}
