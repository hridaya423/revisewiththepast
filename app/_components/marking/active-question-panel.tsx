"use client";

import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { EvidencePanel } from "@/app/_components/marking/evidence-panel";
import { ResponsePanel } from "@/app/_components/marking/response-panel";
import { ScoreActions, ScorePanel, scoreLabel, useScoreDraft, type ConfirmInput } from "@/app/_components/marking/score-panel";
import { statusToneClass } from "@/app/_components/marking/model";
import type { CombinedMarkSchemeEntry, QuestionRow } from "@/app/_components/marking/model";
import type { SaveScoreResult } from "@/features/papers/client";
import { formatQuestionLabel, getQuestionState, getQuestionStateLabel, getQuestionStateTone, parseScoreEvidence } from "@/features/papers/client";

const TABS = [
  { id: "answer", label: "Answer" },
  { id: "scheme", label: "Mark scheme" },
  { id: "feedback", label: "Feedback" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export type MarkSchemeView = { entry: CombinedMarkSchemeEntry | null; preview: string | null; url: string | undefined; pages: number[] | undefined; loading: boolean; onLoad: () => void };

export function ActiveQuestionPanel({
  row,
  nextQuestion,
  previousQuestion,
  onSelect,
  runOcr,
  ocrLoading,
  autoScore,
  autoScoreLoading,
  onConfirm,
  markScheme,
  onAddPages,
  subjectKey,
  feedback,
}: {
  row: QuestionRow;
  nextQuestion: QuestionRow | null;
  previousQuestion: QuestionRow | null;
  onSelect: (questionKey: string) => void;
  runOcr: () => void;
  ocrLoading: boolean;
  autoScore: () => void;
  autoScoreLoading: boolean;
  onConfirm: (input: ConfirmInput) => Promise<SaveScoreResult>;
  markScheme: MarkSchemeView;
  onAddPages: () => void;
  subjectKey: string;
  feedback: ReactNode;
}) {
  const baseId = useId();
  const [tab, setTab] = useState<Tab>("answer");
  const scrollByTab = useRef<Partial<Record<Tab, number>>>({});
  const tablistRef = useRef<HTMLDivElement>(null);
  const draft = useScoreDraft(row, onConfirm);
  const state = getQuestionState(row);
  const label = formatQuestionLabel({ displayOrder: row.savedQuestion?.displayOrder, questionNumber: row.savedQuestion?.questionNumber, questionPartNumber: row.savedQuestion?.questionPartNumber, questionPath: row.savedQuestion?.questionPath, questionKey: row.questionKey });
  const missing = parseScoreEvidence(row.score?.evidenceJson)?.markBreakdown?.filter((entry) => !entry.awarded && entry.criterion) ?? [];
  const topicIds = row.savedQuestion?.canonicalLeafIds ?? [];
  const topicLabel = row.savedQuestion?.topicLabels?.[0];

  const switchTab = (next: Tab, focus = false) => {
    if (next === tab) return;
    scrollByTab.current[tab] = window.scrollY;
    setTab(next);
    requestAnimationFrame(() => {
      const top = tablistRef.current ? tablistRef.current.getBoundingClientRect().top + window.scrollY - 8 : 0;
      window.scrollTo({ top: scrollByTab.current[next] ?? Math.min(window.scrollY, top), behavior: "instant" });
      if (focus) document.getElementById(`${baseId}-tab-${next}`)?.focus();
    });
  };
  const onTabKey = (event: KeyboardEvent) => {
    const index = TABS.findIndex((entry) => entry.id === tab);
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      switchTab(TABS[event.key === "Home" ? 0 : TABS.length - 1].id, true);
    } else if (delta) {
      event.preventDefault();
      switchTab(TABS[(index + delta + TABS.length) % TABS.length].id, true);
    }
  };

  const panel = (id: Tab, title: string, children: ReactNode, className = "") => (
    <section
      id={`${baseId}-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`${baseId}-heading-${id}`}
      className={`min-w-0 bg-bg-elevated p-4 sm:p-5 ${tab === id ? "" : "max-md:hidden"} ${className}`}
    >
      <h3 id={`${baseId}-heading-${id}`} className="mb-4 text-lg font-semibold text-text max-md:sr-only">{title}</h3>
      {children}
    </section>
  );

  const goNext = () => { if (nextQuestion) onSelect(nextQuestion.questionKey); };
  const footerNeedsFeedbackTab = tab !== "feedback" && !draft.draft.dirty && !row.score;

  return (
    <section aria-label={label} className="max-md:pb-28">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusToneClass(getQuestionStateTone(state))}`}>{getQuestionStateLabel(state)}</span>
          {row.questionStatus?.failureReason ? <p className="text-sm text-danger">{row.questionStatus.failureReason}</p> : null}
        </div>
        {row.savedQuestion && row.response && row.score?.scoreStatus !== "confirmed" ? (
          <button type="button" onClick={autoScore} disabled={autoScoreLoading} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-accent px-3 text-sm font-semibold text-accent hover:bg-accent-soft disabled:opacity-50">
            <Sparkles className="h-5 w-5" aria-hidden="true" />{autoScoreLoading ? "Checking against the scheme…" : row.score ? "Ask AI again" : "Get AI suggestion"}
          </button>
        ) : null}
      </div>
      {feedback}

      <div ref={tablistRef} role="tablist" aria-label="Question views" onKeyDown={onTabKey} className="sticky top-0 z-10 -mx-4 mb-3 grid grid-cols-3 border-b border-text/15 bg-bg px-4 md:hidden">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            id={`${baseId}-tab-${entry.id}`}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            aria-controls={`${baseId}-panel-${entry.id}`}
            tabIndex={tab === entry.id ? 0 : -1}
            onClick={() => switchTab(entry.id)}
            className={`min-h-12 border-b-2 text-sm font-semibold transition-colors duration-200 ${tab === entry.id ? "border-accent text-accent" : "border-transparent text-text-secondary"}`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="grid gap-px overflow-hidden rounded-[3px] border border-text/15 bg-text/15 md:grid-cols-[minmax(0,1fr)_minmax(17.5rem,24rem)] xl:grid-cols-[minmax(0,52fr)_minmax(17.5rem,28fr)_minmax(15rem,20fr)]">
        {panel("answer", "Your answer", <ResponsePanel row={row} ocrLoading={ocrLoading} onRunOcr={runOcr} onAddPages={onAddPages} />, "md:row-span-2 xl:row-span-1")}
        {panel("scheme", "Mark scheme", <EvidencePanel {...markScheme} />)}
        {panel("feedback", "Feedback", <ScorePanel row={row} state={draft} nextQuestion={nextQuestion} onNext={goNext} />)}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-text/15 bg-white px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-[0_-4px_16px_rgba(13,23,52,0.06)] md:hidden">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm font-semibold tabular-nums text-text">{draft.draft.dirty ? `Your mark · ${draft.draft.awarded || "–"} / ${draft.maximum}` : scoreLabel(row.score)}</p>
          {footerNeedsFeedbackTab || ((draft.conflict || draft.error) && tab !== "feedback")
            ? <button type="button" onClick={() => switchTab("feedback")} className="min-h-11 rounded-md bg-accent px-4 text-base font-semibold text-white">{draft.conflict || draft.error ? "Review" : "Mark it"}</button>
            : <ScoreActions state={draft} nextQuestion={nextQuestion} onNext={goNext} compact />}
        </div>
      </div>

      {missing.length > 0 && row.score?.scoreStatus === "confirmed" ? (
        <section className="mt-4 grid gap-3 rounded-[3px] border border-text/15 bg-white px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center" aria-labelledby={`${baseId}-practice`}>
          <div>
            <h3 id={`${baseId}-practice`} className="text-base font-semibold text-text">Practise the missing point</h3>
            <p className="mt-1 text-sm leading-5 text-text-secondary">{topicLabel ? `${topicLabel}: ` : ""}{missing[0].criterion}</p>
          </div>
          <Link href={`/paper-maker?subject=${encodeURIComponent(subjectKey)}${topicIds.length ? `&topics=${encodeURIComponent(topicIds.join(","))}` : ""}`} className="inline-flex min-h-11 items-center justify-center rounded-md border border-accent px-4 text-sm font-semibold text-accent hover:bg-accent-soft">Set up a focused paper</Link>
        </section>
      ) : null}

      <nav className="mt-4 flex items-center justify-between gap-3 border-t border-text/10 pt-4" aria-label="Question navigation">
        <button type="button" onClick={() => previousQuestion && onSelect(previousQuestion.questionKey)} disabled={!previousQuestion} className="inline-flex min-h-11 items-center gap-1 rounded-md border border-text/20 bg-white px-3 text-sm font-semibold text-text disabled:opacity-40"><ChevronLeft className="h-5 w-5" aria-hidden="true" />Previous</button>
        <span className="hidden text-sm text-text-secondary sm:inline">{row.savedQuestion?.paperCode || "Your question"}</span>
        <button type="button" onClick={goNext} disabled={!nextQuestion} className="inline-flex min-h-11 items-center gap-1 rounded-md border border-text/20 bg-white px-3 text-sm font-semibold text-text disabled:opacity-40">Next<ChevronRight className="h-5 w-5" aria-hidden="true" /></button>
      </nav>
    </section>
  );
}
