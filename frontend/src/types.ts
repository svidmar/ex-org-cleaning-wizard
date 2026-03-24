export interface Organization {
  uuid: string;
  name: string;
  nameLocales: Record<string, string>;
  country: string | null;
  workflowStep: string;
  hasRor: boolean;
  rorId: string | null;
  identifiers: Identifier[];
  version: string | null;
  pureUrl: string;
  bestMatchScore: number | null;
  bestMatchRorId: string | null;
  bestMatchChosen: boolean;
  syncedAt: string;
}

export interface Identifier {
  typeDiscriminator: string;
  id: string;
  type: {
    uri: string;
    term: Record<string, string>;
  };
}

export interface RorCandidate {
  id?: number;
  rorId: string;
  rorName: string;
  score: number;
  matchingType: string;
  chosen: number;
  country: string | null;
  countryCode: string | null;
  city: string | null;
  aliases: string[];
  labels: string[];
  types: string[];
  orgUuid?: string;
  fetchedAt?: string;
}

export interface OrgWithMatches extends Organization {
  rorMatches: RorCandidate[];
}

export interface OrgListResponse {
  items: Organization[];
  total: number;
  offset: number;
  size: number;
}

export interface MergeGroup {
  rorId: string;
  rorName: string | null;
  country: string;
  approved: Organization[];
  forApproval: Organization[];
  total: number;
}

export interface Dependencies {
  total: number;
  byType: Record<string, number>;
  items: { systemName: string; uuid: string }[];
}

export interface JobState {
  job_name: string;
  status: "idle" | "running" | "paused" | "completed" | "error";
  progress: number;
  total: number;
  started_at: string | null;
  updated_at: string | null;
  error_message: string | null;
  checkpoint: string | null;
}

export interface Stats {
  total: number;
  approved: number;
  forApproval: number;
  withRor: number;
  withoutRor: number;
  matched: number;
  unmatched: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  forApprovalNoRor: number;
  totalMerged: number;
  totalLinked: number;
}

export interface HistoryEntry {
  id: number;
  action: string;
  orgUuid: string;
  orgName: string;
  rorId: string | null;
  rorName: string | null;
  score: number | null;
  matchingType: string | null;
  details: string;
  createdAt: string;
}
