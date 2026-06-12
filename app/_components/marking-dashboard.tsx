"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ArrowRight, Clock3, FolderOpen, ShieldCheck, Sparkles } from "lucide-react";

type SubmissionSummary = {
  _id: string;
  subjectKey: string;
  savedPaperId?: string;
  savedPaperTitle?: string | null;
  studentLabel?: string;
  paperCode?: string;
  tier?: "none" | "foundation" | "higher";
  status: "uploaded" | "ocr_complete" | "scored" | "review_required";
  updatedAt: number;
  uploadedPageCount: number;
  scoredCount: number;
  totalAwardedMarks: number;
  totalMaxMarks: number;
  reviewRequiredCount: number;
};

type SavedPaperSummary = {
  _id: string;
  title: string;
  pdfUrl: string;
  pdfFileName: string;
  questionCount: number;
  totalMarks: number;
  timeMinutes: number;
  updatedAt: number;
};

function formatStatus(status: SubmissionSummary["status"]) {
  if (status === "uploaded") return "Uploaded";
  if (status === "ocr_complete") return "OCR complete";
  if (status === "review_required") return "Needs review";
  return "Scored";
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function MarkingDashboard({
  initialSavedPapers,
  initialSubmissions,
  userName,
}: {
  initialSavedPapers: SavedPaperSummary[];
  initialSubmissions: SubmissionSummary[];
  userName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const importFinishedPdf = (file: File | null) => {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/marking/import-finished-paper", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        setError(await response.text() || "Could not import the finished paper PDF.");
        return;
      }

      const payload = await response.json() as { submissionId: string };
      router.push(`/marking/${payload.submissionId}`);
      router.refresh();
    });
  };

  const submissionsBySavedPaperId = useMemo(() => {
    const grouped = new Map<string, SubmissionSummary[]>();
    for (const submission of initialSubmissions) {
      if (!submission.savedPaperId) continue;
      const existing = grouped.get(submission.savedPaperId) ?? [];
      existing.push(submission);
      grouped.set(submission.savedPaperId, existing);
    }
    return grouped;
  }, [initialSubmissions]);

  const linkedSubmissions = useMemo(
    () => initialSubmissions.filter((submission) => Boolean(submission.savedPaperId)),
    [initialSubmissions],
  );

  const legacySubmissions = useMemo(
    () => initialSubmissions.filter((submission) => !submission.savedPaperId),
    [initialSubmissions],
  );

  const stats = useMemo(() => {
    return {
      savedPapers: initialSavedPapers.length,
      readyToMark: initialSavedPapers.filter((paper) => !(submissionsBySavedPaperId.get(paper._id)?.length)).length,
      activeSubmissions: linkedSubmissions.length,
      needsReview: initialSubmissions.filter((item) => item.reviewRequiredCount > 0 || item.status === "review_required").length,
    };
  }, [initialSavedPapers, initialSubmissions, linkedSubmissions.length, submissionsBySavedPaperId]);

  const startMarkingFromSavedPaper = (savedPaperId: string) => {
    setError(null);
    startTransition(async () => {
      router.push(`/marking/start/${savedPaperId}`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-[2rem] border border-[#1a2e1a]/[0.06] bg-[radial-gradient(circle_at_top_left,rgba(90,138,92,0.12),transparent_34%),linear-gradient(180deg,#ffffff_0%,#fbfaf7_100%)] p-8 shadow-[0_10px_40px_rgba(26,46,26,0.05)] sm:p-10">
        <div className="absolute inset-y-0 right-0 hidden w-[32%] border-l border-[#1a2e1a]/[0.04] bg-[linear-gradient(180deg,rgba(26,46,26,0.02),rgba(26,46,26,0.00))] lg:block" />
        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_360px] lg:items-end">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#1a2e1a]/10 bg-white/80 px-3 py-1.5 text-[0.7rem] uppercase tracking-[0.2em] text-accent-warm backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Marking Studio</span>
            </div>
            <h1 className="mt-5 max-w-[10ch] font-serif text-[clamp(2.3rem,5vw,3.7rem)] leading-[0.98] tracking-[-0.055em] text-[#1a2e1a]">From saved paper to marking workflow.</h1>
            <p className="mt-4 max-w-[60ch] text-[1rem] leading-[1.75] text-[#3d5a3f]/70">{userName}, the right path here is simple: build papers while signed in, let them save automatically, then start marking directly from those saved papers so every question stays tied back to the original source paper and mark scheme.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-[1.25rem] border border-[#1a2e1a]/[0.06] bg-white/88 p-4 shadow-[0_8px_20px_rgba(26,46,26,0.04)] backdrop-blur">
              <div className="flex items-center gap-2 text-[0.72rem] uppercase tracking-[0.16em] text-accent-warm"><FolderOpen className="h-3.5 w-3.5" /><span>Saved papers</span></div>
              <p className="mt-3 font-serif text-[2rem] text-[#1a2e1a]">{stats.savedPapers}</p>
              <p className="mt-1 text-[0.8rem] text-[#3d5a3f]/55">Papers generated while signed in and ready to be turned into marking submissions.</p>
            </div>
            <div className="rounded-[1.25rem] border border-[#1a2e1a]/[0.06] bg-white/88 p-4 shadow-[0_8px_20px_rgba(26,46,26,0.04)] backdrop-blur">
              <div className="flex items-center gap-2 text-[0.72rem] uppercase tracking-[0.16em] text-accent-warm"><ShieldCheck className="h-3.5 w-3.5" /><span>Needs review</span></div>
              <p className="mt-3 font-serif text-[2rem] text-[#1a2e1a]">{stats.needsReview}</p>
              <p className="mt-1 text-[0.8rem] text-[#3d5a3f]/55">Questions the model flagged as uncertain or that were manually held back for review.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-[1.3rem] border border-[#1a2e1a]/[0.06] bg-[linear-gradient(180deg,#ffffff_0%,#fbfaf7_100%)] p-5">
            <p className="text-[0.72rem] uppercase tracking-[0.14em] text-accent-warm">Saved papers</p>
            <p className="mt-2 font-serif text-[2rem] text-[#1a2e1a]">{stats.savedPapers}</p> 
          </div>
          <div className="rounded-[1.3rem] border border-[#1a2e1a]/[0.06] bg-[linear-gradient(180deg,#ffffff_0%,#fbfaf7_100%)] p-5">
            <p className="text-[0.72rem] uppercase tracking-[0.14em] text-accent-warm">Ready to mark</p>
            <p className="mt-2 font-serif text-[2rem] text-[#1a2e1a]">{stats.readyToMark}</p>
          </div>
          <div className="rounded-[1.3rem] border border-[#1a2e1a]/[0.06] bg-[linear-gradient(180deg,#ffffff_0%,#fbfaf7_100%)] p-5">
            <p className="text-[0.72rem] uppercase tracking-[0.14em] text-accent-warm">Active submissions</p>
            <p className="mt-2 font-serif text-[2rem] text-[#1a2e1a]">{stats.activeSubmissions}</p>
          </div>
        </div>

        <div className="rounded-[1.6rem] border border-[#1a2e1a]/[0.06] bg-white p-6 shadow-sm">
          <div>
            <p className="text-[0.72rem] uppercase tracking-[0.16em] text-accent-warm">Fastest route</p>
            <h2 className="mt-1 font-serif text-[1.35rem] text-[#1a2e1a]">Upload a finished paper PDF directly</h2>
            <p className="mt-2 max-w-[60ch] text-[0.88rem] leading-[1.65] text-[#3d5a3f]/60">If you already finished a generated paper before saving it or before you had an account, upload the finished PDF here. The app will try to reconstruct the question set, extract the answers, and create a markable submission automatically.</p>
          </div>
          <label className="mt-5 flex cursor-pointer items-center justify-center rounded-[1rem] border border-dashed border-[#1a2e1a]/15 bg-[#f5f2ea] px-4 py-7 text-center text-[0.86rem] text-[#3d5a3f]/60 hover:border-accent/35 hover:bg-white">
            <input type="file" accept="application/pdf" className="hidden" onChange={(event) => importFinishedPdf(event.target.files?.[0] ?? null)} />
            {isPending ? "Importing finished paper PDF..." : "Upload finished paper PDF"}
          </label>
          {error ? <p className="mt-4 text-[0.8rem] text-red-700">{error}</p> : null}
        </div>

        <div className="rounded-[1.6rem] border border-[#1a2e1a]/[0.06] bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.72rem] uppercase tracking-[0.16em] text-accent-warm">Saved papers</p>
              <h2 className="mt-1 font-serif text-[1.35rem] text-[#1a2e1a]">Start marking from generated papers</h2>
              <p className="mt-2 max-w-[60ch] text-[0.88rem] leading-[1.65] text-[#3d5a3f]/60">This is the preferred flow. It means the marking system already knows exactly which source paper each question came from, which is what allows proper mark scheme lookup and slicing.</p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {initialSavedPapers.length === 0 ? (
              <div className="rounded-[1.3rem] border border-dashed border-[#1a2e1a]/10 bg-[#faf8f3] px-5 py-10 text-center">
                <p className="text-[0.9rem] text-[#3d5a3f]/60">No saved papers yet. Generate a paper while signed in and it will appear here automatically.</p>
                <button type="button" onClick={() => router.push("/paper-maker")} className="btn-press mt-4 inline-flex items-center gap-2 rounded-full bg-[#1a2e1a] px-4 py-2 text-[0.8rem] font-semibold text-white">
                  <span>Go to paper builder</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : initialSavedPapers.map((savedPaper) => {
              const linkedSubmissions = submissionsBySavedPaperId.get(savedPaper._id) ?? [];

              return (
                <div key={savedPaper._id} className="rounded-[1.2rem] border border-[#1a2e1a]/[0.06] bg-[linear-gradient(180deg,#faf9f6_0%,#ffffff_100%)] px-4 py-4 shadow-[0_6px_18px_rgba(26,46,26,0.03)]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[#1a2e1a]">{savedPaper.title}</p>
                      <p className="mt-1 text-[0.8rem] text-[#3d5a3f]/55">{savedPaper.questionCount} questions · {savedPaper.totalMarks} marks · {savedPaper.timeMinutes} minutes · updated {formatDate(savedPaper.updatedAt)}</p>
                      {linkedSubmissions.length > 0 ? (
                        <p className="mt-1 text-[0.78rem] text-[#3d5a3f]/45">{linkedSubmissions.length} linked submission{linkedSubmissions.length === 1 ? "" : "s"}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <a href={savedPaper.pdfUrl} target="_blank" rel="noreferrer" className="btn-press rounded-full border border-[#1a2e1a]/10 px-3 py-2 text-[0.78rem] font-medium text-[#1a2e1a] hover:bg-white">View PDF</a>
                      <button type="button" onClick={() => startMarkingFromSavedPaper(savedPaper._id)} disabled={isPending} className="btn-press inline-flex items-center gap-2 rounded-full bg-[#1a2e1a] px-4 py-2 text-[0.78rem] font-semibold text-white disabled:opacity-60">
                        <span>{linkedSubmissions.length > 0 ? "Mark another attempt" : "Mark this paper"}</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-[1.6rem] border border-[#1a2e1a]/[0.06] bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.72rem] uppercase tracking-[0.16em] text-accent-warm">In progress</p>
              <h2 className="mt-1 font-serif text-[1.35rem] text-[#1a2e1a]">Continue marking</h2>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {linkedSubmissions.length === 0 ? (
              <div className="rounded-[1.3rem] border border-dashed border-[#1a2e1a]/10 bg-[#faf8f3] px-5 py-10 text-center text-[0.9rem] text-[#3d5a3f]/60">No active submissions yet. Start from one of your saved generated papers above.</div>
            ) : linkedSubmissions.map((submission) => (
              <button key={submission._id} type="button" onClick={() => router.push(`/marking/${submission._id}`)} className="card-lift flex w-full items-center justify-between gap-4 rounded-[1.2rem] border border-[#1a2e1a]/[0.06] bg-[linear-gradient(180deg,#faf9f6_0%,#ffffff_100%)] px-4 py-4 text-left shadow-[0_6px_18px_rgba(26,46,26,0.03)] hover:bg-white">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-[#1a2e1a]">{submission.studentLabel || "Untitled student paper"}</p>
                    <span className={`rounded-full px-2.5 py-1 text-[0.68rem] uppercase tracking-[0.12em] ${submission.status === "review_required" ? "bg-[#fff1e8] text-[#9a5a2c]" : submission.status === "scored" ? "bg-[#edf7ee] text-[#3f6d44]" : "bg-white text-accent-warm"}`}>{formatStatus(submission.status)}</span>
                  </div>
                  <p className="mt-1 text-[0.8rem] text-[#3d5a3f]/55">{submission.savedPaperTitle || submission.paperCode || "No paper reference"} · {submission.scoredCount} scored · {submission.uploadedPageCount} uploads · {submission.totalAwardedMarks}/{submission.totalMaxMarks || 0} marks</p>
                </div>
                <div className="flex items-center gap-2 text-[0.75rem] text-[#3d5a3f]/45">
                  <Clock3 className="h-3.5 w-3.5" />
                  <span>{formatDate(submission.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

      </section>
    </div>
  );
}
