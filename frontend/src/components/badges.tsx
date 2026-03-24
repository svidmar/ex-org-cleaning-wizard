import { cn } from "./utils";

export function WorkflowBadge({ step }: { step: string }) {
  const normalized = step.toLowerCase().replace(/\s/g, "");
  const isApproved =
    normalized.includes("approved") && !normalized.includes("forapproval");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded px-2 py-0.5 text-xs font-medium",
        isApproved
          ? "bg-[#0e8563]/10 text-[#0e8563]"
          : "bg-[#df8e2e]/10 text-[#bb5b17]"
      )}
    >
      {step}
    </span>
  );
}

export function CountryBadge({
  pureCountry,
  rorCountry,
}: {
  pureCountry: string | null;
  rorCountry: string | null;
}) {
  if (!pureCountry && !rorCountry) return null;

  const match =
    pureCountry && rorCountry
      ? pureCountry.toLowerCase().trim() === rorCountry.toLowerCase().trim()
      : null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium",
        match === true && "bg-[#0e8563]/10 text-[#0e8563]",
        match === false && "bg-[#df8e2e]/10 text-[#bb5b17]",
        match === null && "bg-gray-100 text-gray-600"
      )}
    >
      {match === true && "Country match"}
      {match === false && `${pureCountry || "?"} vs ${rorCountry || "?"}`}
      {match === null && (pureCountry || rorCountry || "No country")}
    </span>
  );
}

export function MatchTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    EXACT: "bg-[#0e8563]/10 text-[#0e8563] border-[#0e8563]/30",
    PHRASE: "bg-[#007fa3]/10 text-[#007fa3] border-[#007fa3]/30",
    "COMMON TERMS": "bg-[#df8e2e]/10 text-[#bb5b17] border-[#df8e2e]/30",
    FUZZY: "bg-[#cc445b]/10 text-[#cc445b] border-[#cc445b]/30",
    HEURISTICS: "bg-[#31a9c1]/10 text-[#007fa3] border-[#31a9c1]/30",
    ACRONYM: "bg-[#594fbf]/10 text-[#594fbf] border-[#594fbf]/30",
  };
  const c =
    colors[type.toUpperCase()] ||
    "bg-gray-100 text-gray-700 border-gray-300";
  return (
    <span
      className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${c}`}
    >
      {type}
    </span>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <span
      className={cn(
        "inline-flex rounded px-2 py-0.5 text-xs font-bold tabular-nums",
        pct >= 80 && "bg-[#0e8563]/10 text-[#0e8563]",
        pct >= 60 && pct < 80 && "bg-[#df8e2e]/10 text-[#bb5b17]",
        pct < 60 && "bg-[#cc445b]/10 text-[#cc445b]"
      )}
    >
      {pct}%
    </span>
  );
}
