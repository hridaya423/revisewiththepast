"use client";

import { ExternalLink, FileUp, Sparkles, Upload } from "lucide-react";
import type { FeedbackScope, MarkingSubmissionBundle } from "@/app/_components/marking/model";

export function MarkingSetupControls({
  bundle,
  importState,
  canAutoScoreWholePaper,
  autoScoreLoadingKey,
  reviewCount,
  processFinishedPaperPdf,
  autoScoreWholePaper,
  showFeedback,
}: {
  bundle: MarkingSubmissionBundle;
  importState: "idle" | "processing" | "replacing";
  canAutoScoreWholePaper: boolean;
  autoScoreLoadingKey: string | null;
  reviewCount: number;
  processFinishedPaperPdf: (file: File | null) => void;
  autoScoreWholePaper: () => Promise<void>;
  showFeedback: (scope: FeedbackScope) => React.ReactNode;
}) {
  const replacing = bundle.submission.importSource === "imported_pdf" && bundle.pages.length > 0;
  return <details className="border-b border-text/15 pb-3">
    <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 py-2 text-base font-semibold text-text"><span className="inline-flex items-center gap-2"><FileUp className="h-5 w-5 text-accent" aria-hidden="true" />More tools</span><span className="text-sm font-normal text-text-secondary">{bundle.insights.ocrCompletedCount} of {bundle.insights.questionCount} read · {reviewCount} to check</span></summary>
    <div className="space-y-3 pt-2">
      <div className="flex flex-wrap gap-2">
        {bundle.savedPaper?.pdfUrl ? <a href={bundle.savedPaper.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-text/20 bg-white px-3 text-sm font-semibold text-text hover:border-accent"><ExternalLink className="h-4 w-4" aria-hidden="true" />Question paper PDF</a> : null}
        {bundle.savedPaperQuestions?.length ? <label className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-text/20 bg-white px-3 text-sm font-semibold text-text focus-within:outline-2 focus-within:outline-offset-2 hover:border-accent ${importState !== "idle" ? "pointer-events-none opacity-60" : ""}`}><input type="file" accept="application/pdf" className="sr-only" disabled={importState !== "idle"} onChange={(event) => { processFinishedPaperPdf(event.target.files?.[0] ?? null); event.target.value = ""; }} /><Upload className="h-4 w-4" aria-hidden="true" />{importState === "processing" ? "Importing PDF…" : importState === "replacing" ? "Replacing PDF…" : replacing ? "Replace scanned PDF" : "Import a scanned PDF"}</label> : null}
        <button type="button" onClick={() => void autoScoreWholePaper()} disabled={!canAutoScoreWholePaper || autoScoreLoadingKey === "__whole-paper__"} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-text/20 bg-white px-3 text-sm font-semibold text-text hover:border-accent disabled:opacity-50"><Sparkles className="h-4 w-4" aria-hidden="true" />{autoScoreLoadingKey === "__whole-paper__" ? "Getting suggestions…" : "AI suggestions for every question"}</button>
      </div>
      {!canAutoScoreWholePaper ? <p className="text-sm text-text-secondary">Whole-paper suggestions are available once every answer has been read.</p> : <p className="text-sm text-text-secondary">Suggestions stay unconfirmed until you check and confirm each mark.</p>}
      {showFeedback("setup") || showFeedback("whole-paper") || showFeedback("mark-scheme") ? <div className="space-y-2">{showFeedback("setup")}{showFeedback("whole-paper")}{showFeedback("mark-scheme")}</div> : null}
    </div>
  </details>;
}
