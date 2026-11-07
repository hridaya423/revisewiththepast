"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, ExternalLink, FileText } from "lucide-react";

import { InlineNotice } from "@/app/_components/ui/inline-notice";
import { OperationProgress } from "@/app/_components/ui/operation-progress";
import { isGenerationTerminal } from "@/features/papers/builder/domain/generation-job";
import type { usePaperGeneration } from "./use-paper-generation";

type PaperResultProps = {
  generation: ReturnType<typeof usePaperGeneration>;
  subjectLabel: string;
  isAuthenticated: boolean;
  onReview: () => Promise<void>;
  onBack: () => void;
};

export function PaperResult({ generation, subjectLabel, isAuthenticated, onReview, onBack }: PaperResultProps) {
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  const { job, jobId, error, saveError, savedPaperIds, saving, stopping } = generation;
  const pending = job ? !isGenerationTerminal(job.status) : true;
  const ready = job?.status === "succeeded";
  const paper = job?.papers[0];
  const fileUrl = (part: string, view = false) => `/api/paper-maker/generation-jobs/download?jobId=${encodeURIComponent(jobId ?? "")}&part=${part}${view ? "&view=1" : ""}`;
  const returnTo = `/paper-maker?job=${encodeURIComponent(jobId ?? "")}`;
  const review = async () => {
    if (reviewing) return;
    setReviewing(true);
    setReviewError(null);
    try { await onReview(); }
    catch (cause) { setReviewError(cause instanceof Error ? cause.message : "We could not open the review. Please try again."); }
    finally { setReviewing(false); }
  };

  return (
    <section className="mx-auto max-w-[1180px]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-text/12 pb-5">
        <button type="button" disabled={generation.requestPending} onClick={onBack} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-text-secondary disabled:opacity-50">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to paper settings
        </button>
        <span className="text-sm text-text-secondary">{subjectLabel}</span>
      </div>
      {error ? <InlineNotice message={error} action={{ label: "Check status", onSelect: generation.retry }} className="mt-5" /> : null}
      <div className="grid gap-8 py-8 md:grid-cols-[minmax(0,1fr)_280px] lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
        <div className="min-w-0">
          <h1 ref={headingRef} tabIndex={-1} aria-live="polite" aria-atomic="true" className="text-3xl font-bold tracking-[-0.04em] text-text outline-none sm:text-4xl">
            {ready ? "Your paper is ready." : job?.status === "cancelled" ? "Preparation stopped." : job?.status === "failed" ? "Preparation could not finish." : job?.completedPapers === job?.totalPapers && paper ? "Preparing your mark scheme." : "Preparing your paper."}
          </h1>
          {pending ? (
            <div className="mt-8 border-y border-text/12 py-8">
              <OperationProgress kind="paper" label={job?.message ?? "Checking your paper"} />
              {job ? <p className="mt-4 text-sm text-text-secondary">{job.completedPapers} of {job.totalPapers} question papers prepared</p> : null}
              <p className="mt-3 max-w-[50ch] text-base leading-7 text-text-secondary">You can return to this page while your paper is being prepared.</p>
              <button type="button" disabled={stopping || !job} onClick={() => void generation.stop()} className="mt-4 min-h-11 text-sm font-semibold text-text-secondary underline underline-offset-4 disabled:opacity-50">{stopping ? "Stopping..." : "Stop preparation"}</button>
            </div>
          ) : null}
          {job?.error ? <InlineNotice message={job.error} className="mt-5" /> : null}
          {paper ? (
            <div className="mt-8">
              <div className="flex items-center justify-between border-b border-text/12 pb-3 text-sm">
                <span className="inline-flex items-center gap-2 font-semibold text-text"><FileText className="h-4 w-4" aria-hidden="true" />Paper {paper.index + 1}</span>
                <a href={fileUrl(`paper-${paper.index}`, true)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 font-semibold text-accent">Open paper<ExternalLink className="h-4 w-4" aria-hidden="true" /></a>
              </div>
              {paper.previewReady && !previewFailed ? <a href={fileUrl(`paper-${paper.index}`, true)} target="_blank" rel="noreferrer" aria-label="Open the full paper from its first-page preview" className="mx-auto block max-w-[480px] bg-white shadow-[0_8px_30px_var(--shadow)]"><Image unoptimized src={fileUrl(`preview-${paper.index}`, true)} alt="First page of your generated paper" width={800} height={1132} onError={() => setPreviewFailed(true)} className="h-auto w-full" /></a> : (
              <div className="flex min-h-44 items-center gap-5 bg-white p-6">
                <FileText className="h-12 w-12 text-accent" strokeWidth={1.25} aria-hidden="true" />
                <div><p className="font-semibold text-text">{paper.questionCount} questions · {paper.totalMarks} marks</p><p className="mt-2 text-sm leading-6 text-text-secondary">Open the paper to read, print or share it with your PDF viewer.</p></div>
              </div>
              )}
            </div>
          ) : null}
        </div>
        <aside className="min-w-0 border-t border-text/12 pt-6 md:border-l md:border-t-0 md:pl-6 md:pt-0 lg:pl-8" aria-label="Paper actions">
          {paper ? (
            <>
              <dl className="grid grid-cols-2 gap-6 border-b border-text/12 pb-6">
                <div><dt className="text-sm text-text-secondary">Actual marks</dt><dd className="mt-2 font-mono text-2xl font-semibold text-text">{paper.totalMarks}</dd></div>
                <div><dt className="text-sm text-text-secondary">Estimated time</dt><dd className="mt-2 font-mono text-2xl font-semibold text-text">{paper.timeMinutes}<span className="ml-1 text-sm font-normal">min</span></dd></div>
              </dl>
              <div className="mt-6 space-y-4">
                {job?.papers.map((entry) => (
                  <div key={entry.index} className="space-y-2">
                    {job.totalPapers > 1 ? <p className="text-sm font-semibold text-text">Paper {entry.index + 1} · {entry.totalMarks} marks</p> : null}
                    <button type="button" onClick={() => void generation.download(`paper-${entry.index}`, entry.fileName)} className="btn-press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-bold text-white hover:bg-accent-deep"><Download className="h-4 w-4" aria-hidden="true" />Download paper{job.totalPapers > 1 ? ` ${entry.index + 1}` : ""}</button>
                    {entry.markSchemeGenerated ? <a href={fileUrl(`scheme-${entry.index}`)} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent">Download mark scheme<Download className="h-4 w-4" aria-hidden="true" /></a> : null}
                    {entry.markSchemeWarning ? <InlineNotice tone="review" message={entry.markSchemeWarning} action={ready && !generation.requestPending ? { label: "Retry mark scheme", onSelect: () => { void generation.retryScheme(entry.index); } } : undefined} /> : null}
                    {generation.retryingScheme === entry.index ? <p role="status" className="text-sm text-text-secondary">Requesting the mark scheme. Your question paper stays available.</p> : null}
                  </div>
                ))}
                {ready && job && (job.totalPapers > 1 || job.papers.some((entry) => entry.markSchemeGenerated)) ? <a href={fileUrl("combined")} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-text-secondary">Download combined pack<Download className="h-4 w-4" aria-hidden="true" /></a> : null}
              </div>
              <div className="mt-6 border-t border-text/12 pt-5">
                {isAuthenticated ? (
                  <>
                    {savedPaperIds.length === job?.totalPapers ? <p className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-success" role="status"><Check className="h-4 w-4" aria-hidden="true" />Saved to My papers</p> : <><button type="button" disabled={saving || savedPaperIds.length === job?.papers.length} onClick={() => void generation.save()} className="min-h-11 text-sm font-semibold text-accent disabled:opacity-50">{saving ? "Saving..." : "Save to My papers"}</button>{savedPaperIds.length ? <p role="status" className="text-sm text-text-secondary">{savedPaperIds.length} of {job?.totalPapers} papers saved</p> : null}</>}
                    <button type="button" disabled={saving || reviewing} onClick={() => void review()} className="mt-2 flex min-h-12 w-full items-center justify-between gap-3 rounded-md border border-text/20 px-4 text-sm font-semibold text-text disabled:opacity-50">{reviewing ? "Opening review..." : "Review answers"}<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
                  </>
                ) : <><p className="text-sm leading-6 text-text-secondary">Sign in to keep this paper and review your answers.</p><Link href={`/auth?redirect=${encodeURIComponent(returnTo)}`} className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent">Sign in to keep paper<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></>}
                {saveError ? <InlineNotice message={saveError} action={{ label: "Retry", onSelect: () => { void generation.save(); } }} className="mt-3" /> : null}
                {reviewError ? <InlineNotice message={reviewError} className="mt-3" /> : null}
              </div>
            </>
          ) : null}
          {job ? <p className="mt-6 text-xs leading-5 text-text-secondary">This preparation link expires {new Date(job.expiresAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.</p> : null}
        </aside>
      </div>
    </section>
  );
}
