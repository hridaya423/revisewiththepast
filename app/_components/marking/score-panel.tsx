"use client";

import { useState } from "react";
import { Check, CheckCircle2, ChevronRight, Minus, Plus } from "lucide-react";
import { MathRichText } from "@/app/_components/math-rich-text";
import { validateMarkInput } from "@/app/_components/marking/parse-mark-input";
import type { QuestionRow } from "@/app/_components/marking/model";
import type { SaveScoreResult } from "@/features/papers/client";
import { parseScoreEvidence } from "@/features/papers/client";

type Score = QuestionRow["score"];
type Conflict = Extract<SaveScoreResult, { status: "conflict" }>["current"];
export type ConfirmInput = { awardedMarks: number; maxMarks: number; needsReview: boolean; rationale: string; expectedUpdatedAt: number | null };

type Draft = { awarded: string; maximum: string; needsReview: boolean; rationale: string; base: number | null; synced: number | null; dirty: boolean };

function fromScore(score: Score, fixedMaximum: number | null): Draft {
  const maximum = fixedMaximum ?? score?.maxMarks ?? 0;
  const updatedAt = score?.updatedAt ?? null;
  return {
    awarded: String(Math.min(score?.awardedMarks ?? 0, maximum)),
    maximum: String(maximum),
    needsReview: score?.needsReview === true,
    rationale: score?.rationale ?? "",
    base: updatedAt,
    synced: updatedAt,
    dirty: false,
  };
}

export function scoreLabel(score: Score) {
  if (!score) return "Not marked yet";
  return `${score.scoreStatus === "confirmed" ? "Confirmed" : "AI suggestion"} · ${score.awardedMarks} / ${score.maxMarks}`;
}

/**
 * Owns the student's unsaved mark. A background refresh never discards an edit in progress;
 * saving sends the revision the student was looking at so a stale tab cannot silently overwrite.
 */
export function useScoreDraft(row: QuestionRow, onConfirm: (input: ConfirmInput) => Promise<SaveScoreResult>) {
  const fixedMaximum = row.savedQuestion?.totalMarks ?? null;
  const [draft, setDraft] = useState(() => fromScore(row.score, fixedMaximum));
  const [phase, setPhase] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const incoming = row.score?.updatedAt ?? null;
  if (!draft.dirty && phase !== "saving" && draft.synced !== incoming) setDraft(fromScore(row.score, fixedMaximum));

  const edit = (patch: Partial<Pick<Draft, "awarded" | "maximum" | "needsReview" | "rationale">>) => {
    setDraft((current) => ({ ...current, ...patch, dirty: true }));
    setError(null);
    if (phase === "saved") setPhase("idle");
  };

  const maximumCheck = fixedMaximum === null ? validateMarkInput(draft.maximum, 1000) : { ok: true as const, value: fixedMaximum };
  const maximum = maximumCheck.ok ? maximumCheck.value : 0;
  const awardedCheck = validateMarkInput(draft.awarded, maximum);
  const awarded = awardedCheck.ok ? awardedCheck.value : null;

  const confirm = async (expectedUpdatedAt = draft.base) => {
    if (!maximumCheck.ok) { setError(maximumCheck.message); return; }
    if (!awardedCheck.ok) { setError(awardedCheck.message); return; }
    setPhase("saving");
    setError(null);
    try {
      const result = await onConfirm({ awardedMarks: awardedCheck.value, maxMarks: maximum, needsReview: draft.needsReview, rationale: draft.rationale.trim(), expectedUpdatedAt });
      if (result.status === "conflict") {
        setConflict(result.current);
        setPhase("idle");
        return;
      }
      setConflict(null);
      setDraft((current) => ({ ...current, dirty: false, base: result.updatedAt }));
      setPhase("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this mark. Your entry is kept; try again.");
      setPhase("error");
    }
  };

  const useCurrent = () => {
    if (!conflict) return;
    setDraft({ awarded: String(conflict.awardedMarks), maximum: String(conflict.maxMarks), needsReview: conflict.needsReview, rationale: conflict.rationale, base: conflict.updatedAt, synced: draft.synced, dirty: false });
    setConflict(null);
  };
  const keepMine = () => { if (conflict) void confirm(conflict.updatedAt); setConflict(null); };

  const isConfirmed = row.score?.scoreStatus === "confirmed" && !draft.dirty;
  return { draft, edit, phase, error, conflict, useCurrent, keepMine, confirm, awarded, maximum, fixedMaximum, isConfirmed };
}

