import type {
  OrgListResponse,
  OrgWithMatches,
  Dependencies,
  JobState,
  Stats,
  MergeGroup,
  HistoryEntry,
} from "./types";

const BASE = "/api";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!resp.ok) {
    const body = await resp.text();
    // Try to extract a clean error message from JSON response
    let message = body;
    try {
      const json = JSON.parse(body);
      message = json.detail || json.message || json.title || body;
    } catch {
      // body wasn't JSON, use as-is
    }
    throw new Error(message);
  }
  return resp.json();
}

// Health
export async function fetchHealth() {
  return apiFetch<{
    status: string;
    pureConfigured: boolean;
    rorAvailable: boolean;
    rorBase: string;
  }>("/health");
}

// Sync
export async function startSync() {
  return apiFetch<JobState>("/sync/start", { method: "POST" });
}

export async function getSyncStatus() {
  return apiFetch<JobState>("/sync/status");
}

export async function stopSync() {
  return apiFetch<JobState>("/sync/stop", { method: "POST" });
}

// Match
export async function startMatch() {
  return apiFetch<JobState>("/match/start", { method: "POST" });
}

export async function getMatchStatus() {
  return apiFetch<JobState>("/match/status");
}

export async function stopMatch() {
  return apiFetch<JobState>("/match/stop", { method: "POST" });
}

// Stats
export async function fetchStats(): Promise<Stats> {
  return apiFetch<Stats>("/stats");
}

export async function fetchCountries(): Promise<string[]> {
  return apiFetch<string[]>("/countries");
}

// Organizations
export async function fetchOrganizations(params: {
  offset?: number;
  size?: number;
  workflow?: string;
  hasRor?: boolean;
  hasMatch?: boolean;
  minScore?: number;
  maxScore?: number;
  country?: string;
  search?: string;
  sortBy?: string;
  sortDir?: string;
}): Promise<OrgListResponse> {
  const sp = new URLSearchParams();
  if (params.offset != null) sp.set("offset", String(params.offset));
  if (params.size != null) sp.set("size", String(params.size));
  if (params.workflow) sp.set("workflow", params.workflow);
  if (params.hasRor != null) sp.set("hasRor", String(params.hasRor));
  if (params.hasMatch != null) sp.set("hasMatch", String(params.hasMatch));
  if (params.minScore != null) sp.set("minScore", String(params.minScore));
  if (params.maxScore != null) sp.set("maxScore", String(params.maxScore));
  if (params.country) sp.set("country", params.country);
  if (params.search) sp.set("search", params.search);
  if (params.sortBy) sp.set("sortBy", params.sortBy);
  if (params.sortDir) sp.set("sortDir", params.sortDir);
  return apiFetch<OrgListResponse>(`/organizations?${sp}`);
}

export async function fetchOrganization(
  uuid: string
): Promise<OrgWithMatches> {
  return apiFetch<OrgWithMatches>(`/organizations/${uuid}`);
}

export async function fetchDependencies(
  uuid: string
): Promise<Dependencies> {
  return apiFetch<Dependencies>(`/organizations/${uuid}/dependencies`);
}

export async function rematchOrganization(
  uuid: string
): Promise<{ uuid: string; candidateCount: number }> {
  return apiFetch(`/organizations/${uuid}/rematch`, { method: "POST" });
}

// Link ROR
export async function linkRor(
  uuid: string,
  rorId: string,
  rorName?: string
): Promise<{ status: string; uuid: string; rorId: string }> {
  return apiFetch(`/organizations/link-ror`, {
    method: "POST",
    body: JSON.stringify({ uuid, rorId, rorName }),
  });
}

// Merge
export async function fetchMergeCandidates(
  minScore = 0.8
): Promise<{ groups: MergeGroup[] }> {
  return apiFetch<{ groups: MergeGroup[] }>(
    `/merge-candidates?minScore=${minScore}`
  );
}

export async function mergeOrganizations(
  targetUuid: string,
  sourceUuids: string[],
  rorId?: string
): Promise<{
  status: string;
  mergedCount: number;
  failedCount: number;
  failed: { uuid: string; name: string; error: string }[];
  rorLinked: boolean;
}> {
  return apiFetch(`/organizations/merge`, {
    method: "POST",
    body: JSON.stringify({ targetUuid, sourceUuids, rorId }),
  });
}

// History
export async function fetchHistory(
  limit = 50,
  offset = 0
): Promise<{ items: HistoryEntry[]; total: number }> {
  return apiFetch(`/history?limit=${limit}&offset=${offset}`);
}
