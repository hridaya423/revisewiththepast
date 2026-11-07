"use client";

import { ActionButton } from "@/app/_components/ui/action-button";
import { useState } from "react";

type GenerationStateProps = {
  canGenerate: boolean;
  isPending: boolean;
  generationMode: "paper" | "paper-and-mark-scheme" | null;
  paperCount: number;
  compact?: boolean;
  onGenerate: (includeMarkScheme: boolean) => void;
};

export function GenerationState({ canGenerate, isPending, generationMode, paperCount, compact = false, onGenerate }: GenerationStateProps) {
  const [includeMarkScheme, setIncludeMarkScheme] = useState(false);
  const paperLabel = paperCount > 1 ? `Create ${paperCount} papers` : "Create paper";

  return (
    <div className={`generation-actions grid gap-3 ${compact ? "grid-cols-1" : ""}`}>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-text-secondary">
        <input type="checkbox" checked={includeMarkScheme} onChange={(event) => setIncludeMarkScheme(event.target.checked)} disabled={isPending} className="ui-checkbox shrink-0" />
        Include a mark scheme
      </label>
      <ActionButton
        state={isPending && generationMode ? "pending" : "idle"}
        idleLabel={paperLabel}
        pendingLabel="Building paper"
        onClick={() => onGenerate(includeMarkScheme)}
        disabled={!canGenerate || isPending}
        className="min-h-12 w-full rounded-md bg-accent px-4 text-sm font-bold text-white hover:bg-accent-deep disabled:opacity-40"
      />
    </div>
  );
}