export type ScoreDraft = ReturnType<typeof useScoreDraft>;

export function ScoreActions({ state, nextQuestion, onNext, compact = false }: { state: ScoreDraft; nextQuestion: QuestionRow | null; onNext: () => void; compact?: boolean }) {
  const settled = (state.phase === "saved" || state.isConfirmed) && !state.draft.dirty;
  if (settled) {
    return nextQuestion
      ? <button type="button" onClick={onNext} className={`inline-flex ${compact ? "min-h-11 px-4" : "min-h-12 w-full"} items-center justify-center gap-1 rounded-md bg-accent text-base font-semibold text-white hover:bg-accent-deep`}>Next question <ChevronRight className="h-5 w-5" aria-hidden="true" /></button>
      : <p className={`inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-success ${compact ? "" : "w-full justify-center"}`}><CheckCircle2 className="h-5 w-5" aria-hidden="true" />Last question confirmed</p>;
  }
  const label = state.phase === "saving" ? "Saving…" : state.phase === "error" ? "Retry" : state.isConfirmed || (state.draft.dirty && state.draft.base !== null) ? "Update mark" : "Confirm mark";
  return <button type="button" onClick={() => void state.confirm()} disabled={state.phase === "saving"} className={`inline-flex ${compact ? "min-h-11 px-4" : "min-h-12 w-full"} items-center justify-center gap-2 rounded-md bg-accent text-base font-semibold text-white hover:bg-accent-deep disabled:opacity-60`}><Check className="h-5 w-5" aria-hidden="true" />{label}</button>;
}

