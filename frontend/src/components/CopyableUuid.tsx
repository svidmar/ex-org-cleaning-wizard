import { useState } from "react";

export function CopyableUuid({ uuid }: { uuid: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(uuid);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title="Click to copy UUID"
      className="inline-flex items-center gap-1 font-mono text-xs text-gray-400 hover:text-[#594fbf] transition cursor-pointer"
    >
      {uuid}
      {copied && <span className="text-[10px] text-emerald-600">Copied!</span>}
    </button>
  );
}
