"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, ChevronRight, FileText, Loader2, Plus, Upload } from "lucide-react";

import { OperationNotice } from "@/app/_components/marking/presentation";
import { QuestionProgressRail, type QuestionProgressItem } from "@/app/_components/marking/question-progress";

type SubmissionSummary = {
  _id: string;
  subjectKey: string;
  subjectSlug: string;
  boardCode: string;
  savedPaperId?: string;
  savedPaperTitle?: string | null;
  savedPaperPdfUrl?: string | null;
  savedPaperQuestionCount: number;
  studentLabel?: string;
  paperCode?: string;
  status: "uploaded" | "ocr_complete" | "scored" | "review_required";
  updatedAt: number;
  uploadedPageCount: number;
  confirmedCount: number;
  aiSuggestedCount: number;
  confirmedAwardedMarks: number;
  confirmedMaxMarks: number;
  paperMaxMarks: number;
  reviewRequiredCount: number;
  questionProgress: QuestionProgressItem[];
  gapTopics: Array<{ label: string; missedMarks: number }>;
};

type SavedPaperSummary = {
  _id: string;
  title: string;
  pdfUrl: string;
  questionCount: number;
  totalMarks: number;
  timeMinutes: number;
  updatedAt: number;
};

function formatDate(timestamp: number) {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Recently";
}

function paperStatus(attempt?: SubmissionSummary) {
  if (!attempt) return { label: "Not started", dot: "bg-text-subtle" };
  if (attempt.reviewRequiredCount > 0 || attempt.status === "review_required") return { label: "Needs review", dot: "bg-warning" };
  if (attempt.confirmedCount >= attempt.savedPaperQuestionCount && attempt.savedPaperQuestionCount > 0) return { label: "Marked", dot: "bg-success" };
  return { label: "In progress", dot: "bg-accent-warm-deep" };
}

function currentQuestionLabel(submission: SubmissionSummary) {
  return submission.questionProgress?.find((item) => item.state === "current")?.label;
}

function PaperThumbnail({ submission }: { submission: SubmissionSummary }) {
  return (
    <a
      href={submission.savedPaperPdfUrl ?? undefined}
      target={submission.savedPaperPdfUrl ? "_blank" : undefined}
      rel="noreferrer"
      className="group relative block min-h-64 overflow-hidden rounded-sm border border-text/15 bg-white shadow-[0_12px_30px_var(--shadow-lg)]"
      aria-label={submission.savedPaperPdfUrl ? "Open saved paper PDF" : "Paper preview"}
    >
      {submission.savedPaperPdfUrl ? (
        <iframe
          src={`${submission.savedPaperPdfUrl}#page=1&toolbar=0&navpanes=0&scrollbar=0`}
          title="Saved paper preview"
          loading="lazy"
          tabIndex={-1}
          className="pointer-events-none absolute inset-0 h-full w-full bg-white"
        />
      ) : (
        <div className="absolute inset-0 p-8">
          <div className="flex justify-between border-b border-text/25 pb-3 font-serif text-[0.6rem] text-text"><span>{(submission.subjectSlug || "GCSE").toUpperCase()}</span><span>{submission.paperCode ?? "REVISION PAPER"}</span></div>
          <div className="mt-7 space-y-5">
            {["w-11/12", "w-4/5", "w-full", "w-3/4"].map((width, index) => <div key={width} className="flex gap-4"><span className="font-serif text-xs">{index + 1}</span><div className="flex-1 space-y-2"><div className={`h-px bg-text/30 ${width}`} /><div className="h-px w-full bg-text/15" /><div className="h-px w-5/6 bg-text/15" /></div></div>)}
          </div>
        </div>
      )}
      <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-sm border border-success/20 bg-success-soft/90 px-2 py-1 text-[0.58rem] font-bold text-success backdrop-blur-sm"><Check className="h-3 w-3" /> Paper ready</span>
    </a>
  );
}

