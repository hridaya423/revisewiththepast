"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ArrowRight, BarChart3, BookOpenCheck, Clock3, FileText, FolderOpen, Plus, ShieldCheck, Sparkles } from "lucide-react";

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
  const [studentLabel, setStudentLabel] = useState("");
  const [paperCode, setPaperCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => {
    return {
      savedPapers: initialSavedPapers.length,
      submissions: initialSubmissions.length,
      needsReview: initialSubmissions.filter((item) => item.reviewRequiredCount > 0 || item.status === "review_required").length,
      totalPages: initialSubmissions.reduce((sum, item) => sum + item.uploadedPageCount, 0),
      totalMarks: initialSubmissions.reduce((sum, item) => sum + item.totalAwardedMarks, 0),
    };
  }, [initialSavedPapers.length, initialSubmissions]);

  const createSubmission = () => {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/marking/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boardCode: "edexcel",
          subjectSlug: "mathematics",
          subjectKey: "edexcel-mathematics-higher",
          paperCode: paperCode.trim() || undefined,
          tier: "higher",
          studentLabel: studentLabel.trim() || undefined,
        }),
      });

      if (!response.ok) {
        setError(await response.text() || "Could not create submission.");
        return;
      }

      const payload = await response.json() as { submissionId: string };
      router.push(`/marking/${payload.submissionId}`);
      router.refresh();
    });
  };

  const createSubmissionFromSavedPaper = (savedPaperId: string, savedPaperTitle: string) => {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/marking/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          savedPaperId,
          boardCode: "edexcel",
          subjectSlug: "mathematics",
          subjectKey: "edexcel-mathematics-higher",
          tier: "higher",
          studentLabel: `${savedPaperTitle} script`,
        }),
      });

      if (!response.ok) {
        setError(await response.text() || "Could not create submission from saved paper.");
        return;
      }

      const payload = await response.json() as { submissionId: string };
      router.push(`/marking/${payload.submissionId}`);
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
            <h1 className="mt-5 max-w-[11ch] font-serif text-[clamp(2.2rem,5vw,3.6rem)] leading-[0.98] tracking-[-0.055em] text-[#1a2e1a]">Private marking, built around real papers.</h1>
            <p className="mt-4 max-w-[60ch] text-[1rem] leading-[1.75] text-[#3d5a3f]/70">{userName}, this is where saved generated papers turn into a real marking workflow. Keep source-linked papers, upload student pages question by question, run OCR, inspect sliced mark schemes, auto-score, and review anything uncertain without losing the provenance.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-[1.25rem] border border-[#1a2e1a]/[0.06] bg-white/88 p-4 shadow-[0_8px_20px_rgba(26,46,26,0.04)] backdrop-blur">
              <div className="flex items-center gap-2 text-[0.72rem] uppercase tracking-[0.16em] text-accent-warm"><FolderOpen className="h-3.5 w-3.5" /><span>Saved papers</span></div>
              <p className="mt-3 font-serif text-[2rem] text-[#1a2e1a]">{stats.savedPapers}</p>
              <p className="mt-1 text-[0.8rem] text-[#3d5a3f]/55">Each one keeps the exact generated composition for later marking.</p>
            </div>
            <div className="rounded-[1.25rem] border border-[#1a2e1a]/[0.06] bg-white/88 p-4 shadow-[0_8px_20px_rgba(26,46,26,0.04)] backdrop-blur">
              <div className="flex items-center gap-2 text-[0.72rem] uppercase tracking-[0.16em] text-accent-warm"><ShieldCheck className="h-3.5 w-3.5" /><span>Needs review</span></div>
              <p className="mt-3 font-serif text-[2rem] text-[#1a2e1a]">{stats.needsReview}</p>
              <p className="mt-1 text-[0.8rem] text-[#3d5a3f]/55">Low-confidence or edge-case questions stay visible instead of getting buried.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="rounded-[1.6rem] border border-[#1a2e1a]/[0.06] bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Plus className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[0.72rem] uppercase tracking-[0.14em] text-accent-warm">New submission</p>
              <h2 className="font-serif text-[1.35rem] text-[#1a2e1a]">Start a paper</h2>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block text-[0.8rem] font-medium text-[#1a2e1a]/75">
              Student Label
              <input value={studentLabel} onChange={(event) => setStudentLabel(event.target.value)} placeholder="e.g. Amelia mock 1" className="mt-1.5 w-full rounded-xl border border-[#1a2e1a]/[0.08] bg-[#faf9f6] px-4 py-3 text-[0.88rem] outline-none focus:border-accent/35 focus:bg-white focus:shadow-[0_0_0_3px_rgba(90,138,92,0.15)]" />
            </label>

            <label className="block text-[0.8rem] font-medium text-[#1a2e1a]/75">
              Paper code
              <input value={paperCode} onChange={(event) => setPaperCode(event.target.value)} placeholder="e.g. 1MA1/1H" className="mt-1.5 w-full rounded-xl border border-[#1a2e1a]/[0.08] bg-[#faf9f6] px-4 py-3 text-[0.88rem] outline-none focus:border-accent/35 focus:bg-white focus:shadow-[0_0_0_3px_rgba(90,138,92,0.15)]" />
            </label>

            <button type="button" onClick={createSubmission} disabled={isPending} className="btn-press flex w-full items-center justify-center gap-2 rounded-full bg-[#1a2e1a] px-5 py-3 text-[0.88rem] font-semibold text-white shadow-[0_8px_20px_rgba(26,46,26,0.18)] transition-all hover:bg-[#233923] hover:shadow-[0_12px_28px_rgba(26,46,26,0.22)] disabled:opacity-60">
              <span>{isPending ? "Creating..." : "Create submission"}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
            {error ? <p className="text-[0.8rem] text-red-700">{error}</p> : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-[1.3rem] border border-[#1a2e1a]/[0.06] bg-[linear-gradient(180deg,#ffffff_0%,#fbfaf7_100%)] p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f4f2ec] text-accent-warm"><FileText className="h-4 w-4" /></div>
              <p className="mt-4 text-[0.72rem] uppercase tracking-[0.14em] text-accent-warm">Stored pages</p>
              <p className="mt-1 font-serif text-[1.8rem] text-[#1a2e1a]">{stats.totalPages}</p>
            </div>
            <div className="rounded-[1.3rem] border border-[#1a2e1a]/[0.06] bg-[linear-gradient(180deg,#ffffff_0%,#fbfaf7_100%)] p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f4f2ec] text-accent-warm"><BarChart3 className="h-4 w-4" /></div>
              <p className="mt-4 text-[0.72rem] uppercase tracking-[0.14em] text-accent-warm">Awarded marks</p>
              <p className="mt-1 font-serif text-[1.8rem] text-[#1a2e1a]">{stats.totalMarks}</p>
            </div>
            <div className="rounded-[1.3rem] border border-[#1a2e1a]/[0.06] bg-[linear-gradient(180deg,#ffffff_0%,#fbfaf7_100%)] p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f4f2ec] text-accent-warm"><BookOpenCheck className="h-4 w-4" /></div>
              <p className="mt-4 text-[0.72rem] uppercase tracking-[0.14em] text-accent-warm">State</p>
              <p className="mt-1 text-[0.9rem] text-[#3d5a3f]/65">Generated papers now persist to your account, so marking can resolve the original source paper and mark scheme for each question.</p>
            </div>
          </div>

          <div className="rounded-[1.6rem] border border-[#1a2e1a]/[0.06] bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.16em] text-accent-warm">Saved papers</p>
                <h2 className="mt-1 font-serif text-[1.35rem] text-[#1a2e1a]">Stored generated papers</h2>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {initialSavedPapers.length === 0 ? (
                <div className="rounded-[1.3rem] border border-dashed border-[#1a2e1a]/10 bg-[#faf8f3] px-5 py-10 text-center text-[0.9rem] text-[#3d5a3f]/60">Generate a paper while signed in and it will be stored here automatically for later marking.</div>
              ) : initialSavedPapers.map((savedPaper) => (
                <div key={savedPaper._id} className="rounded-[1.2rem] border border-[#1a2e1a]/[0.06] bg-[linear-gradient(180deg,#faf9f6_0%,#ffffff_100%)] px-4 py-4 shadow-[0_6px_18px_rgba(26,46,26,0.03)]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[#1a2e1a]">{savedPaper.title}</p>
                      <p className="mt-1 text-[0.8rem] text-[#3d5a3f]/55">{savedPaper.questionCount} questions · {savedPaper.totalMarks} marks · {savedPaper.timeMinutes} minutes · updated {formatDate(savedPaper.updatedAt)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <a href={savedPaper.pdfUrl} target="_blank" rel="noreferrer" className="btn-press rounded-full border border-[#1a2e1a]/10 px-3 py-2 text-[0.78rem] font-medium text-[#1a2e1a] hover:bg-white">View PDF</a>
                      <button type="button" onClick={() => createSubmissionFromSavedPaper(savedPaper._id, savedPaper.title)} className="btn-press inline-flex items-center gap-2 rounded-full bg-[#1a2e1a] px-4 py-2 text-[0.78rem] font-semibold text-white">
                        <span>Mark this paper</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[1.6rem] border border-[#1a2e1a]/[0.06] bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.16em] text-accent-warm">Recent submissions</p>
                <h2 className="mt-1 font-serif text-[1.35rem] text-[#1a2e1a]">Saved marking papers</h2>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {initialSubmissions.length === 0 ? (
                <div className="rounded-[1.3rem] border border-dashed border-[#1a2e1a]/10 bg-[#faf8f3] px-5 py-10 text-center text-[0.9rem] text-[#3d5a3f]/60">No saved papers yet. Create your first submission to start storing uploads, OCR, marks, and review state.</div>
              ) : initialSubmissions.map((submission) => (
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
        </div>
      </section>
    </div>
  );
}
