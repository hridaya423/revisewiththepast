"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Brain, CheckCircle2, ChevronRight, Eye, FileUp, ScanText, Sparkles, TriangleAlert, Gauge, Layers3, ShieldAlert } from "lucide-react";
import { MathRichText } from "@/app/_components/math-rich-text";

type Bundle = {
  submission: {
    studentLabel?: string;
    paperCode?: string;
    status: "uploaded" | "ocr_complete" | "scored" | "review_required";
    importSource?: "manual_upload" | "imported_pdf" | "saved_paper";
  };
  savedPaper?: {
    title: string;
    pdfUrl: string;
  } | null;
  savedPaperQuestions?: Array<{
    unitKey: string;
    displayOrder: number;
    paperCode: string;
    year?: number;
    session?: string;
    questionNumber: string;
    questionPartNumber?: string | null;
    questionPath?: string[];
    totalMarks: number;
    promptText: string;
    contextText?: string | null;
  }>;
  pages: Array<{
    _id: string;
    questionKey: string;
    questionNumber?: string;
    questionPartNumber?: string;
    pageLabel?: string;
    fileName: string;
    sourceImageUrl: string;
    scriptPageNumber?: number;
    ocrText?: string;
  }>;
  responses: Array<{
    _id: string;
    questionKey: string;
    questionNumber?: string;
    questionPartNumber?: string;
    sourceImageUrl?: string;
    ocrText: string;
    ocrProvider?: string;
  }>;
  scores: Array<{
    _id: string;
    questionKey: string;
    awardedMarks: number;
    maxMarks: number;
    confidence: number;
    needsReview: boolean;
    rationale: string;
    evidenceJson?: string;
    scoreStatus?: "ai_suggested" | "confirmed";
    updatedAt?: number;
  }>;
  questionStatuses?: Array<{
    questionKey: string;
    status: string;
    failureReason?: string;
  }>;
  insights: {
    questionCount: number;
    uploadedPageCount: number;
    ocrCompletedCount: number;
    scoredCount: number;
    reviewRequiredCount: number;
    totalAwardedMarks: number;
    totalMaxMarks: number;
    averageConfidence: number | null;
  };
};

type CombinedMarkSchemeEntry = {
  questionKey: string;
  label: string;
  markScheme: {
    partText: string;
    questionText: string;
    pageNumbers: number[];
    markSchemeUrl: string;
  };
};

function formatQuestionLabel(question: {
  displayOrder?: number;
  questionNumber?: string;
  questionPartNumber?: string | null;
  questionPath?: string[];
  questionKey: string;
}) {
  const number = question.questionNumber ? `Question ${question.questionNumber}` : question.questionKey;
  const pathSuffix = question.questionPath && question.questionPath.length > 0
    ? ` (${question.questionPath.join(")(")})`
    : question.questionPartNumber
      ? ` (${question.questionPartNumber})`
      : "";
  return question.displayOrder ? `${question.displayOrder}. ${number}${pathSuffix}` : `${number}${pathSuffix}`;
}

function parseScoreEvidence(rawJson?: string) {
  if (!rawJson) return null;
  try {
    return JSON.parse(rawJson) as {
      markScheme?: {
        partText?: string;
        questionText?: string;
        pageNumbers?: number[];
        markSchemeUrl?: string;
      };
      markBreakdown?: Array<{
        criterion?: string;
        awarded?: boolean;
        evidence?: string;
      }>;
    };
  } catch {
    return null;
  }
}

function formatStatus(status: Bundle["submission"]["status"]) {
  if (status === "uploaded") return "Uploaded";
  if (status === "ocr_complete") return "OCR complete";
  if (status === "review_required") return "Needs review";
  return "Scored";
}

function confidenceLabel(value: number | null) {
  if (value === null) return "No confidence yet";
  if (value >= 0.85) return "High confidence";
  if (value >= 0.65) return "Moderate confidence";
  return "Low confidence";
}

function getQuestionState(row: {
  pages: unknown[];
  response: unknown;
  score: { needsReview: boolean; scoreStatus?: "ai_suggested" | "confirmed" } | null;
  questionStatus?: { status: string; failureReason?: string } | null;
}) {
  if (row.questionStatus?.status === "failed") return "failed" as const;
  if (row.questionStatus?.status === "needs_manual_review") return "review" as const;
  if (row.score?.scoreStatus === "confirmed") return row.score.needsReview ? "review" as const : "scored" as const;
  if (row.score?.scoreStatus === "ai_suggested") return row.score.needsReview ? "review" as const : "scored" as const;
  if (row.score?.needsReview) return "review" as const;
  if (row.score) return "scored" as const;
  if (row.response) return "ocr" as const;
  if (row.pages.length > 0) return "uploaded" as const;
  return "empty" as const;
}

function getQuestionStateLabel(state: ReturnType<typeof getQuestionState>, questionStatus?: { status: string; failureReason?: string } | null) {
  if (state === "failed") return questionStatus?.failureReason ? "Failed" : "Failed";
  if (state === "review") return "Needs review";
  if (state === "scored") return "Scored";
  if (state === "ocr") return "OCR ready";
  if (state === "uploaded") return "Uploaded";
  return "Waiting";
}

