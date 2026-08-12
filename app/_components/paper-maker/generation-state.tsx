"use client";

import { ActionButton } from "@/app/_components/ui/action-button";
import { OperationProgress } from "@/app/_components/ui/operation-progress";

type GenerationStateProps = {
  canGenerate: boolean;
  isPending: boolean;
  generationMode: "paper" | "paper-and-mark-scheme" | null;
  paperCount: number;
  compact?: boolean;
  onGenerate: (includeMarkScheme: boolean) => void;
};

export function GenerationState({ canGenerate, isPending, generationMode, paperCount, compact = false, onGenerate }: GenerationStateProps) {
  const paperLabel = paperCount > 1 ? `Generate ${paperCount} papers` : "Generate paper";
  const bothLabel = paperCount > 1 ? `Generate ${paperCount} papers + mark schemes` : "Generate paper + mark scheme";

  return (
    <div className={`generation-actions ${compact ? "grid grid-cols-2 gap-2" : "grid gap-2.5"}`}>
      <ActionButton
        state={isPending && generationMode === "paper" ? "pending" : "idle"}
        idleLabel={paperLabel}
        pendingLabel="Building paper"
        onClick={() => onGenerate(false)}
        disabled={!canGenerate || isPending}
        className={`${compact ? "col-span-2 min-h-12 px-3 text-[0.68rem]" : "min-h-12 w-full px-4 text-[0.76rem]"} rounded-md bg-accent font-bold text-white hover:bg-accent-deep disabled:opacity-40`}
      />
      <ActionButton
        state={isPending && generationMode === "paper-and-mark-scheme" ? "pending" : "idle"}
        idleLabel={bothLabel}
        pendingLabel="Building both"
        onClick={() => onGenerate(true)}
        disabled={!canGenerate || isPending}
        className={`${compact ? "col-span-2 mx-auto min-h-10 px-3 text-[0.61rem]" : "min-h-11 w-full px-3 text-[0.68rem]"} rounded-md border border-text/15 bg-transparent font-bold text-accent hover:border-accent/50 hover:bg-white/55 disabled:opacity-40`}
      />
      {isPending ? <OperationProgress kind="paper" label={generationMode === "paper-and-mark-scheme" ? "Assembling paper and mark scheme" : "Assembling exam questions"} compact className={compact ? "col-span-2 justify-center" : "justify-center"} /> : null}
    </div>
  );
}