export function ScorePanel({ row, state, nextQuestion, onNext }: { row: QuestionRow; state: ScoreDraft; nextQuestion: QuestionRow | null; onNext: () => void }) {
  const evidence = parseScoreEvidence(row.score?.evidenceJson);
  const breakdown = evidence?.markBreakdown ?? [];
  const id = row.questionKey;
  const stepAwarded = (delta: number) => state.edit({ awarded: String(Math.min(state.maximum, Math.max(0, (state.awarded ?? 0) + delta))) });
  return (
    <div className="space-y-5">
      <p className={`inline-flex rounded-md border px-2.5 py-1 text-sm font-semibold ${row.score?.scoreStatus === "confirmed" ? "border-success/25 bg-success-soft text-success" : row.score ? "border-accent/25 bg-accent-soft text-accent-deep" : "border-text/15 bg-bg-soft text-text-secondary"}`}>{scoreLabel(row.score)}</p>

      {breakdown.length > 0 ? (
        <section aria-labelledby={`breakdown-${id}`}>
          <h4 id={`breakdown-${id}`} className="text-sm font-semibold text-text">Marking points{row.score?.scoreStatus !== "confirmed" ? <span className="font-normal text-text-secondary"> · suggested by AI, check each one</span> : null}</h4>
          <ul className="mt-3 space-y-3">
            {breakdown.map((entry, index) => (
              <li key={index} className="grid grid-cols-[1.5rem_1fr] gap-2 text-sm leading-5">
                <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full ${entry.awarded ? "bg-success text-white" : "border border-warning bg-warning-soft text-warning"}`}>{entry.awarded ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Minus className="h-3.5 w-3.5" aria-hidden="true" />}<span className="sr-only">{entry.awarded ? "Awarded" : "Not awarded"}</span></span>
                <div><p className="font-semibold text-text">{entry.criterion || (entry.awarded ? "Mark awarded" : "Mark missing")}</p>{entry.evidence ? <MathRichText text={entry.evidence} className="mt-0.5 text-text-secondary" /> : null}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : row.score?.rationale && row.score.scoreStatus !== "confirmed" ? (
        <section aria-label="AI rationale"><p className="text-sm font-semibold text-text">Why the AI suggested this</p><MathRichText text={row.score.rationale} className="mt-1 text-sm leading-5 text-text-secondary" /></section>
      ) : null}

      <form onSubmit={(event) => { event.preventDefault(); void state.confirm(); }} className="space-y-4 border-t border-text/10 pt-4" aria-labelledby={`decision-${id}`}>
        <h4 id={`decision-${id}`} className="text-base font-semibold text-text">Your decision</h4>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => stepAwarded(-1)} disabled={(state.awarded ?? 0) <= 0} aria-label="One mark fewer" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-text/25 bg-white text-text disabled:opacity-35"><Minus className="h-5 w-5" aria-hidden="true" /></button>
          <span className="flex items-center gap-1.5">
            <label className="sr-only" htmlFor={`awarded-${id}`}>Marks awarded</label>
            <input id={`awarded-${id}`} inputMode="numeric" autoComplete="off" value={state.draft.awarded} onChange={(event) => state.edit({ awarded: event.target.value })} aria-invalid={Boolean(state.error)} aria-describedby={state.error ? `score-error-${id}` : undefined} className="h-11 w-14 rounded-md border border-text/25 bg-white text-center font-mono text-xl font-semibold tabular-nums text-text focus:border-accent" />
            <span className="text-lg text-text-secondary" aria-hidden="true">/</span><span className="sr-only">out of</span>
            {state.fixedMaximum !== null
              ? <span className="min-w-6 font-mono text-xl font-semibold tabular-nums text-text">{state.fixedMaximum}</span>
              : <><label className="sr-only" htmlFor={`max-${id}`}>Marks available</label><input id={`max-${id}`} inputMode="numeric" autoComplete="off" value={state.draft.maximum} onChange={(event) => state.edit({ maximum: event.target.value })} className="h-11 w-14 rounded-md border border-text/25 bg-white text-center font-mono text-xl tabular-nums text-text focus:border-accent" /></>}
          </span>
          <button type="button" onClick={() => stepAwarded(1)} disabled={(state.awarded ?? 0) >= state.maximum} aria-label="One mark more" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-text/25 bg-white text-text disabled:opacity-35"><Plus className="h-5 w-5" aria-hidden="true" /></button>
        </div>
        {state.error ? <p id={`score-error-${id}`} role="alert" className="text-sm font-semibold text-danger">{state.error}</p> : null}
        <label className="block text-sm font-semibold text-text">Note <span className="font-normal text-text-secondary">(optional)</span>
          <textarea value={state.draft.rationale} onChange={(event) => state.edit({ rationale: event.target.value })} maxLength={4000} rows={3} placeholder="What earned the mark, or what to check later" className="mt-1.5 w-full resize-y rounded-md border border-text/25 bg-white px-3 py-2.5 text-base leading-6 text-text focus:border-accent" />
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-text"><input type="checkbox" checked={state.draft.needsReview} onChange={(event) => state.edit({ needsReview: event.target.checked })} className="ui-checkbox shrink-0" />Flag to look at again</label>

        {state.conflict ? (
          <div role="alert" className="space-y-3 rounded-md border border-warning/40 bg-warning-soft px-3 py-3 text-sm text-text">
            <p><span className="font-semibold">This mark changed somewhere else.</span> It is now {state.conflict.scoreStatus === "confirmed" ? "confirmed" : "suggested"} at {state.conflict.awardedMarks} / {state.conflict.maxMarks}{state.conflict.rationale ? `: “${state.conflict.rationale}”` : "."}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={state.useCurrent} className="min-h-11 rounded-md border border-text/25 bg-white px-3 font-semibold text-text">Use the current mark</button>
              <button type="button" onClick={state.keepMine} className="min-h-11 rounded-md bg-accent px-3 font-semibold text-white">Keep my {state.awarded ?? ""} / {state.maximum}</button>
            </div>
          </div>
        ) : null}
        <div className="max-md:hidden"><ScoreActions state={state} nextQuestion={nextQuestion} onNext={onNext} /></div>
        <p role="status" className="sr-only">{state.phase === "saved" ? `Confirmed ${state.awarded} out of ${state.maximum}.` : ""}</p>
      </form>
    </div>
  );
}
