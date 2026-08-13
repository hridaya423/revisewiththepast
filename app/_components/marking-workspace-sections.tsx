"use client";

import { Brain, ExternalLink, FileUp, Sparkles, Upload } from "lucide-react";
import { formatQuestionLabel, getQuestionState, getQuestionStateLabel } from "@/features/papers/client";
import type { FeedbackScope, MarkingSubmissionBundle, QuestionRow } from "@/app/_components/marking/model";

export function MarkingSetupControls({
  bundle,
  setupStatus,
  autoScoreLoadingKey,
  isLoadingCombinedMarkScheme,
  combinedMarkScheme,
  pendingBulkFiles,
  bulkUploadTargets,
  reviewCount,
  processFinishedPaperPdf,
  autoScoreWholePaper,
  loadCombinedMarkScheme,
  setPendingBulkFiles,
  uploadFinishedScriptPages,
  showFeedback,
}: {
  bundle: MarkingSubmissionBundle;
  setupStatus: { importState: "idle" | "processing" | "replacing"; canAutoScoreWholePaper: boolean };
  autoScoreLoadingKey: string | null;
  isLoadingCombinedMarkScheme: boolean;
  combinedMarkScheme: { entries: unknown[] } | null;
  pendingBulkFiles: File[];
  bulkUploadTargets: NonNullable<MarkingSubmissionBundle["savedPaperQuestions"]>;
  reviewCount: number;
  processFinishedPaperPdf: (file: File | null) => void;
  autoScoreWholePaper: () => Promise<void>;
  loadCombinedMarkScheme: () => Promise<void>;
  setPendingBulkFiles: (files: File[]) => void;
  uploadFinishedScriptPages: (files: File[]) => void;
  showFeedback: (scope: FeedbackScope) => React.ReactNode;
}) {
  const { importState, canAutoScoreWholePaper } = setupStatus;
  return <details className="border-b border-text/10 pb-3">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-1 text-[0.875rem] font-semibold text-text-secondary marker:hidden"><span className="inline-flex items-center gap-2"><FileUp className="h-4 w-4 text-accent" /> Setup and import utilities</span><span className="text-[0.8rem] font-normal text-text-muted">OCR {bundle.insights.ocrCompletedCount}/{bundle.insights.questionCount} · {reviewCount} review</span></summary>
    <div className="mt-3 border-t border-text/10 pt-3">
      <div className="flex flex-wrap gap-2">
        {bundle.savedPaper?.pdfUrl ? <a href={bundle.savedPaper.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 border border-text/15 bg-white px-3 text-[0.875rem] font-semibold text-text-secondary hover:border-accent"><ExternalLink className="h-4 w-4" /> Source PDF</a> : null}
         {bundle.savedPaperQuestions?.length ? <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 border border-text/15 bg-white px-3 text-[0.875rem] font-semibold text-text-secondary hover:border-accent"><input type="file" accept="application/pdf" className="sr-only" onChange={(event) => processFinishedPaperPdf(event.target.files?.[0] ?? null)} /><Upload className="h-4 w-4" />{importState === "processing" ? "Processing PDF..." : importState === "replacing" ? "Replacing PDF..." : bundle.submission.importSource === "imported_pdf" && bundle.pages.length > 0 ? "Replace script PDF" : "Import script PDF"}</label> : null}
        <button type="button" onClick={() => void autoScoreWholePaper()} disabled={!canAutoScoreWholePaper || autoScoreLoadingKey === "__whole-paper__"} className="inline-flex min-h-10 items-center gap-2 bg-accent px-3 text-[0.875rem] font-semibold text-white disabled:opacity-45"><Sparkles className="h-4 w-4" />{autoScoreLoadingKey === "__whole-paper__" ? "Scoring paper..." : "Auto-score paper"}</button>
        <button type="button" onClick={() => void loadCombinedMarkScheme()} disabled={isLoadingCombinedMarkScheme} className="inline-flex min-h-10 items-center gap-2 border border-text/15 bg-white px-3 text-[0.875rem] font-semibold text-text-secondary disabled:opacity-45"><Brain className="h-4 w-4" />{isLoadingCombinedMarkScheme ? "Loading scheme..." : combinedMarkScheme ? "Refresh scheme" : "Load mark scheme"}</button>
      </div>
      {!canAutoScoreWholePaper ? <p className="mt-2 text-[0.8rem] text-text-muted">Whole-paper scoring unlocks when every question has an OCR transcript.</p> : null}
       {bundle.savedPaperQuestions?.length ? <div className="mt-4 border-t border-text/10 pt-3"><label className="inline-flex min-h-10 cursor-pointer items-center border border-dashed border-text/25 px-3 text-[0.875rem] font-semibold text-text-secondary"><input type="file" accept="image/*" multiple className="sr-only" onChange={(event) => setPendingBulkFiles(Array.from(event.target.files ?? []))} />Choose answer images in question order</label>{pendingBulkFiles.length ? <div className="mt-3 max-w-2xl border border-info/20 bg-info-soft p-3"><p className="text-[0.875rem] font-semibold text-info">{pendingBulkFiles.length} files selected for {bulkUploadTargets.length} available questions</p><div className="mt-2 divide-y divide-info/10">{pendingBulkFiles.map((file, index) => <div key={`${file.name}-${file.lastModified}`} className="flex justify-between gap-3 py-2 text-[0.8rem]"><span className="truncate">{file.name}</span><span className="shrink-0 font-semibold">{bulkUploadTargets[index] ? formatQuestionLabel({ displayOrder: bulkUploadTargets[index].displayOrder, questionNumber: bulkUploadTargets[index].questionNumber, questionPartNumber: bulkUploadTargets[index].questionPartNumber, questionPath: bulkUploadTargets[index].questionPath, questionKey: bulkUploadTargets[index].unitKey }) : "Not assigned"}</span></div>)}</div><div className="mt-3 flex gap-2"><button type="button" onClick={() => uploadFinishedScriptPages(pendingBulkFiles)} disabled={importState !== "idle" || pendingBulkFiles.length > bulkUploadTargets.length} className="bg-info px-3 py-2 text-[0.875rem] font-semibold text-white disabled:opacity-45">Confirm upload</button><button type="button" onClick={() => setPendingBulkFiles([])} className="border border-info/25 bg-white px-3 py-2 text-[0.875rem] font-semibold text-info">Cancel</button></div></div> : null}</div> : null}
      {showFeedback("setup") || showFeedback("whole-paper") || showFeedback("mark-scheme") || showFeedback("bulk") ? <div className="mt-3 space-y-2">{showFeedback("setup")}{showFeedback("whole-paper")}{showFeedback("mark-scheme")}{showFeedback("bulk")}</div> : null}
    </div>
  </details>;
}

export function MarkingQuestionNavigation({ rows, activeQuestionKey, onSelect }: { rows: QuestionRow[]; activeQuestionKey: string | null; onSelect: (key: string) => void }) {
  return <aside className="hidden border-r border-text/10 bg-white py-3 xl:block" aria-label="Questions"><p className="px-4 pb-3 text-[0.72rem] font-bold uppercase tracking-[0.1em] text-text-muted">Questions</p><div>{rows.map((row, index) => { const state = getQuestionState(row); const active = row.questionKey === activeQuestionKey; const dot = row.score?.scoreStatus === "confirmed" && !row.score.needsReview ? "bg-success" : state === "review" || state === "failed" ? "bg-warning" : active ? "bg-accent" : "bg-text-subtle"; return <button key={row.questionKey} type="button" onClick={() => onSelect(row.questionKey)} aria-current={active ? "true" : undefined} className={`flex min-h-11 w-full items-center gap-3 border-r-2 px-4 text-left text-[0.8rem] transition-colors ${active ? "border-accent bg-accent-soft text-accent" : "border-transparent text-text-secondary hover:bg-bg-soft hover:text-text"}`}><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" /><span className="w-5 font-mono tabular-nums">{String(index + 1).padStart(2, "0")}</span><span className="truncate text-[0.72rem] font-medium">{getQuestionStateLabel(state)}</span></button>; })}</div></aside>;
}
