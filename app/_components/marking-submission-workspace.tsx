"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Brain, Check, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, FileUp, Minus, Plus, RotateCcw, ScanText, Sparkles, Upload } from "lucide-react";
import { MathRichText } from "@/app/_components/math-rich-text";
import { OperationNotice, statusToneClass } from "@/app/_components/marking/presentation";
import { QuestionProgressRail, type QuestionProgressState } from "@/app/_components/marking/question-progress";

export type MarkingSubmissionBundle = {
  submission: {
    subjectKey: string;
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
    canonicalLeafIds?: string[];
    topicLabels?: string[];
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

type QuestionStatus = NonNullable<MarkingSubmissionBundle["questionStatuses"]>[number];

type QuestionRow = {
  questionKey: string;
  savedQuestion: NonNullable<MarkingSubmissionBundle["savedPaperQuestions"]>[number] | null;
  pages: MarkingSubmissionBundle["pages"];
  response: MarkingSubmissionBundle["responses"][number] | null;
  score: MarkingSubmissionBundle["scores"][number] | null;
  questionStatus: QuestionStatus | null;
  combinedMarkScheme: CombinedMarkSchemeEntry | null;
};

type FeedbackScope = "setup" | "upload" | "ocr" | "score" | "mark-scheme" | "bulk" | "whole-paper";

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

function formatStatus(status: MarkingSubmissionBundle["submission"]["status"]) {
  if (status === "uploaded") return "Uploaded";
  if (status === "ocr_complete") return "OCR complete";
  if (status === "review_required") return "Needs review";
  return "Scored";
}

function getQuestionState(row: Pick<QuestionRow, "pages" | "response" | "score" | "questionStatus">) {
  if (row.questionStatus?.status === "failed") return "failed" as const;
  if (row.questionStatus?.status === "needs_manual_review") return "review" as const;
  if (row.score?.scoreStatus === "confirmed") return row.score.needsReview ? "review" as const : "scored" as const;
  if (row.score?.scoreStatus === "ai_suggested") return row.score.needsReview ? "review" as const : "suggested" as const;
  if (row.score?.needsReview) return "review" as const;
  if (row.score) return "scored" as const;
  if (row.response) return "ocr" as const;
  if (row.pages.length > 0) return "uploaded" as const;
  return "empty" as const;
}

function getQuestionStateLabel(state: ReturnType<typeof getQuestionState>) {
  if (state === "failed") return "Failed";
  if (state === "review") return "Needs review";
  if (state === "scored") return "Scored";
  if (state === "suggested") return "AI suggestion";
  if (state === "ocr") return "OCR ready";
  if (state === "uploaded") return "Waiting for OCR";
  return "Waiting";
}

function getQuestionStateTone(state: ReturnType<typeof getQuestionState>) {
  if (state === "failed") return "failure" as const;
  if (state === "review") return "review" as const;
  if (state === "scored") return "confirmed" as const;
  if (state === "suggested") return "active" as const;
  if (state === "ocr") return "active" as const;
  return "neutral" as const;
}

function prioritizeQuestion(row: QuestionRow) {
  const state = getQuestionState(row);
  if (state === "review" || state === "failed") return 0;
  if (state === "ocr") return 1;
  if (state === "uploaded" || state === "empty") return 2;
  return 3;
}

export function MarkingSubmissionWorkspace({ submissionId, initialBundle }: { submissionId: string; initialBundle: MarkingSubmissionBundle }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [operationFeedback, setOperationFeedback] = useState<{ scope: FeedbackScope; message: string } | null>(null);
  const [ocrLoadingKey, setOcrLoadingKey] = useState<string | null>(null);
  const [scoreLoadingKey, setScoreLoadingKey] = useState<string | null>(null);
  const [autoScoreLoadingKey, setAutoScoreLoadingKey] = useState<string | null>(null);
  const [combinedMarkScheme, setCombinedMarkScheme] = useState<{ entries: CombinedMarkSchemeEntry[]; combinedText: string; failures?: Array<{ questionKey: string; error: string }> } | null>(null);
  const [isLoadingCombinedMarkScheme, setIsLoadingCombinedMarkScheme] = useState(false);
  const [selectedQuestionKey, setSelectedQuestionKey] = useState<string | null>(null);
  const [pageLabel, setPageLabel] = useState("");
  const [pendingBulkFiles, setPendingBulkFiles] = useState<File[]>([]);

  const questionRows = useMemo<QuestionRow[]>(() => {
    const savedQuestions = initialBundle.savedPaperQuestions ?? [];
    const questionKeys = savedQuestions.length > 0
      ? savedQuestions.map((question) => question.unitKey)
      : Array.from(new Set([
          ...initialBundle.pages.map((page) => page.questionKey),
          ...initialBundle.responses.map((response) => response.questionKey),
          ...initialBundle.scores.map((score) => score.questionKey),
        ]));
    const savedQuestionByKey = new Map(savedQuestions.map((question) => [question.unitKey, question]));
    const pagesByKey = new Map<string, MarkingSubmissionBundle["pages"]>();
    for (const page of initialBundle.pages) {
      const pages = pagesByKey.get(page.questionKey) ?? [];
      pages.push(page);
      pagesByKey.set(page.questionKey, pages);
    }
    const responseByKey = new Map(initialBundle.responses.map((response) => [response.questionKey, response]));
    const scoreByKey = new Map(initialBundle.scores.map((score) => [score.questionKey, score]));
    const statusByKey = new Map(initialBundle.questionStatuses?.map((status) => [status.questionKey, status]) ?? []);
    const markSchemeByKey = new Map(combinedMarkScheme?.entries.map((entry) => [entry.questionKey, entry]) ?? []);
    return questionKeys.map((questionKey) => ({
      questionKey,
      savedQuestion: savedQuestionByKey.get(questionKey) ?? null,
      pages: pagesByKey.get(questionKey) ?? [],
      response: responseByKey.get(questionKey) ?? null,
      score: scoreByKey.get(questionKey) ?? null,
      questionStatus: statusByKey.get(questionKey) ?? null,
      combinedMarkScheme: markSchemeByKey.get(questionKey) ?? null,
    }));
  }, [combinedMarkScheme?.entries, initialBundle.pages, initialBundle.questionStatuses, initialBundle.responses, initialBundle.savedPaperQuestions, initialBundle.scores]);

  const activeQuestionKey = useMemo(() => {
    if (selectedQuestionKey && questionRows.some((row) => row.questionKey === selectedQuestionKey)) return selectedQuestionKey;
    return [...questionRows].sort((left, right) => prioritizeQuestion(left) - prioritizeQuestion(right))[0]?.questionKey ?? null;
  }, [questionRows, selectedQuestionKey]);
  const activeRow = questionRows.find((row) => row.questionKey === activeQuestionKey) ?? null;
  const activeRowIndex = activeRow ? questionRows.findIndex((row) => row.questionKey === activeRow.questionKey) : -1;
  const nextQuestion = activeRowIndex >= 0 ? questionRows[activeRowIndex + 1] ?? null : null;
  const previousQuestion = activeRowIndex > 0 ? questionRows[activeRowIndex - 1] ?? null : null;
  const isImportedSubmission = initialBundle.submission.importSource === "imported_pdf";
  const hasImportedPages = initialBundle.pages.length > 0;
  const canAutoScoreWholePaper = questionRows.length > 0 && questionRows.every((row) => Boolean(row.response));
  const bulkUploadTargets = useMemo(() => questionRows.filter((row) => row.pages.length === 0 && row.savedQuestion).map((row) => row.savedQuestion!), [questionRows]);
  const reviewRows = useMemo(() => questionRows.filter((row) => {
    const state = getQuestionState(row);
    return state === "review" || state === "failed";
  }), [questionRows]);
  const activeMarkSchemeEntry = useMemo(() => {
    return questionRows.find((row) => row.questionKey === activeQuestionKey)?.combinedMarkScheme ?? null;
  }, [activeQuestionKey, questionRows]);

  const showFeedback = (scope: FeedbackScope) => operationFeedback?.scope === scope ? <OperationNotice message={operationFeedback.message} /> : null;
  const fail = (scope: FeedbackScope, cause: unknown, fallback: string) => {
    setOperationFeedback({ scope, message: cause instanceof Error ? cause.message : fallback });
  };

  const uploadPageForQuestion = (questionKey: string, file: File | null, questionNumberOverride?: string, questionPartNumberOverride?: string | null) => {
    if (!file) return;
    setOperationFeedback(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("submissionId", submissionId);
        formData.append("questionKey", questionKey);
        if (questionNumberOverride) formData.append("questionNumber", questionNumberOverride);
        if (questionPartNumberOverride) formData.append("questionPartNumber", questionPartNumberOverride);
        if (pageLabel.trim()) formData.append("pageLabel", pageLabel.trim());
        formData.append("file", file);
        const response = await fetch("/api/marking/uploads", { method: "POST", body: formData });
        if (!response.ok) throw new Error(await response.text() || "Could not upload response page.");
        setPageLabel("");
        router.refresh();
      } catch (cause) {
        fail("upload", cause, "Could not upload response page.");
      }
    });
  };

  const uploadFinishedScriptPages = (files: File[]) => {
    const savedQuestions = initialBundle.savedPaperQuestions ?? [];
    if (files.length === 0) return;
    if (savedQuestions.length === 0) {
      setOperationFeedback({ scope: "bulk", message: "This submission needs a linked saved paper before script pages can be assigned automatically." });
      return;
    }
    const targetQuestions = questionRows.filter((row) => row.pages.length === 0).map((row) => row.savedQuestion).filter((question): question is NonNullable<typeof question> => question !== null);
    if (targetQuestions.length === 0) {
      setOperationFeedback({ scope: "bulk", message: "Every generated question already has an uploaded page. Use the per-question upload control for extra pages." });
      return;
    }
    if (files.length > targetQuestions.length) {
      setOperationFeedback({ scope: "bulk", message: `You selected ${files.length} pages but only ${targetQuestions.length} questions are still missing uploads. Extra pages were not assigned automatically.` });
    } else {
      setOperationFeedback(null);
    }
    startTransition(async () => {
      try {
        for (let index = 0; index < Math.min(files.length, targetQuestions.length); index += 1) {
          const file = files[index];
          const question = targetQuestions[index];
          const formData = new FormData();
          formData.append("submissionId", submissionId);
          formData.append("questionKey", question.unitKey);
          formData.append("questionNumber", question.questionNumber);
          if (question.questionPartNumber) formData.append("questionPartNumber", question.questionPartNumber);
          formData.append("pageLabel", `Script page ${index + 1}`);
          formData.append("file", file);
          const response = await fetch("/api/marking/uploads", { method: "POST", body: formData });
          if (!response.ok) throw new Error(await response.text() || `Could not upload script page ${index + 1}.`);
        }
        setPageLabel("");
        setPendingBulkFiles([]);
        router.refresh();
      } catch (cause) {
        fail("bulk", cause, "Could not upload the selected answer images.");
      }
    });
  };

  const processFinishedPaperPdf = (file: File | null) => {
    if (!file) return;
    setOperationFeedback(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("submissionId", submissionId);
        const response = await fetch("/api/marking/import-finished-paper", { method: "POST", body: formData });
        if (!response.ok) throw new Error(await response.text() || "Could not import the finished paper PDF.");
        router.refresh();
      } catch (cause) {
        fail("setup", cause, "Could not import the finished paper PDF.");
      }
    });
  };

  const runOcr = async (questionKey: string) => {
    setOcrLoadingKey(questionKey);
    setOperationFeedback(null);
    try {
      const response = await fetch("/api/marking/ocr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submissionId, questionKey }) });
      if (!response.ok) throw new Error(await response.text() || "Could not run OCR.");
      router.refresh();
    } catch (cause) {
      fail("ocr", cause, "Could not run OCR.");
    } finally {
      setOcrLoadingKey(null);
    }
  };

  const autoScore = async (questionKey: string) => {
    setAutoScoreLoadingKey(questionKey);
    setOperationFeedback(null);
    try {
      const response = await fetch("/api/marking/auto-score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submissionId, questionKey }) });
      if (!response.ok) throw new Error(await response.text() || "Could not auto-score this question.");
      router.refresh();
    } catch (cause) {
      fail("score", cause, "Could not auto-score this question.");
    } finally {
      setAutoScoreLoadingKey(null);
    }
  };

  const autoScoreWholePaper = async () => {
    setAutoScoreLoadingKey("__whole-paper__");
    setOperationFeedback(null);
    try {
      const response = await fetch("/api/marking/auto-score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submissionId, scoreWholePaper: true }) });
      if (!response.ok) throw new Error(await response.text() || "Could not auto-score the full paper.");
      router.refresh();
    } catch (cause) {
      fail("whole-paper", cause, "Could not auto-score the full paper.");
    } finally {
      setAutoScoreLoadingKey(null);
    }
  };

  const saveScore = async (questionKey: string, formData: FormData) => {
    setScoreLoadingKey(questionKey);
    setOperationFeedback(null);
    const awardedMarks = Number(formData.get(`awarded-${questionKey}`) ?? 0);
    const maxMarks = Number(formData.get(`max-${questionKey}`) ?? 0);
    const rationale = String(formData.get(`rationale-${questionKey}`) ?? "").trim();
    const confidence = Number(formData.get(`confidence-${questionKey}`) ?? 0.5);
    const needsReview = formData.get(`review-${questionKey}`) === "on";
    const existingScore = initialBundle.scores.find((entry) => entry.questionKey === questionKey);
    const existingEvidence = parseScoreEvidence(existingScore?.evidenceJson);
    try {
      const response = await fetch("/api/marking/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, questionKey, awardedMarks, maxMarks, confidence, needsReview, rationale, evidence: existingEvidence ?? { savedFrom: "marking-workspace" } }),
      });
      if (!response.ok) throw new Error(await response.text() || "Could not save score.");
      if (formData.get("saveAction") === "next" && nextQuestion) setSelectedQuestionKey(nextQuestion.questionKey);
      router.refresh();
    } catch (cause) {
      fail("score", cause, "Could not save score.");
    } finally {
      setScoreLoadingKey(null);
    }
  };

  const loadCombinedMarkScheme = useCallback(async () => {
    setIsLoadingCombinedMarkScheme(true);
    setOperationFeedback(null);
    try {
      const response = await fetch(`/api/marking/submissions/${submissionId}/mark-scheme`);
      if (!response.ok) throw new Error(await response.text() || "Could not load combined mark scheme.");
      const payload = await response.json() as { entries: CombinedMarkSchemeEntry[]; combinedText: string; failures?: Array<{ questionKey: string; error: string }> };
      setCombinedMarkScheme(payload);
    } catch (cause) {
      fail("mark-scheme", cause, "Could not load combined mark scheme.");
    } finally {
      setIsLoadingCombinedMarkScheme(false);
    }
  }, [submissionId]);

  useEffect(() => {
    if ((initialBundle.savedPaperQuestions ?? []).length === 0 || combinedMarkScheme) return;
    const timeoutId = window.setTimeout(() => void loadCombinedMarkScheme(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [combinedMarkScheme, initialBundle.savedPaperQuestions, loadCombinedMarkScheme]);

  const activeScoreEvidence = activeRow ? parseScoreEvidence(activeRow.score?.evidenceJson) : null;
  const activeMarkSchemePreview = activeScoreEvidence?.markScheme?.partText || activeRow?.combinedMarkScheme?.markScheme.partText || null;
  const activeMarkSchemeUrl = activeScoreEvidence?.markScheme?.markSchemeUrl || activeRow?.combinedMarkScheme?.markScheme.markSchemeUrl;
  const activeMarkSchemePages = activeScoreEvidence?.markScheme?.pageNumbers || activeRow?.combinedMarkScheme?.markScheme.pageNumbers;
  const confirmedMarks = initialBundle.scores.filter((score) => score.scoreStatus === "confirmed").reduce((sum, score) => sum + score.awardedMarks, 0);
  const paperMarks = (initialBundle.savedPaperQuestions ?? []).reduce((sum, question) => sum + question.totalMarks, 0) || initialBundle.insights.totalMaxMarks;
  const activeTopicLabel = activeRow?.savedQuestion?.topicLabels?.[0];

  const progressItems = questionRows.map((row, index) => {
    const state = getQuestionState(row);
    let progressState: QuestionProgressState = "waiting";
    if (row.questionKey === activeQuestionKey) progressState = "current";
    else if (row.score?.scoreStatus === "confirmed" && !row.score.needsReview) progressState = "confirmed";
    else if (state === "review") progressState = "review";
    else if (state === "failed") progressState = "failed";
    else if (state === "ocr" || state === "scored" || state === "suggested") progressState = "ready";
    return { key: row.questionKey, label: String(index + 1).padStart(2, "0"), state: progressState };
  });

  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 border-b border-text/10 pb-3 text-[0.875rem] text-text-muted">
        <Link href="/marking" className="hover:text-accent">Mark your papers</Link><span aria-hidden="true">/</span><span>{initialBundle.savedPaper?.title || initialBundle.submission.paperCode || "Saved paper"}</span><span aria-hidden="true">/</span><span className="font-semibold text-text">{activeRow ? formatQuestionLabel({ questionNumber: activeRow.savedQuestion?.questionNumber, questionPartNumber: activeRow.savedQuestion?.questionPartNumber, questionKey: activeRow.questionKey }) : "Questions"}</span>
      </nav>

      <header className="border-b border-text/10 pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[clamp(1.65rem,3vw,2.25rem)] font-bold leading-tight tracking-[-0.035em] text-text">{activeTopicLabel || initialBundle.savedPaper?.title || initialBundle.submission.studentLabel || "Untitled revision paper"}</h1>
              <span className={`border px-2 py-1 text-[0.75rem] font-semibold ${statusToneClass(initialBundle.submission.status === "review_required" ? "review" : initialBundle.submission.status === "scored" ? "confirmed" : initialBundle.submission.status === "ocr_complete" ? "active" : "neutral")}`}>{formatStatus(initialBundle.submission.status)}</span>
            </div>
            <p className="mt-1 text-[0.875rem] text-text-muted">{activeRow ? `${formatQuestionLabel({ questionNumber: activeRow.savedQuestion?.questionNumber, questionPartNumber: activeRow.savedQuestion?.questionPartNumber, questionPath: activeRow.savedQuestion?.questionPath, questionKey: activeRow.questionKey })} of ${questionRows.length} · ${activeRow.savedQuestion?.totalMarks ?? activeRow.score?.maxMarks ?? 0} marks` : initialBundle.submission.paperCode || "No paper reference yet"}</p>
          </div>
          <p className="text-[0.95rem] font-semibold tabular-nums text-text">{confirmedMarks} / {paperMarks} confirmed</p>
        </div>
        {progressItems.length > 0 ? <div className="mt-4 overflow-x-auto pb-1"><QuestionProgressRail items={progressItems} activeKey={activeQuestionKey} onSelect={setSelectedQuestionKey} /></div> : null}
      </header>

      <details className="border-b border-text/10 pb-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-1 text-[0.875rem] font-semibold text-text-secondary marker:hidden"><span className="inline-flex items-center gap-2"><FileUp className="h-4 w-4 text-accent" /> Setup and import utilities</span><span className="text-[0.8rem] font-normal text-text-muted">OCR {initialBundle.insights.ocrCompletedCount}/{initialBundle.insights.questionCount} · {reviewRows.length} review</span></summary>
        <div className="mt-3 border-t border-text/10 pt-3">
          <div className="flex flex-wrap gap-2">
            {initialBundle.savedPaper?.pdfUrl ? <a href={initialBundle.savedPaper.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 border border-text/15 bg-white px-3 text-[0.875rem] font-semibold text-text-secondary hover:border-accent"><ExternalLink className="h-4 w-4" /> Source PDF</a> : null}
            {initialBundle.savedPaperQuestions && initialBundle.savedPaperQuestions.length > 0 ? <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 border border-text/15 bg-white px-3 text-[0.875rem] font-semibold text-text-secondary hover:border-accent"><input type="file" accept="application/pdf" className="sr-only" onChange={(event) => processFinishedPaperPdf(event.target.files?.[0] ?? null)} /><Upload className="h-4 w-4" />{isPending ? (isImportedSubmission && hasImportedPages ? "Replacing PDF..." : "Processing PDF...") : isImportedSubmission && hasImportedPages ? "Replace script PDF" : "Import script PDF"}</label> : null}
            <button type="button" onClick={autoScoreWholePaper} disabled={!canAutoScoreWholePaper || autoScoreLoadingKey === "__whole-paper__"} className="inline-flex min-h-10 items-center gap-2 bg-accent px-3 text-[0.875rem] font-semibold text-white disabled:opacity-45"><Sparkles className="h-4 w-4" />{autoScoreLoadingKey === "__whole-paper__" ? "Scoring paper..." : "Auto-score paper"}</button>
            <button type="button" onClick={() => void loadCombinedMarkScheme()} disabled={isLoadingCombinedMarkScheme} className="inline-flex min-h-10 items-center gap-2 border border-text/15 bg-white px-3 text-[0.875rem] font-semibold text-text-secondary disabled:opacity-45"><Brain className="h-4 w-4" />{isLoadingCombinedMarkScheme ? "Loading scheme..." : combinedMarkScheme ? "Refresh scheme" : "Load mark scheme"}</button>
          </div>
          {!canAutoScoreWholePaper ? <p className="mt-2 text-[0.8rem] text-text-muted">Whole-paper scoring unlocks when every question has an OCR transcript.</p> : null}
          {initialBundle.savedPaperQuestions && initialBundle.savedPaperQuestions.length > 0 ? <div className="mt-4 border-t border-text/10 pt-3"><label className="inline-flex min-h-10 cursor-pointer items-center border border-dashed border-text/25 px-3 text-[0.875rem] font-semibold text-text-secondary"><input type="file" accept="image/*" multiple className="sr-only" onChange={(event) => setPendingBulkFiles(Array.from(event.target.files ?? []))} />Choose answer images in question order</label>{pendingBulkFiles.length > 0 ? <div className="mt-3 max-w-2xl border border-info/20 bg-info-soft p-3"><p className="text-[0.875rem] font-semibold text-info">{pendingBulkFiles.length} files selected for {bulkUploadTargets.length} available questions</p><div className="mt-2 divide-y divide-info/10">{pendingBulkFiles.map((file, index) => <div key={`${file.name}-${file.lastModified}`} className="flex justify-between gap-3 py-2 text-[0.8rem]"><span className="truncate">{file.name}</span><span className="shrink-0 font-semibold">{bulkUploadTargets[index] ? formatQuestionLabel({ displayOrder: bulkUploadTargets[index].displayOrder, questionNumber: bulkUploadTargets[index].questionNumber, questionPartNumber: bulkUploadTargets[index].questionPartNumber, questionPath: bulkUploadTargets[index].questionPath, questionKey: bulkUploadTargets[index].unitKey }) : "Not assigned"}</span></div>)}</div><div className="mt-3 flex gap-2"><button type="button" onClick={() => uploadFinishedScriptPages(pendingBulkFiles)} disabled={isPending || pendingBulkFiles.length > bulkUploadTargets.length} className="bg-info px-3 py-2 text-[0.875rem] font-semibold text-white disabled:opacity-45">Confirm upload</button><button type="button" onClick={() => setPendingBulkFiles([])} className="border border-info/25 bg-white px-3 py-2 text-[0.875rem] font-semibold text-info">Cancel</button></div></div> : null}</div> : null}
          {showFeedback("setup") || showFeedback("whole-paper") || showFeedback("mark-scheme") || showFeedback("bulk") ? <div className="mt-3 space-y-2">{showFeedback("setup")}{showFeedback("whole-paper")}{showFeedback("mark-scheme")}{showFeedback("bulk")}</div> : null}
        </div>
      </details>

      {questionRows.length === 0 ? <div className="border border-dashed border-text/15 px-6 py-12 text-center text-[0.8rem] text-text-muted">Upload the first response page to start reviewing this saved paper.</div> : activeRow ? (
        <div className="grid border-y border-text/10 xl:grid-cols-[12.5rem_minmax(0,1fr)]">
          <aside className="hidden border-r border-text/10 bg-white py-3 xl:block" aria-label="Questions">
            <p className="px-4 pb-3 text-[0.72rem] font-bold uppercase tracking-[0.1em] text-text-muted">Questions</p>
            <div>
              {questionRows.map((row, index) => {
                const questionState = getQuestionState(row);
                const isActive = row.questionKey === activeQuestionKey;
                const dotClass = row.score?.scoreStatus === "confirmed" && !row.score.needsReview ? "bg-success" : questionState === "review" || questionState === "failed" ? "bg-warning" : isActive ? "bg-accent" : "bg-text-subtle";
                return (
                  <button key={row.questionKey} type="button" onClick={() => setSelectedQuestionKey(row.questionKey)} aria-current={isActive ? "true" : undefined} className={`flex min-h-11 w-full items-center gap-3 border-r-2 px-4 text-left text-[0.8rem] transition-colors ${isActive ? "border-accent bg-accent-soft text-accent" : "border-transparent text-text-secondary hover:bg-bg-soft hover:text-text"}`}>
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
                    <span className="w-5 font-mono tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                    <span className="truncate text-[0.72rem] font-medium">{getQuestionStateLabel(questionState)}</span>
                  </button>
                );
              })}
            </div>
          </aside>
          <div className="min-w-0 py-3 xl:pl-4">
            <ActiveQuestionPanel
              key={`${activeRow.questionKey}-${activeRow.score?.updatedAt ?? "empty"}`}
              row={activeRow}
              nextQuestion={nextQuestion}
              previousQuestion={previousQuestion}
              isPending={isPending}
              pageLabel={pageLabel}
              setPageLabel={setPageLabel}
              uploadPageForQuestion={uploadPageForQuestion}
              runOcr={runOcr}
              ocrLoadingKey={ocrLoadingKey}
              autoScore={autoScore}
              autoScoreLoadingKey={autoScoreLoadingKey}
              scoreLoadingKey={scoreLoadingKey}
              saveScore={saveScore}
              activeMarkSchemeEntry={activeMarkSchemeEntry}
              activeMarkSchemePreview={activeMarkSchemePreview}
              activeMarkSchemeUrl={activeMarkSchemeUrl}
              activeMarkSchemePages={activeMarkSchemePages}
              activeTopicLabel={activeTopicLabel}
              activeTopicIds={activeRow.savedQuestion?.canonicalLeafIds ?? []}
              subjectKey={initialBundle.submission.subjectKey}
              setSelectedQuestionKey={setSelectedQuestionKey}
              showFeedback={showFeedback}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActiveQuestionPanel({
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
  const [awarded, setAwarded] = useState(Math.min(row.score?.awardedMarks ?? 0, initialMaximum));
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
            <div className="mt-8 flex items-center justify-center gap-3"><button type="button" onClick={() => setAwarded((current) => Math.max(0, current - 1))} disabled={awarded <= 0} aria-label="Decrease awarded marks" className="flex h-12 w-12 items-center justify-center border border-text/25 bg-white text-text disabled:opacity-35"><Minus className="h-5 w-5" /></button><label className="sr-only" htmlFor={`awarded-${row.questionKey}`}>Awarded marks</label><input id={`awarded-${row.questionKey}`} name={`awarded-${row.questionKey}`} value={awarded} onChange={(event) => setAwarded(Math.min(maximum, Math.max(0, Number(event.target.value))))} type="number" min={0} max={maximum} className="w-16 bg-transparent text-center font-mono text-[3.5rem] font-bold leading-none text-text outline-none" /><span className="text-[1.75rem] text-text-muted">/</span><label className="sr-only" htmlFor={`max-${row.questionKey}`}>Maximum marks</label><input id={`max-${row.questionKey}`} name={`max-${row.questionKey}`} value={maximum} onChange={(event) => updateMaximum(Number(event.target.value))} type="number" min={0} className="w-12 bg-transparent text-center font-mono text-[1.75rem] text-text-muted outline-none" /><button type="button" onClick={() => setAwarded((current) => Math.min(maximum, current + 1))} disabled={awarded >= maximum} aria-label="Increase awarded marks" className="flex h-12 w-12 items-center justify-center border border-text/25 bg-white text-text disabled:opacity-35"><Plus className="h-5 w-5" /></button></div>
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
