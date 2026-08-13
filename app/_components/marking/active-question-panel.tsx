"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, FileUp, Minus, Plus, RotateCcw, ScanText, Sparkles } from "lucide-react";
import { MathRichText } from "@/app/_components/math-rich-text";
import { parseMarkInput } from "@/app/_components/marking/parse-mark-input";
import { statusToneClass } from "@/app/_components/marking/model";
import type { CombinedMarkSchemeEntry, FeedbackScope, QuestionRow } from "@/app/_components/marking/model";
import { formatQuestionLabel, getQuestionState, getQuestionStateLabel, getQuestionStateTone, parseScoreEvidence } from "@/features/papers/client";

export function ActiveQuestionPanel({
  row,
  nextQuestion,
  previousQuestion,
  isPending,
  pageLabel,
  setPageLabel,
  uploadPageForQuestion,
  runOcr,
  ocrLoadingKey,
  autoScore,
  autoScoreLoadingKey,
  scoreLoadingKey,
  saveScore,
  activeMarkSchemeEntry,
  activeMarkSchemePreview,
  activeMarkSchemeUrl,
  activeMarkSchemePages,
  activeTopicLabel,
  activeTopicIds,
  subjectKey,
  setSelectedQuestionKey,
  showFeedback,
}: {
  row: QuestionRow;
  nextQuestion: QuestionRow | null;
  previousQuestion: QuestionRow | null;
  isPending: boolean;
  pageLabel: string;
  setPageLabel: (value: string) => void;
  uploadPageForQuestion: (questionKey: string, file: File | null, questionNumberOverride?: string, questionPartNumberOverride?: string | null) => void;
  runOcr: (questionKey: string) => Promise<void>;
  ocrLoadingKey: string | null;
  autoScore: (questionKey: string) => Promise<void>;
  autoScoreLoadingKey: string | null;
  scoreLoadingKey: string | null;
  saveScore: (questionKey: string, formData: FormData) => Promise<void>;
  activeMarkSchemeEntry: CombinedMarkSchemeEntry | null;
  activeMarkSchemePreview: string | null;
  activeMarkSchemeUrl: string | undefined;
  activeMarkSchemePages: number[] | undefined;
  activeTopicLabel?: string;
  activeTopicIds: string[];
  subjectKey: string;
  setSelectedQuestionKey: (questionKey: string) => void;
  showFeedback: (scope: FeedbackScope) => React.ReactNode;
}) {
  const state = getQuestionState(row);
  const scoreEvidence = parseScoreEvidence(row.score?.evidenceJson);
  const initialMaximum = row.score?.maxMarks ?? row.savedQuestion?.totalMarks ?? 0;
  const [maximum, setMaximum] = useState(initialMaximum);
  const [awarded, setAwarded] = useState(() => Math.min(row.score?.awardedMarks ?? 0, initialMaximum));
  const missingEvidence = scoreEvidence?.markBreakdown?.filter((entry) => !entry.awarded && (entry.criterion || entry.evidence)) ?? [];
  const updateMaximum = (value: number) => {
    const nextMaximum = Math.max(0, value);
    setMaximum(nextMaximum);
    setAwarded((current) => Math.min(current, nextMaximum));
  };
  return (
    <section aria-labelledby="active-question-title">
      <h2 id="active-question-title" className="sr-only">{formatQuestionLabel({ displayOrder: row.savedQuestion?.displayOrder, questionNumber: row.savedQuestion?.questionNumber, questionPartNumber: row.savedQuestion?.questionPartNumber, questionPath: row.savedQuestion?.questionPath, questionKey: row.questionKey })}</h2>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><span className={`border px-2 py-1 text-[0.75rem] font-semibold ${statusToneClass(getQuestionStateTone(state))}`}>{getQuestionStateLabel(state)}</span>{row.questionStatus?.failureReason ? <p className="text-[0.875rem] text-danger">{row.questionStatus.failureReason}</p> : null}</div><div className="flex flex-wrap gap-2">{row.savedQuestion ? <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 border border-text/15 bg-white px-3 text-[0.875rem] font-semibold text-text-secondary"><input type="file" accept="image/*" className="sr-only" onChange={(event) => uploadPageForQuestion(row.questionKey, event.target.files?.[0] ?? null, row.savedQuestion?.questionNumber, row.savedQuestion?.questionPartNumber ?? null)} /><FileUp className="h-4 w-4" />{isPending ? "Uploading..." : "Upload page"}</label> : null}{row.pages[0] ? <button type="button" onClick={() => void runOcr(row.questionKey)} disabled={ocrLoadingKey === row.questionKey} className="inline-flex min-h-10 items-center gap-2 border border-text/15 bg-white px-3 text-[0.875rem] font-semibold text-accent disabled:opacity-45"><RotateCcw className="h-4 w-4" />{ocrLoadingKey === row.questionKey ? "Running OCR..." : row.response ? "Refresh OCR" : "Run OCR"}</button> : null}{row.savedQuestion && row.response ? <button type="button" onClick={() => void autoScore(row.questionKey)} disabled={autoScoreLoadingKey === row.questionKey} className="inline-flex min-h-10 items-center gap-2 bg-accent px-3 text-[0.875rem] font-semibold text-white disabled:opacity-45"><Sparkles className="h-4 w-4" />{autoScoreLoadingKey === row.questionKey ? "Scoring..." : "Auto-score"}</button> : null}</div></div>
      {showFeedback("upload") || showFeedback("ocr") || showFeedback("score") ? <div className="mt-3 space-y-2">{showFeedback("upload")}{showFeedback("ocr")}{showFeedback("score")}</div> : null}

      <div className="mt-3 grid border border-text/15 bg-bg-elevated xl:grid-cols-[minmax(0,52fr)_minmax(18rem,28fr)_minmax(17rem,20fr)]">
        <section aria-labelledby="response-heading" className="min-w-0 border-b border-text/15 xl:border-b-0 xl:border-r">
          <div className="flex min-h-14 items-center justify-between border-b border-text/10 px-4"><h3 id="response-heading" className="text-[1.05rem] font-bold text-text">Your response</h3><span className="text-[0.8rem] text-text-muted">{row.pages.length} page{row.pages.length === 1 ? "" : "s"}</span></div>
          <div className="max-h-[52vh] overflow-y-auto p-4">
            {row.pages.length > 0 ? <div className="space-y-4">{row.pages.map((page) => <figure key={page._id} className="border border-text/10 bg-bg-soft"><div className="relative min-h-[18rem] h-[42vh] max-h-[32rem] bg-[#f1eee6] p-2"><Image src={page.sourceImageUrl} alt={page.fileName} fill className="object-contain p-2" sizes="(max-width: 1280px) 100vw, 52vw" unoptimized /></div><figcaption className="flex items-center justify-between gap-3 border-t border-text/10 px-3 py-2 text-[0.8rem] text-text-muted"><span className="truncate">{page.pageLabel || page.fileName}</span><a href={page.sourceImageUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 font-semibold text-accent">Open full size <ExternalLink className="h-3.5 w-3.5" /></a></figcaption></figure>)}</div> : <div className="flex min-h-48 items-center justify-center border border-dashed border-text/20 bg-bg-soft px-5 text-center text-[0.9rem] text-text-muted">No response page uploaded for this question.</div>}
            <details className="mt-3"><summary className="cursor-pointer text-[0.8rem] font-semibold text-text-muted">Set label for the next upload</summary><label className="mt-2 flex items-center gap-2 text-[0.8rem] font-semibold text-text-secondary">Page label<input value={pageLabel} onChange={(event) => setPageLabel(event.target.value)} placeholder="Optional" className="min-w-0 flex-1 border border-text/15 bg-white px-3 py-2 text-[0.875rem] font-normal text-text outline-none focus:border-accent" /></label></details>
          </div>
          <div className="border-t border-text/10 px-4 py-4"><p className="text-[0.8rem] font-bold uppercase tracking-[0.08em] text-text-muted">Question</p><MathRichText text={row.savedQuestion?.promptText || "Question source text is not linked for this row yet."} className="mt-2 text-[0.95rem] leading-6 text-text-secondary" />{row.savedQuestion?.contextText ? <MathRichText text={row.savedQuestion.contextText} className="mt-2 text-[0.875rem] leading-6 text-text-muted" /> : null}</div>
          <div className="border-t border-text/10 px-4 py-4"><p className="flex items-center gap-2 text-[0.8rem] font-bold uppercase tracking-[0.08em] text-info"><ScanText className="h-4 w-4" /> OCR transcript</p><MathRichText text={row.response?.ocrText || "Run OCR to extract the student answer text."} className="mt-2 whitespace-pre-line text-[0.95rem] leading-7 text-text-secondary" /></div>
        </section>

        <section aria-labelledby="scheme-heading" className="min-w-0 border-b border-text/15 xl:border-b-0 xl:border-r">
          <div className="flex min-h-14 items-center justify-between border-b border-text/10 px-4"><h3 id="scheme-heading" className="text-[1.05rem] font-bold text-text">Official mark scheme</h3>{activeMarkSchemeUrl ? <a href={activeMarkSchemeUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[0.8rem] font-semibold text-accent">Open PDF <ExternalLink className="h-3.5 w-3.5" /></a> : null}</div>
          <div className="max-h-[calc(100vh-19rem)] overflow-y-auto p-4"><div className="border-l-2 border-success/35 bg-success-soft/35 px-4 py-3">{activeMarkSchemeEntry ? <p className="mb-2 text-[0.8rem] font-semibold text-success">{activeMarkSchemeEntry.label}{activeMarkSchemePages ? ` · pages ${activeMarkSchemePages.join(", ")}` : ""}</p> : null}<MathRichText text={activeMarkSchemePreview || "Load the mark scheme or auto-score this question to see the exact scheme slice."} className="text-[0.95rem] leading-6 text-text-secondary" /></div>
          {scoreEvidence?.markBreakdown && scoreEvidence.markBreakdown.length > 0 ? <div className="mt-4 border-t border-text/15 pt-4"><h4 className="text-[0.95rem] font-bold text-text">What the answer earned</h4><div className="mt-3 space-y-3">{scoreEvidence.markBreakdown.map((entry, index) => <div key={`${row.questionKey}-${index}`} className="grid grid-cols-[1.25rem_1fr] gap-2 text-[0.875rem] leading-5"><span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full ${entry.awarded ? "bg-success text-white" : "bg-warning text-white"}`}>{entry.awarded ? <Check className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}</span><div><p className="font-semibold text-text">{entry.criterion || (entry.awarded ? "Mark awarded" : "Mark missing")}</p>{entry.evidence ? <MathRichText text={entry.evidence} className="mt-0.5 text-text-muted" /> : null}</div></div>)}</div></div> : <p className="mt-4 border-t border-text/15 pt-4 text-[0.875rem] leading-6 text-text-muted">Auto-score to compare the response against each marking point.</p>}</div>
        </section>

        <aside aria-labelledby="score-heading" className="min-w-0 bg-bg-elevated">
          <form action={(formData) => void saveScore(row.questionKey, formData)} className="sticky top-3 p-4">
            <div className="flex items-start justify-between gap-2"><div><h3 id="score-heading" className="text-[1.05rem] font-bold text-text">Confirm the score</h3><p className="mt-1 text-[0.8rem] text-text-muted">Review and save this decision.</p></div>{row.score ? <span className={`border px-2 py-1 text-[0.72rem] font-semibold ${row.score.scoreStatus === "confirmed" ? statusToneClass("confirmed") : statusToneClass("active")}`}>{row.score.scoreStatus === "confirmed" ? "Saved" : "AI suggestion"}</span> : null}</div>
            <div className="mt-8 flex items-center justify-center gap-3"><button type="button" onClick={() => setAwarded((current) => Math.max(0, current - 1))} disabled={awarded <= 0} aria-label="Decrease awarded marks" className="flex h-12 w-12 items-center justify-center border border-text/25 bg-white text-text disabled:opacity-35"><Minus className="h-5 w-5" /></button><label className="sr-only" htmlFor={`awarded-${row.questionKey}`}>Awarded marks</label><input id={`awarded-${row.questionKey}`} name={`awarded-${row.questionKey}`} value={awarded} onChange={(event) => setAwarded(parseMarkInput(event.target.value, awarded, maximum))} type="number" min={0} max={maximum} className="w-16 bg-transparent text-center font-mono text-[3.5rem] font-bold leading-none text-text outline-none" /><span className="text-[1.75rem] text-text-muted">/</span><label className="sr-only" htmlFor={`max-${row.questionKey}`}>Maximum marks</label><input id={`max-${row.questionKey}`} name={`max-${row.questionKey}`} value={maximum} onChange={(event) => updateMaximum(parseMarkInput(event.target.value, maximum, Number.MAX_SAFE_INTEGER))} type="number" min={0} className="w-12 bg-transparent text-center font-mono text-[1.75rem] text-text-muted outline-none" /><button type="button" onClick={() => setAwarded((current) => Math.min(maximum, current + 1))} disabled={awarded >= maximum} aria-label="Increase awarded marks" className="flex h-12 w-12 items-center justify-center border border-text/25 bg-white text-text disabled:opacity-35"><Plus className="h-5 w-5" /></button></div>
            <label className="mt-6 block text-[0.875rem] font-semibold text-text-secondary">Confidence<input name={`confidence-${row.questionKey}`} defaultValue={row.score?.confidence ?? 0.5} type="number" min={0} max={1} step="0.05" className="mt-1.5 w-full border border-text/15 bg-bg-soft px-3 py-2.5 font-mono text-[0.875rem] text-text outline-none focus:border-accent" /></label>
            <label className="mt-4 block text-[0.875rem] font-semibold text-text-secondary">Rationale<textarea name={`rationale-${row.questionKey}`} defaultValue={row.score?.rationale ?? ""} placeholder="Explain what earned the mark or needs checking." className="mt-1.5 min-h-28 w-full resize-y border border-text/15 bg-bg-soft px-3 py-2.5 text-[0.9rem] leading-6 text-text outline-none focus:border-accent" /></label>
            <label className="mt-4 flex min-h-11 items-center gap-3 text-[0.875rem] font-semibold text-text-secondary"><input type="checkbox" name={`review-${row.questionKey}`} defaultChecked={row.score?.needsReview === true} className="ui-checkbox shrink-0" />Needs another look</label>
            <button type="submit" disabled={scoreLoadingKey === row.questionKey} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 bg-accent px-4 text-[0.95rem] font-bold text-white hover:bg-accent-deep disabled:opacity-60"><CheckCircle2 className="h-5 w-5" />{scoreLoadingKey === row.questionKey ? "Saving..." : `Confirm ${awarded} mark${awarded === 1 ? "" : "s"}`}</button>
            {nextQuestion ? <button type="submit" name="saveAction" value="next" disabled={scoreLoadingKey === row.questionKey} className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1 text-[0.9rem] font-semibold text-accent disabled:opacity-60">Save and next question <ChevronRight className="h-4 w-4" /></button> : null}
          </form>
        </aside>
      </div>

      {missingEvidence.length > 0 ? <section className="grid gap-3 border-x border-b border-success/20 bg-success-soft/35 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center" aria-labelledby="practice-heading"><div><h3 id="practice-heading" className="text-[0.95rem] font-bold text-text">Turn the missing point into practice</h3><p className="mt-1 text-[0.875rem] text-text-muted">{activeTopicLabel ? `${activeTopicLabel}: ` : ""}{missingEvidence[0].criterion || "Review the missing marking point in your next paper."}</p></div><Link href={`/paper-maker?subject=${encodeURIComponent(subjectKey)}${activeTopicIds.length ? `&topics=${encodeURIComponent(activeTopicIds.join(","))}` : ""}`} className="inline-flex min-h-11 items-center justify-center bg-accent-warm px-4 text-[0.8rem] font-bold text-text hover:bg-accent-warm-deep hover:text-white">Build a focused paper</Link></section> : null}

      <nav className="flex items-center justify-between gap-3 border-t border-text/10 pt-4" aria-label="Question navigation"><button type="button" onClick={() => previousQuestion && setSelectedQuestionKey(previousQuestion.questionKey)} disabled={!previousQuestion} className="inline-flex min-h-11 items-center gap-2 border border-text/15 bg-white px-3 text-[0.875rem] font-semibold text-text-secondary disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Previous</button><span className="hidden text-[0.8rem] text-text-muted sm:inline">{row.savedQuestion?.paperCode || "Manual question"}</span><button type="button" onClick={() => nextQuestion && setSelectedQuestionKey(nextQuestion.questionKey)} disabled={!nextQuestion} className="inline-flex min-h-11 items-center gap-2 bg-accent px-3 text-[0.875rem] font-semibold text-white disabled:opacity-40">Next <ChevronRight className="h-4 w-4" /></button></nav>
    </section>
  );
}