export function MarkingDashboard({ initialSavedPapers, initialSubmissions, userName, initialLoadError = null }: { initialSavedPapers: SavedPaperSummary[]; initialSubmissions: SubmissionSummary[]; userName: string; initialLoadError?: string | null }) {
  const router = useRouter();
  const [importState, setImportState] = useState<"idle" | "processing">("idle");
  const [startingPaperIds, setStartingPaperIds] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(initialLoadError);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sortedSubmissions = useMemo(() => [...initialSubmissions].sort((left, right) => right.updatedAt - left.updatedAt), [initialSubmissions]);
  const featuredSubmission = sortedSubmissions[0] ?? null;
  const submissionsBySavedPaperId = useMemo(() => {
    const grouped = new Map<string, SubmissionSummary[]>();
    for (const submission of sortedSubmissions) {
      if (!submission.savedPaperId) continue;
      grouped.set(submission.savedPaperId, [...(grouped.get(submission.savedPaperId) ?? []), submission]);
    }
    return grouped;
  }, [sortedSubmissions]);
  const gapTopics = useMemo(() => {
    const missedByLabel = new Map<string, number>();
    for (const submission of sortedSubmissions) {
      for (const topic of submission.gapTopics ?? []) missedByLabel.set(topic.label, (missedByLabel.get(topic.label) ?? 0) + topic.missedMarks);
    }
    return Array.from(missedByLabel).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([label, missedMarks]) => ({ label, missedMarks }));
  }, [sortedSubmissions]);

  const importFinishedPdf = async (file: File | null) => {
    if (!file) return;
    setImportError(null);
    setImportState("processing");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/marking/import-finished-paper", { method: "POST", body: formData });
      if (!response.ok) throw new Error(await response.text() || "Could not import the finished paper PDF.");
      const payload = await response.json() as { submissionId: string };
      router.push(`/marking/${payload.submissionId}`);
      router.refresh();
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : "Could not import the finished paper PDF.");
    } finally {
      setImportState("idle");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const openSavedPaper = async (savedPaperId: string, createNew = false) => {
    const latestAttempt = submissionsBySavedPaperId.get(savedPaperId)?.[0];
    if (latestAttempt && !createNew) {
      router.push(`/marking/${latestAttempt._id}`);
      return;
    }
    setActionError(null);
    setStartingPaperIds((current) => new Set(current).add(savedPaperId));
    try {
      const response = await fetch("/api/marking/submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ savedPaperId }) });
      if (!response.ok) throw new Error(await response.text() || "Could not start marking this paper.");
      const payload = await response.json() as { submissionId: string };
      router.push(`/marking/${payload.submissionId}`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not start marking this paper.");
    } finally {
      setStartingPaperIds((current) => {
        const next = new Set(current);
        next.delete(savedPaperId);
        return next;
      });
    }
  };

  const triggerImport = () => fileInputRef.current?.click();

  return (
    <div className="space-y-8 pb-8">
      <input ref={fileInputRef} type="file" accept="application/pdf" className="sr-only" disabled={importState === "processing"} onChange={(event) => void importFinishedPdf(event.target.files?.[0] ?? null)} />
      <header className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[clamp(2rem,5vw,3.35rem)] font-extrabold leading-none tracking-[-0.055em] text-text">Mark your papers</h1>
          <p className="mt-3 text-[0.88rem] text-text-secondary">Keep every response, mark-scheme point and next step together, {userName}.</p>
        </div>
        <button type="button" onClick={triggerImport} disabled={importState === "processing"} className="btn-press inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-sm border border-accent bg-bg-elevated px-5 text-[0.76rem] font-bold text-accent hover:bg-accent-soft disabled:opacity-55">
          {importState === "processing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {importState === "processing" ? "Reading paper" : "Import a finished paper"}
        </button>
      </header>

      {actionError ? <OperationNotice message={actionError} /> : null}
      {importError ? <OperationNotice message={importError} /> : null}
      {loadError ? <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><OperationNotice message={loadError} /><button type="button" onClick={() => { setLoadError(null); router.refresh(); }} className="btn-press min-h-10 shrink-0 border border-danger/25 bg-white px-4 text-[0.72rem] font-bold text-danger hover:bg-danger-soft">Try loading again</button></div> : null}

      {featuredSubmission ? (
        <section className="grid gap-0 overflow-hidden rounded-sm border border-text/15 bg-bg-soft lg:grid-cols-12" aria-labelledby="continue-marking-title">
          <div className="flex min-w-0 flex-col p-6 sm:p-8 lg:col-span-8 lg:p-9">
            <p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.18em] text-accent">Continue marking</p>
            <h2 id="continue-marking-title" className="mt-2 text-[clamp(1.25rem,3vw,1.8rem)] font-extrabold tracking-[-0.035em] text-text">{featuredSubmission.savedPaperTitle || featuredSubmission.studentLabel || `${(featuredSubmission.boardCode || "GCSE").toUpperCase()} ${featuredSubmission.subjectSlug || "paper"}`}</h2>
            <p className="mt-2 font-mono text-[0.72rem] text-text-muted">{featuredSubmission.savedPaperQuestionCount || featuredSubmission.questionProgress.length} questions <span className="px-2 text-text-subtle">·</span> {featuredSubmission.paperMaxMarks} marks <span className="px-2 text-text-subtle">·</span> updated {formatDate(featuredSubmission.updatedAt)}</p>
            {featuredSubmission.questionProgress.length > 0 ? <div className="mt-8 overflow-x-auto pb-2"><QuestionProgressRail items={featuredSubmission.questionProgress} /></div> : null}
            <div className="mt-auto pt-7">
              <p className="text-[clamp(1.65rem,4vw,2.45rem)] font-extrabold tracking-[-0.04em] text-text"><span className="tabular-nums">{featuredSubmission.confirmedAwardedMarks} / {featuredSubmission.paperMaxMarks}</span> <span className="text-[0.55em] tracking-[-0.02em]">marks confirmed</span></p>
              <div className="mt-3 h-px max-w-xl overflow-hidden bg-text/25"><div className="h-full bg-accent-warm-deep" style={{ width: `${featuredSubmission.paperMaxMarks > 0 ? Math.min(100, (featuredSubmission.confirmedMaxMarks / featuredSubmission.paperMaxMarks) * 100) : 0}%` }} /></div>
              <button type="button" onClick={() => router.push(`/marking/${featuredSubmission._id}`)} className="btn-press mt-7 inline-flex min-h-12 items-center justify-center gap-8 rounded-sm bg-accent px-6 text-[0.78rem] font-bold text-white shadow-[0_8px_20px_var(--accent-glow)] hover:bg-accent-deep">
                {currentQuestionLabel(featuredSubmission) ? `Continue with question ${currentQuestionLabel(featuredSubmission)}` : featuredSubmission.reviewRequiredCount > 0 ? "Review this paper" : "Open marked paper"}
                <ArrowRight className="h-4 w-4" />
              </button>
              {featuredSubmission.aiSuggestedCount > 0 ? <p className="mt-3 text-[0.68rem] text-text-muted">{featuredSubmission.aiSuggestedCount} AI suggestion{featuredSubmission.aiSuggestedCount === 1 ? "" : "s"} waiting for confirmation</p> : null}
            </div>
          </div>
          <div className="border-t border-text/10 bg-bg-warm p-5 lg:col-span-4 lg:border-l lg:border-t-0 lg:p-7"><PaperThumbnail submission={featuredSubmission} /></div>
        </section>
      ) : (
        <section className="rounded-sm border border-dashed border-text/20 bg-bg-soft px-6 py-12 text-center">
          <FileText className="mx-auto h-7 w-7 text-accent" />
          <h2 className="mt-4 text-lg font-bold text-text">Your marking desk is ready</h2>
          <p className="mt-2 text-sm text-text-muted">Start from a saved paper below or import one you have already completed.</p>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-12">
        <section className="min-w-0 lg:col-span-9" aria-labelledby="saved-papers-title">
          <div className="flex items-end justify-between border-b border-text/20 pb-3">
            <div><h2 id="saved-papers-title" className="text-[1.35rem] font-extrabold tracking-[-0.035em] text-text">Your saved papers</h2><p className="mt-1 text-[0.72rem] text-text-muted">Resume the latest attempt or explicitly begin another.</p></div>
            <span className="font-mono text-[0.66rem] text-text-subtle">{initialSavedPapers.length} total</span>
          </div>
          {initialSavedPapers.length === 0 ? (
            <div className="border-b border-text/15 py-10 text-center"><p className="text-sm text-text-muted">Generated papers will appear here.</p><button type="button" onClick={() => router.push("/paper-maker")} className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-accent">Build a paper <ArrowRight className="h-4 w-4" /></button></div>
          ) : (
            <div className="divide-y divide-text/15 border-b border-text/20">
              {initialSavedPapers.map((paper) => {
                const attempts = submissionsBySavedPaperId.get(paper._id) ?? [];
                const latestAttempt = attempts[0];
                const status = paperStatus(latestAttempt);
                const isStarting = startingPaperIds.has(paper._id);
                return (
                  <article key={paper._id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1.6fr)_0.7fr_0.7fr_auto] sm:items-center sm:gap-5">
                    <div className="flex min-w-0 items-center gap-3"><Check className={`h-5 w-5 shrink-0 ${latestAttempt ? "text-accent-warm-deep" : "text-accent"}`} /><div className="min-w-0"><h3 className="truncate text-[0.8rem] font-bold text-text">{paper.title}</h3><p className="mt-1 font-mono text-[0.62rem] text-text-subtle sm:hidden">{formatDate(paper.updatedAt)} · {paper.questionCount} / {paper.totalMarks}</p></div></div>
                    <p className="hidden font-mono text-[0.64rem] text-text-muted sm:block">{formatDate(paper.updatedAt)}</p>
                    <div className="hidden items-center gap-2 text-[0.66rem] text-text-muted sm:flex"><span className={`h-2 w-2 rounded-full ${status.dot}`} />{status.label}</div>
                    <div className="flex items-center justify-end gap-2">
                      <a href={paper.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1 px-2 text-[0.68rem] font-semibold text-text-muted hover:text-accent" aria-label={`Open ${paper.title} PDF`}>PDF <ArrowUpRight className="h-3.5 w-3.5" /></a>
                      <button type="button" disabled={isStarting} onClick={() => void openSavedPaper(paper._id)} className="btn-press inline-flex h-9 min-w-24 items-center justify-center gap-2 rounded-sm border border-accent px-3 text-[0.68rem] font-bold text-accent hover:bg-accent-soft disabled:opacity-55">{isStarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : latestAttempt ? "Resume" : "Start marking"}<ChevronRight className="h-3.5 w-3.5" /></button>
                      {latestAttempt ? <button type="button" disabled={isStarting} onClick={() => void openSavedPaper(paper._id, true)} className="btn-press inline-flex h-9 w-9 items-center justify-center rounded-sm text-text-subtle hover:bg-bg-warm hover:text-accent disabled:opacity-55" aria-label={`Start a new attempt for ${paper.title}`}><Plus className="h-4 w-4" /></button> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <section className="mt-6 flex flex-col gap-4 rounded-sm border border-text/15 bg-bg-soft px-5 py-4 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="secondary-import-title">
            <div><p className="font-mono text-[0.58rem] font-bold uppercase tracking-[0.16em] text-accent">Other ways to start</p><h2 id="secondary-import-title" className="mt-1 text-base font-bold text-text">Already completed a paper?</h2><p className="mt-1 text-[0.7rem] text-text-muted">Import the PDF to add marks and feedback.</p></div>
            <button type="button" onClick={triggerImport} disabled={importState === "processing"} className="btn-press inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-sm border border-accent px-5 text-[0.7rem] font-bold text-accent hover:bg-accent-soft disabled:opacity-55"><Upload className="h-4 w-4" /> Import PDF</button>
          </section>
        </section>

        <aside className="self-start rounded-sm border border-text/15 bg-bg-soft p-5 lg:col-span-3" aria-labelledby="focused-practice-title">
          <p className="font-mono text-[0.6rem] font-bold uppercase tracking-[0.17em] text-accent">Focused practice</p>
          {gapTopics.length > 0 ? (
            <><h2 id="focused-practice-title" className="mt-3 text-lg font-extrabold tracking-[-0.03em] text-text">{gapTopics.length} gap{gapTopics.length === 1 ? "" : "s"} ready to practise</h2><ul className="mt-3 divide-y divide-text/15">{gapTopics.slice(0, 5).map((topic) => <li key={topic.label} className="flex items-center justify-between gap-3 py-3 text-[0.72rem] text-text-secondary"><span>{topic.label}</span><span className="shrink-0 font-mono text-[0.58rem] text-text-subtle">−{topic.missedMarks}</span></li>)}</ul></>
          ) : (
            <><h2 id="focused-practice-title" className="mt-3 text-lg font-extrabold tracking-[-0.03em] text-text">No confirmed gaps yet</h2><p className="mt-2 text-[0.72rem] leading-5 text-text-muted">Confirmed marks with topic data will shape your next focused paper.</p></>
          )}
          <button type="button" onClick={() => router.push("/paper-maker")} className="mt-4 inline-flex items-center gap-2 text-[0.72rem] font-bold text-accent-warm-deep hover:text-success">Build a focused paper <ArrowRight className="h-4 w-4" /></button>
        </aside>
      </div>
    </div>
  );
}