function getQuestionStateStyles(state: ReturnType<typeof getQuestionState>) {
  if (state === "failed") return "border-[#b85b4f]/25 bg-[#fff3f1] text-[#8f3f37]";
  if (state === "review") return "border-[#d9a063]/35 bg-[#fff5ea] text-[#9a5a2c]";
  if (state === "scored") return "border-[#5a8a5c]/20 bg-[#edf7ee] text-[#3f6d44]";
  if (state === "ocr") return "border-[#6d8aa6]/20 bg-[#eef4fb] text-[#486781]";
  if (state === "uploaded") return "border-[#1a2e1a]/10 bg-[#f6f4ef] text-[#5f6d60]";
  return "border-[#1a2e1a]/10 bg-white text-[#6f7d71]";
}

export function MarkingSubmissionWorkspace({ submissionId, initialBundle }: { submissionId: string; initialBundle: Bundle }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [ocrLoadingKey, setOcrLoadingKey] = useState<string | null>(null);
  const [scoreLoadingKey, setScoreLoadingKey] = useState<string | null>(null);
  const [autoScoreLoadingKey, setAutoScoreLoadingKey] = useState<string | null>(null);
  const [combinedMarkScheme, setCombinedMarkScheme] = useState<{ entries: CombinedMarkSchemeEntry[]; combinedText: string; failures?: Array<{ questionKey: string; error: string }> } | null>(null);
  const [isLoadingCombinedMarkScheme, setIsLoadingCombinedMarkScheme] = useState(false);
  const [activeMarkSchemeQuestionKey, setActiveMarkSchemeQuestionKey] = useState<string | null>(null);
  const [pageLabel, setPageLabel] = useState("");

  const questionRows = useMemo(() => {
    const savedQuestions = initialBundle.savedPaperQuestions ?? [];
    const questionKeys = savedQuestions.length > 0
      ? savedQuestions.map((question) => question.unitKey)
      : Array.from(new Set([
          ...initialBundle.pages.map((page) => page.questionKey),
          ...initialBundle.responses.map((response) => response.questionKey),
          ...initialBundle.scores.map((score) => score.questionKey),
        ]));

    return questionKeys.map((questionKey) => ({
      questionKey,
      savedQuestion: savedQuestions.find((question) => question.unitKey === questionKey) ?? null,
      pages: initialBundle.pages.filter((page) => page.questionKey === questionKey),
      response: initialBundle.responses.find((response) => response.questionKey === questionKey) ?? null,
      score: initialBundle.scores.find((score) => score.questionKey === questionKey) ?? null,
      questionStatus: initialBundle.questionStatuses?.find((entry) => entry.questionKey === questionKey) ?? null,
      combinedMarkScheme: combinedMarkScheme?.entries.find((entry) => entry.questionKey === questionKey) ?? null,
    }));
  }, [combinedMarkScheme?.entries, initialBundle.pages, initialBundle.questionStatuses, initialBundle.responses, initialBundle.savedPaperQuestions, initialBundle.scores]);

  const isImportedSubmission = initialBundle.submission.importSource === "imported_pdf";
  const hasImportedPages = initialBundle.pages.length > 0;

  const reviewRows = useMemo(() => questionRows.filter((row) => row.score?.needsReview), [questionRows]);
  const activeMarkSchemeEntry = useMemo(() => {
    const fallback = questionRows.find((row) => row.combinedMarkScheme)?.questionKey ?? null;
    const selectedKey = activeMarkSchemeQuestionKey ?? fallback;
    return questionRows.find((row) => row.questionKey === selectedKey)?.combinedMarkScheme ?? null;
  }, [activeMarkSchemeQuestionKey, questionRows]);

  const uploadPageForQuestion = (questionKey: string, file: File | null, questionNumberOverride?: string, questionPartNumberOverride?: string | null) => {
    if (!file) return;
    setUploadError(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.append("submissionId", submissionId);
      formData.append("questionKey", questionKey);
      if (questionNumberOverride) formData.append("questionNumber", questionNumberOverride);
      if (questionPartNumberOverride) formData.append("questionPartNumber", questionPartNumberOverride);
      if (pageLabel.trim()) formData.append("pageLabel", pageLabel.trim());
      formData.append("file", file);

      const response = await fetch("/api/marking/uploads", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        setUploadError(await response.text() || "Could not upload response page.");
        return;
      }

      setPageLabel("");
      router.refresh();
    });
  };

  const uploadFinishedScriptPages = (files: FileList | null) => {
    const savedQuestions = initialBundle.savedPaperQuestions ?? [];
    if (!files || files.length === 0) return;
    if (savedQuestions.length === 0) {
      setUploadError("This submission needs a linked saved paper before script pages can be assigned automatically.");
      return;
    }

    const orderedFiles = Array.from(files);
    const targetQuestions = questionRows
      .filter((row) => row.pages.length === 0)
      .map((row) => row.savedQuestion)
      .filter((question): question is NonNullable<typeof question> => question !== null);

    if (targetQuestions.length === 0) {
      setUploadError("Every generated question already has an uploaded page. Use the per-question upload buttons for extra pages.");
      return;
    }

    if (orderedFiles.length > targetQuestions.length) {
      setUploadError(`You selected ${orderedFiles.length} pages but only ${targetQuestions.length} questions are still missing uploads. Extra pages were not assigned automatically.`);
    } else {
      setUploadError(null);
    }

    startTransition(async () => {
      for (let index = 0; index < Math.min(orderedFiles.length, targetQuestions.length); index += 1) {
        const file = orderedFiles[index];
        const question = targetQuestions[index];
        const formData = new FormData();
        formData.append("submissionId", submissionId);
        formData.append("questionKey", question.unitKey);
        formData.append("questionNumber", question.questionNumber);
        if (question.questionPartNumber) formData.append("questionPartNumber", question.questionPartNumber);
        formData.append("pageLabel", `Script page ${index + 1}`);
        formData.append("file", file);

        const response = await fetch("/api/marking/uploads", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          setUploadError(await response.text() || `Could not upload script page ${index + 1}.`);
          return;
        }
      }

      setPageLabel("");
      router.refresh();
    });
  };

  const processFinishedPaperPdf = (file: File | null) => {
    if (!file) return;
    setUploadError(null);

    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("submissionId", submissionId);

        const response = await fetch("/api/marking/import-finished-paper", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          setUploadError(await response.text() || "Could not import the finished paper PDF.");
          return;
        }

        router.refresh();
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : String(error));
      }
    });
  };

  const runOcr = async (questionKey: string) => {
    setOcrLoadingKey(questionKey);
    const response = await fetch("/api/marking/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId, questionKey }),
    });
    setOcrLoadingKey(null);
    if (!response.ok) {
      setUploadError(await response.text() || "Could not run OCR.");
      return;
    }
    router.refresh();
  };

  const autoScore = async (questionKey: string) => {
    setAutoScoreLoadingKey(questionKey);
    const response = await fetch("/api/marking/auto-score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId, questionKey }),
    });
    setAutoScoreLoadingKey(null);
    if (!response.ok) {
      setUploadError(await response.text() || "Could not auto-score this question.");
      return;
    }
    router.refresh();
  };

  const autoScoreWholePaper = async () => {
    setAutoScoreLoadingKey("__whole-paper__");
    const response = await fetch("/api/marking/auto-score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId, scoreWholePaper: true }),
    });
    setAutoScoreLoadingKey(null);
    if (!response.ok) {
      setUploadError(await response.text() || "Could not auto-score the full paper.");
      return;
    }
    router.refresh();
  };

  const saveScore = async (questionKey: string, formData: FormData) => {
    setScoreLoadingKey(questionKey);
    const awardedMarks = Number(formData.get(`awarded-${questionKey}`) ?? 0);
    const maxMarks = Number(formData.get(`max-${questionKey}`) ?? 0);
    const rationale = String(formData.get(`rationale-${questionKey}`) ?? "").trim();
    const confidence = Number(formData.get(`confidence-${questionKey}`) ?? 0.5);
    const needsReview = formData.get(`review-${questionKey}`) === "on";
    const existingScore = initialBundle.scores.find((entry) => entry.questionKey === questionKey);
    const existingEvidence = parseScoreEvidence(existingScore?.evidenceJson);

    const response = await fetch("/api/marking/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionId,
        questionKey,
        awardedMarks,
        maxMarks,
        confidence,
        needsReview,
        rationale,
        evidence: existingEvidence ?? { savedFrom: "marking-workspace" },
      }),
    });
    setScoreLoadingKey(null);
    if (!response.ok) {
      setUploadError(await response.text() || "Could not save score.");
      return;
    }
    router.refresh();
  };

  const loadCombinedMarkScheme = async () => {
    setIsLoadingCombinedMarkScheme(true);
    const response = await fetch(`/api/marking/submissions/${submissionId}/mark-scheme`);
    setIsLoadingCombinedMarkScheme(false);
    if (!response.ok) {
      setUploadError(await response.text() || "Could not load combined mark scheme.");
      return;
    }
    const payload = await response.json() as {
      entries: CombinedMarkSchemeEntry[];
      combinedText: string;
      failures?: Array<{ questionKey: string; error: string }>;
    };
    setCombinedMarkScheme(payload);
    setActiveMarkSchemeQuestionKey(payload.entries[0]?.questionKey ?? null);
  };

  useEffect(() => {
    if ((initialBundle.savedPaperQuestions ?? []).length === 0 || combinedMarkScheme) return;
    void loadCombinedMarkScheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId, initialBundle.savedPaperQuestions?.length]);

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-[2rem] border border-[#1a2e1a]/[0.06] bg-[radial-gradient(circle_at_top_left,rgba(90,138,92,0.12),transparent_30%),linear-gradient(180deg,#ffffff_0%,#fbfaf7_100%)] p-8 shadow-[0_10px_40px_rgba(26,46,26,0.05)] sm:p-10">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_360px] lg:items-end">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#1a2e1a]/10 bg-white/80 px-3 py-1.5 text-[0.7rem] uppercase tracking-[0.2em] text-accent-warm backdrop-blur">
              <Layers3 className="h-3.5 w-3.5" />
              <span>Submission workspace</span>
            </div>
            <h1 className="mt-5 max-w-[12ch] font-serif text-[clamp(2rem,4vw,3.2rem)] leading-[0.98] tracking-[-0.05em] text-[#1a2e1a]">Every question tied back to the real source paper.</h1>
            <p className="mt-4 max-w-[64ch] text-[0.98rem] leading-[1.75] text-[#3d5a3f]/70">This workspace keeps the paper, uploaded student pages, OCR transcript, sliced mark scheme, auto-score, and saved review decision in one place. The goal is to make marking feel inspectable, not magical.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <div className="rounded-[1.25rem] border border-[#1a2e1a]/[0.06] bg-white/88 p-4 shadow-[0_8px_20px_rgba(26,46,26,0.04)] backdrop-blur">
              <div className="text-[0.72rem] uppercase tracking-[0.16em] text-accent-warm">Status</div>
              <p className="mt-3 font-serif text-[1.7rem] text-[#1a2e1a]">{formatStatus(initialBundle.submission.status)}</p>
            </div>
            <div className="rounded-[1.25rem] border border-[#1a2e1a]/[0.06] bg-white/88 p-4 shadow-[0_8px_20px_rgba(26,46,26,0.04)] backdrop-blur">
              <div className="flex items-center gap-2 text-[0.72rem] uppercase tracking-[0.16em] text-accent-warm"><Gauge className="h-3.5 w-3.5" /><span>Confidence</span></div>
              <p className="mt-3 font-serif text-[1.4rem] text-[#1a2e1a]">{confidenceLabel(initialBundle.insights.averageConfidence)}</p>
              <p className="mt-1 text-[0.78rem] text-[#3d5a3f]/55">{initialBundle.insights.averageConfidence !== null ? `${Math.round(initialBundle.insights.averageConfidence * 100)}% average` : "Run scoring to populate"}</p>
            </div>
            <div className="rounded-[1.25rem] border border-[#1a2e1a]/[0.06] bg-white/88 p-4 shadow-[0_8px_20px_rgba(26,46,26,0.04)] backdrop-blur">
              <div className="text-[0.72rem] uppercase tracking-[0.16em] text-accent-warm">Coverage</div>
              <p className="mt-3 font-serif text-[1.7rem] text-[#1a2e1a]">{initialBundle.insights.scoredCount}/{initialBundle.insights.questionCount}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4 xl:sticky xl:top-[92px] xl:self-start">
          <div className="rounded-[1.6rem] border border-[#1a2e1a]/[0.06] bg-white p-6 shadow-sm">
            <p className="text-[0.68rem] uppercase tracking-[0.18em] text-accent-warm">Submission</p>
            <h1 className="mt-2 font-serif text-[1.7rem] text-[#1a2e1a]">{initialBundle.submission.studentLabel || initialBundle.savedPaper?.title || "Untitled student paper"}</h1>
            <p className="mt-2 text-[0.86rem] text-[#3d5a3f]/60">{initialBundle.savedPaper?.title || initialBundle.submission.paperCode || "No paper reference yet"} · {formatStatus(initialBundle.submission.status)}</p>
            {initialBundle.savedPaper?.pdfUrl ? (
              <a href={initialBundle.savedPaper.pdfUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#1a2e1a]/10 px-4 py-2 text-[0.8rem] font-medium text-[#1a2e1a] hover:bg-[#faf8f3]">
                <Eye className="h-4 w-4" />
                <span>View saved paper PDF</span>
              </a>
            ) : null}
          </div>

          {initialBundle.savedPaperQuestions && initialBundle.savedPaperQuestions.length > 0 ? (
            <div className="rounded-[1.6rem] border border-[#1a2e1a]/[0.06] bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent"><FileUp className="h-4 w-4" /></div>
                <div>
                  <p className="text-[0.72rem] uppercase tracking-[0.14em] text-accent-warm">Saved composition</p>
                  <h2 className="font-serif text-[1.25rem] text-[#1a2e1a]">Source-linked questions</h2>
                </div>
              </div>
              <p className="mt-4 text-[0.84rem] leading-[1.6] text-[#3d5a3f]/60">
                {isImportedSubmission && hasImportedPages
                  ? "This submission was imported from a finished script PDF. Page images, OCR, and question mapping are already attached. Use the controls below to add extra pages or re-run scoring."
                  : "Upload the finished student script PDF to render pages, run handwriting OCR, map answers to your saved questions, and auto-score them."}
              </p>
              {!(isImportedSubmission && hasImportedPages) ? (
              <label className="mt-4 flex cursor-pointer items-center justify-center rounded-[1rem] border border-dashed border-[#1a2e1a]/15 bg-[#f5f2ea] px-4 py-6 text-center text-[0.84rem] text-[#3d5a3f]/60 hover:border-accent/35 hover:bg-white">
                <input type="file" accept="application/pdf" className="hidden" onChange={(event) => processFinishedPaperPdf(event.target.files?.[0] ?? null)} />
                {isPending ? "Processing finished paper PDF..." : "Upload finished paper PDF"}
              </label>
              ) : (
              <label className="mt-4 flex cursor-pointer items-center justify-center rounded-[1rem] border border-dashed border-[#1a2e1a]/15 bg-[#faf8f3] px-4 py-6 text-center text-[0.84rem] text-[#3d5a3f]/60 hover:border-accent/35 hover:bg-white">
                <input type="file" accept="application/pdf" className="hidden" onChange={(event) => processFinishedPaperPdf(event.target.files?.[0] ?? null)} />
                {isPending ? "Replacing script PDF..." : "Replace script PDF"}
              </label>
              )}
              <button type="button" onClick={autoScoreWholePaper} disabled={autoScoreLoadingKey === "__whole-paper__"} className="btn-press mt-4 inline-flex items-center gap-2 rounded-full bg-[#1a2e1a] px-4 py-2 text-[0.8rem] font-semibold text-white disabled:opacity-60">
                <Sparkles className="h-3.5 w-3.5" />
                <span>{autoScoreLoadingKey === "__whole-paper__" ? "Scoring whole paper..." : "Auto-score whole paper"}</span>
              </button>
              <label className="mt-4 flex cursor-pointer items-center justify-center rounded-[1rem] border border-dashed border-[#1a2e1a]/15 bg-[#faf8f3] px-4 py-6 text-center text-[0.84rem] text-[#3d5a3f]/60 hover:border-accent/35 hover:bg-white">
                <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => uploadFinishedScriptPages(event.target.files)} />
                {isPending ? "Uploading script pages..." : "Upload finished script pages"}
              </label>
              <button type="button" onClick={loadCombinedMarkScheme} disabled={isLoadingCombinedMarkScheme} className="btn-press mt-4 inline-flex items-center gap-2 rounded-full border border-[#1a2e1a]/10 px-4 py-2 text-[0.8rem] font-medium text-[#1a2e1a] hover:bg-[#faf8f3] disabled:opacity-60">
                <Brain className="h-4 w-4" />
                <span>{isLoadingCombinedMarkScheme ? "Loading mark scheme..." : combinedMarkScheme ? "Reload mark scheme" : "Load combined mark scheme"}</span>
              </button>
              {combinedMarkScheme?.failures && combinedMarkScheme.failures.length > 0 ? (
                <p className="mt-3 text-[0.78rem] text-[#9a5a2c]">{combinedMarkScheme.failures.length} mark scheme slice{combinedMarkScheme.failures.length === 1 ? "" : "s"} could not be loaded.</p>
              ) : null}
              {combinedMarkScheme ? (
                <div className="mt-4 overflow-hidden rounded-[1rem] border border-[#1a2e1a]/[0.06] bg-[#faf8f3]">
                  <div className="flex overflow-x-auto border-b border-[#1a2e1a]/[0.06] px-2 py-2">
                    {combinedMarkScheme.entries.map((entry) => (
                      <button
                        key={entry.questionKey}
                        type="button"
                        onClick={() => setActiveMarkSchemeQuestionKey(entry.questionKey)}
                        className={`shrink-0 rounded-full px-3 py-1.5 text-[0.74rem] font-medium transition-colors ${activeMarkSchemeQuestionKey === entry.questionKey || (!activeMarkSchemeQuestionKey && combinedMarkScheme.entries[0]?.questionKey === entry.questionKey) ? "bg-[#1a2e1a] text-white" : "text-[#1a2e1a]/65 hover:bg-white"}`}
                      >
                        {entry.label} 
                      </button>
                    ))}
                  </div>
                  <div className="max-h-[320px] overflow-y-auto p-4">
                    {activeMarkSchemeEntry ? (
                      <>
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-[#1a2e1a]">{activeMarkSchemeEntry.label}</p>
                          <a href={activeMarkSchemeEntry.markScheme.markSchemeUrl} target="_blank" rel="noreferrer" className="text-[0.76rem] font-medium text-[#1a2e1a]/65 underline">Open PDF</a>
                        </div>
                        <MathRichText text={activeMarkSchemeEntry.markScheme.partText} className="mt-3 text-[0.8rem] leading-[1.6] text-[#1a2e1a]/78" />
                      </>
                    ) : (
                      <p className="text-[0.8rem] text-[#3d5a3f]/60">No mark scheme entry loaded.</p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-[1.6rem] border border-[#1a2e1a]/[0.06] bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent"><FileUp className="h-4 w-4" /></div>
                <div>
                  <p className="text-[0.72rem] uppercase tracking-[0.14em] text-accent-warm">Unsupported path</p>
                  <h2 className="font-serif text-[1.25rem] text-[#1a2e1a]">This submission needs a saved generated paper</h2>
                </div>
              </div>
              <p className="mt-4 text-[0.84rem] leading-[1.6] text-[#3d5a3f]/60">The polished marking flow starts from a generated paper saved to your account. That is what lets the app resolve the original source paper, pull the right mark scheme, and slice the relevant question section automatically.</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-[1.3rem] border border-[#1a2e1a]/[0.06] bg-[linear-gradient(180deg,#ffffff_0%,#fbfaf7_100%)] p-5">
              <div className="flex items-center gap-2"><ScanText className="h-4 w-4 text-accent-warm" /><span className="text-[0.72rem] uppercase tracking-[0.14em] text-accent-warm">OCR complete</span></div>
              <p className="mt-2 font-serif text-[1.65rem] text-[#1a2e1a]">{initialBundle.insights.ocrCompletedCount}</p>
            </div>
            <div className="rounded-[1.3rem] border border-[#1a2e1a]/[0.06] bg-[linear-gradient(180deg,#ffffff_0%,#fbfaf7_100%)] p-5">
              <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent-warm" /><span className="text-[0.72rem] uppercase tracking-[0.14em] text-accent-warm">Marks saved</span></div>
              <p className="mt-2 font-serif text-[1.65rem] text-[#1a2e1a]">{initialBundle.insights.totalAwardedMarks}/{initialBundle.insights.totalMaxMarks}</p>
            </div>
            <div className="rounded-[1.3rem] border border-[#1a2e1a]/[0.06] bg-[linear-gradient(180deg,#ffffff_0%,#fbfaf7_100%)] p-5">
              <div className="flex items-center gap-2"><TriangleAlert className="h-4 w-4 text-accent-warm" /><span className="text-[0.72rem] uppercase tracking-[0.14em] text-accent-warm">Needs review</span></div>
              <p className="mt-2 font-serif text-[1.65rem] text-[#1a2e1a]">{initialBundle.insights.reviewRequiredCount}</p>
            </div>
          </div>

          {uploadError ? <p className="rounded-[1rem] border border-red-200 bg-red-50 px-4 py-3 text-[0.8rem] text-red-700">{uploadError}</p> : null}
        </aside>

        <div className="space-y-4">
          {reviewRows.length > 0 ? (
            <section className="rounded-[1.6rem] border border-[#d9a063]/20 bg-[linear-gradient(180deg,#fff8f0_0%,#ffffff_100%)] p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[0.72rem] uppercase tracking-[0.16em] text-[#b17436]">Review queue</p>
                  <h2 className="mt-1 font-serif text-[1.25rem] text-[#1a2e1a]">Questions needing human attention</h2>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full bg-[#fff2e6] px-3 py-1.5 text-[0.72rem] font-medium text-[#9a5a2c]"><ShieldAlert className="h-3.5 w-3.5" />{reviewRows.length} to review</div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {reviewRows.map((row) => (
                  <a key={`review-${row.questionKey}`} href={`#question-${row.questionKey}`} className="inline-flex items-center gap-2 rounded-full border border-[#d9a063]/25 bg-white px-3 py-2 text-[0.78rem] font-medium text-[#9a5a2c] hover:bg-[#fff6ee]">
                    <span>{formatQuestionLabel({ displayOrder: row.savedQuestion?.displayOrder, questionNumber: row.savedQuestion?.questionNumber, questionPartNumber: row.savedQuestion?.questionPartNumber, questionKey: row.questionKey })}</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-[1.6rem] border border-[#1a2e1a]/[0.06] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.16em] text-accent-warm">Question navigation</p>
                <p className="mt-1 text-[0.86rem] text-[#3d5a3f]/60">Jump around the paper with progress states instead of scanning the full page.</p>
              </div>
              {reviewRows.length > 0 ? (
                <div className="inline-flex items-center gap-2 rounded-full bg-[#fff2e6] px-3 py-1.5 text-[0.72rem] font-medium text-[#9a5a2c]"><ShieldAlert className="h-3.5 w-3.5" />{reviewRows.length} to review</div>
              ) : null}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {questionRows.map((row) => {
                const state = getQuestionState(row);
                return (
                  <a
                    key={`nav-${row.questionKey}`}
                    href={`#question-${row.questionKey}`}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[0.78rem] font-medium transition-colors ${getQuestionStateStyles(state)}`}
                  >
                    <span>{formatQuestionLabel({ displayOrder: row.savedQuestion?.displayOrder, questionNumber: row.savedQuestion?.questionNumber, questionPartNumber: row.savedQuestion?.questionPartNumber, questionKey: row.questionKey })}</span>
                    <span className="text-[0.68rem] uppercase tracking-[0.12em] opacity-70">{getQuestionStateLabel(state)}</span>
                  </a>
                );
              })}
            </div>
          </section>

          {questionRows.length === 0 ? (
            <div className="rounded-[1.6rem] border border-dashed border-[#1a2e1a]/10 bg-white px-6 py-16 text-center text-[0.92rem] text-[#3d5a3f]/58">Upload the first response page to start building this saved paper.</div>
          ) : questionRows.map((row) => {
            const scoreEvidence = parseScoreEvidence(row.score?.evidenceJson);
            const markSchemePreview = scoreEvidence?.markScheme?.partText || row.combinedMarkScheme?.markScheme.partText || null;
            const maxMarksDefault = row.score?.maxMarks ?? row.savedQuestion?.totalMarks ?? 0;

            return (
              <section id={`question-${row.questionKey}`} key={row.questionKey} className="scroll-mt-24 rounded-[1.6rem] border border-[#1a2e1a]/[0.06] bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-[0.72rem] uppercase tracking-[0.16em] text-accent-warm">Question</p>
                    <h2 className="mt-1 font-serif text-[1.35rem] text-[#1a2e1a]">{formatQuestionLabel({
                      displayOrder: row.savedQuestion?.displayOrder,
                      questionNumber: row.savedQuestion?.questionNumber,
                      questionPartNumber: row.savedQuestion?.questionPartNumber,
                      questionPath: row.savedQuestion?.questionPath,
                      questionKey: row.questionKey,
                    })}</h2>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-[#1a2e1a]/10 bg-[#faf8f3] px-2.5 py-1 text-[0.72rem] text-[#3d5a3f]/65">{row.savedQuestion?.paperCode ? `${row.savedQuestion.paperCode} · ${row.savedQuestion.year ?? ""} ${row.savedQuestion.session ?? ""}`.trim() : "Manual question"}</span>
                      <span className={`rounded-full border px-2.5 py-1 text-[0.72rem] ${getQuestionStateStyles(getQuestionState(row))}`}>{getQuestionStateLabel(getQuestionState(row), row.questionStatus)}</span>
                      <span className="rounded-full border border-[#1a2e1a]/10 bg-[#faf8f3] px-2.5 py-1 text-[0.72rem] text-[#3d5a3f]/65">{row.pages.length} uploaded page{row.pages.length === 1 ? "" : "s"}</span>
                    </div>
                    {row.questionStatus?.failureReason ? (
                      <p className="mt-2 text-[0.78rem] text-[#9a5a2c]">{row.questionStatus.failureReason}</p>
                    ) : null}
                    {row.score ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <div className="rounded-full border border-[#1a2e1a]/10 bg-[#faf8f3] px-3 py-1.5 text-[0.76rem] font-semibold text-[#1a2e1a]">
                          {row.score.scoreStatus === "confirmed" ? "Saved" : "AI suggestion"}: {row.score.awardedMarks}/{row.score.maxMarks}
                        </div>
                        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-[#1a2e1a]/8">
                          <div className={`h-full rounded-full ${row.score.confidence >= 0.85 ? "bg-[#5a8a5c]" : row.score.confidence >= 0.65 ? "bg-[#b38a43]" : "bg-[#b85b4f]"}`} style={{ width: `${Math.max(6, Math.min(100, row.score.confidence * 100))}%` }} />
                        </div>
                        <p className="text-[0.76rem] uppercase tracking-[0.12em] text-[#3d5a3f]/55">{Math.round(row.score.confidence * 100)}% confidence</p>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {row.savedQuestion ? (
                      <label className="btn-press inline-flex cursor-pointer items-center justify-center gap-2 rounded-full border border-[#1a2e1a]/10 bg-[#faf8f3] px-4 py-2.5 text-[0.8rem] font-medium text-[#1a2e1a] hover:bg-white">
                        <input type="file" accept="image/*" className="hidden" onChange={(event) => uploadPageForQuestion(row.questionKey, event.target.files?.[0] ?? null, row.savedQuestion?.questionNumber, row.savedQuestion?.questionPartNumber ?? null)} />
                        <FileUp className="h-4 w-4" />
                        <span>{isPending ? "Uploading..." : "Upload page"}</span>
                      </label>
                    ) : null}
                    {row.pages[0] ? (
                      <button type="button" onClick={() => runOcr(row.questionKey)} disabled={ocrLoadingKey === row.questionKey} className="btn-press inline-flex items-center justify-center gap-2 rounded-full border border-[#1a2e1a]/10 bg-[#faf8f3] px-4 py-2.5 text-[0.8rem] font-medium text-[#1a2e1a] hover:bg-white disabled:opacity-60">
                        <ScanText className="h-4 w-4" />
                        <span>{ocrLoadingKey === row.questionKey ? "Running OCR..." : row.response ? "Refresh OCR" : "Run OCR"}</span>
                      </button>
                    ) : null}
                    {row.savedQuestion && row.response ? (
                      <button type="button" onClick={() => autoScore(row.questionKey)} disabled={autoScoreLoadingKey === row.questionKey} className="btn-press inline-flex items-center justify-center gap-2 rounded-full bg-[#1a2e1a] px-4 py-2.5 text-[0.8rem] font-semibold text-white disabled:opacity-60">
                        <Sparkles className="h-4 w-4" />
                        <span>{autoScoreLoadingKey === row.questionKey ? "Auto-scoring..." : "Auto-score"}</span>
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-5 grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
                  <div className="space-y-3">
                    {row.pages.length > 0 ? row.pages.map((page) => (
                      <div key={page._id} className="overflow-hidden rounded-[1.2rem] border border-[#1a2e1a]/[0.06] bg-[#faf9f6]">
                        <div className="relative aspect-[4/5] bg-[#f1eee6]">
                          <Image src={page.sourceImageUrl} alt={page.fileName} fill className="object-cover" sizes="320px" unoptimized />
                        </div>
                        <div className="px-3 py-2 text-[0.74rem] text-[#3d5a3f]/55">{page.pageLabel || page.fileName}</div>
                      </div>
                    )) : (
                      <div className="rounded-[1.2rem] border border-dashed border-[#1a2e1a]/10 bg-[#faf8f3] px-4 py-8 text-center text-[0.82rem] text-[#3d5a3f]/55">No response page uploaded for this question yet.</div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-[1.2rem] border border-[#1a2e1a]/[0.06] bg-[linear-gradient(180deg,#faf8f3_0%,#fffdf8_100%)] p-4">
                      <div className="text-[0.76rem] uppercase tracking-[0.14em] text-accent-warm">Source prompt</div>
                      <MathRichText text={row.savedQuestion?.promptText || "Question source text is not linked for this row yet."} className="mt-3 text-[0.88rem] leading-[1.7] text-[#1a2e1a]/78" />
                      {row.savedQuestion?.contextText ? <MathRichText text={row.savedQuestion.contextText} className="mt-3 text-[0.82rem] leading-[1.6] text-[#3d5a3f]/60" /> : null}
                    </div>

                    <div className="rounded-[1.2rem] border border-[#1a2e1a]/[0.06] bg-[linear-gradient(180deg,#faf8f3_0%,#fffdf8_100%)] p-4">
                      <div className="flex items-center gap-2 text-[0.76rem] uppercase tracking-[0.14em] text-accent-warm"><Brain className="h-4 w-4" /> OCR transcript</div>
                      <MathRichText text={row.response?.ocrText || "Run OCR to extract the student’s answer text for this question."} className="mt-3 text-[0.88rem] leading-[1.7] text-[#1a2e1a]/78" />
                    </div>

                    <div className="rounded-[1.2rem] border border-[#1a2e1a]/[0.06] bg-[linear-gradient(180deg,#faf8f3_0%,#fffdf8_100%)] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[0.76rem] uppercase tracking-[0.14em] text-accent-warm">Relevant mark scheme</div>
                        {scoreEvidence?.markScheme?.markSchemeUrl || row.combinedMarkScheme?.markScheme.markSchemeUrl ? (
                          <a href={scoreEvidence?.markScheme?.markSchemeUrl || row.combinedMarkScheme?.markScheme.markSchemeUrl} target="_blank" rel="noreferrer" className="text-[0.76rem] font-medium text-[#1a2e1a]/65 underline">Open PDF</a>
                        ) : null}
                      </div>
                      {(scoreEvidence?.markScheme?.pageNumbers || row.combinedMarkScheme?.markScheme.pageNumbers) ? (
                        <p className="mt-2 text-[0.72rem] uppercase tracking-[0.12em] text-[#3d5a3f]/45">Pages {(scoreEvidence?.markScheme?.pageNumbers || row.combinedMarkScheme?.markScheme.pageNumbers || []).join(", ")}</p>
                      ) : null}
                      <MathRichText text={markSchemePreview || "Load the combined mark scheme or auto-score this question to populate the exact mark scheme slice used for grading."} className="mt-3 text-[0.84rem] leading-[1.65] text-[#1a2e1a]/78" />
                    </div>

                    <form key={`${row.questionKey}-${row.score?.updatedAt ?? "empty"}`} action={(formData) => saveScore(row.questionKey, formData)} className="rounded-[1.2rem] border border-[#1a2e1a]/[0.06] bg-white p-4 shadow-[0_6px_18px_rgba(26,46,26,0.03)]">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[0.76rem] uppercase tracking-[0.14em] text-accent-warm">Score decision</p>
                          <p className="mt-1 text-[0.8rem] text-[#3d5a3f]/58">Adjust the score manually or keep the model’s result and rationale.</p>
                        </div>
                        {row.score?.scoreStatus === "confirmed" ? <div className="rounded-full bg-[#f4f7f1] px-3 py-1.5 text-[0.76rem] font-medium text-[#3f6d44]">Saved</div> : row.score?.scoreStatus === "ai_suggested" ? <div className="rounded-full bg-[#eef4fb] px-3 py-1.5 text-[0.76rem] font-medium text-[#486781]">AI suggestion</div> : null}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <input name={`awarded-${row.questionKey}`} defaultValue={row.score?.awardedMarks ?? ""} placeholder="Awarded" type="number" min={0} className="rounded-xl border border-[#1a2e1a]/[0.08] bg-[#faf9f6] px-4 py-3 text-[0.88rem] outline-none focus:border-accent/35" />
                        <input name={`max-${row.questionKey}`} defaultValue={row.score?.maxMarks ?? row.savedQuestion?.totalMarks ?? ""} placeholder="Max" type="number" min={0} className="rounded-xl border border-[#1a2e1a]/[0.08] bg-[#faf9f6] px-4 py-3 text-[0.88rem] outline-none focus:border-accent/35" />
                        <input name={`confidence-${row.questionKey}`} defaultValue={row.score?.confidence ?? ""} placeholder="Confidence" type="number" min={0} max={1} step="0.05" className="rounded-xl border border-[#1a2e1a]/[0.08] bg-[#faf9f6] px-4 py-3 text-[0.88rem] outline-none focus:border-accent/35" />
                      </div>
                      <textarea name={`rationale-${row.questionKey}`} defaultValue={row.score?.rationale ?? ""} placeholder="Why this mark was awarded or why it needs review. LaTeX supported, e.g. $x^2 + 3x$." className="mt-3 min-h-[110px] w-full rounded-xl border border-[#1a2e1a]/[0.08] bg-[#faf9f6] px-4 py-3 text-[0.88rem] leading-[1.6] outline-none focus:border-accent/35" />
                      <label className="mt-3 flex items-center gap-2 text-[0.82rem] text-[#1a2e1a]/70">
                        <input type="checkbox" name={`review-${row.questionKey}`} defaultChecked={row.score?.needsReview === true} />
                        Flag for review
                      </label>
                      <button type="submit" disabled={scoreLoadingKey === row.questionKey} className="btn-press mt-4 inline-flex items-center gap-2 rounded-full bg-[#1a2e1a] px-4 py-2.5 text-[0.82rem] font-semibold text-white disabled:opacity-60">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>{scoreLoadingKey === row.questionKey ? "Saving..." : "Save score"}</span>
                      </button>
                    </form>

                    {scoreEvidence?.markBreakdown && scoreEvidence.markBreakdown.length > 0 ? (
                      <div className="rounded-[1.2rem] border border-[#1a2e1a]/[0.06] bg-white p-4 shadow-[0_6px_18px_rgba(26,46,26,0.03)]">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[0.76rem] uppercase tracking-[0.14em] text-accent-warm">Auto-score breakdown</p>
                            <p className="mt-1 text-[0.8rem] text-[#3d5a3f]/58">A clearer view of what the model believed it awarded or withheld.</p>
                          </div>
                        </div>
                        <div className="mt-3 space-y-2">
                          {scoreEvidence.markBreakdown.map((entry, index) => (
                            <div key={`${row.questionKey}-${index}`} className="rounded-xl bg-[#faf8f3] px-3 py-3 text-[0.82rem] text-[#1a2e1a]/78">
                              <p className="font-medium text-[#1a2e1a]">{entry.criterion} · <span className={entry.awarded ? "text-[#3f6d44]" : "text-[#9a5a2c]"}>{entry.awarded ? "awarded" : "not awarded"}</span></p>
                              <MathRichText text={entry.evidence ?? ""} className="mt-1 text-[#3d5a3f]/60" />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {row.score?.rationale ? (
                      <div className="rounded-[1.2rem] border border-[#1a2e1a]/[0.06] bg-white p-4 shadow-[0_6px_18px_rgba(26,46,26,0.03)]">
                        <div className="text-[0.76rem] uppercase tracking-[0.14em] text-accent-warm">Saved rationale</div>
                        <MathRichText text={row.score.rationale} className="mt-3 text-[0.84rem] leading-[1.65] text-[#1a2e1a]/78" />
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}
